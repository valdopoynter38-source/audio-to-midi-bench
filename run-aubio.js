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
const SINGLE = process.argv.includes('--single');
const args = process.argv.slice(2).filter(a => a !== '--single');
const WAV = args[0] || 'melody.wav';
const OUT_DIR = args[1] || '.';   // sample B writes into its own dir
console.error('using', EXE);

const methods = ['default', 'yinfft', 'yin', 'mcomb', 'fcomb', 'schmitt'];
const thresholds = ['0.1', '0.2', '0.3', '0.5'];
const iois = ['0.012', '0.03', '0.06'];
const PICK = 'default|0.2|0.03';   // the run the table uses; all 72 agree on the sweep files

// --single: one run, the picked one, no sweep. The nine-sample set uses this:
// 72 combinations on ten seconds of audio is a quarter of an hour per sample,
// and the sweep has nothing to say there — it exists to show that aubio's
// parameters do not change its output on the ranking samples, which is checked
// on A, B and C. The constant is not allowed to depend on a parameter search.
if (SINGLE) {
  const [m, t, io] = PICK.split('|');
  const r = spawnSync(EXE, ['-i', WAV, '-p', m, '-t', t, '-M', io],
    { encoding: 'utf8', maxBuffer: 1 << 22 });
  const notes = parse(r.stdout || '');
  fs.writeFileSync(path.join(OUT_DIR, 'out-aubio.json'),
    JSON.stringify({ tool: 'aubio', notes }, null, 1));
  console.log(`single ${PICK} -> ${notes.length} notes: ${notes.map(n => n.pitch).join(',')}`);
  process.exit(0);
}

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

fs.writeFileSync(path.join(OUT_DIR, 'aubio-sweep.tsv'), rows.join('\n'));
fs.writeFileSync(path.join(OUT_DIR, 'aubio-all.json'), JSON.stringify(results, null, 1));

// Deduplicated, with a count so it is obvious it repeats on every run.
const stderrOut = [...stderrLines.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([line, n]) => `${line}   [${n}/${rows.length} runs]`)
  .join('\n');
fs.writeFileSync(path.join(OUT_DIR, 'aubio-stderr.txt'), stderrOut + (stderrOut ? '\n' : ''));

// The table uses the default-parameter run; all 72 agree, so any would do.
const picked = results[PICK] || results[Object.keys(results)[0]];
fs.writeFileSync(path.join(OUT_DIR, 'out-aubio.json'), JSON.stringify({ tool: 'aubio', notes: picked }, null, 1));

const distinct = new Set(Object.values(results).map(n => n.map(x => `${x.pitch}@${x.start}`).join(',')));
console.log('combos:', rows.length);
console.log('distinct outputs across all combos:', distinct.size);
console.log('picked', PICK, '->', picked.length, 'notes:', picked.map(n => n.pitch).join(','));
console.log('');
console.log('aubio on its own stderr (' + stderrLines.size + ' distinct line(s)):');
for (const [line, n] of stderrLines) console.log(`  ${line}   [${n}/${rows.length} runs]`);
