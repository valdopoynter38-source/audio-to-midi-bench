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
  const GL = truth.glide;
  const inGlide = n => n.start >= GL.start - 0.02 && n.end <= GL.end + 0.05;
  const overlap = n => truth.notes.reduce((s, t) => s + Math.max(0, Math.min(t.end, n.end) - Math.max(t.start, n.start)), 0);

  // --- 输出侧先分桶，每个输出只进一个 ---
  const isGlide = notes.map(inGlide);
  const isSpurious = notes.map((n, i) => !isGlide[i] && overlap(n) < (n.end - n.start) * 0.5);

  // --- 真值侧 ---
  const rows = [];
  let wrong = 0, missing = 0, answeredBySpurious = 0;
  const usedIdx = new Set();
  for (const t of truth.notes) {
    const w0 = t.start + 0.03, w1 = t.end - 0.03;
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
    let verdict;
    if (!best || bestC / span < 0.5) { verdict = 'missing'; missing++; }
    else {
      const pitch = [...cover.entries()].find(([, v]) => v === best)[0];
      if (isSpurious[best.src]) answeredBySpurious++;
      else usedIdx.add(best.src);
      if (pitch !== t.pitch) { verdict = `wrong ${pitch} (${pitch - t.pitch > 0 ? '+' : ''}${pitch - t.pitch} st)`; wrong++; }
      else verdict = 'ok';
      rows.push({ truth: t.pitch, at: t.start, got: pitch, verdict });
      continue;
    }
    rows.push({ truth: t.pitch, at: t.start, got: null, verdict });
  }

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
  return {
    counted_notes: truthTotal,
    correct: truthTotal - wrong - missing,
    wrong, missing,                                  // 真值侧：三者之和 = counted_notes
    total_out: notes.length,
    used, spurious, glide_out_count: glideN, dangling, // 输出侧：四者之和 = total_out
    answered_by_spurious: answeredBySpurious,        // 有多少条真值音是被一个 spurious 输出答的
    rows, hist_out: hist(notes), hist_truth: hist(truth.notes),
    glide_out: notes.filter(inGlide).map(n => n.pitch),
  };
}

const truth = JSON.parse(fs.readFileSync('truth.json', 'utf8'));
const tool = process.argv[2];
const file = process.argv[3];
const notes = file.endsWith('.mid') ? parseMidi(file) : JSON.parse(fs.readFileSync(file, 'utf8')).notes;
const r = score(truth, notes);
r.tool = tool;
r.source = file;
fs.writeFileSync(`score-${tool}.json`, JSON.stringify(r, null, 2));
console.log(`\n== ${tool} (${file}) ==`);
console.log(`truth     ${r.counted_notes} notes -> correct ${r.correct} | wrong ${r.wrong} | missing ${r.missing}   (${r.correct}+${r.wrong}+${r.missing} = ${r.counted_notes})`);
console.log(`outputs   ${r.total_out} notes -> used ${r.used} | spurious ${r.spurious} | glide ${r.glide_out_count} | dangling ${r.dangling}   (${r.used}+${r.spurious}+${r.glide_out_count}+${r.dangling} = ${r.total_out})`);
if (r.answered_by_spurious) console.log(`          ${r.answered_by_spurious} truth note(s) answered by an output also counted spurious`);
for (const row of r.rows) console.log(`  truth ${row.truth} @${row.at}s -> ${row.got === null ? 'none' : row.got}  ${row.verdict}`);
console.log('  glide:', r.glide_out.join(','));
console.log('  dur out  ', JSON.stringify(r.hist_out));
console.log('  dur truth', JSON.stringify(r.hist_truth));
