// Real-time beat tracking for SalsaCount. Pure JS (no DOM), runs in the browser and in Node.
//
// Pipeline:
//   audio -> OnsetDetector  (log-magnitude spectral flux, ~100 frames/s)
//         -> BeatTracker    (tempo by autocorrelation within salsa's tempo range,
//                            then a comb search for exact period + phase,
//                            then smoothing so the beat grid doesn't jitter)
// Times are in seconds on whatever clock the caller uses for the audio.

// ---------- FFT (iterative radix-2, in place) ----------
class FFT {
  constructor(n) {
    this.n = n;
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float32Array(n / 2);
    this.sin = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / n);
    }
  }
  transform(re, im) {
    const { n, rev } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step], wi = this.sin[k * step];
          const a = start + k, b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  }
}

// ---------- onset strength ----------
export class OnsetDetector {
  constructor(sampleRate, { hopSec = 0.01, maxHz = 11000 } = {}) {
    this.sampleRate = sampleRate;
    this.hop = Math.round(sampleRate * hopSec);
    this.frameRate = sampleRate / this.hop;
    this.n = 1 << Math.ceil(Math.log2(sampleRate * 0.04)); // ~40 ms window (2048 at 44.1/48 kHz)
    this.fft = new FFT(this.n);
    this.win = new Float32Array(this.n).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.n));
    this.ring = new Float32Array(this.n);
    this.write = 0;
    this.sinceHop = 0;
    this.total = 0; // samples consumed
    this.bins = Math.min(this.n / 2, Math.round((maxHz / sampleRate) * this.n));
    this.prev = new Float32Array(this.bins);
    this.re = new Float32Array(this.n);
    this.im = new Float32Array(this.n);
    // An attack registers once it is inside the window; report the frame at the window's
    // centre so onset times line up with the actual hits (checked against synthetic audio).
    this.delay = this.n / 2 / sampleRate;
  }

  // Feed samples; calls onFrame(strength, timeSec) for every completed hop.
  // `startTime` is the clock time of samples[0].
  push(samples, startTime, onFrame) {
    const { n, ring } = this;
    for (let i = 0; i < samples.length; i++) {
      ring[this.write] = samples[i];
      this.write = (this.write + 1) % n;
      this.total++;
      if (++this.sinceHop >= this.hop) {
        this.sinceHop = 0;
        if (this.total >= n) {
          const t = startTime + (i + 1) / this.sampleRate - this.delay;
          onFrame(this.frame(), t);
        }
      }
    }
  }

  frame() {
    const { n, ring, re, im, win, prev, bins } = this;
    for (let i = 0; i < n; i++) {
      re[i] = ring[(this.write + i) % n] * win[i];
      im[i] = 0;
    }
    this.fft.transform(re, im);
    let flux = 0;
    const scale = 4 / n;
    for (let k = 1; k < bins; k++) {
      const mag = Math.hypot(re[k], im[k]) * scale;
      const l = Math.log1p(1000 * mag);
      const d = l - prev[k];
      if (d > 0) flux += d;
      prev[k] = l;
    }
    return flux / bins;
  }
}

// ---------- tempo + phase ----------
const lerp = (a, i) => {
  const i0 = Math.floor(i);
  if (i0 < 0 || i0 + 1 >= a.length) return i0 >= 0 && i0 < a.length ? a[i0] : 0;
  const f = i - i0;
  return a[i0] * (1 - f) + a[i0 + 1] * f;
};

export class BeatTracker {
  constructor(frameRate, {
    minBpm = 145, maxBpm = 240, historySec = 8, updateSec = 0.25, minHistorySec = 3,
  } = {}) {
    this.fr = frameRate;
    this.minBpm = minBpm; this.maxBpm = maxBpm;
    this.H = Math.round(historySec * frameRate);
    this.minFrames = Math.round(minHistorySec * frameRate);
    this.updateEvery = Math.max(1, Math.round(updateSec * frameRate));
    this.env = new Float32Array(this.H);
    this.count = 0;      // frames received
    this.lastTime = 0;   // time of the newest frame
    this.state = null;   // { period, beatTime, confidence }
    this.disagree = 0;
    this.candidate = null;
  }

  reset() { this.env.fill(0); this.count = 0; this.state = null; this.disagree = 0; this.candidate = null; }

  // Add one onset frame. Returns the current beat grid ({period, beatTime, confidence}) when it
  // was just re-estimated, otherwise undefined.
  add(strength, time) {
    this.env.copyWithin(0, 1);
    this.env[this.H - 1] = strength;
    this.count++;
    this.lastTime = time;
    if (this.count < this.minFrames || this.count % this.updateEvery) return undefined;
    const est = this.estimate();
    return this.smooth(est);
  }

