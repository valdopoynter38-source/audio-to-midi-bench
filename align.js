// Which onset offsets are constants of the ruler, and which are just readings?
//
//   node align.js --sample truth.json out-a.json out-b.json out-c.json \
//                 --sample truth3.json build-c/out-a.json ... > align.json
//
// Two gates, both fixed before any number is looked at:
//
//   1. COVERAGE  the engine has to have spoken about essentially the whole
//      sample (an output starting within +/-150 ms of the truth start, pitch
//      ignored). A median taken over the notes a tool chose to report is that
//      tool's selection, not a property of the ruler.
//
//   2. REPRODUCTION  the same number has to come back on a second sample of the
//      same condition — silence between every note, different notes, different
//      gaps, different glide. A single sample cannot distinguish "this tool is
//      11 ms early" from "this tool is 11 ms early on this file"; running the
//      same file twice, on two machines or one, cannot distinguish them either.
//      That is reproducibility, and it is not the question.
//
// A constant that passes both is the pooled median over every matched note from
// every sample. One that fails either goes to `withheld` with the reason, and
// nothing on the time axis is shifted for that engine.
const fs = require('fs');
const { matchOnsets, stats, q, round1 } = require('./match.js');

const COVERAGE = 0.9;        // spoken / notes, on every sample
const REPRODUCTION_MS = 10;  // |median_sample1 - median_sample2| allowed

// A label is for reading the table, not for the gates: the gates only see the
// numbers. truth.json and truth3.json are the two samples of one condition
// (silence between every note); truth2*.json are the legato sample and are not
// used here at all.
const LABEL = { 'truth.json': 'A', 'truth3.json': 'C', 'truth2.json': 'B', 'truth2-90.json': 'B90' };

// --- parse --sample <truth> <out> [out ...] groups ---
const groups = [];
let cur = null;
for (const a of process.argv.slice(2)) {
  if (a === '--sample') { cur = { truth: null, outs: [] }; groups.push(cur); continue; }
  if (!cur) { console.error('first argument must be --sample'); process.exit(2); }
  if (!cur.truth) cur.truth = a; else cur.outs.push(a);
}
if (!groups.length) {
  console.error('usage: node align.js --sample <truth.json> <out.json> [...] [--sample ...]');
  process.exit(2);
}

const samples = [];
for (const g of groups) {
  const truth = JSON.parse(fs.readFileSync(g.truth, 'utf8'));
  const rows = g.outs.map(p => {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const notes = Array.isArray(raw) ? raw : raw.notes;
    return stats(matchOnsets(truth, notes), Array.isArray(raw) ? p : (raw.tool || p), p);
  });
  samples.push({ file: g.truth, sample: LABEL[g.truth.split(/[\\/]/).pop()] || g.truth, notes_total: truth.notes.length, rows });
}

// --- per tool: one row per sample, then the two gates ---
const tools = [...new Set(samples.flatMap(s => s.rows.map(r => r.tool)))].sort();
const table = [];
for (const tool of tools) {
  const per = [];
  for (const s of samples) {
    const r = s.rows.find(x => x.tool === tool);
    if (!r) continue;
    per.push({ sample: s.sample, file: s.file, spoken: r.spoken, notes_total: r.notes_total, median_ms: r.median_ms });
  }
  const meds = per.map(p => p.median_ms).filter(v => v !== null);
  const spread = meds.length > 1 ? round1(Math.max(...meds) - Math.min(...meds)) : null;
  const coverOk = per.every(p => p.notes_total > 0 && p.spoken / p.notes_total >= COVERAGE);
  const reproOk = meds.length >= 2 && Math.max(...meds) - Math.min(...meds) <= REPRODUCTION_MS;
  table.push({ tool, per, spread_ms: spread, cover_ok: coverOk, reproduce_ok: reproOk });
}

const constants = {}, withheld = {};
for (const t of table) {
  const name = t.tool.replace(/-js$/, '');
  if (!t.cover_ok) {
    const worst = t.per.reduce((a, b) => (a.spoken / a.notes_total <= b.spoken / b.notes_total ? a : b));
    withheld[name] = {
      per_sample_ms: Object.fromEntries(t.per.map(p => [p.sample, p.median_ms])),
      why: 'spoke about only ' + worst.spoken + ' of ' + worst.notes_total + ' notes on sample '
        + worst.sample + '. The median is taken over the notes this engine chose to answer, so it '
        + 'describes the selection as much as the engine. Subtracting it would calibrate the ruler '
        + 'on the engine\'s own choice of which notes to report.',
    };
    continue;
  }
  if (!t.reproduce_ok) {
    withheld[name] = {
      per_sample_ms: Object.fromEntries(t.per.map(p => [p.sample, p.median_ms])),
      why: 'does not reproduce: ' + t.per.map(p => p.median_ms + ' ms on sample ' + p.sample).join(', ')
        + ' — a spread of ' + t.spread_ms + ' ms against a ' + REPRODUCTION_MS + ' ms bar. One '
        + 'sample cannot tell a fixed offset from this file\'s reading, and a second sample of the '
        + 'same condition disagrees, so there is no constant to subtract.',
    };
    continue;
  }
  // pooled over every matched note of every sample, not an average of medians
  const all = [];
  for (const s of samples) {
    const truth = JSON.parse(fs.readFileSync(s.file, 'utf8'));
    const p = s.rows.find(r => r.tool === t.tool).source;
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    all.push(...matchOnsets(truth, Array.isArray(raw) ? raw : raw.notes).deltas);
  }
  constants[name] = round1(q(all, 0.5));
}

const doc = {
  method: 'per truth note: among the outputs with the same pitch starting within +/-150 ms, take '
    + 'the nearest; delta = out.start - truth.start. A constant must (1) come from a set the tool '
    + 'did not choose — it spoke about >= ' + COVERAGE + ' of the notes on every sample — and '
    + '(2) reproduce on a second sample of the same condition within ' + REPRODUCTION_MS + ' ms.',
  gates: { coverage: COVERAGE, reproduction_ms: REPRODUCTION_MS },
  constants_ms: constants,
  withheld,
  samples: samples.map(s => ({ sample: s.sample, file: s.file, notes_total: s.notes_total })),
  rows: table,
};
console.log(JSON.stringify(doc, null, 1));
