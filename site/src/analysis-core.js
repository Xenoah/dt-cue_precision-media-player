import {estimateTempo} from './tempo.js';
export {estimateTempo} from './tempo.js';
// First-order complementary crossovers: low <250 Hz, mid 250–4000 Hz, high >4000 Hz.
// Per-channel energy aggregation avoids phase cancellation in stereo material.
export function analyzePCM(channels, sampleRate, progress = () => {}) {
  const length = channels[0]?.length || 0;
  if (!length || !sampleRate) throw new Error('Empty PCM');
  const bucketSize = Math.max(32, Math.ceil(length / 24000));
  const count = Math.ceil(length / bucketSize);
  const low = new Float32Array(count), mid = new Float32Array(count), high = new Float32Array(count);
  const peak = new Float32Array(count);
  const hop = Math.max(1, Math.round(sampleRate / 200));
  const envelope = new Float32Array(Math.ceil(length / hop));
  const aLow = 1 - Math.exp(-2 * Math.PI * 250 / sampleRate);
  const aHigh = 1 - Math.exp(-2 * Math.PI * 4000 / sampleRate);
  let totalSquare = 0, maxPeak = 0;
  for (let c = 0; c < channels.length; c++) {
    const data = channels[c];
    let lp = 0, hp = 0;
    for (let i = 0; i < length; i++) {
      const s = data[i] || 0;
      lp += aLow * (s - lp); hp += aHigh * (s - hp);
      const m = hp - lp, h = s - hp, b = Math.floor(i / bucketSize);
      low[b] += lp * lp; mid[b] += m * m; high[b] += h * h;
      peak[b] = Math.max(peak[b], Math.abs(s));
      totalSquare += s * s; maxPeak = Math.max(maxPeak, Math.abs(s));
      envelope[Math.floor(i / hop)] += .7 * lp * lp + .3 * s * s;
    }
    progress((c + 1) / channels.length * .8);
  }
  for (let i = 0; i < count; i++) {
    const n = Math.min(bucketSize, length - i * bucketSize) * channels.length;
    low[i] = Math.sqrt(low[i] / n); mid[i] = Math.sqrt(mid[i] / n); high[i] = Math.sqrt(high[i] / n);
  }
  for (let i = 0; i < envelope.length; i++) envelope[i] = Math.sqrt(envelope[i] / (hop * channels.length));
  const tempo = estimateTempo(envelope, sampleRate / hop, value=>progress(.8+value*.2));
  progress(1);
  return {low, mid, high, peak, bucketSize, sampleRate, duration:length / sampleRate,
    channels:channels.length, samplePeak:maxPeak, rms:Math.sqrt(totalSquare / (length * channels.length)), ...tempo};
}

export function frameSeek(time, direction, fps, duration) {
  // Media clocks may round to microseconds; tolerate that at frame boundaries.
  const frame = direction > 0 ? Math.floor(time * fps + 1e-3) + 1 : Math.ceil(time * fps - 1e-3) - 1;
  return Math.min(duration, Math.max(0, frame / fps));
}
export function formatTime(time = 0) {
  const ms = Math.max(0, Math.round((Number.isFinite(time) ? time : 0) * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2,'0')}:${String(Math.floor(ms / 60000) % 60).padStart(2,'0')}:${String(Math.floor(ms / 1000) % 60).padStart(2,'0')}.${String(ms % 1000).padStart(3,'0')}`;
}
export function parseTime(value) {
  if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(value.trim())) return null;
  const parts = value.trim().split(':').map(Number);
  if (parts.some((n,i)=>!Number.isFinite(n) || (i > 0 && n >= 60))) return null;
  return parts.reduce((a,n)=>a*60+n,0);
}
