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

function score(truth, notes) {
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
  const dangling = notes.length - used - spurious - glideN;
  const truthTotal = truth.notes.length;
  if (dangling !== 0) {
    throw new Error(`output accounting does not balance: used ${used} + spurious ${spurious} + glide ${glideN} + dangling ${dangling} != total_out ${notes.length}`);
  }
  if (used + spurious + glideN !== notes.length) {
    throw new Error(`double-counted outputs: ${used}+${spurious}+${glideN} != ${notes.length}`);
  }

  const hist = (arr) => {
    const h = { '<0.2s': 0, '0.2-0.5s': 0, '0.5-1.0s': 0, '>1.0s': 0 };
    for (const n of arr) {
      const d = n.end - n.start;
      if (d < 0.2) h['<0.2s']++; else if (d < 0.5) h['0.2-0.5s']++; else if (d < 1.0) h['0.5-1.0s']++; else h['>1.0s']++;
    }
    return h;
  };
  const out = {
    counted_notes: truthTotal,
    correct: truthTotal - wrong - missing,
    wrong, missing,                                  // 真值侧：三者之和 = counted_notes
    total_out: notes.length,
    used, spurious, glide_out_count: glideN, dangling, // 输出侧：四者之和 = total_out
    answered_by_spurious: answeredBySpurious,        // 有多少条真值音是被一个 spurious 输出答的
    rows, hist_out: hist(notes), hist_truth: hist(truth.notes),
    glide_out: notes.filter(inGlide).map(n => n.pitch),
  };

  // --- 只有带连奏的样本才量接缝 ---
  // 每个引擎对每条真值音只给一个音高，所以「把接缝排除掉再判一次」在结构上
  // 几乎恒等于原来的判词，那条轴动不了，不做。真正会动的是两件事：它把这个音
  // 的起点报晚了多少，以及它拿几条输出顶了几条真值音。
  if (hasJoin) {
    const pairs = strict.srcs.map((s, i) => [s, i]).filter(([s]) => s >= 0);
    const onsets = pairs.map(([s, i]) => (notes[s].start - truth.notes[i].start) * 1000);
    const abs = onsets.map(Math.abs).sort((a, b) => a - b);
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
      onset_median_ms: med(onsets),
      onset_p95_abs_ms: abs.length ? Math.round(abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.95))] * 10) / 10 : null,
      note: "onset = output.start - truth.start; positive means the note is reported late. "
          + "notes_sharing_an_output counts truth notes that had to share one output with another.",
    };

    // 这个引擎报的音高，是不是取「它自己报的起点」往前某个固定时刻的那一点？
    // 扫描 -200..+80 ms（10 ms 步长），取平均绝对误差最小的偏移。这是对误差的
    // 描述，不是对误差的辩护：扫描范围和步长都写死在下面，不随结果调整。
    if (Array.isArray(truth.f0_cents)) {
      const g = truth.f0_grid || 0.01;
      const c = truth.f0_cents;
      const f0at = t => {
        const i = Math.round(t / g) - 1;
        return (i >= 0 && i < c.length) ? 69 + c[i] / 100 : null;
      };
      const outs = [...new Set(pairs.map(([s]) => s))].map(s => notes[s]).filter(o => typeof o.pitch === 'number');
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
          + "(output.start + offset) reproduces the pitch this engine reported; "
          + "scanned -200..+80 ms in 10 ms steps";
      }
    }
  }
  return out;
}

const truth = JSON.parse(fs.readFileSync(process.argv[4] || 'truth.json', 'utf8'));
const tool = process.argv[2];
const file = process.argv[3];
const notes = file.endsWith('.mid') ? parseMidi(file) : JSON.parse(fs.readFileSync(file, 'utf8')).notes;
const r = score(truth, notes);
r.tool = tool;
r.source = file;
const outDir = process.argv[5] || '.';   // sample B writes into its own dir
fs.writeFileSync(require('path').join(outDir, `score-${tool}.json`), JSON.stringify(r, null, 2));
console.log(`\n== ${tool} (${file}) ==`);
console.log(`truth     ${r.counted_notes} notes -> correct ${r.correct} | wrong ${r.wrong} | missing ${r.missing}   (${r.correct}+${r.wrong}+${r.missing} = ${r.counted_notes})`);
console.log(`outputs   ${r.total_out} notes -> used ${r.used} | spurious ${r.spurious} | glide ${r.glide_out_count} | dangling ${r.dangling}   (${r.used}+${r.spurious}+${r.glide_out_count}+${r.dangling} = ${r.total_out})`);
if (r.answered_by_spurious) console.log(`          ${r.answered_by_spurious} truth note(s) answered by an output also counted spurious`);
if (r.join) console.log(`joins     onset ${r.join.onset_median_ms>=0?'+':''}${r.join.onset_median_ms} ms median | ${r.join.distinct_outputs_answering} outputs answer ${r.join.notes_with_an_answer} notes (${r.join.notes_sharing_an_output} note(s) share an output)`);
for (const row of r.rows) console.log(`  truth ${row.truth} @${row.at}s -> ${row.got === null ? 'none' : row.got}  ${row.verdict}`);
console.log('  glide:', r.glide_out.join(','));
console.log('  dur out  ', JSON.stringify(r.hist_out));
console.log('  dur truth', JSON.stringify(r.hist_truth));
