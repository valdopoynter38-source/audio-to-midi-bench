// 跑 localmidi 自己的检测器：detectNotes 从 converter.js 原样抄过来，一个字没改。
// 只把浏览器里的 AudioBuffer 换成从 melody.wav 读出来的 Float32Array。
const fs = require('fs');
const path = require('path');

function readWav(path) {
  const b = fs.readFileSync(path);
  let off = 12, fmt = null, data = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      fmt = {
        channels: b.readUInt16LE(off + 10),
        sampleRate: b.readUInt32LE(off + 12),
        bits: b.readUInt16LE(off + 22),
      };
    } else if (id === 'data') {
      data = b.subarray(off + 8, off + 8 + size);
    }
    off += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('bad wav');
  const n = data.length / 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = data.readInt16LE(i * 2) / 32768;
  return { sampleRate: fmt.sampleRate, getChannelData: () => out, length: n };
}

// ==== 以下 detectNotes 与 localmidi印钱/converter.js 完全一致 ====
const detectNotes = (buffer, sensitivityLevel) => {
  const sampleRate = buffer.sampleRate;
  const samples = buffer.getChannelData(0);
  const frameSize = Math.min(8192, 2 ** Math.floor(Math.log2(sampleRate / 27)));
  const hop = Math.floor(frameSize / 4);
  const minFreq = 55;
  const maxFreq = 1400;
  const threshold = [0.009, 0.015, 0.023][sensitivityLevel - 1];
  const frames = [];
  for (let offset = 0; offset + frameSize < samples.length; offset += hop) {
    let energy = 0;
    for (let i = 0; i < frameSize; i += 4) energy += samples[offset + i] ** 2;
    const rms = Math.sqrt(energy / (frameSize / 4));
    if (rms < threshold) { frames.push({ pitch: null, rms, time: offset / sampleRate }); continue; }
    let bestLag = 0;
    let bestCorrelation = 0;
    const minLag = Math.floor(sampleRate / maxFreq);
    const maxLag = Math.min(Math.floor(sampleRate / minFreq), frameSize / 2);
    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let correlation = 0;
      for (let i = 0; i < frameSize - lag; i += 4) correlation += samples[offset + i] * samples[offset + i + lag];
      if (correlation > bestCorrelation) { bestCorrelation = correlation; bestLag = lag; }
    }
    const pitchHz = bestLag ? sampleRate / bestLag : 0;
    const midiPitch = pitchHz ? Math.round(69 + 12 * Math.log2(pitchHz / 440)) : null;
    frames.push({ pitch: midiPitch >= 28 && midiPitch <= 96 ? midiPitch : null, rms, time: offset / sampleRate });
  }
  const notes = [];
  let active = null;
  const minDuration = [0.055, 0.075, 0.11][sensitivityLevel - 1];
  for (const frame of frames) {
    if (frame.pitch === null) {
      if (active) { if (frame.time - active.start >= minDuration) notes.push({ ...active, end: frame.time }); active = null; }
      continue;
    }
    if (active && Math.abs(frame.pitch - active.pitch) <= 1) {
      active.end = frame.time;
      active.velocity = Math.max(active.velocity, Math.min(120, 48 + Math.round(frame.rms * 170)));
    } else {
      if (active && frame.time - active.start >= minDuration) notes.push({ ...active, end: frame.time });
      active = { pitch: frame.pitch, start: frame.time, end: frame.time, velocity: Math.min(120, 48 + Math.round(frame.rms * 170)) };
    }
  }
  if (active && active.end - active.start >= minDuration) notes.push(active);
  return notes;
};
// ==== 抄完 ====

const buf = readWav(process.argv[2] || 'melody.wav');
const sens = Number(process.argv[3] || 2);
const outDir = process.argv[4] || '.';   // sample B writes into its own dir
const notes = detectNotes(buf, sens);
const clean = notes.map(n => ({ pitch: n.pitch, start: +n.start.toFixed(3), end: +n.end.toFixed(3) }));
fs.writeFileSync(path.join(outDir, `out-localmidi-s${sens}.json`), JSON.stringify({ tool: 'localmidi', sensitivity: sens, notes: clean }, null, 2));
console.log('notes:', notes.length);
console.log(clean.map(n => `${n.pitch}@${n.start}-${n.end}`).join(' '));
