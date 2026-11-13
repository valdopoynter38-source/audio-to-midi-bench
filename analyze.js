// 统一评分：同一把尺子量所有工具。
// 口径（写进视频描述，谁都能复算）。两侧分开记，各自封闭：
//
//   真值侧 11 个音：  correct + wrong + missing = 11
//     1) 对每条真值音，取窗口 [start+0.03, end-0.03]
//     2) 覆盖该窗口最多的音高就是引擎的答案；覆盖率 <50% 记 missing，音高不等记 wrong
//
//   输出侧 N 个音：  used + spurious + glide + dangling = N
//     3) 落在滑音段 [6.60,7.20] 内的输出 → glide（真值两解，不计分）
//     4) 与所有真值音重叠总和不足自身时长 50% 的输出 → spurious
//     5) 剩下的里，被某条真值音选为答案的 → used
//     6) 剩下仍无人认领的 → dangling（正常应为 0；不为 0 说明有输出凭空消失，
//        这正是这张表以前出过的问题，故此处直接抛错而不是静默丢弃）
//
//   优先级 glide > spurious > used：一个输出只进一个桶。
//   注意 spurious 会盖过 used —— 一个 0.6 s 的音认领了两条 0.15 s 的真值音，
//   就算它是唯一可用的答案，它本身仍是噪声块，两处都记才对得上账。
const fs = require('fs');

function parseMidi(path) {
  const b = fs.readFileSync(path);
  let off = 0;
  const readVar = () => { let v = 0, c; do { c = b[off++]; v = (v << 7) | (c & 0x7f); } while (c & 0x80); return v; };
  if (b.toString('ascii', 0, 4) !== 'MThd') throw new Error('not midi');
  const hlen = b.readUInt32BE(4);
  const division = b.readUInt16BE(12);
  off = 8 + hlen;
  const notes = [];
  const open = new Map();
  while (off < b.length) {
    const id = b.toString('ascii', off, off + 4);
    const len = b.readUInt32BE(off + 4);
    const end = off + 8 + len;
    off += 8;
    if (id === 'MTrk') {
      let tick = 0, running = 0;
      while (off < end) {
        tick += readVar();
        let status = b[off];
        if (status & 0x80) { off++; running = status; } else status = running;
        const type = status & 0xf0;
        if (status === 0xff) { off++; const l = readVar(); off += l; continue; }
        if (status === 0xf0 || status === 0xf7) { const l = readVar(); off += l; continue; }
        if (type === 0x90 || type === 0x80) {
          const pitch = b[off], vel = b[off + 1]; off += 2;
          const sec = tick / division * 0.5; // 默认 120 BPM：一拍 0.5 s
          if (type === 0x90 && vel > 0) {
            if (!open.has(pitch)) open.set(pitch, []);
            open.get(pitch).push(sec);
          } else if (open.has(pitch) && open.get(pitch).length) {
            const start = open.get(pitch).shift();
            notes.push({ pitch, start: +start.toFixed(3), end: +sec.toFixed(3) });
          }
        } else if (type === 0xa0 || type === 0xb0 || type === 0xe0) { off += 2; }
        else if (type === 0xc0 || type === 0xd0) { off += 1; }
        else { off += 1; }
      }
    }
    off = end;
  }
  return notes.sort((a, b2) => a.start - b2.start);
}

