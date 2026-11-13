// What is the number made of? A lattice convention, or an analysis delay?
//
//   node probe-report.js            # reads probe-truth.json + build-probe/*
//                                   # writes build-probe/timebase.json
//
// align.js can say a constant is stable to within N ms. It cannot say what that
// number IS, and the difference matters:
//
//   * a lattice convention is discrete. The engine reports "frame k" and chooses
//     whether frame k's timestamp means its first sample, its centre, or its last.
//     Against a true onset that can sit anywhere inside the frame, the error
//     swings over one hop and its median sits near half a hop.
//   * an analysis delay is continuous. A median filter, a lookback, a smoothing
//     window: the reported time is late by a fixed amount no matter where inside
//     the frame the onset fell.
//
// Both are constants of the implementation, neither is a constant of the
// material — but they are two objects, and writing them as one "offset" is how a
// reader ends up subtracting a frame convention as if it were latency.
//
// probe.wav puts one pitch, one envelope, five onsets at five different phases of
// a 512-sample hop. If the deltas swing with the phase, that part is the lattice;
// if they all sit at the same height, that part is the delay.
const fs = require('fs');
const { q, round1 } = require('./match.js');

const SR = 44100;
const CANDIDATES = [1024, 512, 256, 128, 64];
const ROUNDING_MS = 1.0;
const WINDOW = 0.20;

const truth = JSON.parse(fs.readFileSync('probe-truth.json', 'utf8'));
const dir = 'build-probe';

// Known from the code, and stated here so the report can name them:
//   run-localmidi.js   frameSize 1024, hop 256, time = offset / sampleRate
//                      -> the timestamp is the frame's FIRST sample
//   run-pyin.py        FRAME 2048, HOP 512, librosa frames_to_time(center=True)
//                      -> the timestamp is the frame's CENTRE
//   aubionotes 0.4.6   hop 256; its onset position is (frames processed * hop)
//                      -> the timestamp is the frame's LAST sample
const KNOWN = {
  localmidi: {
    hop: 256, frame: 1024, reported: 'frame first sample (offset / sampleRate)',
    frame_centre_ms: -round1(1024 / 2 / SR * 1000),   // centre sits later, so report is early
  },
  pyin: {
    hop: 512, frame: 2048, reported: 'frame centre (librosa frames_to_time, center=True)',
    frame_centre_ms: 0,
  },
  aubio: {
    hop: 256, frame: null, reported: 'frame last sample (frames processed * hop)',
    frame_centre_ms: round1(256 / 2 / SR * 1000),     // report is later than the centre
  },
};

const files = {
  localmidi: 'out-localmidi-s2.json',
  pyin: 'out-pyin.json',
  aubio: 'out-aubio.json',
};

const out = {};
for (const [tool, f] of Object.entries(files)) {
  const p = `${dir}/${f}`;
  if (!fs.existsSync(p)) { console.log(`skip ${tool}: ${p} missing`); continue; }
  const notes = JSON.parse(fs.readFileSync(p, 'utf8')).notes;

  // lattice: the finest hop that explains every reported start
  let hop = null;
  for (const h of CANDIDATES) {
    const ms = h / SR * 1000;
    const worst = Math.max(...notes.map(n => {
      const k = Math.round(n.start * 1000 / ms);
      return Math.abs(n.start * 1000 - k * ms);
    }));
    if (worst <= ROUNDING_MS) { hop = h; break; }
  }

  // Any pitch, nearest start: this probe is about WHERE the engine says the note
  // begins, not whether it got the pitch right. localmidi reports the first note
  // a semitone high (61 for 60) and that is a pitch error, not a silence — the
  // same distinction the coverage gate draws.
  const deltas = [], rows = [];
  for (const t of truth.notes) {
    const cand = notes.filter(n => Math.abs(n.start - t.start) <= WINDOW)
      .sort((a, b) => Math.abs(a.start - t.start) - Math.abs(b.start - t.start));
    const hit = cand[0] || null;
    const d = hit ? round1((hit.start - t.start) * 1000) : null;
    if (d !== null) deltas.push(d);
    rows.push({
      truth_s: t.start,
      phase_samples: round1(((t.start * SR) % 512 + 512) % 512),
      out_s: hit ? hit.start : null,
      out_pitch: hit ? hit.pitch : null,
      delta_ms: d,
    });
  }

  const k = KNOWN[tool];
  const med = deltas.length ? round1(q(deltas, 0.5)) : null;
  const band = deltas.length > 1 ? round1(q(deltas, 1) - q(deltas, 0)) : null;
  out[tool] = {
    hop_samples: hop === null ? k.hop : hop,
    hop_ms: round1((hop === null ? k.hop : hop) / SR * 1000),
    frame_samples: k.frame,
    reported: k.reported,
    frame_centre_ms: k.frame_centre_ms,
    probe_deltas_ms: deltas,
    probe_median_ms: med,
    probe_band_ms: band,
    probe_rows: rows,
    note: null,   // filled below
  };
}

// The sentence each engine needs, written from what was measured, not assumed.
if (out.localmidi) {
  const o = out.localmidi;
  o.note = 'Reports the first sample of a 1024-sample frame. The centre of that frame is '
    + round1(1024 / 2 / SR * 1000) + ' ms later, so ' + o.frame_centre_ms + ' ms of any constant is the '
    + 'frame-centre convention (discrete, one 5.81 ms hop wide) and the remainder is where inside the '
    + 'frame the RMS crosses threshold. Probe: median ' + o.probe_median_ms + ' ms, band '
    + o.probe_band_ms + ' ms over five phases — the band is smaller than a hop, which is what a '
    + 'lattice looks like.';
}
if (out.pyin) {
  const o = out.pyin;
  o.note = 'Reports the centre of a 2048-sample frame, so the frame convention contributes 0 ms. '
    + 'What is left is where in the frame the pitch becomes stable enough to start a note; with a '
    + '512-sample hop that can only be stated to ' + o.hop_ms + ' ms. Probe: median '
    + o.probe_median_ms + ' ms, band ' + o.probe_band_ms + ' ms.';
}
if (out.aubio) {
  const o = out.aubio;
  o.note = 'Reports the last sample of the frame it has processed, which is ' + o.frame_centre_ms
    + ' ms later than that frame\'s centre — a lattice convention, half a hop. The remaining '
    + round1(o.probe_median_ms - o.frame_centre_ms) + ' ms is aubio\'s own onset smoothing '
    + '(median filter plus lookback). That split is measured here for the convention and only '
    + 'bounded for the smoothing: this repository does not run aubionotes with the filter disabled, '
    + 'so the continuous part is stated as "the rest", not decomposed further.';
}

fs.writeFileSync(`${dir}/timebase.json`, JSON.stringify(out, null, 1));
console.log('tool        hop    frame-centre   probe median   probe band   reported as');
for (const [t, o] of Object.entries(out)) {
  console.log(`${t.padEnd(10)} ${String(o.hop_ms).padStart(5)} ms ${String(o.frame_centre_ms).padStart(9)} ms ${String(o.probe_median_ms).padStart(11)} ms ${String(o.probe_band_ms).padStart(9)} ms   ${o.reported}`);
}
