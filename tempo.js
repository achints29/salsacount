// Pure timing math for SalsaCount. No DOM access, so it can be unit-tested in Node.
//
// A "grid" describes the beat: beat index k happens at time  anchor + k * period  (ms).
// `offset` maps beat indices to salsa counts: count = ((k + offset) mod 8) + 1.

export const MIN_BPM = 60;
export const MAX_BPM = 260;
export const FIT_WINDOW = 12; // how many recent taps the tempo fit uses
export const RESET_GAP_MS = 2000; // a pause longer than this starts a new tap series

export const mod = (n, m) => ((n % m) + m) % m;
export const bpmFromPeriod = (period) => 60000 / period;
export const periodFromBpm = (bpm) => 60000 / bpm;

export function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Fit a beat grid to tap times (ascending, ms). The first tap is beat index 0.
// Tolerates a missed tap (a gap of ~2 beats counts as 2 beats).
// Returns { period, anchor } or null if there isn't enough sensible data.
export function fitTaps(taps, window = FIT_WINDOW) {
  if (taps.length < 2) return null;
  const recent = taps.slice(-window);
  const intervals = [];
  for (let i = 1; i < recent.length; i++) intervals.push(recent[i] - recent[i - 1]);
  let period = median(intervals);
  if (!(period > 0)) return null;

  // Beat index of every tap in the series, allowing for skipped beats.
  const idx = [0];
  for (let i = 1; i < taps.length; i++) {
    const n = Math.max(1, Math.round((taps[i] - taps[i - 1]) / period));
    idx.push(idx[i - 1] + n);
  }

  // Least-squares line  t = anchor + period * k  over the recent taps.
  const xs = idx.slice(-window);
  const ys = taps.slice(-window);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (sxx > 0) period = sxy / sxx;
  const anchor = my - period * mx;

  const bpm = bpmFromPeriod(period);
  if (bpm < MIN_BPM || bpm > MAX_BPM) return null;
  return { period, anchor };
}

export const beatPosition = (t, grid) => (t - grid.anchor) / grid.period;
export const nearestBeatIndex = (t, grid) => Math.round(beatPosition(t, grid));
export const countForIndex = (k, offset = 0) => mod(k + offset, 8) + 1;
export const isPause = (count) => count === 4 || count === 8;
export const isBreak = (count, mode) => (mode === 'on2' ? count === 2 || count === 6 : count === 1 || count === 5);

// Offset that makes the beat nearest to time t count as "1".
export const offsetForOneAt = (t, grid) => mod(-nearestBeatIndex(t, grid), 8);

// Change tempo without jumping: the most recent beat stays where it is
// and keeps its index, so the count carries on smoothly.
export function withBpm(grid, bpm, now) {
  const clamped = Math.min(MAX_BPM, Math.max(MIN_BPM, bpm));
  const k = Math.floor(beatPosition(now, grid));
  const beatTime = grid.anchor + k * grid.period;
  const period = periodFromBpm(clamped);
  return { ...grid, period, anchor: beatTime - k * period };
}
