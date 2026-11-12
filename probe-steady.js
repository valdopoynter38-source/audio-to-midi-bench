// Control experiment for the aubio row on sample B.
//
// The result that needs defending is not "aubio scores 9/30 on joined notes" —
// anyone can dismiss that as "your sample is weird". The result that needs
// defending is the *reason*: aubio's note-level pitch on this file is wrong by up
// to 7 semitones, including on 1.6 s of perfectly steady C5.
//
// So we take each note's stable body, cut it out of the same file, pad it with
// silence, and ask aubionotes about that alone. Same binary, same timbre, same
// vibrato, same -p default. Only the neighbours are gone.
//
// If the isolated pitch is right, then aubio can read this signal, and the error
// in the full file is produced by the context — which is the finding.
// If the isolated pitch is also wrong, the sample is at fault and the table
// should not be published.
//
//   node probe-steady.js [melody2.wav] [truth2.json] [outDir]
//
// Writes <outDir>/steady-probe.json. Notes shorter than MIN_BODY are skipped,
// because a 130 ms fragment is not a fair question for any note-level tool.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const WAV = process.argv[2] || 'melody2.wav';
const TRUTH = process.argv[3] || 'truth2.json';
const OUT_DIR = process.argv[4] || '.';
const MIN_BODY = 0.30;
const PAD = 0.25;
// No margin at either end. A negative margin would cut *into* the glide, and a
// positive one would cut into the next note's glide — and aubio reports the pitch
// at the note's first frame, so either mistake hands it the transition and the
// control stops being a control. Cut the stable body exactly.
const MARGIN = 0.0;

function findExe() {
  if (process.env.AUBIO && fs.existsSync(process.env.AUBIO)) return process.env.AUBIO;
  const local = path.join('aubio', 'aubio-0.4.6-win64', 'bin', 'aubionotes.exe');
  if (fs.existsSync(local)) return local;
  return 'aubionotes';
}

function readWav(p) {
  const b = fs.readFileSync(p);
  let off = 12, fmt = null, data = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { sr: b.readUInt32LE(off + 12), ch: b.readUInt16LE(off + 10), bits: b.readUInt16LE(off + 22) };
    else if (id === 'data') data = b.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size % 2);
  }
  if (!fmt || !data || fmt.bits !== 16 || fmt.ch !== 1) throw new Error('expected mono 16-bit wav');
  const s = new Int16Array(data.length / 2);
  for (let i = 0; i < s.length; i++) s[i] = data.readInt16LE(i * 2);
  return { sr: fmt.sr, samples: s };
}

function writeWav(p, sr, samples) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i], 44 + i * 2);
  fs.writeFileSync(p, buf);
}

const { sr, samples } = readWav(WAV);
const truth = JSON.parse(fs.readFileSync(TRUTH, 'utf8'));
const EXE = findExe();
const probeDir = path.join(OUT_DIR, 'probe');
fs.mkdirSync(probeDir, { recursive: true });

const rows = [];
truth.notes.forEach((n, i) => {
  const bs = n.start + (n.glide_in || 0);
  const be = n.end;
  const body = be - bs;
  if (body < MIN_BODY) {
    rows.push({ index: i + 1, truth: n.pitch, body_s: +body.toFixed(3), isolated: null, skipped: `body ${body.toFixed(2)}s < ${MIN_BODY}s` });
    return;
  }
  const i0 = Math.max(0, Math.round((bs - MARGIN) * sr));
  const i1 = Math.min(samples.length, Math.round((be + MARGIN) * sr));
  const pad = Math.round(PAD * sr);
  const seg = new Int16Array(pad + (i1 - i0) + pad);
  seg.set(samples.subarray(i0, i1), pad);

  const f = path.join(probeDir, `note-${String(i + 1).padStart(2, '0')}.wav`);
  writeWav(f, sr, seg);

  const r = spawnSync(EXE, ['-i', f, '-p', 'default', '-t', '0.2', '-M', '0.03'], { encoding: 'utf8', maxBuffer: 1 << 22 });
  let best = null;
  for (const line of (r.stdout || '').split(/\r?\n/)) {
    const p = line.trim().split(/\s+/);
    if (p.length !== 3) continue;
    const [pitch, s0, s1] = p.map(Number);
    if (!isFinite(pitch) || !isFinite(s0) || !isFinite(s1)) continue;
    if (!best || (s1 - s0) > (best.end - best.start)) best = { pitch: Math.round(pitch), start: s0, end: s1 };
  }
  rows.push({
    index: i + 1, truth: n.pitch, body_s: +body.toFixed(3),
    isolated: best ? best.pitch : null,
    correct: best ? best.pitch === n.pitch : false,
  });
});

const tested = rows.filter(r => !r.skipped);
const ok = tested.filter(r => r.correct).length;
const out = {
  question: "Can aubionotes read this signal at all, given the note alone?",
  method: `each note's stable body [start+glide_in, end] cut out exactly, ${PAD}s silence padding at each end, same binary and -p default`,
  min_body_s: MIN_BODY,
  notes_tested: tested.length,
  notes_skipped: rows.length - tested.length,
  isolated_correct: ok,
  isolated_wrong: tested.length - ok,
  rows,
  note: "aubionotes reports the pitch of a note's first frame. Isolated, that frame is inside the stable body. In the full file the onset fires on the join, so the first frame is the transition. Compare with score-aubio.json.",
};
fs.writeFileSync(path.join(OUT_DIR, 'steady-probe.json'), JSON.stringify(out, null, 1));

console.log(`probe: ${ok}/${tested.length} isolated bodies read correctly (${rows.length - tested.length} too short to ask)`);
for (const r of tested) if (!r.correct) console.log(`  note ${r.index}: truth ${r.truth}, isolated ${r.isolated}`);
