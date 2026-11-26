import test from 'node:test';
import assert from 'node:assert/strict';
import { fitTaps, countForIndex, offsetForOneAt, withBpm, beatPosition, isBreak, nearestBeatIndex } from '../tempo.js';

const taps = (bpm, n, start = 1000, jitter = () => 0) =>
  Array.from({ length: n }, (_, i) => start + (i * 60000) / bpm + jitter(i));

test('fits a steady 180 BPM tap series', () => {
  const g = fitTaps(taps(180, 8));
  assert.ok(Math.abs(60000 / g.period - 180) < 0.01);
  assert.ok(Math.abs(g.anchor - 1000) < 0.5);
});

test('averages out human jitter', () => {
  const j = [0, 18, -12, 9, -20, 14, -6, 11, -15, 4];
  const g = fitTaps(taps(190, 10, 0, (i) => j[i]));
  assert.ok(Math.abs(60000 / g.period - 190) < 3, `bpm ${60000 / g.period}`);
});

test('tolerates a missed tap', () => {
  const t = taps(200, 8);
  t.splice(4, 1); // skip beat 4
  const g = fitTaps(t);
  assert.ok(Math.abs(60000 / g.period - 200) < 0.01);
  assert.equal(nearestBeatIndex(t.at(-1), g), 7);
});

test('rejects a single tap and absurd tempos', () => {
  assert.equal(fitTaps([100]), null);
  assert.equal(fitTaps([0, 100, 200]), null); // 600 BPM
});

test('counts 1..8 and wraps, including negative beats', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => countForIndex(k)), [1, 2, 3, 4, 5, 6, 7, 8, 1]);
  assert.equal(countForIndex(-1), 8);
});

test('"this is 1" re-aligns the count', () => {
  const g = { period: 300, anchor: 0, offset: 0 };
  const off = offsetForOneAt(3 * 300 + 20, g); // pressed near beat 3
  assert.equal(countForIndex(3, off), 1);
  assert.equal(countForIndex(4, off), 2);
});

test('tempo nudge keeps the current beat in place', () => {
  const g = { period: 300, anchor: 0, offset: 2 };
  const now = 10 * 300 + 50;
  const g2 = withBpm(g, 210, now);
  assert.equal(Math.floor(beatPosition(now, g2)), 10);
  assert.ok(Math.abs(g2.anchor + 10 * g2.period - 3000) < 1e-9);
  assert.equal(g2.offset, 2);
});

test('break steps for On1 and On2', () => {
  assert.deepEqual([1, 2, 5, 6].map((c) => isBreak(c, 'on1')), [true, false, true, false]);
  assert.deepEqual([1, 2, 5, 6].map((c) => isBreak(c, 'on2')), [false, true, false, true]);
});
