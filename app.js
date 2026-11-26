import {
  fitTaps, countForIndex, isPause, isBreak, beatPosition,
  offsetForOneAt, withBpm, bpmFromPeriod, mod, RESET_GAP_MS, MAX_BPM,
} from './tempo.js';

const $ = (id) => document.getElementById(id);
const el = {
  bpm: $('bpm'), big: $('big'), row: [...$('row').children], hint: $('hint'), tap: $('tap'),
  on1: $('on1'), on2: $('on2'), setOne: $('setOne'), shiftUp: $('shiftUp'), shiftDown: $('shiftDown'),
  slower: $('slower'), faster: $('faster'), stop: $('stop'),
  settings: $('settings'), settingsBtn: $('settingsBtn'), closeSettings: $('closeSettings'),
  click: $('click'), offset: $('offset'), offsetVal: $('offsetVal'),
};

// ---------- settings (saved per browser; storage can fail in private mode) ----------
const KEY = 'salsacount.settings';
const settings = { mode: 'on1', click: false, offsetMs: 0 };
try { Object.assign(settings, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {} };

// ---------- state ----------
let grid = null;   // { period, anchor, offset } in performance.now() milliseconds
let taps = [];     // tap times in the current series
let shown = null;  // last rendered "k:count" so the DOM is only touched on change
let firstTapAt = null;

const now = () => performance.now();
// Pointer events carry a high-resolution timestamp on the same clock as performance.now().
const eventTime = (e) => {
  const n = now();
  return e && e.timeStamp > 0 && Math.abs(n - e.timeStamp) < 500 ? e.timeStamp : n;
};

// ---------- tapping ----------
function tap(e) {
  e.preventDefault();
  const t = eventTime(e);
  ensureAudio();
  keepAwake();
  el.tap.classList.add('hit');
  setTimeout(() => el.tap.classList.remove('hit'), 90);

  const last = taps.at(-1);
  if (last !== undefined && t - last < 60000 / MAX_BPM * 0.8) return; // accidental double-tap
  const gapLimit = grid ? Math.max(RESET_GAP_MS, grid.period * 2.5) : RESET_GAP_MS;
  if (last === undefined || t - last > gapLimit) taps = []; // new series: this tap is "1"
  taps.push(t);

  if (taps.length === 1) {
    firstTapAt = t;
    grid = null;
    render1Only();
    return;
  }
  const fit = fitTaps(taps);
  if (fit) {
    grid = { ...fit, offset: 0 };
    el.hint.textContent = taps.length < 4 ? 'Keep tapping…' : 'Locked in. Tap again any time to correct.';
  }
}

function render1Only() {
  el.big.className = 'big';
  el.big.textContent = '1';
  el.bpm.textContent = '—';
  highlight(1);
  el.hint.textContent = 'Keep tapping…';
}

// ---------- controls ----------
function setOne(e) {
  if (!grid) return;
  grid.offset = offsetForOneAt(eventTime(e), grid);
}
function shift(d) { if (grid) grid.offset = mod(grid.offset + d, 8); }
function nudge(d) {
  if (!grid) return;
  grid = withBpm(grid, Math.round(bpmFromPeriod(grid.period)) + d, now());
  taps = []; // next tap starts a fresh series
}
function stop() {
  grid = null; taps = []; shown = null; firstTapAt = null;
  el.big.className = 'big idle'; el.big.textContent = '–'; el.bpm.textContent = '—';
  highlight(0);
  el.hint.textContent = 'Tap along with the beat, starting on 1';
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
let ctx = null;
let lastClick = -Infinity; // performance time of the last scheduled click

function ensureAudio() {
  if (!settings.click) return;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    // iOS 17+: play even when the ring/silent switch is on.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function toCtxTime(perfMs) {
  const ts = ctx.getOutputTimestamp ? ctx.getOutputTimestamp() : null;
  if (ts && ts.performanceTime > 0) return ts.contextTime + (perfMs - ts.performanceTime) / 1000;
  return ctx.currentTime + (perfMs - now()) / 1000;
}

function click(when, count) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = count === 1 ? 1760 : 1100;
  const peak = count === 1 ? 0.9 : isPause(count) ? 0.25 : 0.5;
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(peak, when + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
  osc.connect(gain).connect(ctx.destination);
  osc.start(when);
  osc.stop(when + 0.06);
}

function scheduleClicks() {
  if (!settings.click || !ctx || ctx.state !== 'running' || !grid) return;
  const t = now();
  const horizon = t + 120;
  let k = Math.ceil(beatPosition(Math.max(t + 5, lastClick + grid.period * 0.5), grid));
  for (let beat = grid.anchor + k * grid.period; beat < horizon; k++, beat = grid.anchor + k * grid.period) {
    click(Math.max(ctx.currentTime, toCtxTime(beat)), countForIndex(k, grid.offset));
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
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && grid) keepAwake(); });

// ---------- wiring ----------
el.tap.addEventListener('pointerdown', tap);
el.setOne.addEventListener('pointerdown', setOne);
el.shiftUp.addEventListener('click', () => shift(1));
el.shiftDown.addEventListener('click', () => shift(-1));
el.faster.addEventListener('click', () => nudge(1));
el.slower.addEventListener('click', () => nudge(-1));
el.stop.addEventListener('click', stop);
el.on1.addEventListener('click', () => setMode('on1'));
el.on2.addEventListener('click', () => setMode('on2'));
el.settingsBtn.addEventListener('click', () => { el.settings.hidden = false; });
el.closeSettings.addEventListener('click', () => { el.settings.hidden = true; });
el.settings.addEventListener('click', (e) => { if (e.target === el.settings) el.settings.hidden = true; });
el.click.addEventListener('change', () => { settings.click = el.click.checked; save(); ensureAudio(); });
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
