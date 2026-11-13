// One onset matcher, used by everything that measures onsets.
//
//   const { matchOnsets } = require('./match.js');
//   matchOnsets(truth, notes) -> { total, spoken, matched, deltas, pairs }
//
// Rule, fixed here and not tuned: for each truth note, among the outputs whose
// pitch equals the truth pitch and which start within +/-150 ms, take the one
// closest to the truth start. A note with no such output is counted as unmatched,
// never as a zero.
//
// 150 ms, not 250: a repeated pitch can reappear half a second later, and a
// 250 ms window happily pairs a note with the *next* occurrence of the same
// pitch, which is how three notes on the 90 ms sample first came out as
// "+238 ms late" — a matching artefact, not a measurement.
//
// `spoken` is counted separately and on purpose: it is how many truth notes the
// engine spoke about *at all* (any output starting within the window, pitch
// ignored). A median can only be read off a set the tool did not choose, and
// "did it speak at this note" is the choice; "did it get the pitch right" is an
// error the median must not be allowed to hide, but it must not silently shrink
// the population either. Both numbers are reported, and the gate reads `spoken`.
const WINDOW = 0.15;

function matchOnsets(truth, notes) {
  const deltas = [];
  const pairs = [];
  let spoken = 0;
  for (const t of truth.notes) {
    let near = null;      // nearest start, any pitch — this is "did it speak here"
    let bp = null, bpOut = null;   // nearest start among outputs of the right pitch
    for (const n of notes) {
      const d = n.start - t.start;
      if (Math.abs(d) > WINDOW) continue;
      if (near === null || Math.abs(d) < Math.abs(near)) near = d;
      if (n.pitch !== t.pitch) continue;
      if (bp === null || Math.abs(d) < Math.abs(bp)) { bp = d; bpOut = n; }
    }
    if (near !== null) spoken++;
    if (bp !== null) {
      deltas.push(bp * 1000);
      pairs.push({ note: t, out: bpOut, delta: bp });
    }
  }
  return { total: truth.notes.length, spoken, matched: deltas.length, deltas, pairs };
}

const q = (arr, p) => {
  if (!arr.length) return null;
  const b = [...arr].sort((x, y) => x - y);
  return b[Math.min(b.length - 1, Math.max(0, Math.round((b.length - 1) * p)))];
};
const round1 = v => Math.round(v * 10) / 10;

function stats(m, tool, source) {
  const med = m.matched ? q(m.deltas, 0.5) : null;
  return {
    tool,
    source,
    notes_total: m.total,
    spoken: m.spoken,
    matched: m.matched,
    unmatched: m.total - m.matched,
    spoken_share: Math.round(m.spoken / m.total * 1000) / 1000,
    median_ms: med === null ? null : round1(med),
    p25_ms: m.matched ? round1(q(m.deltas, 0.25)) : null,
    p75_ms: m.matched ? round1(q(m.deltas, 0.75)) : null,
    min_ms: m.matched ? round1(q(m.deltas, 0)) : null,
    max_ms: m.matched ? round1(q(m.deltas, 1)) : null,
  };
}

module.exports = { matchOnsets, stats, q, round1, WINDOW };
