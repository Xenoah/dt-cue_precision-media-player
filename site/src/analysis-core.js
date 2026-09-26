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
  const tempo = estimateTempo(envelope, sampleRate / hop);
  progress(1);
  return {low, mid, high, peak, bucketSize, sampleRate, duration:length / sampleRate,
    channels:channels.length, samplePeak:maxPeak, rms:Math.sqrt(totalSquare / (length * channels.length)), ...tempo};
}

export function estimateTempo(envelope, envelopeRate) {
  if (envelope.length < envelopeRate * 4) return {bpm:null, confidence:0, beatOffset:0, candidates:[]};
  const onset = new Float32Array(envelope.length);
  let total = 0, max = 0, envelopeMax = 0;
  for(const value of envelope)envelopeMax=Math.max(envelopeMax,value);
  for (let i = 2; i < envelope.length; i++) {
    onset[i] = Math.max(0, envelope[i] - (envelope[i - 1] + envelope[i - 2]) / 2);
    total += onset[i]; max = Math.max(max, onset[i]);
  }
  if (max < Math.max(.0002,envelopeMax*.06)) return {bpm:null, confidence:0, beatOffset:0, candidates:[]};
  const events = [], threshold = Math.max(max * .075, total / onset.length * 2,envelopeMax*.035);
  const refractory = Math.floor(envelopeRate * .12);
  for (let i = 1; i < onset.length - 1; i++) {
    if (onset[i] < threshold || onset[i] < onset[i - 1] || onset[i] < onset[i + 1]) continue;
    if (events.length && i - events.at(-1).index < refractory) {
      if (onset[i] > events.at(-1).strength) events[events.length - 1] = {index:i, strength:onset[i]};
    } else events.push({index:i, strength:onset[i]});
  }
  if (events.length < 5) return {bpm:null, confidence:0, beatOffset:0, candidates:[]};
  const scores = new Float64Array(1401); // 60..200 BPM, 0.1 BPM bins
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < Math.min(i + 9, events.length); j++) {
      const interval = (events[j].index - events[i].index) / envelopeRate;
      if (interval > 4) break;
      const raw = 60 / interval;
      for (let multiple = 1; multiple <= 4; multiple++) {
        const bpm = raw * multiple;
        if (bpm < 60 || bpm > 200) continue;
        const index = Math.round((bpm - 60) * 10);
        const weight = Math.sqrt(events[i].strength * events[j].strength) / Math.sqrt(j - i) / Math.sqrt(multiple);
        for (let d = -12; d <= 12; d++) {
          if (index + d >= 0 && index + d < scores.length) scores[index + d] += weight * Math.exp(-d * d / 50);
        }
      }
    }
  }
  const candidates = [];
  for (let i = 0; i < scores.length; i++) {
    if ((!i || scores[i] >= scores[i - 1]) && (i === scores.length - 1 || scores[i] >= scores[i + 1]) && scores[i] > 0)
      candidates.push({bpm:60 + i / 10, score:scores[i]});
  }
  candidates.sort((a,b) => b.score - a.score);
  if (!candidates.length) return {bpm:null, confidence:0, beatOffset:0, candidates:[]};
  const bpm = candidates[0].bpm, period = 60 / bpm;
  // Phase of strongest onset; tempo remains an estimate, including half/double ambiguity.
  const strongest = events.reduce((a,b)=>b.strength > a.strength ? b : a);
  const beatOffset = (strongest.index / envelopeRate) % period;
  const match = events.filter(e=>Math.min((e.index/envelopeRate-beatOffset+period)%period,
    period-(e.index/envelopeRate-beatOffset+period)%period) < .06).length / events.length;
  if(match<.3)return {bpm:null,confidence:0,beatOffset:0,candidates:[]};
  return {bpm, confidence:Math.min(.95, match), beatOffset,
    candidates:candidates.slice(0,3).map(c=>c.bpm)};
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
