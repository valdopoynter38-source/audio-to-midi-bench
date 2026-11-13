// How late does each engine report the notes it does report?
//
//   node measure-onset.js <truth.json> <out.json> [out.json ...] [--json]
//
// The number this prints is a property of the tool only if it survives a change
// of sample. If it moves when the notes, the gaps or the joins change, it is the
// engine's reaction to this file, and those are two different objects that must
// not be averaged into one. `align.js` is what decides; this script only reads.
//
// Matching rule lives in match.js, fixed there: same pitch, nearest start inside
// +/-150 ms, unmatched counted and never zero, plus `spoken` — how many notes the
// engine spoke about at all, pitch ignored.
const fs = require('fs');
const { matchOnsets, stats } = require('./match.js');

const [, , truthPath, ...rest] = process.argv;
const outPaths = rest.filter(a => !a.startsWith('--'));
if (!truthPath || !outPaths.length) {
  console.error('usage: node measure-onset.js <truth.json> <out.json> [...]');
  process.exit(2);
}
const truth = JSON.parse(fs.readFileSync(truthPath, 'utf8'));

const rows = [];
for (const path of outPaths) {
  const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
  const notes = Array.isArray(raw) ? raw : raw.notes;
  const tool = Array.isArray(raw) ? path : (raw.tool || path);
  rows.push(stats(matchOnsets(truth, notes), tool, path));
}

console.log(`\ntruth: ${truthPath}  (${truth.notes.length} notes)`);
console.log('tool          spoken  matched/total  median   p25    p75    min    max');
for (const r of rows) {
  if (r.median_ms === null) {
    console.log(`${r.tool.padEnd(13)} ${String(r.spoken).padStart(4)}/${r.notes_total}   no match`);
    continue;
  }
  console.log(
    `${r.tool.padEnd(13)} ${String(r.spoken).padStart(4)}/${r.notes_total}  ` +
    `${String(r.matched).padStart(2)}/${r.notes_total}          ` +
    `${String(r.median_ms).padStart(6)}  ${String(r.p25_ms).padStart(5)}  ${String(r.p75_ms).padStart(5)}  ` +
    `${String(r.min_ms).padStart(5)}  ${String(r.max_ms).padStart(5)}`
  );
}
if (process.argv.includes('--json')) {
  const doc = {
    measured_on: truthPath,
    sample_notes: truth.notes.length,
    method: 'for each truth note: among the outputs with the same pitch starting within '
      + '+/-150 ms, take the nearest; delta = out.start - truth.start; report the median. '
      + 'spoken counts the notes that had any output starting within the window, pitch ignored.',
    rows,
  };
  // A reading from one file is not a constant, however clean the file is. This
  // mode is kept for the per-sample report; constants are written by align.js,
  // which needs two samples of the same condition to agree.
  doc.note = 'readings only. A single sample, or a subset a tool chose to answer, is a point, '
    + 'not a constant: it goes into align.json only if a second sample of the same condition '
    + 'reproduces it.';
  console.log(JSON.stringify(doc, null, 1));
}
