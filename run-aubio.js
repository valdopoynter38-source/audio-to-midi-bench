// aubio 全参数扫一遍，取它最好的一次，避免「我们把它调坏了」这种质疑。
// 输出：aubio-all.json（72 组原始读数）+ aubio-sweep.tsv（汇总）
//
// aubionotes 从哪来，按这个顺序找：
//   1) 环境变量 AUBIO=/path/to/aubionotes
//   2) 当前目录 ./aubio/aubio-0.4.6-win64/bin/aubionotes.exe（官方 win64 包解压在这）
//   3) PATH 里的 aubionotes
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function findExe() {
  if (process.env.AUBIO && fs.existsSync(process.env.AUBIO)) return process.env.AUBIO;
  const local = path.join('aubio', 'aubio-0.4.6-win64', 'bin', 'aubionotes.exe');
  if (fs.existsSync(local)) return local;
  return 'aubionotes';
}
const EXE = findExe();
const WAV = process.argv[2] || 'melody.wav';
console.error('using', EXE);

const methods = ['default', 'yinfft', 'yin', 'mcomb', 'fcomb', 'schmitt'];
const thresholds = ['0.1', '0.2', '0.3', '0.5'];
const iois = ['0.012', '0.03', '0.06'];

function parse(txt) {
  const notes = [];
  for (const line of txt.split(/\r?\n/)) {
    const p = line.trim().split(/\s+/);
    if (p.length !== 3) continue;
    const [pitch, start, end] = p.map(Number);
    if (!isFinite(pitch) || !isFinite(start) || !isFinite(end)) continue;
    notes.push({ pitch: Math.round(pitch), start: +start.toFixed(3), end: +end.toFixed(3) });
  }
  return notes;
}

const rows = [];
const results = {};
for (const m of methods) {
  for (const t of thresholds) {
    for (const io of iois) {
      let txt = '';
      try {
        txt = execFileSync(EXE, ['-i', WAV, '-p', m, '-t', t, '-M', io], { encoding: 'utf8', maxBuffer: 1 << 22 });
      } catch (e) {
        txt = (e.stdout || '').toString();
      }
      const notes = parse(txt);
      const key = `${m}|${t}|${io}`;
      results[key] = notes;
      rows.push(`${key}\t${notes.length}\t${notes.map(n => n.pitch).join(',')}`);
    }
  }
}
fs.writeFileSync('aubio-sweep.tsv', rows.join('\n'));
fs.writeFileSync('aubio-all.json', JSON.stringify(results, null, 1));

// 表里那一列用的是默认参数这一组；72 组结果相同，取哪一组都一样。
const PICK = 'default|0.2|0.03';
const picked = results[PICK] || results[Object.keys(results)[0]];
fs.writeFileSync('out-aubio.json', JSON.stringify({ tool: 'aubio', notes: picked }, null, 1));

const distinct = new Set(Object.values(results).map(n => n.map(x => `${x.pitch}@${x.start}`).join(',')));
console.log('combos:', rows.length);
console.log('distinct outputs across all combos:', distinct.size);
console.log('picked', PICK, '->', picked.length, 'notes:', picked.map(n => n.pitch).join(','));
