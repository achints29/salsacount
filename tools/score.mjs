// Scoring helpers shared by tests and the evaluation tool.

// Beats the app would actually display: between two updates, the latest grid is extrapolated.
export function predictedBeats(updates, endTime) {
  const out = [];
  for (let u = 0; u < updates.length; u++) {
    const g = updates[u].grid;
    if (!g) continue;
    const from = updates[u].time, to = u + 1 < updates.length ? updates[u + 1].time : endTime;
    let k = Math.ceil((from - g.beatTime) / g.period);
    for (let b = g.beatTime + k * g.period; b < to; b = g.beatTime + ++k * g.period) out.push(b);
  }
  return out;
}

// F-measure with a +/- tolerance (seconds), one-to-one matching. Also returns the mean signed error.
export function fMeasure(pred, truth, tol = 0.07, from = 0) {
  const p = pred.filter((t) => t >= from), g = truth.filter((t) => t >= from);
  let i = 0, hits = 0, errSum = 0;
  for (const t of p) {
    while (i < g.length && g[i] < t - tol) i++;
    if (i < g.length && Math.abs(g[i] - t) <= tol) { hits++; errSum += t - g[i]; i++; }
  }
  const prec = p.length ? hits / p.length : 0, rec = g.length ? hits / g.length : 0;
  return { f: prec + rec ? (2 * prec * rec) / (prec + rec) : 0, precision: prec, recall: rec, meanErrMs: hits ? (errSum / hits) * 1000 : NaN, n: g.length };
}

// Tempo accuracy: fraction of updates whose BPM is within 4% of the truth at that time.
export function tempoAccuracy(updates, truth, from = 0) {
  let ok = 0, n = 0;
  for (const u of updates) {
    if (u.time < from || !u.grid) continue;
    let j = truth.findIndex((t) => t > u.time);
    if (j < 2) continue;
    const truePeriod = truth[j - 1] - truth[j - 2];
    n++;
    if (Math.abs(u.grid.period - truePeriod) / truePeriod < 0.04) ok++;
  }
  return n ? ok / n : 0;
}
