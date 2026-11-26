import { synthSalsa } from '../test/synth.mjs';
import { trackBuffer } from '../beat.js';
import { predictedBeats, fMeasure, tempoAccuracy } from './score.mjs';
const cases = [
  { bpm: 160 }, { bpm: 180 }, { bpm: 190, seed: 2 }, { bpm: 205 }, { bpm: 225 },
  { bpm: 180, endBpm: 196, seed: 3 }, { bpm: 190, noise: 0.08, jitterMs: 15, seed: 4 },
];
for (const c of cases) {
  const s = synthSalsa({ seconds: 40, ...c });
  const { updates } = trackBuffer(s.samples, s.sampleRate);
  const pred = predictedBeats(updates, 40);
  const fm = fMeasure(pred, s.beats, 0.07, 8);
  const last = updates.at(-1).grid;
  console.log(JSON.stringify(c), 'F', fm.f.toFixed(3), 'err', fm.meanErrMs.toFixed(1) + 'ms', 'tempoAcc', tempoAccuracy(updates, s.beats, 8).toFixed(2), 'finalBPM', (60 / last.period).toFixed(1), 'conf', last.confidence.toFixed(2));
}
