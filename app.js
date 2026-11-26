import {
  fitTaps, countForIndex, isPause, isBreak, beatPosition, nearestBeatIndex,
  offsetForOneAt, withBpm, bpmFromPeriod, mod, RESET_GAP_MS, MAX_BPM,
} from './tempo.js';
import { OnsetDetector, BeatTracker } from './beat.js';

const $ = (id) => document.getElementById(id);
const el = {
  bpm: $('bpm'), big: $('big'), row: [...$('row').children], hint: $('hint'), tap: $('tap'),
  on1: $('on1'), on2: $('on2'), setOne: $('setOne'), shiftUp: $('shiftUp'), shiftDown: $('shiftDown'),
  slower: $('slower'), faster: $('faster'), stop: $('stop'), listen: $('listen'),
  settings: $('settings'), settingsBtn: $('settingsBtn'), closeSettings: $('closeSettings'),
  click: $('click'), offset: $('offset'), offsetVal: $('offsetVal'),
};
const IDLE_HINT = 'Press Listen, or tap along starting on 1';

// ---------- settings (saved per browser; storage can fail in private mode) ----------
const KEY = 'salsacount.settings';
const settings = { mode: 'on1', click: false, offsetMs: 0 };
try { Object.assign(settings, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {} };

// ---------- state ----------
let grid = null;   // { period, anchor, offset } in performance.now() milliseconds
let taps = [];     // tap times in the current series
let shown = null;  // last rendered key so the DOM is only touched on change
let firstTapAt = null;

const now = () => performance.now();
// Pointer events carry a high-resolution timestamp on the same clock as performance.now().
const eventTime = (e) => {
  const n = now();
  return e && e.timeStamp > 0 && Math.abs(n - e.timeStamp) < 500 ? e.timeStamp : n;
};

// ---------- audio context (shared by the click and the mic) ----------
let ctx = null;
function getCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
function setAudioSession(type) {
  try { if (navigator.audioSession) navigator.audioSession.type = type; } catch {}
}
// Audio-clock seconds <-> performance.now() milliseconds.
function clockMap() {
  const ts = ctx.getOutputTimestamp ? ctx.getOutputTimestamp() : null;
  if (ts && ts.performanceTime > 0) return { ctx: ts.contextTime, perf: ts.performanceTime };
  return { ctx: ctx.currentTime, perf: now() };
}
const ctxToPerf = (sec) => { const m = clockMap(); return m.perf + (sec - m.ctx) * 1000; };
const perfToCtx = (ms) => { const m = clockMap(); return m.ctx + (ms - m.perf) / 1000; };

// ---------- tapping ----------
function tap(e) {
  e.preventDefault();
  const t = eventTime(e);
  if (settings.click && !listening) { setAudioSession('playback'); getCtx(); }
  keepAwake();
  el.tap.classList.add('hit');
  setTimeout(() => el.tap.classList.remove('hit'), 90);

  const last = taps.at(-1);
  if (last !== undefined && t - last < (60000 / MAX_BPM) * 0.8) return; // accidental double-tap
  const gapLimit = grid ? Math.max(RESET_GAP_MS, grid.period * 2.5) : RESET_GAP_MS;
  if (last === undefined || t - last > gapLimit) taps = []; // new series: this tap is "1"
  taps.push(t);

  if (taps.length === 1) {
    firstTapAt = t;
    if (!listening) { grid = null; render1Only(); }
    return;
  }
  const fit = fitTaps(taps);
  if (!fit) return;
  if (listening && detected) {
    // While listening, taps don't replace the detected tempo. They say where the beat
    // (and the 1) is: if the detector sits on the offbeat, flip it by half a beat.
    const current = detected.anchor + (halfShift ? detected.period / 2 : 0);
    const d = mod((fit.anchor - current) / detected.period, 1);
    if (taps.length >= 3 && Math.abs(d - 0.5) < 0.2) halfShift = !halfShift;
    applyDetected();
    grid.offset = offsetForOneAt(taps[0], grid);
  } else {
    grid = { ...fit, offset: 0 };
  }
  el.hint.textContent = taps.length < 4 ? 'Keep tapping…' : 'Locked in. Tap again any time to correct.';
}

function render1Only() {
  el.big.className = 'big';
  el.big.textContent = '1';
  el.bpm.textContent = '—';
  highlight(1);
  el.hint.textContent = 'Keep tapping…';
}

// ---------- listening ----------
let listening = false;
let mic = null;          // { stream, source, node, sink }
let detected = null;     // latest detector grid in perf ms: { period, anchor }
let halfShift = false;   // user said the detector is on the offbeat

async function startListening() {
  const c = getCtx();
  if (!c || !navigator.mediaDevices?.getUserMedia || !c.audioWorklet) {
    el.hint.textContent = 'This browser can’t listen through the mic. Tap along instead.';
    return;
  }
  setAudioSession('play-and-record');
  el.listen.classList.add('waiting');
  el.hint.textContent = 'Allow the microphone…';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    await c.audioWorklet.addModule('capture-worklet.js');
    if (c.state === 'suspended') await c.resume();
    const source = c.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(c, 'capture');
    const sink = c.createGain();
    sink.gain.value = 0; // keep the graph running without playing the mic back
    source.connect(node).connect(sink).connect(c.destination);
    const od = new OnsetDetector(c.sampleRate);
    const bt = new BeatTracker(od.frameRate);
    node.port.onmessage = ({ data }) => {
      od.push(data.samples, data.time, (s, t) => {
        const g = bt.add(s, t);
        if (g) onDetected(g);
      });
    };
    mic = { stream, source, node, sink };
    listening = true;
    detected = null;
    halfShift = false;
    el.listen.setAttribute('aria-pressed', 'true');
    el.listen.textContent = '🎤 Listening';
    el.hint.textContent = 'Listening… finding the beat';
    keepAwake();
  } catch (err) {
    el.listen.classList.remove('waiting');
    el.hint.textContent = err && err.name === 'NotAllowedError'
      ? 'Microphone blocked. Allow it in Settings › Safari › Microphone.'
      : 'Couldn’t start the microphone.';
    setAudioSession('auto');
  }
}

