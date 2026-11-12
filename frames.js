// 把 converter.js 的逐帧判定原样跑一遍，导出指定时间窗的每一帧，
// 并对边界那一帧把整条 lag-相关系数曲线也存下来（视频里要画它）。
const fs = require('fs');

function readWav(path) {
  const b = fs.readFileSync(path);
  let off = 12, fmt = null, data = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { sampleRate: b.readUInt32LE(off + 12) };
    else if (id === 'data') data = b.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size % 2);
  }
  const n = data.length / 2, out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = data.readInt16LE(i * 2) / 32768;
  return { sampleRate: fmt.sampleRate, samples: out };
}

const { sampleRate, samples } = readWav('melody.wav');
const frameSize = Math.min(8192, 2 ** Math.floor(Math.log2(sampleRate / 27))); // 1024
const hop = Math.floor(frameSize / 4);                                        // 256
const minFreq = 55, maxFreq = 1400;
const threshold = 0.015; // sensitivity 2
const minLag = Math.floor(sampleRate / maxFreq);
const maxLag = Math.min(Math.floor(sampleRate / minFreq), frameSize / 2);

const T0 = 5.90, T1 = 6.45;
const rows = [];
let best = null;

for (let offset = 0; offset + frameSize < samples.length; offset += hop) {
  const time = offset / sampleRate;
  if (time < T0 || time > T1) continue;
  let energy = 0;
  for (let i = 0; i < frameSize; i += 4) energy += samples[offset + i] ** 2;
  const rms = Math.sqrt(energy / (frameSize / 4));
  let bestLag = 0, bestCorr = 0;
  const curve = [];
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let c = 0;
    for (let i = 0; i < frameSize - lag; i += 4) c += samples[offset + i] * samples[offset + i + lag];
    curve.push([lag, c]);
    if (c > bestCorr) { bestCorr = c; bestLag = lag; }
  }
  const hz = bestLag ? sampleRate / bestLag : 0;
  const midi = hz ? Math.round(69 + 12 * Math.log2(hz / 440)) : null;
  rows.push({ time: +time.toFixed(3), rms: +rms.toFixed(4), lag: bestLag, hz: +hz.toFixed(1), midi });
  if (Math.abs(time - 5.985) < 0.003) {
    best = { time: +time.toFixed(3), offset, lag: bestLag, hz: +hz.toFixed(1), midi,
             wave: Array.from(samples.subarray(offset, offset + frameSize)),
             curve };
  }
}

fs.writeFileSync('frames.json', JSON.stringify({ frameSize, hop, sampleRate, rows, best }, null, 1));
console.log('frameSize', frameSize, 'hop', hop, '->', (hop / sampleRate * 1000).toFixed(1), 'ms hop,', (frameSize / sampleRate * 1000).toFixed(1), 'ms window');
console.log(rows.map(r => `${r.time}s lag=${r.lag} ${r.hz}Hz midi=${r.midi}`).join('\n'));
console.log('boundary frame:', best.time, 'lag', best.lag, best.hz, 'Hz ->', best.midi);
