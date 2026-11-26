import test from 'node:test';
import assert from 'node:assert/strict';
import { synthSalsa } from './synth.mjs';
import { trackBuffer } from '../beat.js';
import { predictedBeats, fMeasure } from '../tools/score.mjs';

for (const bpm of [165, 195, 225]) {
  test(`tracks synthetic salsa at ${bpm} BPM`, () => {
    const s = synthSalsa({ bpm, seconds: 20, seed: bpm });
    const { updates } = trackBuffer(s.samples, s.sampleRate);
    const last = updates.at(-1).grid;
    assert.ok(Math.abs(60 / last.period - bpm) < 2, `bpm ${60 / last.period}`);
    const fm = fMeasure(predictedBeats(updates, 20), s.beats, 0.07, 6);
    assert.ok(fm.f > 0.95, `F ${fm.f}`);
  });
}

test('follows a tempo change', () => {
  const s = synthSalsa({ bpm: 175, endBpm: 195, seconds: 30, seed: 7 });
  const { updates } = trackBuffer(s.samples, s.sampleRate);
  const fm = fMeasure(predictedBeats(updates, 30), s.beats, 0.07, 6);
  assert.ok(fm.f > 0.95, `F ${fm.f}`);
});

test('stays quiet on silence', () => {
  const { updates } = trackBuffer(new Float32Array(22050 * 6), 22050);
  assert.ok(updates.every((u) => !u.grid));
});