function stopListening() {
  if (mic) {
    mic.stream.getTracks().forEach((t) => t.stop());
    try { mic.source.disconnect(); mic.node.disconnect(); mic.sink.disconnect(); } catch {}
    mic.node.port.onmessage = null;
  }
  mic = null;
  listening = false;
  detected = null;
  el.listen.setAttribute('aria-pressed', 'false');
  el.listen.classList.remove('waiting');
  el.listen.textContent = '🎤 Listen';
  setAudioSession('auto');
}

function onDetected(g) {
  const first = !detected;
  detected = { period: g.period * 1000, anchor: ctxToPerf(g.beatTime) };
  applyDetected(false);
  if (first) {
    el.listen.classList.remove('waiting');
    el.hint.textContent = 'Got the beat. Press “This is 1” on the 1.';
  }
}

// Move the grid onto the detected beat, keeping the count where it is.
function applyDetected() {
  if (!detected) return;
  const period = detected.period;
  const anchor = detected.anchor + (halfShift ? period / 2 : 0);
  if (!grid) { grid = { period, anchor, offset: 0 }; return; }
  const k = nearestBeatIndex(anchor, grid);
  grid = { period, anchor: anchor - k * period, offset: grid.offset };
}

// ---------- controls ----------
function setOne(e) {
  if (!grid) return;
  grid.offset = offsetForOneAt(eventTime(e), grid);
}
function shift(d) { if (grid) grid.offset = mod(grid.offset + d, 8); }
function nudge(d) {
  if (!grid || listening) return;
  grid = withBpm(grid, Math.round(bpmFromPeriod(grid.period)) + d, now());
  taps = []; // next tap starts a fresh series
}
function stop() {
  stopListening();
  grid = null; taps = []; shown = null; firstTapAt = null;
  el.big.className = 'big idle'; el.big.textContent = '–'; el.bpm.textContent = '—';
  highlight(0);
  el.hint.textContent = IDLE_HINT;
  releaseWake();
}
function setMode(mode) {
  settings.mode = mode; save();
  el.on1.setAttribute('aria-pressed', String(mode === 'on1'));
  el.on2.setAttribute('aria-pressed', String(mode === 'on2'));
  el.row.forEach((li, i) => li.classList.toggle('break', isBreak(i + 1, mode)));
  shown = null;
}