function score(truth, notesRaw, alignMs, alignStatus) {
  // --- the ruler's time axis is aligned before anything is compared ---------
  // Every engine reports its onsets with a fixed offset, and that offset is a
  // property of the engine, not of the recording. It is measured once, on the
  // sample where silence makes "where does this note start" unambiguous
  // (measure-onset.js on melody.wav), stored in align.json, and applied here to
  // every sample. Nothing is aligned per file: if this constant had to change
  // when the sample changed, it would not be a constant and must not be used.
  const shift = (alignMs || 0) / 1000;
  const notes = notesRaw.map(n => ({
    ...n, start: +(n.start - shift).toFixed(6), end: +(n.end - shift).toFixed(6),
  }));
  // Sample A carries a `glide` region (one note that is not scored). Sample B
  // carries `glide_in` per note instead and has no separate region. A truth file
  // is allowed to have neither.
  const GL = truth.glide || null;
  const inGlide = GL
    ? (n => n.start >= GL.start - 0.02 && n.end <= GL.end + 0.05)
    : () => false;
  const hasJoin = truth.notes.some(t => typeof t.glide_in === "number" && t.glide_in > 0);
  const overlap = n => truth.notes.reduce((s, t) => s + Math.max(0, Math.min(t.end, n.end) - Math.max(t.start, n.start)), 0);

  // --- 输出侧先分桶，每个输出只进一个 ---
  const isGlide = notes.map(inGlide);
  const isSpurious = notes.map((n, i) => !isGlide[i] && overlap(n) < (n.end - n.start) * 0.5);

  // --- 一把尺子，可以套在两个窗口上 ---
  // trimHead(t) / trimTail(t) 决定这条真值音的打分窗口。严格窗两边各让 30 ms
  // （样本 A 的口径，两个样本可比）；核心窗让掉 glide_in，只量音高稳定的那一段。
  function evaluate(trimHead, trimTail, collectOutputSide) {
    const rows = [];
    const srcs = [];          // 每条真值音是被哪个输出答的（-1 = 没人答）
    let wrong = 0, missing = 0, byS = 0;
    const usedLocal = new Set();
    for (const t of truth.notes) {
      let w0 = t.start + trimHead(t);
      let w1 = t.end - trimTail(t);
      if (w1 - w0 < 0.02) { w0 = t.start; w1 = t.end; }   // 窗口被削没了就退回整条音
      const span = w1 - w0;
      const cover = new Map();   // pitch -> { c: 覆盖总时长, src: 贡献最多的那个输出下标 }
      notes.forEach((n, i) => {
        if (isGlide[i]) return;
        const o = Math.min(w1, n.end) - Math.max(w0, n.start);
        if (o <= 0) return;
        const cur = cover.get(n.pitch) || { c: 0, src: -1, best: 0 };
        cur.c += o;
        if (o > cur.best) { cur.best = o; cur.src = i; }
        cover.set(n.pitch, cur);
      });
      let best = null, bestC = 0;
      for (const [, v] of cover) if (v.c > bestC) { bestC = v.c; best = v; }
      if (!best || bestC / span < 0.5) {
        missing++;
        srcs.push(-1);
        rows.push({ truth: t.pitch, at: t.start, got: null, verdict: 'missing' });
        continue;
      }
      const pitch = [...cover.entries()].find(([, v]) => v === best)[0];
      if (collectOutputSide) {
        if (isSpurious[best.src]) byS++;
        else usedLocal.add(best.src);
      }
      let verdict;
      if (pitch !== t.pitch) { verdict = `wrong ${pitch} (${pitch - t.pitch > 0 ? '+' : ''}${pitch - t.pitch} st)`; wrong++; }
      else verdict = 'ok';
      srcs.push(best.src);
      rows.push({ truth: t.pitch, at: t.start, got: pitch, verdict });
    }
    return { rows, wrong, missing, byS, usedLocal, srcs };
  }

  const strict = evaluate(() => 0.03, () => 0.03, true);
  const rows = strict.rows;
  const wrong = strict.wrong, missing = strict.missing;
  const answeredBySpurious = strict.byS;
  const usedIdx = strict.usedLocal;

  // --- 分桶求和 + 对账 ---
  const used = usedIdx.size;
  const spurious = isSpurious.filter(Boolean).length;
  const glideN = isGlide.filter(Boolean).length;
  let left = notes.length - used - spurious - glideN;
  const truthTotal = truth.notes.length;

  // 剩下这些：既没人认领，也不是「压根不在音符上」。其中有一类是真的——
  // 输出落在某个音的接缝里（[start, start+glide_in]）却没被任何音选中，那是
  // 一记滑音被切出来的一片，不是错，也不是漏。给它一个桶，别让它冒充尺子缺陷。
  // 剩下的才算 dangling，那仍然是缺陷（有输出凭空消失），继续抛错。
  const inJoinWindow = n => truth.notes.some(t =>
    t.glide_in > 0 && n.start >= t.start - 0.005 && n.start <= t.start + t.glide_in + 0.005);
  const leftIdx = notes.map((n, i) => (usedIdx.has(i) || isSpurious[i] || isGlide[i] ? -1 : i)).filter(i => i >= 0);
  const glidePieces = leftIdx.filter(i => inJoinWindow(notes[i])).length;
  const dangling = left - glidePieces;
  if (dangling !== 0) {
    const which = leftIdx.filter(i => !inJoinWindow(notes[i])).map(i => `${notes[i].pitch}@${notes[i].start}`);
    throw new Error(`output accounting does not balance: used ${used} + spurious ${spurious} + glide ${glideN} + join_pieces ${glidePieces} + dangling ${dangling} != total_out ${notes.length}`
      + (which.length ? ` (unaccounted: ${which.join(', ')})` : ''));
  }
  if (used + spurious + glideN + glidePieces !== notes.length) {
    throw new Error(`double-counted outputs: ${used}+${spurious}+${glideN}+${glidePieces} != ${notes.length}`);
  }

  const hist = (arr) => {
    const h = { '<0.2s': 0, '0.2-0.5s': 0, '0.5-1.0s': 0, '>1.0s': 0 };
    for (const n of arr) {
      const d = n.end - n.start;
      if (d < 0.2) h['<0.2s']++; else if (d < 0.5) h['0.2-0.5s']++; else if (d < 1.0) h['0.5-1.0s']++; else h['>1.0s']++;
    }
    return h;
  };

  // --- 并音：另一个轴，不是另一个桶 ------------------------------------------
  // 一个输出覆盖 ≥2 条真值音各 ≥50% 的时长 → 它并了音；被它覆盖的那几条真值音
  // 各自标 merged。merged 与 correct/wrong 不互斥（一个音可以既报对又被并），
  // 所以它不进 correct+wrong+missing 那条和；它自己那条轴封闭：
  //     merged_notes + solo_notes = counted_notes
  // 并音和漏音是两种错（一个是「两条并成一条」，一个是「一条都没出」），
  // 混进一列就没法再判是哪种。
  const coverOf = (t, n) => Math.max(0, Math.min(t.end, n.end) - Math.max(t.start, n.start));
  const spans = notes.map(n => truth.notes.reduce(
    (a, t) => a + (coverOf(t, n) > 0.5 * (t.end - t.start) ? 1 : 0), 0));
  const mergedOut = new Set(spans.map((k, i) => (k >= 2 ? i : -1)).filter(i => i >= 0));
  const mergedTruth = truth.notes.map((t, i) =>
    [...mergedOut].some(o => coverOf(t, notes[o]) > 0.5 * (t.end - t.start)));
  const mergedNotes = mergedTruth.filter(Boolean).length;
  const answered = truthTotal - missing;
  if (mergedNotes > answered) {
    throw new Error(`merged axis does not balance: ${mergedNotes} merged notes but only ${answered} answered — a merged note must have been answered, so treat this as a ruler defect`);
  }
  mergedTruth.forEach((m, i) => { rows[i].merged = m; });

  const out = {
    counted_notes: truthTotal,
    correct: truthTotal - wrong - missing,
    wrong, missing,                                  // 真值侧：三者之和 = counted_notes
    total_out: notes.length,
    used, spurious, glide_out_count: glideN, join_piece_count: glidePieces, dangling, // 输出侧：五者之和 = total_out
    join_piece_note: "an output that starts inside a note's join window and answers nothing: "
      + "one glide cut into two. Neither a duplicate of a truth note (spurious) nor a lost "
      + "output (dangling) — it is the join being chopped, so it gets its own bucket rather "
      + "than being forced into either.",
    answered_by_spurious: answeredBySpurious,        // 有多少条真值音是被一个 spurious 输出答的
    align_ms: alignMs || 0,                          // 时间轴对齐常数，见 align.json
    align_status: alignStatus || 'none',             // 'constant' | 'withheld' | 'none'（0 不等于「量出来是 0」）
    merged_outputs: mergedOut.size,                  // 覆盖 ≥2 条真值音的输出个数
    merged_notes: mergedNotes,                       // 被这种输出覆盖的真值音条数
    solo_notes: truthTotal - mergedNotes,            // merged_notes + solo_notes = counted_notes
    merged_note: "merged is a second axis, not a bucket: it says how the answer was "
      + "shaped (one output covering two notes), while correct/wrong/missing says "
      + "whether the pitch was right. A note can be both correct and merged. "
      + "merged_notes + solo_notes = counted_notes; merged notes are by construction "
      + "answered, so they can never be missing.",
    rows, hist_out: hist(notes), hist_truth: hist(truth.notes),
    glide_out: notes.filter(inGlide).map(n => n.pitch),
  };

  // --- 颤音音不并进均值 ------------------------------------------------------
  // 颤音的 f0 在 5-6 Hz 上摆 20-40 音分，一个音只给一个音高时，这个音高落在摆动
  // 的哪一相位是随机的，所以「颤音音的平均音高误差」不是一个有意义的数。稳定音
  // 和颤音音分开报，并给出每条颤音音里 f0 包络的峰峰值 —— 一组数字要能看出
  // 「一个值代表不了这条音」。
  if (truth.notes.some(t => (t.vibrato_cents || 0) > 0)) {
    const cents = (got, want) => 100 * (got - want);
    const steady = [], vib = [];
    rows.forEach((r, i) => {
      if (r.got === null) return;
      const t = truth.notes[i];
      ((t.vibrato_cents || 0) > 0 ? vib : steady).push(Math.abs(cents(r.got, t.pitch)));
    });
    const medOf = a => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return Math.round(b[Math.floor(b.length / 2)] * 10) / 10; };
    const pp = [];
    if (Array.isArray(truth.f0_cents)) {
      const g = truth.f0_grid || 0.01;
      truth.notes.forEach(t => {
        if (!(t.vibrato_cents > 0)) return;
        const i0 = Math.round(t.start / g), i1 = Math.round(t.end / g);
        const seg = truth.f0_cents.slice(Math.max(0, i0), Math.min(truth.f0_cents.length, i1));
        if (seg.length) pp.push({ at: t.start, pitch: t.pitch, pp_cents: Math.round((Math.max(...seg) - Math.min(...seg)) * 10) / 10 });
      });
    }
    out.pitch_error = {
      steady_median_abs_cents: medOf(steady), steady_notes: steady.length,
      vibrato_median_abs_cents: medOf(vib), vibrato_notes: vib.length,
      vibrato_envelope_pp_cents: pp,
      note: "reported separately on purpose: a vibrato note's pitch swings 20-40 cents at "
        + "5-6 Hz, so a single reported value sits at an arbitrary phase of that swing and "
        + "its 'average error' is not a measurement. The full envelope is f0_cents in the "
        + "truth file; pp_cents above is its peak-to-peak inside each vibrato note.",
    };
  }

  // --- 只有带连奏的样本才量接缝 ---
  // 每个引擎对每条真值音只给一个音高，所以「把接缝排除掉再判一次」在结构上
  // 几乎恒等于原来的判词，那条轴动不了，不做。真正会动的是两件事：它把这个音
  // 的起点报晚了多少，以及它拿几条输出顶了几条真值音。
  if (hasJoin) {
    const pairs = strict.srcs.map((s, i) => [s, i]).filter(([s]) => s >= 0);

    // onset 用和 measure-onset.js 逐字相同的配对：同音高、起点落在 ±150 ms 内取最近，
    // 没有就记 unmatched，绝不记 0。不能拿「答了这条真值音的那条输出」来配 —— 那是另一个
    // 物件：并音时它递上来的是邻居的起点，于是同一件事（这个引擎的起点偏了多少）在两个地方
    // 会出两个数（localmidi 曾经在这里是 +12、在表里是 +29）。常数是照这条规则量的，读数
    // 就必须照同一条规则量，否则「raw 减常数」减的是两个不同的东西。
    const WINDOW = 0.15;
    const onsetDeltas = [], onsetAlignedDeltas = [];
    for (const t of truth.notes) {
      let best = null, bestS = -1;
      for (let s = 0; s < notesRaw.length; s++) {
        const n = notesRaw[s];
        if (n.pitch !== t.pitch) continue;
        const d = n.start - t.start;
        if (Math.abs(d) > WINDOW) continue;
        if (best === null || Math.abs(d) < Math.abs(best)) { best = d; bestS = s; }
      }
      if (best === null) continue;
      onsetDeltas.push(best * 1000);
      onsetAlignedDeltas.push((notes[bestS].start - t.start) * 1000);
    }
    // 两个数都给出来：raw 是引擎自己报的起点（含它固有的延迟），aligned 是扣掉
    // align.json 那个常数之后剩下的。raw 才是它的行为；aligned 是用来判断
    // 「除了延迟，它在接缝上还多晚了多少」的。
    const abs = onsetAlignedDeltas.map(Math.abs).sort((a, b) => a - b);
    const distinct = new Set(pairs.map(([s]) => s)).size;
    const med = a => {
      if (!a.length) return null;
      const b = [...a].sort((x, y) => x - y);
      return Math.round(b[Math.floor(b.length / 2)] * 10) / 10;
    };
    out.join = {
      notes_with_an_answer: pairs.length,
      distinct_outputs_answering: distinct,
      notes_sharing_an_output: pairs.length - distinct,
      onset_matched: onsetDeltas.length,
      onset_unmatched: truth.notes.length - onsetDeltas.length,
      onset_raw_median_ms: med(onsetDeltas),
      onset_aligned_median_ms: med(onsetAlignedDeltas),
      onset_p95_abs_ms: abs.length ? Math.round(abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.95))] * 10) / 10 : null,
      note: "onset = output.start - truth.start; positive means the note is reported late. "
          + "Pairing is measure-onset.js's, identical: per truth note, the nearest same-pitch "
          + "output starting within +/-150 ms, and unmatched is counted, never zero. It is not "
          + "the output that answered the note: when a note is merged, that output carries the "
          + "neighbour's onset, and the same offset would then come out as two different numbers "
          + "in two files. onset_raw carries the engine's own offset; onset_aligned has align_ms "
          + "removed, so what is left is the part that is specific to this file. "
          + "notes_sharing_an_output counts truth notes that had to share one output with another.",
    };

    // 按接缝长度分组：同一把尺子量出来的命中率，随接缝长度怎么变。
    // 这里只放读数，不放模型——把「为什么」写进文档，读者可以拿这几个数自己核。
    const byGlide = new Map();
    for (const [s, i] of pairs) {
      const t = truth.notes[i];
      const g = Math.round((t.glide_in || 0) * 1000);
      const e = byGlide.get(g) || { glide_ms: g, notes: 0, correct: 0, sum_err: 0, sum_model: 0, modeled: 0 };
      e.notes++;
      if (notes[s].pitch === t.pitch) e.correct++;
      e.sum_err += notes[s].pitch - t.pitch;
      byGlide.set(g, e);
    }
    out.join.join_by_glide_ms = [...byGlide.values()]
      .sort((a, b) => a.glide_ms - b.glide_ms)
      .map(e => ({ glide_ms: e.glide_ms, notes: e.notes, correct: e.correct, mean_error_st: Math.round(e.sum_err / e.notes * 100) / 100 }));

    // 这个引擎报的音高，是不是取「它自己报的起点」往前某个固定时刻的那一点？
    // 扫描 -200..+80 ms（10 ms 步长），取平均绝对误差最小的偏移。这是对误差的
    // 描述，不是对误差的辩护：扫描范围和步长都写死在下面，不随结果调整。
    // 这里用 raw 起点，因为问题问的是「它自己报的起点」往前多少 —— 对齐常数
    // 属于我们，不属于它。
    if (Array.isArray(truth.f0_cents)) {
      const g = truth.f0_grid || 0.01;
      const c = truth.f0_cents;
      const f0at = t => {
        const i = Math.round(t / g) - 1;
        return (i >= 0 && i < c.length) ? 69 + c[i] / 100 : null;
      };
      const outs = [...new Set(pairs.map(([s]) => s))].map(s => notesRaw[s]).filter(o => typeof o.pitch === 'number');
      let best = null;
      for (let off = -0.20; off <= 0.0801; off += 0.01) {
        let n = 0, hit = 0, err = 0;
        for (const o of outs) {
          const v = f0at(o.start + off);
          if (v === null) continue;
          n++;
          if (Math.round(v) === o.pitch) hit++;
          err += Math.abs(v - o.pitch);
        }
        if (!n) continue;
        const cand = { off, hit, n, err: err / n };
        if (!best || cand.err < best.err - 1e-9) best = cand;
      }
      if (best) {
        out.join.pitch_offset_ms = Math.round(best.off * 1000);
        out.join.pitch_offset_match = `${best.hit}/${best.n}`;
        out.join.pitch_offset_note = "best single offset such that the truth pitch curve at "
          + "(output.start + offset) reproduces the pitch this engine reported; measured from the "
          + "raw, unaligned onset; scanned -200..+80 ms in 10 ms steps";
      }
    }
  }
  return out;
}

