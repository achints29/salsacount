// Synthetic salsa-like audio with exactly known beat times, for testing the beat tracker.
// Cowbell on every beat, 2-3 son clave, conga tumbao (slaps on 2/6, open tones on 4, 4&, 8, 8&),
// anticipated bass (2& and 4), piano montuno on the offbeats, a little noise and human timing jitter.

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

export function synthSalsa({ sampleRate = 22050, bpm = 190, endBpm = bpm, seconds = 30, seed = 1, jitterMs = 8, noise = 0.02 } = {}) {
  const r = rng(seed);
  const out = new Float32Array(Math.round(sampleRate * seconds));
  // beat times with linear tempo change
  const beats = [];
  let t = 0.5;
  while (t < seconds - 0.5) {
    beats.push(t);
    const bpmNow = bpm + (endBpm - bpm) * (t / seconds);
    t += 60 / bpmNow;
  }
  const at = (b, frac) => { // time of beat index b plus a fraction of a beat
    const i = Math.min(b, beats.length - 2);
    return beats[b] + frac * (beats[i + 1] - beats[i]);
  };
  const hit = (time, freqs, decay, amp, noiseAmt = 0) => {
    time += ((r() - 0.5) * 2 * jitterMs) / 1000;
    amp *= 0.8 + 0.4 * r();
    const start = Math.round(time * sampleRate);
    const len = Math.round(decay * 6 * sampleRate);
    for (let i = 0; i < len && start + i < out.length; i++) {
      if (start + i < 0) continue;
      const tt = i / sampleRate;
      const env = Math.exp(-tt / decay) * Math.min(1, i / (0.001 * sampleRate));
      let v = 0;
      for (const f of freqs) v += Math.sin(2 * Math.PI * f * tt);
      v = v / freqs.length + noiseAmt * (r() * 2 - 1);
      out[start + i] += amp * env * v;
    }
  };
  for (let b = 0; b < beats.length - 1; b++) {
    const c = (b % 8) + 1; // count 1..8
    hit(at(b, 0), [587, 845], 0.05, c === 1 || c === 5 ? 0.3 : 0.22);           // cowbell
    if ([2, 3, 5, 8].includes(c)) hit(at(b, 0), [2500], 0.02, 0.3);            // clave (2-3 son)
    if (c === 6) hit(at(b, 0.5), [2500], 0.02, 0.3);                           // clave on 6&
    if (c === 2 || c === 6) hit(at(b, 0), [620], 0.04, 0.3, 0.8);              // conga slap
    if (c === 4 || c === 8) { hit(at(b, 0), [330], 0.15, 0.4); hit(at(b, 0.5), [330], 0.15, 0.4); } // open tones
    if (c === 2 || c === 6) hit(at(b, 0.5), [82, 164], 0.3, 0.5);              // bass 2&
    if (c === 4 || c === 8) hit(at(b, 0), [82, 164], 0.3, 0.5);                // bass 4
    hit(at(b, 0.5), [440, 554, 659], 0.12, 0.18);                               // piano offbeats
  }
  for (let i = 0; i < out.length; i++) out[i] += noise * (r() * 2 - 1);
  return { samples: out, sampleRate, beats };
}