  // Envelope over the available history, with a moving average removed and rectified.
  prepared() {
    const n = Math.min(this.count, this.H);
    const raw = this.env.subarray(this.H - n);
    const w = Math.round(this.fr * 0.25);
    const out = new Float32Array(n);
    let sum = 0;
    const pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + raw[i];
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - w), b = Math.min(n, i + w + 1);
      const v = raw[i] - (pre[b] - pre[a]) / (b - a);
      out[i] = v > 0 ? v : 0;
      sum += out[i];
    }
    return { e: out, mean: sum / n };
  }

  estimate() {
    const { fr } = this;
    const { e, mean } = this.prepared();
    const n = e.length;
    if (mean <= 1e-6) return null;

    // 1) Coarse tempo: autocorrelation, also rewarding 2- and 4-beat periodicity.
    const Lmin = (fr * 60) / this.maxBpm, Lmax = (fr * 60) / this.minBpm;
    const maxLag = Math.min(n - 1, Math.ceil(4 * Lmax) + 1);
    const ac = new Float32Array(maxLag + 1);
    for (let L = Math.floor(Lmin); L <= maxLag; L++) {
      let s = 0;
      for (let i = L; i < n; i++) s += e[i] * e[i - L];
      ac[L] = s / (n - L);
    }
    let bestL = 0, best = -Infinity;
    for (let L = Lmin; L <= Lmax; L += 0.25) {
      const s = lerp(ac, L) + 0.5 * lerp(ac, 2 * L) + 0.25 * lerp(ac, 4 * L);
      if (s > best) { best = s; bestL = L; }
    }
    if (!(bestL > 0)) return null;

    // 2) Fine period + phase: comb over recent history, newer beats weighted more.
    const tau = 3 * fr; // weight half-life-ish
    let top = { score: -Infinity }, phaseScores = null;
    for (let P = bestL * 0.97; P <= bestL * 1.03; P += bestL * 0.0015) {
      const scores = [];
      for (let ph = 0; ph < P; ph += 0.25) {
        let s = 0, wsum = 0;
        for (let pos = n - 1 - ph; pos >= 0; pos -= P) {
          const w = Math.exp(-(n - 1 - pos) / tau);
          // small window so slightly early/late hits still count
          s += w * Math.max(lerp(e, pos), 0.7 * lerp(e, pos - 1), 0.7 * lerp(e, pos + 1));
          wsum += w;
        }
        s /= wsum;
        scores.push(s);
        if (s > top.score) top = { score: s, P, ph };
      }
      if (top.P === P) phaseScores = scores;
    }
    const avg = phaseScores.reduce((a, b) => a + b, 0) / phaseScores.length;
    const confidence = avg > 0 ? top.score / avg : 0;
    return {
      period: top.P / fr,
      beatTime: this.lastTime - top.ph / fr,
      confidence,
    };
  }

  smooth(est) {
    if (!est || est.confidence < 1.4) return this.state;
    const cur = this.state;
    if (!cur) {
      this.state = { ...est };
      return this.state;
    }
    const d = (est.beatTime - cur.beatTime) / cur.period;
    const k = Math.round(d);
    const frac = d - k;
    const dp = Math.abs(est.period - cur.period) / cur.period;
    if (Math.abs(frac) < 0.2 && dp < 0.04) {
      const predicted = cur.beatTime + k * cur.period;
      this.state = {
        beatTime: predicted + 0.35 * (est.beatTime - predicted),
        period: cur.period + 0.25 * (est.period - cur.period),
        confidence: est.confidence,
      };
      this.disagree = 0;
      this.candidate = null;
    } else {
      // Only switch to a different grid if it keeps winning for ~0.75 s.
      const c = this.candidate;
      const consistent = c && Math.abs(est.period - c.period) / c.period < 0.04 &&
        Math.abs(((est.beatTime - c.beatTime) / c.period + 0.5) % 1 - 0.5) < 0.2;
      this.disagree = consistent ? this.disagree + 1 : 1;
      this.candidate = est;
      if (this.disagree >= 3) {
        this.state = { ...est };
        this.disagree = 0;
        this.candidate = null;
      }
    }
    return this.state;
  }
}

// Convenience: run a whole buffer offline, returning the grid at every update.
export function trackBuffer(samples, sampleRate, opts = {}) {
  const od = new OnsetDetector(sampleRate);
  const bt = new BeatTracker(od.frameRate, opts);
  const updates = [];
  const block = 1024;
  for (let i = 0; i < samples.length; i += block) {
    od.push(samples.subarray(i, Math.min(samples.length, i + block)), i / sampleRate, (s, t) => {
      const g = bt.add(s, t);
      if (g !== undefined) updates.push({ time: t, grid: g && { ...g } });
    });
  }
  return { updates, frameRate: od.frameRate };
}