const truth = JSON.parse(fs.readFileSync(process.argv[4] || 'truth.json', 'utf8'));
const tool = process.argv[2];
const file = process.argv[3];
const notes = file.endsWith('.mid') ? parseMidi(file) : JSON.parse(fs.readFileSync(file, 'utf8')).notes;

// 对齐常数只有一个来源：align.json。没有它就不对齐（0），也不猜。
// 三种状态必须分开写：'constant' 是真扣了常数，'withheld' 是量了但不许扣
// （中位数是工具自己挑的那几条算出来的），'none' 是 align.json 里根本没有这个引擎。
// 把 withheld 写成 align_ms: 0 会让读者以为「量出来是 0」——那是另一个物件。
const path = require('path');
const alignPath = path.join(__dirname, 'align.json');
let alignMs = 0, alignStatus = 'none';
if (fs.existsSync(alignPath)) {
  const a = JSON.parse(fs.readFileSync(alignPath, 'utf8'));
  const base = tool.replace(/-js$/, '');          // localmidi-js 和 localmidi 是同一把尺子
  if (a.constants_ms && Object.prototype.hasOwnProperty.call(a.constants_ms, base)) {
    alignMs = a.constants_ms[base];
    alignStatus = 'constant';
  } else if (a.withheld && a.withheld[base]) {
    alignStatus = 'withheld';
  }
}
const r = score(truth, notes, alignMs, alignStatus);
r.tool = tool;
r.source = file;
const outDir = process.argv[5] || '.';   // sample B writes into its own dir
fs.writeFileSync(require('path').join(outDir, `score-${tool}.json`), JSON.stringify(r, null, 2));
console.log(`\n== ${tool} (${file}) ==`);
if (r.align_status === 'withheld') {
  console.log(`align     no shift — align.json withholds a constant for this engine: its median was read off the notes it chose to answer, so subtracting it would calibrate the ruler on that choice`);
} else if (r.align_status === 'constant') {
  console.log(`align     ${r.align_ms >= 0 ? '+' : ''}${r.align_ms} ms removed from every onset (align.json, measured on sample A)`);
} else {
  console.log(`align     no shift (align.json has no constant for this engine)`);
}
console.log(`truth     ${r.counted_notes} notes -> correct ${r.correct} | wrong ${r.wrong} | missing ${r.missing}   (${r.correct}+${r.wrong}+${r.missing} = ${r.counted_notes})`);
console.log(`outputs   ${r.total_out} notes -> used ${r.used} | spurious ${r.spurious} | glide ${r.glide_out_count} | join pieces ${r.join_piece_count} | dangling ${r.dangling}   (${r.used}+${r.spurious}+${r.glide_out_count}+${r.join_piece_count}+${r.dangling} = ${r.total_out})`);
console.log(`merged    ${r.merged_outputs} output(s) each cover 2+ truth notes, ${r.merged_notes} note(s) merged | ${r.merged_notes}+${r.solo_notes} = ${r.counted_notes}   (a second axis, not a bucket)`);
if (r.answered_by_spurious) console.log(`          ${r.answered_by_spurious} truth note(s) answered by an output also counted spurious`);
if (r.join) {
  const aligned = r.align_status === 'constant'
    ? `-> aligned ${r.join.onset_aligned_median_ms >= 0 ? '+' : ''}${r.join.onset_aligned_median_ms} ms`
    : `(not shifted: ${r.align_status})`;
  console.log(`joins     onset raw ${r.join.onset_raw_median_ms >= 0 ? '+' : ''}${r.join.onset_raw_median_ms} ms ${aligned}  (${r.join.onset_matched}/${r.counted_notes} notes paired, same rule as measure-onset.js) | ${r.join.distinct_outputs_answering} outputs answer ${r.join.notes_with_an_answer} notes`);
}
if (r.pitch_error) console.log(`pitch err steady ${r.pitch_error.steady_median_abs_cents} cents (n=${r.pitch_error.steady_notes}) | vibrato ${r.pitch_error.vibrato_median_abs_cents} cents (n=${r.pitch_error.vibrato_notes}) — reported apart, never averaged together`);
for (const row of r.rows) console.log(`  truth ${row.truth} @${row.at}s -> ${row.got === null ? 'none' : row.got}  ${row.verdict}${row.merged ? '  [merged]' : ''}`);
console.log('  glide:', r.glide_out.join(','));
console.log('  dur out  ', JSON.stringify(r.hist_out));
console.log('  dur truth', JSON.stringify(r.hist_truth));
