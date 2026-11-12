// 统一评分：同一把尺子量所有工具。
// 口径（写进视频描述，谁都能复算）：
//   1) 对每条真值音，取窗口 [start+0.03, end-0.03]
//   2) 在输出里找覆盖该窗口时间最长的音高；覆盖率 <50% 记 missing，音高不等记 wrong
//   3) 输出里与任何真值音重叠不足自身时长 50% 的，记 spurious
//   4) 滑音段 [6.60,7.20] 真值两解，不计分，单列
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
  const rows = [];
  let wrong = 0, missing = 0;
  for (const t of truth.notes) {
    const w0 = t.start + 0.03, w1 = t.end - 0.03;
    const span = w1 - w0;
    const cover = new Map();
    for (const n of notes) {
      if (inGlide(n)) continue;
      const o = Math.min(w1, n.end) - Math.max(w0, n.start);
      if (o > 0) cover.set(n.pitch, (cover.get(n.pitch) || 0) + o);
    }
    let best = null, bestC = 0;
    for (const [p, c] of cover) if (c > bestC) { bestC = c; best = p; }
    let verdict;
    if (!best || bestC / span < 0.5) { verdict = 'missing'; missing++; }
    else if (best !== t.pitch) { verdict = `wrong ${best} (${best - t.pitch > 0 ? '+' : ''}${best - t.pitch} st)`; wrong++; }
    else verdict = 'ok';
    rows.push({ truth: t.pitch, at: t.start, got: best, verdict });
  }
  const spurious = notes.filter(n => {
    if (inGlide(n)) return false;
    const ov = truth.notes.reduce((s, t) => s + Math.max(0, Math.min(t.end, n.end) - Math.max(t.start, n.start)), 0);
    return ov < (n.end - n.start) * 0.5;
  });
  const hist = (arr) => {
    const h = { '<0.2s': 0, '0.2-0.5s': 0, '0.5-1.0s': 0, '>1.0s': 0 };
    for (const n of arr) {
      const d = n.end - n.start;
      if (d < 0.2) h['<0.2s']++; else if (d < 0.5) h['0.2-0.5s']++; else if (d < 1.0) h['0.5-1.0s']++; else h['>1.0s']++;
    }
    return h;
  };
  return {
    total_out: notes.length,
    correct: truth.notes.length - wrong - missing,
    wrong, missing, spurious: spurious.length,
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
console.log(`notes out ${r.total_out} | correct ${r.correct}/${truth.counted_notes} | wrong ${r.wrong} | missing ${r.missing} | spurious ${r.spurious}`);
for (const row of r.rows) console.log(`  truth ${row.truth} @${row.at}s -> ${row.got === null ? 'none' : row.got}  ${row.verdict}`);
console.log('  glide:', r.glide_out.join(','));
console.log('  dur out  ', JSON.stringify(r.hist_out));
console.log('  dur truth', JSON.stringify(r.hist_truth));
