// What resolution does an onset report actually have?
//
//   node grid.js [sampleCdir]        # default build-c
//
// This exists for one finding, and it is a finding about the ruler, not about a
// sample. Nothing here is added to any onset; it only says how finely an onset can
// be stated.
//
// Every engine takes a frame index and multiplies it by a hop, so a reported start
// is always k * hop and never anything between two of them. The candidates below
// are the hops a segmenter could plausibly use; the smallest one that explains
// every start within rounding is the engine's resolution. Measured:
//
//   pYIN       512 samples = 11.61 ms   (librosa frame 2048 / hop 512)
//   localmidi  256 samples =  5.81 ms   (its detector hops 256)
//   aubio      256 samples =  5.81 ms   (aubionotes default)
//
// They share the fine grid; pYIN uses only every second point of it.
//
// That matters for the alignment constant. pYIN's median came out +3 ms on
// melody.wav and -11 ms on melody3.wav — 14 ms, 1.21 of its own 11.61 ms hop,
// against a 10 ms bar. Both numbers are lattice readings: a truth onset lands at
// an arbitrary place inside the hop, so which lattice point a note snaps to
// depends on where the note sits in the file, not on the engine. Withholding pYIN
// is therefore not a "4 ms miss" to be argued about; there was never a sub-hop
// number to have.
const fs = require('fs');
const path = require('path');

const SR = 44100;
const CANDIDATES = [1024, 512, 256, 128, 64];   // samples; finest explanation wins
const ROUNDING_MS = 1.0;                        // |start - k*hop| under this is rounding

const dirC = process.argv[2] || 'build-c';
const inputs = [
  { sample: 'A', tool: 'localmidi', file: 'out-localmidi-s2.json' },
  { sample: 'A', tool: 'pyin', file: 'out-pyin.json' },
  { sample: 'A', tool: 'aubio', file: 'out-aubio.json' },
  { sample: 'C', tool: 'localmidi', file: path.join(dirC, 'out-localmidi-s2.json') },
  { sample: 'C', tool: 'pyin', file: path.join(dirC, 'out-pyin.json') },
  { sample: 'C', tool: 'aubio', file: path.join(dirC, 'out-aubio.json') },
];

const r2 = v => Math.round(v * 100) / 100;
const files = [];
for (const i of inputs) {
  if (!fs.existsSync(i.file)) continue;
  const notes = JSON.parse(fs.readFileSync(i.file, 'utf8')).notes;
  let found = null;
  for (const hop of CANDIDATES) {
    const ms = hop / SR * 1000;
    const residuals = notes.map(n => {
      const k = Math.round(n.start * 1000 / ms);
      return Math.abs(n.start * 1000 - k * ms);
    });
    const max = Math.max(...residuals);
    if (found === null && max <= ROUNDING_MS) found = { hop, ms, max };
  }
  files.push({
    sample: i.sample, tool: i.tool, file: i.file, notes: notes.length,
    hop_samples: found ? found.hop : null,
    hop_ms: found ? r2(found.ms) : null,
    max_residual_ms: found ? r2(found.max) : null,
    on_a_lattice: found !== null,
  });
}

// the medians behind each constant, and how far apart they are in hops
let medians = null;
if (fs.existsSync('align.json')) {
  const a = JSON.parse(fs.readFileSync('align.json', 'utf8'));
  medians = {};
  for (const row of a.rows) {
    const per = {};
    for (const p of row.per) per[p.sample] = p.median_ms;
    const d = (per.A !== undefined && per.C !== undefined) ? Math.abs(per.C - per.A) : null;
    const hop = (files.find(f => f.tool === row.tool && f.sample === 'A') || {}).hop_ms;
    medians[row.tool] = {
      A_ms: per.A === undefined ? null : per.A,
      C_ms: per.C === undefined ? null : per.C,
      difference_ms: d === null ? null : r2(d),
      engine_hop_ms: hop === undefined ? null : hop,
      difference_in_hops: (d === null || !hop) ? null : r2(d / hop),
    };
  }
}

const doc = {
  sample_rate: SR,
  candidates_samples: CANDIDATES,
  rounding_ms: ROUNDING_MS,
  why: 'A reported onset is a frame index times a hop, so no onset can land between two lattice '
    + 'points. A "constant" read off a lattice is only defined to its hop: if two samples of the '
    + 'same condition come out one hop apart, the number is where the notes fell in the file, not a '
    + 'property of the engine.',
  files,
  medians,
  note: 'hop_samples is the finest hop that explains every start in the file within rounding. '
    + 'It describes the ruler and is not a correction: nothing here is added to any onset.',
};
fs.writeFileSync(path.join(dirC, 'onset-grid.json'), JSON.stringify(doc, null, 1));

console.log('lattice   every onset = k * hop; smallest hop that explains each file:');
for (const f of files) {
  const h = f.on_a_lattice ? `${String(f.hop_samples).padStart(4)} samples = ${String(f.hop_ms).padStart(5)} ms` : 'none';
  console.log(`  ${f.tool.padEnd(10)} ${f.sample}  ${String(f.notes).padStart(2)} notes  ${h}  (max residual ${f.max_residual_ms} ms)`);
}
if (medians) {
  for (const [tool, m] of Object.entries(medians)) {
    if (m.difference_ms === null) continue;
    console.log(`  ${tool.padEnd(10)} median ${String(m.A_ms).padStart(4)} ms on A, ${String(m.C_ms).padStart(4)} ms on C -> ${m.difference_ms} ms = ${m.difference_in_hops} hop of ${m.engine_hop_ms} ms`);
  }
}
