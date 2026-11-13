// Which onset offsets are constants of the ruler, and which are just readings?
//
//   node align.js --timebase timebase.json \
//                 --sample truth.json   out-a.json out-b.json out-c.json \
//                 --sample truth3.json  build-c/out-a.json ... \
//                 --sample truth-s1.json build-s/s1/out-a.json ... > align.json
//
// TWO GATES, both fixed before any number is looked at.
//
//   1. COVERAGE  the engine has to have spoken about >= 90 % of the notes on
//      EVERY sample used to read the constant. "Spoken" means an output starts
//      within +/-150 ms of the truth start, PITCH IGNORED.
//
//      One denominator, everywhere. A pitch error and a refusal to speak are
//      different failures and must not substitute for each other: localmidi
//      labels one note on A a semitone low — a documented error, still an answer
//      to "something starts here" — while aubio says nothing at all about four
//      notes. If the gate read `matched`, the first would be punished as if it
//      had stayed silent, and the second would be forgiven whenever its pitch
//      happened to be right. So the gate reads `spoken`, on every sample, and
//      `matched` is reported beside it and used for nothing.
//
//   2. REPRODUCTION  the same number has to come back across AT LEAST FIVE
//      samples of the same condition — silence between every note, but different
//      material: plain, three vibrato rates, three glide lengths, a low register,
//      a high register. The verdict is the BAND of the per-sample medians
//      (max - min), not a pairwise difference.
//
//      Two samples give one comparison, and one comparison is not a band: report
//      "A and C differ by 2 ms" and you have picked the pair that looks good.
//      pYIN is the standing proof — the same two samples put it a whole 11.61 ms
//      hop apart, so a 2 ms difference on two samples says nothing about whether
//      the number is stable. A band over nine samples of different material says
//      something: if the constant were a function of the material, the three
//      vibrato rates and the three glide lengths would move it, and the band
//      would show that.
//
// A constant that passes both is the pooled median over every matched note from
// every sample. One that fails either goes to `withheld` with the reason, and
// nothing on the time axis is shifted for that engine.
//
// The `timebase` block is not a gate. It says what the number physically is —
// where the engine's frame sits relative to the onset it reports — because
// "−13 ms" can be a frame-centre convention (discrete, one hop wide) or an
// analysis delay (continuous). Those are two different objects and both have to
// be named before either can be subtracted.
const fs = require('fs');
const { matchOnsets, stats, q, round1 } = require('./match.js');

const COVERAGE = 0.9;       // spoken / notes, on every sample used for the constant
const BAND_MS = 10;         // max(per-sample median) - min(...) allowed
const MIN_SAMPLES = 5;      // a band needs at least this many points to be a band

// The first note of every sample starts at t = 0 with no silence in front of it.
// An onset detector has no "was silent until here" reference there, so all three
// engines fire on the first frame and the delta is 0 by construction. That is a
// different measurement condition from every other note in the file, and mixing
// it in pulls each sample's median towards zero — the one value the question is
// about. It is excluded on the condition, not on the number: "silence between
// every note" is what all the samples are supposed to share, and the first note
// does not have it.
const LEAD_IN = 0.05;

function labelOf(file) {
  const b = file.split(/[\\/]/).pop();
  if (b === 'truth.json') return 'A';
  if (b === 'truth3.json') return 'C';
  const m = b.match(/^truth-(s\d+)\.json$/);
  if (m) return m[1];
  return b.replace(/\.json$/, '');
}

// --- parse --timebase <file> and --sample <truth> <out> [out ...] groups ---
const groups = [];
let cur = null, timebasePath = null;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--timebase') { timebasePath = argv[++i]; continue; }
  if (a === '--sample') { cur = { truth: null, outs: [] }; groups.push(cur); continue; }
  if (!cur) { console.error('first argument must be --sample (or --timebase)'); process.exit(2); }
  if (!cur.truth) cur.truth = a; else cur.outs.push(a);
}
if (!groups.length) {
  console.error('usage: node align.js [--timebase timebase.json] --sample <truth.json> <out.json> [...] [--sample ...]');
  process.exit(2);
}