// ---------- rendering ----------
function highlight(count) {
  el.row.forEach((li, i) => li.classList.toggle('now', i + 1 === count));
}

function frame() {
  if (grid) {
    const t = now() + settings.offsetMs;
    const pos = beatPosition(t, grid);
    const k = Math.floor(pos);
    const phase = pos - k;
    const count = countForIndex(k, grid.offset);
    const key = `${k}:${count}:${settings.mode}`;
    if (key !== shown) {
      shown = key;
      el.big.textContent = String(count);
      el.big.className = 'big' + (isPause(count) ? ' rest' : isBreak(count, settings.mode) ? ' break' : '');
      highlight(count);
      el.bpm.textContent = String(Math.round(bpmFromPeriod(grid.period)));
    }
    el.big.style.setProperty('--p', Math.max(0, 1 - phase * 3).toFixed(3));
  } else if (firstTapAt !== null) {
    el.big.style.setProperty('--p', Math.max(0, 1 - (now() - firstTapAt) / 300).toFixed(3));
  }
  requestAnimationFrame(frame);
}

// ---------- metronome click (Web Audio, scheduled slightly ahead) ----------
let lastClick = -Infinity; // performance time of the last scheduled click

function click(when, count) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = count === 1 ? 1760 : 1100;
  const peak = count === 1 ? 0.9 : 0.5;
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(peak, when + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
  osc.connect(gain).connect(ctx.destination);
  osc.start(when);
  osc.stop(when + 0.06);
}

function scheduleClicks() {
  // Muted while listening: the mic would hear the click and lock onto it.
  if (!settings.click || listening || !ctx || ctx.state !== 'running' || !grid) return;
  const t = now();
  const horizon = t + 120;
  let k = Math.ceil(beatPosition(Math.max(t + 5, lastClick + grid.period * 0.5), grid));
  for (let beat = grid.anchor + k * grid.period; beat < horizon; k++, beat = grid.anchor + k * grid.period) {
    const count = countForIndex(k, grid.offset);
    if (!isPause(count)) click(Math.max(ctx.currentTime, perfToCtx(beat)), count); // silent on 4 and 8
    lastClick = beat;
  }
}
setInterval(scheduleClicks, 25);

// ---------- keep the screen on while counting ----------
let wake = null;
async function keepAwake() {
  try { if (!wake && 'wakeLock' in navigator) wake = await navigator.wakeLock.request('screen'); wake?.addEventListener('release', () => { wake = null; }); } catch {}
}
function releaseWake() { try { wake?.release(); } catch {} wake = null; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && (grid || listening)) keepAwake(); });

// ---------- wiring ----------
el.tap.addEventListener('pointerdown', tap);
el.setOne.addEventListener('pointerdown', setOne);
el.shiftUp.addEventListener('click', () => shift(1));
el.shiftDown.addEventListener('click', () => shift(-1));
el.faster.addEventListener('click', () => nudge(1));
el.slower.addEventListener('click', () => nudge(-1));
el.stop.addEventListener('click', stop);
el.listen.addEventListener('click', () => (listening ? stopListening() : startListening()));
el.on1.addEventListener('click', () => setMode('on1'));
el.on2.addEventListener('click', () => setMode('on2'));
el.settingsBtn.addEventListener('click', () => { el.settings.hidden = false; });
el.closeSettings.addEventListener('click', () => { el.settings.hidden = true; });
el.settings.addEventListener('click', (e) => { if (e.target === el.settings) el.settings.hidden = true; });
el.click.addEventListener('change', () => {
  settings.click = el.click.checked; save();
  if (settings.click && !listening) { setAudioSession('playback'); getCtx(); }
});
el.offset.addEventListener('input', () => {
  settings.offsetMs = Number(el.offset.value); save();
  el.offsetVal.textContent = `${settings.offsetMs} ms`;
});
// Desktop testing: space = tap, "1" = this is 1.
document.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'Space') tap(e);
  else if (e.key === '1') setOne(e);
});

el.click.checked = settings.click;
el.offset.value = String(settings.offsetMs);
el.offsetVal.textContent = `${settings.offsetMs} ms`;
setMode(settings.mode);
stop();
requestAnimationFrame(frame);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
