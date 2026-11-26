// Run the beat tracker over real audio files.
//   node tools/eval.mjs <audio files...> [--clicks]
// If a matching Salsa-dataset annotation exists (tools/annotations/<same name>.csv, fetched by
// tools/fetch-dataset.sh), it scores against it. With --clicks it writes <name>.clicks.mp3 next to
// the audio: the song with the detected beats as clicks (higher click every 8 beats from the first
// detected beat), so you can listen and judge.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, extname } from 'node:path';
import { trackBuffer } from '../beat.js';
import { predictedBeats, fMeasure, tempoAccuracy } from './score.mjs';

const SR = 22050;
const args = process.argv.slice(2);
const clicks = args.includes('--clicks');
const files = args.filter((a) => !a.startsWith('--'));
const annDir = new URL('./annotations/', import.meta.url).pathname;

function decode(file) {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
function findAnnotation(file) {
  if (!existsSync(annDir)) return null;
  const key = norm(basename(file, extname(file)));
  const hit = readdirSync(annDir).find((f) => { const k = norm(basename(f, '.csv')); return key.includes(k) || k.includes(key); });
  if (!hit) return null;
  return readFileSync(join(annDir, hit), 'utf8').trim().split('\n').map((l) => l.split(',')).map(([t, p]) => ({ t: +t, pos: +p }));
}

for (const file of files) {
  const x = decode(file);
  const dur = x.length / SR;
  const { updates } = trackBuffer(x, SR);
  const pred = predictedBeats(updates, dur);
  const bpms = updates.filter((u) => u.grid).map((u) => 60 / u.grid.period);
  const firstLock = updates.find((u) => u.grid);
  const q = (p) => bpms.slice().sort((a, b) => a - b)[Math.floor(p * (bpms.length - 1))];
  console.log(`\n${basename(file)}  (${dur.toFixed(0)} s)`);
  console.log(`  locked after ${firstLock ? firstLock.time.toFixed(1) : '-'} s, BPM median ${q(0.5)?.toFixed(1)} (10–90%: ${q(0.1)?.toFixed(1)}–${q(0.9)?.toFixed(1)})`);
  const ann = findAnnotation(file);
  if (ann) {
    const truth = ann.map((a) => a.t);
    const fm = fMeasure(pred, truth, 0.07, 10);
    console.log(`  vs annotation: F=${fm.f.toFixed(3)} (P ${fm.precision.toFixed(2)}, R ${fm.recall.toFixed(2)}), mean error ${fm.meanErrMs.toFixed(1)} ms, tempo acc ${tempoAccuracy(updates, truth, 10).toFixed(2)}`);
    const off = fMeasure(pred.map((t) => t + 0.5 * (truth[1] - truth[0])), truth, 0.07, 10);
    if (off.f > fm.f) console.log(`  (shifted half a beat it would score F=${off.f.toFixed(3)}: tracker may be on the offbeat, or audio/annotation versions differ)`);
  }
  if (clicks) {
    const out = join(dirname(file), basename(file, extname(file)) + '.clicks.mp3');
    const mix = Float32Array.from(x, (v) => v * 0.6);
    pred.forEach((b, i) => {
      const f = i % 8 === 0 ? 2000 : 1200, s = Math.round(b * SR);
      for (let j = 0; j < SR * 0.04 && s + j < mix.length; j++) mix[s + j] += 0.5 * Math.exp(-j / (SR * 0.008)) * Math.sin((2 * Math.PI * f * j) / SR);
    });
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', '-', '-b:a', '128k', out], { input: Buffer.from(mix.buffer) });
    console.log(`  wrote ${out}`);
  }
}