const samples = [];
for (const g of groups) {
  const rawTruth = JSON.parse(fs.readFileSync(g.truth, 'utf8'));
  // drop the note with no silence in front of it (see LEAD_IN above)
  const truth = { ...rawTruth, notes: rawTruth.notes.filter(n => n.start >= LEAD_IN) };
  const dropped = rawTruth.notes.length - truth.notes.length;
  const rows = g.outs.map(p => {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const notes = Array.isArray(raw) ? raw : raw.notes;
    return stats(matchOnsets(truth, notes), Array.isArray(raw) ? p : (raw.tool || p), p);
  });
  samples.push({
    file: g.truth, sample: labelOf(g.truth),
    kind: rawTruth.kind || null, params: rawTruth.params || null,
    notes_total: truth.notes.length, notes_dropped: dropped, rows,
  });
}

// --- per tool: one row per sample, then the two gates ---
const tools = [...new Set(samples.flatMap(s => s.rows.map(r => r.tool)))].sort();
const table = [];
for (const tool of tools) {
  const per = [];
  for (const s of samples) {
    const r = s.rows.find(x => x.tool === tool);
    if (!r) continue;
    per.push({
      sample: s.sample, file: s.file, kind: s.kind,
      spoken: r.spoken, matched: r.matched, notes_total: r.notes_total,
      spoken_share: r.spoken_share, matched_share: Math.round(r.matched / r.notes_total * 1000) / 1000,
      median_ms: r.median_ms,
    });
  }
  const meds = per.map(p => p.median_ms).filter(v => v !== null);
  const band = meds.length > 1 ? round1(Math.max(...meds) - Math.min(...meds)) : null;
  const coverOk = per.every(p => p.notes_total > 0 && p.spoken / p.notes_total >= COVERAGE);
  const reproOk = meds.length >= MIN_SAMPLES && band !== null && band <= BAND_MS;
  table.push({
    tool, per, n_samples: per.length, n_medians: meds.length,
    band_ms: band, cover_ok: coverOk, reproduce_ok: reproOk,
  });
}

const timebase = timebasePath && fs.existsSync(timebasePath)
  ? JSON.parse(fs.readFileSync(timebasePath, 'utf8')) : null;

function tbNote(name) {
  const t = timebase && timebase[name];
  if (!t) return '';
  const inner = round1(t.probe_median_ms - t.frame_centre_ms);
  return ' Timebase: ' + t.reported + '; frame convention ' + t.frame_centre_ms
    + ' ms, probe median ' + t.probe_median_ms + ' ms — the ' + inner + ' ms between them is where '
    + 'inside the frame the onset is detected (continuous), which is a different object from the '
    + 'frame convention (discrete, one hop wide).';
}

