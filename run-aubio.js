// Sweep every aubionotes parameter combination and keep what aubio says about itself.
// Outputs: aubio-all.json (72 raw readings), aubio-sweep.tsv (one line per run),
//          aubio-stderr.txt (aubio's own diagnostics, deduplicated)
//
// Why stderr is captured: aubionotes 0.4.6 prints "warning: onset threshold not
// supported yet" on every run. That line is the tool admitting the parameter is
// not wired up — a statement, not our inference from 72 identical outputs. It is
// the primary evidence for the aubio column, so it has to survive into a file the
// reader can open, not scroll past in a terminal.
//
// Where aubionotes comes from, in order:
//   1) AUBIO=/path/to/aubionotes
//   2) ./aubio/aubio-0.4.6-win64/bin/aubionotes.exe (official win64 zip unpacked here)
//   3) aubionotes on PATH
const { spawnSync } = require('child_process');
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
const stderrLines = new Map();   // line -> how many runs printed it

for (const m of methods) {
  for (const t of thresholds) {
    for (const io of iois) {
      const r = spawnSync(EXE, ['-i', WAV, '-p', m, '-t', t, '-M', io],
        { encoding: 'utf8', maxBuffer: 1 << 22 });
      const txt = r.stdout || '';
      for (const line of (r.stderr || '').split(/\r?\n/)) {
        const s = line.trim();
        if (s) stderrLines.set(s, (stderrLines.get(s) || 0) + 1);
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

// Deduplicated, with a count so it is obvious it repeats on every run.
const stderrOut = [...stderrLines.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([line, n]) => `${line}   [${n}/${rows.length} runs]`)
  .join('\n');
fs.writeFileSync('aubio-stderr.txt', stderrOut + (stderrOut ? '\n' : ''));

// The table uses the default-parameter run; all 72 agree, so any would do.
const PICK = 'default|0.2|0.03';
const picked = results[PICK] || results[Object.keys(results)[0]];
fs.writeFileSync('out-aubio.json', JSON.stringify({ tool: 'aubio', notes: picked }, null, 1));

const distinct = new Set(Object.values(results).map(n => n.map(x => `${x.pitch}@${x.start}`).join(',')));
console.log('combos:', rows.length);
console.log('distinct outputs across all combos:', distinct.size);
console.log('picked', PICK, '->', picked.length, 'notes:', picked.map(n => n.pitch).join(','));
console.log('');
console.log('aubio on its own stderr (' + stderrLines.size + ' distinct line(s)):');
for (const [line, n] of stderrLines) console.log(`  ${line}   [${n}/${rows.length} runs]`);
