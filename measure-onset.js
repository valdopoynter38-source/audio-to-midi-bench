// How late does each engine report the notes it does report?
//
//   node measure-onset.js <truth.json> <out.json> [out.json ...]
//
// The number this prints is a property of the tool, not of the sample: if an
// engine's onset detector has a fixed delay, the same delta must come out of a
// file whose notes are separated by silence and out of a file whose notes are
// joined. If it does not, the engine is not late — it is reading the join, and
// those are two different defects that must not be averaged into one.
//
// Matching rule, fixed here and not tuned: for each truth note, among the
// outputs whose pitch equals the truth pitch and which start within +/-150 ms,
// take the one closest to the truth start. A note with no such output is
// counted as unmatched, never as a zero.
const fs = require('fs');

const [, , truthPath, ...rest] = process.argv;
const outPaths = rest.filter(a => !a.startsWith('--'));
if (!truthPath || !outPaths.length) {
  console.error('usage: node measure-onset.js <truth.json> <out.json> [...]');
  process.exit(2);
}
const truth = JSON.parse(fs.readFileSync(truthPath, 'utf8'));
// 150 ms, not 250: a repeated pitch can reappear half a second later, and a
// 250 ms window happily pairs a note with the *next* occurrence of the same
// pitch, which is how three notes on the 90 ms sample first came out as
// "+238 ms late" — a matching artefact, not a measurement. 150 ms still leaves
// room for a 58 ms delay plus pYIN's 82 ms lag.
const WINDOW = 0.15;

const q = (arr, p) => {
  if (!arr.length) return null;
  const b = [...arr].sort((x, y) => x - y);
  return b[Math.min(b.length - 1, Math.max(0, Math.round((b.length - 1) * p)))];
};
const round1 = v => Math.round(v * 10) / 10;

const rows = [];
for (const path of outPaths) {
  const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
  const notes = Array.isArray(raw) ? raw : raw.notes;
  const tool = Array.isArray(raw) ? path : (raw.tool || path);
  const deltas = [];
  let unmatched = 0;
  for (const t of truth.notes) {
    let best = null;
    for (const n of notes) {
      if (n.pitch !== t.pitch) continue;
      const d = n.start - t.start;
      if (Math.abs(d) > WINDOW) continue;
      if (!best || Math.abs(d) < Math.abs(best)) best = d;
    }
    if (best === null) unmatched++;
    else deltas.push(best * 1000);
  }
  const med = deltas.length ? q(deltas, 0.5) : null;
  const near = med === null ? 0 : deltas.filter(d => Math.abs(d - med) <= 10).length;
  rows.push({
    tool,
    source: path,
    notes_total: truth.notes.length,
    matched: deltas.length,
    unmatched,
    median_ms: med === null ? null : round1(med),
    p25_ms: deltas.length ? round1(q(deltas, 0.25)) : null,
    p75_ms: deltas.length ? round1(q(deltas, 0.75)) : null,
    within_10ms_of_median: near,
    within_10ms_share: deltas.length ? round1(near / deltas.length * 100) / 100 : null,
  });
}

console.log(`\ntruth: ${truthPath}  (${truth.notes.length} notes)`);
console.log('tool          matched  median   p25    p75   within +/-10ms of median');
for (const r of rows) {
  if (r.median_ms === null) { console.log(`${r.tool.padEnd(13)} ${r.matched}/${r.notes_total}   no match`); continue; }
  console.log(
    `${r.tool.padEnd(13)} ${String(r.matched).padStart(2)}/${r.notes_total}    ` +
    `${String(r.median_ms).padStart(6)}  ${String(r.p25_ms).padStart(5)}  ${String(r.p75_ms).padStart(5)}   ` +
    `${r.within_10ms_of_median}/${r.matched} (${r.within_10ms_share})`
  );
}
if (process.argv.includes('--json')) {
  const doc = {
    measured_on: truthPath,
    sample_notes: truth.notes.length,
    method: 'for each truth note: among the outputs with the same pitch starting within '
      + '+/-150 ms, take the nearest; delta = out.start - truth.start; report the median',
    rows,
  };
  // Only the silence-separated sample is allowed to define constants: it is the
  // only file where "the note starts here" is not a matter of opinion. Running
  // this on a joined sample produces a reading, not a constant, so the field is
  // omitted rather than optional-but-tempting.
  if (!process.argv.includes('--no-constants')) {
    const constants = {};
    for (const r of rows) {
      if (r.median_ms === null) continue;
      constants[r.tool.replace(/-js$/, '')] = r.median_ms;
    }
    doc.why_this_file = 'silence is the only place where "the note starts here" is not a matter '
      + 'of opinion, so the constant is read off the one sample where a join cannot bias it';
    doc.caveat = 'a constant read off this file and applied to every file is a ruler, not a '
      + 'correction: if it had to change when the sample changed, it would not be constant';
    doc.constants_ms = constants;
  } else {
    doc.note = 'readings only: this sample has joins, so a number here describes how this '
      + 'engine behaves on this file. It is not a constant and must not be fed to align.json.';
  }
  console.log(JSON.stringify(doc, null, 1));
}