const constants = {}, withheld = {};
for (const t of table) {
  const name = t.tool.replace(/-js$/, '');
  if (!t.cover_ok) {
    const worst = t.per.reduce((a, b) => (a.spoken / a.notes_total <= b.spoken / b.notes_total ? a : b));
    withheld[name] = {
      per_sample_ms: Object.fromEntries(t.per.map(p => [p.sample, p.median_ms])),
      spoken: Object.fromEntries(t.per.map(p => [p.sample, p.spoken + '/' + p.notes_total])),
      matched: Object.fromEntries(t.per.map(p => [p.sample, p.matched + '/' + p.notes_total])),
      why: 'spoke about only ' + worst.spoken + ' of ' + worst.notes_total + ' notes on sample '
        + worst.sample + ' (spoken, any pitch; matched was ' + worst.matched + '/' + worst.notes_total
        + '). The median is taken over the notes this engine chose to speak about, so it describes '
        + 'the selection as much as the engine. Subtracting it would calibrate the ruler on the '
        + 'engine\'s own choice of which notes to report.' + tbNote(name),
    };
    continue;
  }
  if (!t.reproduce_ok) {
    const list = t.per.filter(p => p.median_ms !== null).map(p => p.median_ms + ' on ' + p.sample).join(', ');
    // If the samples carry a register tag, say whether the band is the register.
    // This is a description of the spread, not a second gate: a per-register
    // constant would need its own reproduction test, which these samples are not.
    const byReg = {};
    for (const s of samples) {
      const r = s.params && s.params.register;
      const row = s.rows.find(x => x.tool === t.tool);
      if (r && row && row.median_ms !== null) (byReg[r] = byReg[r] || []).push(row.median_ms);
    }
    const regs = Object.entries(byReg).map(([k, v]) => [k, round1(q(v, 0.5)), v.length]);
    const regSpread = regs.length > 1
      ? round1(Math.max(...regs.map(x => x[1])) - Math.min(...regs.map(x => x[1]))) : null;
    const regList = regs.map(([k, m, n]) => k + ' ' + m + ' ms (' + n + (n === 1 ? ' sample' : ' samples') + ')').join(', ');
    let regNote = '';
    if (regs.length > 1) {
      regNote = regSpread > BAND_MS
        ? ' Across registers the medians are ' + regList + ', a spread of ' + regSpread + ' ms — so the '
          + 'offset is a function of pitch, not a constant. A per-register constant would need its own '
          + 'reproduction test inside each register, which these samples are not.'
        : ' The register does not explain the band: ' + regList + ', a spread of ' + regSpread
          + ' ms, inside the bar — whatever moves this number is something else.';
    }
    withheld[name] = {
      per_sample_ms: Object.fromEntries(t.per.map(p => [p.sample, p.median_ms])),
      spoken: Object.fromEntries(t.per.map(p => [p.sample, p.spoken + '/' + p.notes_total])),
      matched: Object.fromEntries(t.per.map(p => [p.sample, p.matched + '/' + p.notes_total])),
      band_ms: t.band_ms,
      why: 'does not reproduce: ' + list + ' — a band of ' + t.band_ms + ' ms across '
        + t.n_medians + ' samples of different material, against a ' + BAND_MS + ' ms bar'
        + (t.n_medians < MIN_SAMPLES ? ' (and fewer than ' + MIN_SAMPLES + ' samples: not a band)' : '')
        + '. A band is reported instead of a pairwise difference because any two samples can be '
        + 'picked to agree; the band is the spread over material that was chosen in advance. '
        + 'A constant read off a set this narrow would be this file\'s reading, not the engine\'s.'
        + regNote + tbNote(name),
    };
    continue;
  }
  // pooled over every matched note of every sample, not an average of medians
  const all = [];
  for (const s of samples) {
    const rawT = JSON.parse(fs.readFileSync(s.file, 'utf8'));
    const truth = { ...rawT, notes: rawT.notes.filter(n => n.start >= LEAD_IN) };
    const p = s.rows.find(r => r.tool === t.tool).source;
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    all.push(...matchOnsets(truth, Array.isArray(raw) ? raw : raw.notes).deltas);
  }
  const pooled = round1(q(all, 0.5));
  const entry = {
    align_ms: pooled,
    band_ms: t.band_ms,
    samples: t.n_medians,
    note: 'pooled median over every matched note of every sample; per-sample medians span '
      + t.band_ms + ' ms.',
  };
  if (timebase && timebase[name]) {
    const tb = timebase[name];
    entry.timebase = {
      hop_ms: tb.hop_ms,
      frame_centre_ms: tb.frame_centre_ms,
      reported: tb.reported,
      probe_median_ms: tb.probe_median_ms,
      residual_ms: tb.frame_centre_ms === null ? null : round1(pooled - tb.frame_centre_ms),
      note: tb.note,
    };
  }
  constants[name] = entry;
}

const doc = {
  method: 'per truth note: among the outputs with the same pitch starting within +/-150 ms, take '
    + 'the nearest; delta = out.start - truth.start. The first note of each sample is excluded: it '
    + 'starts at t = 0 with no silence in front of it, so every engine fires on the first frame and '
    + 'the delta is 0 by construction — a different condition, not a reading. A constant must (1) come '
    + 'from a set the tool did not choose — spoken (any pitch) >= ' + COVERAGE + ' of the notes on '
    + 'EVERY sample — and (2) reproduce across >= ' + MIN_SAMPLES + ' samples of the same condition, '
    + 'judged by the band of the per-sample medians, not by a pairwise difference. Matched counts are '
    + 'reported and never used as a gate: a pitch error is not a refusal to speak.',
  gates: { coverage: COVERAGE, band_ms: BAND_MS, min_samples: MIN_SAMPLES, lead_in_excluded_s: LEAD_IN },
  constants_ms: constants,
  withheld,
  timebase,
  samples: samples.map(s => ({
    sample: s.sample, file: s.file, kind: s.kind, params: s.params,
    notes_total: s.notes_total, notes_dropped_no_lead_in: s.notes_dropped,
  })),
  rows: table,
};
console.log(JSON.stringify(doc, null, 1));
