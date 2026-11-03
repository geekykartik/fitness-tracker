/**
 * main.js — wires everything together:
 *   camera + MediaPipe (pose.js) → rep engine (engine.js) → dashboard (ui.js)
 *   plus timers, sets/rest, voice feedback, calories and history.
 *
 * Privacy: the video stream is only ever read by canvas/MediaPipe inside
 * this page. Nothing is posted anywhere.
 */
import { EXERCISE_MAP, EXERCISES, MET, DEFAULT_SETTINGS } from './config.js';
import { ExerciseEngine } from './engine.js';
import { PoseSession } from './pose.js';
import { FeedbackBus, beep, setCompleteChime } from './feedback.js';
import {
  saveSession, loadHistory, clearHistory, dateKey,
} from './history.js';
import * as ui from './ui.js';

/* ═══════════════════ app state ═══════════════════ */
const settings = loadSettings();
let history = loadHistory();

const app = {
  exerciseId: EXERCISES[0].id,
  mode: 'idle',          // idle → running ⇄ paused, running → resting → running
  setReps: 0,            // reps in the CURRENT set
  restLeft: 0,
  cameraReady: false,
  modelReady: false,
  lastPoseAt: 0,
  lowLight: false,
  lightAt: 0,
  celebrate: null,       // { text, until } — short "nice rep!" banner
  lastTick: performance.now(),
  statusMsg: '',
};

/** Per-workout session: totals accumulate per exercise across the whole run. */
let session = newSession();
function newSession() {
  return { ts: Date.now(), durationSec: 0, exercises: {} };
}
function entry(id = app.exerciseId) {
  const ex = EXERCISE_MAP[id];
  return (session.exercises[id] ||= {
    name: ex.name, emoji: ex.emoji, reps: 0, sets: 0,
    scores: [], missed: 0, mistakes: {}, activeMs: 0,
  });
}

/* ═══════════════════ instances ═══════════════════ */
const engine = new ExerciseEngine();
const bus = new FeedbackBus();
const pose = new PoseSession(ui.els.video, ui.els.overlay, onPose);

/* ═══════════════════ settings ═══════════════════ */
function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('fitcam_settings') || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
function saveSettings() {
  try { localStorage.setItem('fitcam_settings', JSON.stringify(settings)); } catch {}
}
function applySettingsToInputs() {
  ui.els.inTarget.value = settings.targetReps;
  ui.els.inRest.value = settings.restSecs;
  ui.els.inWeight.value = settings.weightKg;
  ui.els.inModel.value = settings.model;
  ui.els.inVoice.checked = settings.voice;
  ui.els.inMirror.checked = settings.mirror;
  bus.setVoice(settings.voice);
  ui.els.camStage.classList.toggle('mirrored', settings.mirror);
}

/* ═══════════════════ camera + model ═══════════════════ */
async function ensureModel(silent = false) {
  if (app.modelReady) return true;
  try {
    await pose.loadModel(settings.model, (s) => {
      if (!silent) { ui.els.camStatusText.textContent = s + '…'; ui.setStatus(s); }
    });
    app.modelReady = true;
    return true;
  } catch (err) {
    console.error(err);
    if (!silent) {
      ui.showError('Could not load the pose model — check your internet connection (needed once, then it is cached).');
      ui.els.camStatusText.textContent = 'Model failed to load. Check your connection and retry.';
    }
    return false;
  }
}

async function ensureCamera() {
  if (app.cameraReady) return true;
  ui.els.camStatusText.textContent = 'Starting camera…';
  ui.setStatus('Starting camera…');
  try {
    await pose.startCamera();
  } catch (err) {
    ui.showError(err.message);
    ui.els.camStatusText.textContent = err.message;
    ui.setStatus('Camera blocked', 'bad');
    return false;
  }
  const ok = await ensureModel();
  if (!ok) {
    pose.stopCamera();
    return false;
  }
  pose.startLoop();
  app.cameraReady = true;
  ui.els.camPlaceholder.hidden = true;
  ui.setStatus('Live', 'live');
  return true;
}

/* ═══════════════════ per-frame callback from PoseSession ═══════════════════ */
function onPose(lm, now) {
  // Low-light check a couple of times per second (cheap 48×36 sample).
  if (lm && now - app.lightAt > 2500) {
    app.lightAt = now;
    app.lowLight = sampleBrightness() < 42;
  }

  let snap = null;
  if (lm) {
    app.lastPoseAt = now;
    // Engine keeps counting its state machine even while paused/idle so the
    // skeleton + positioning feedback stay alive; only EVENTS are gated
    // on mode === 'running' below.
    snap = engine.update(lm, now);
    pose.setPhase(snap?.activeRules?.length ? 'warn' : 'ok');
  } else {
    pose.setPhase('ok');
  }
  app.lastSnap = snap;

  // "No body detected" still needs to update the banner when lm is null.
  const msg = pickFeedback(snap, now);
  if (msg) {
    ui.setFeedback(msg.text, msg.level, msg.icon);
    bus.update(msg.text, msg.priority, msg.speak);
  }
  if (!snap) return;

  // ── Rep / partial events are only counted while actually working out ──
  if (app.mode === 'running' && snap?.event) {
    if (snap.event.type === 'rep') onRep(snap.event, now);
    else if (snap.event.type === 'partial') {
      const e = entry();
      e.missed++;
      e.mistakes[snap.event.label] = (e.mistakes[snap.event.label] || 0) + 1;
    }
  }
}

/** A rep finished: update counters, maybe finish the set. */
function onRep(ev, now) {
  const e = entry();
  e.reps++;
  app.setReps++;
  e.scores.push(ev.score);
  for (const label of ev.violations) {
    e.mistakes[label] = (e.mistakes[label] || 0) + 1;
  }

  const badge = ev.score >= 80 ? 'Good' : 'Needs work';
  app.celebrate = {
    text: `Rep ${app.setReps} ✓  form ${ev.score} (${badge})`,
    until: now + 1400,
  };

  if (app.setReps >= settings.targetReps) completeSet();
}

function completeSet() {
  const e = entry();
  e.sets++;
  app.setReps = 0;
  setCompleteChime();
  if (settings.restSecs > 0) {
    app.mode = 'resting';
    app.restLeft = settings.restSecs;
    bus.sayNow(`Set complete. Rest for ${settings.restSecs} seconds.`);
  } else {
    beep({ freq: 980, dur: 0.18 });
    bus.sayNow('Set complete. Next set, go!');
  }
}

function startNextSet() {
  app.mode = 'running';
  app.restLeft = 0;
  app.setReps = 0;
  beep({ freq: 880, dur: 0.15 });
  bus.sayNow(`Set ${entry().sets + 1}. Go!`);
}

/* ═══════════════════ message selection ═══════════════════ */
const ICON_RULES = [
  [/step back|full body|frame/i, '🚶'],
  [/dark|light/i, '💡'],
  [/no body/i, '🔍'],
  [/knees?/i, '🦵'],
  [/heel/i, '🦶'],
  [/feet|land/i, '👣'],
  [/jump/i, '⭐'],
  [/hips|sag/i, '🩹'],
  [/straight line|back straight|arch|chest/i, '📏'],
  [/elbow|curl|extend|lock/i, '💪'],
  [/arms|clap|overhead/i, '🙌'],
  [/lower|down/i, '⬇️'],
  [/stand|up fully|push back|step back up/i, '⬆️'],
  [/swing/i, '🤸'],
];
function iconFor(text) {
  for (const [re, icon] of ICON_RULES) if (re.test(text)) return icon;
  return '⚠️';
}

function pickFeedback(snap, now) {
  if (app.mode === 'paused') {
    return { text: 'Paused — press Resume when you are ready', level: 'info', icon: '⏸', priority: 0, speak: false };
  }
  const msgs = [];
  if (snap?.visibleMessage) {
    msgs.push({ text: snap.visibleMessage, level: 'warn', icon: '🚶', priority: 0, speak: true });
  }
  if (app.lowLight) {
    msgs.push({ text: 'Too dark — turn on more light so I can see you', level: 'warn', icon: '💡', priority: 0, speak: true });
  }
  if (!snap || now - app.lastPoseAt > 1800) {
    msgs.push({ text: 'No body detected — step in front of the camera', level: 'warn', icon: '🔍', priority: 0, speak: true });
  }
  if (app.mode === 'resting') {
    msgs.push({
      text: `Rest ${fmtClock(app.restLeft)} — set ${entry().sets + 1} coming up`,
      level: 'info', icon: '⏳', priority: 1, speak: false,
    });
  }
  if (app.celebrate && now < app.celebrate.until) {
    msgs.push({ text: app.celebrate.text, level: 'good', icon: '🎉', priority: 1, speak: false });
  }
  if (snap?.feedback) {
    msgs.push({
      text: snap.feedback.label,
      level: 'warn',
      icon: iconFor(snap.feedback.label),
      priority: snap.feedback.priority,
      speak: true,
    });
  }
  if (!msgs.length && app.mode === 'running') {
    msgs.push({ text: 'Nice — keep going', level: 'good', icon: '✅', priority: 9, speak: false });
  }
  if (!msgs.length && app.mode === 'idle') {
    msgs.push({ text: 'Press Start when your whole body is in frame', level: 'info', icon: 'ℹ️', priority: 9, speak: false });
  }
  msgs.sort((a, b) => a.priority - b.priority);
  return msgs[0] || null;
}

/* ═══════════════════ timers / dashboard refresh (4× per second) ═══════════════════ */
function tick() {
  const now = performance.now();
  const dt = (now - app.lastTick) / 1000;
  app.lastTick = now;

  if (app.mode === 'running' || app.mode === 'resting') {
    session.durationSec += dt;
    if (app.mode === 'running') entry().activeMs += dt * 1000;
  }
  if (app.mode === 'resting') {
    app.restLeft -= dt;
    if (app.restLeft <= 0) startNextSet();
  }

  renderDashboard(now);
}

function renderDashboard(now) {
  const cfg = EXERCISE_MAP[app.exerciseId];
  const e = entry();
  const avg = e.scores.length
    ? Math.round(e.scores.reduce((a, b) => a + b, 0) / e.scores.length)
    : null;
  const snap = engine.metrics;

  ui.renderDashboard({
    reps: app.setReps,
    target: settings.targetReps,
    missed: e.missed,
    sets: e.sets,
    score: app.lastSnap?.score ?? engine.lastScore ?? null,
    avgScore: avg,
    repTotal: e.reps,
    timer: fmtClock(session.durationSec),
    phaseText: phaseText(cfg, snap),
    rest: app.mode === 'resting' ? fmtClock(Math.max(0, app.restLeft)) : '—',
    restSub: app.mode === 'resting' ? `set ${e.sets} done` : 'between sets',
  });

  ui.setControls({ started: app.mode !== 'idle', paused: app.mode === 'paused' });

  if (pose.fps) ui.setFps(`${Math.round(pose.fps)} fps`);
  if (snap && app.mode !== 'idle') {
    const v = snap[cfg.primary];
    const unit = cfg.primary === 'ratio' ? '×' : '°';
    const txt = cfg.primary === 'ratio' ? v.toFixed(2) : Math.round(v);
    ui.setMetric(`${cfg.primaryLabel}: ${txt}${unit}`);
  } else {
    ui.setMetric('');
  }
}

function phaseText(cfg, m) {
  if (app.mode === 'resting') return 'phase: resting';
  if (!m) return 'phase: —';
  const v = m[cfg.primary];
  const unit = cfg.primary === 'ratio' ? '×' : '°';
  const txt = cfg.primary === 'ratio' ? Number(v).toFixed(2) : Math.round(v);
  return `phase: ${engine.state} · ${txt}${unit}`;
}

/** Average brightness of the current video frame (0–255). */
function sampleBrightness() {
  const v = ui.els.video;
  if (!v.videoWidth) return 128;
  try {
    const c = sampleBrightness.c || (sampleBrightness.c = Object.assign(document.createElement('canvas'), { width: 48, height: 36 }));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(v, 0, 0, 48, 36);
    const d = ctx.getImageData(0, 0, 48, 36).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return sum / (d.length / 4);
  } catch {
    return 128;
  }
}

/* ═══════════════════ exercise switching ═══════════════════ */
function selectExercise(id) {
  if (!EXERCISE_MAP[id]) return;
  app.exerciseId = id;
  app.setReps = 0;                 // a new exercise always starts a fresh set
  app.celebrate = null;
  engine.setExercise(EXERCISE_MAP[id]);
  ui.setActiveChip(id);
  ui.setAngleTip(EXERCISE_MAP[id].cameraTip);
  if (app.mode === 'resting') { app.mode = 'running'; app.restLeft = 0; }
}

/* ═══════════════════ summary + history ═══════════════════ */
function buildSummary() {
  const exercises = {};
  const mistakes = {};
  let totalReps = 0, calories = 0;
  const allScores = [];

  for (const [id, e] of Object.entries(session.exercises)) {
    if (!e.reps && !e.scores.length) continue;
    exercises[id] = e;
    totalReps += e.reps;
    allScores.push(...e.scores);
    calories += (MET[id] || 4) * settings.weightKg * (e.activeMs / 3600000);
    for (const [k, v] of Object.entries(e.mistakes)) mistakes[k] = (mistakes[k] || 0) + v;
  }

  const top = Object.entries(mistakes).sort((a, b) => b[1] - a[1])[0];
  return {
    exercises,
    totalReps,
    avgScore: allScores.length ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length) : null,
    durationSec: Math.round(session.durationSec),
    calories: Math.max(0, Math.round(calories)),
    topMistake: top ? `${top[0]} (×${top[1]})` : null,
  };
}

function finishWorkout() {
  const s = buildSummary();

  // Nothing meaningful to save yet — don't pause or spam the history.
  // (Shown as a short-lived toast so the live feedback loop can't eat it.)
  if (s.totalReps === 0 && s.durationSec < 20) {
    app.celebrate = { text: 'Nothing to finish yet — do a few reps first.', until: performance.now() + 3500 };
    ui.setFeedback(app.celebrate.text, 'warn', 'ℹ️');
    return;
  }

  if (app.mode === 'running' || app.mode === 'resting' || app.mode === 'paused') app.mode = 'paused';
  ui.setStatus('Finished');
  ui.setControls({ started: true, paused: true });

  // Persist a compact copy to localStorage history.
  const compactEx = {};
  for (const [id, e] of Object.entries(s.exercises)) {
    compactEx[id] = {
      name: e.name, emoji: e.emoji, reps: e.reps, sets: e.sets,
      avgScore: e.scores.length ? Math.round(e.scores.reduce((a, b) => a + b, 0) / e.scores.length) : null,
      mistakes: e.mistakes,
    };
  }
  history = saveSession({
    ts: Date.now(),
    dateKey: dateKey(Date.now()),
    durationSec: s.durationSec,
    calories: s.calories,
    totalReps: s.totalReps,
    avgScore: s.avgScore,
    exercises: compactEx,
    topMistake: s.topMistake,
  });
  ui.renderHistory(history);

  ui.renderSummary(s);
  ui.els.summaryModal.hidden = false;
  bus.sayNow(s.totalReps ? `Workout complete. ${s.totalReps} reps. Great job!` : 'Workout finished.');
}

function newWorkout() {
  session = newSession();
  app.setReps = 0;
  app.mode = 'idle';
  app.restLeft = 0;
  app.celebrate = null;
  engine.reset();
  ui.setControls({ started: false, paused: false });
  ui.setStatus(app.cameraReady ? 'Live' : 'Camera off', app.cameraReady ? 'live' : '');
  ui.els.summaryModal.hidden = true;
  ui.setFeedback('New workout — press Start when ready.', 'info', 'ℹ️');
}

/* ═══════════════════ events ═══════════════════ */
async function startPressed() {
  if (app.mode === 'paused') {
    // Resume into whichever phase we paused from (workout or rest).
    app.mode = app.modeBeforePause === 'resting' ? 'resting' : 'running';
    app.lastTick = performance.now();
    ui.setStatus('Live', 'live');
    ui.setControls({ started: true, paused: false });   // update NOW, not on next tick
    beep({ freq: 700, dur: 0.1 });
    return;
  }
  if (app.mode !== 'idle') return;
  const ok = await ensureCamera();
  if (!ok) return;
  app.mode = 'running';
  app.lastTick = performance.now();
  beep({ freq: 760, dur: 0.12 });
  bus.sayNow('Workout started.');
}

ui.els.btnStart.addEventListener('click', startPressed);
ui.els.btnEnableCam.addEventListener('click', startPressed);

ui.els.btnPause.addEventListener('click', () => {
  if (app.mode === 'running' || app.mode === 'resting') {
    app.modeBeforePause = app.mode;
    app.mode = 'paused';
    ui.setStatus('Paused');
    ui.setControls({ started: true, paused: true });    // enable Resume immediately
    beep({ freq: 520, dur: 0.08 });
  }
});

ui.els.btnReset.addEventListener('click', () => {
  const e = entry();
  if ((e.reps || e.sets || e.scores.length) &&
      !confirm('Reset counters for this exercise?')) return;
  delete session.exercises[app.exerciseId];
  app.setReps = 0;
  app.restLeft = 0;
  if (app.mode === 'resting') app.mode = 'running';
  engine.reset();
  ui.setFeedback('Reset — counters cleared.', 'info', '↺');
});

ui.els.btnFinish.addEventListener('click', finishWorkout);
ui.els.btnCloseSummary.addEventListener('click', () => { ui.els.summaryModal.hidden = true; });
ui.els.btnNewWorkout.addEventListener('click', newWorkout);
ui.els.btnDismissError.addEventListener('click', ui.hideError);

ui.els.btnClearHistory.addEventListener('click', () => {
  if (!history.length) return;
  if (!confirm('Delete all saved workout history from this device?')) return;
  clearHistory();
  history = [];
  ui.renderHistory(history);
});

/* Settings inputs */
ui.els.inTarget.addEventListener('change', () => {
  settings.targetReps = Math.max(1, Math.min(100, parseInt(ui.els.inTarget.value) || 12));
  ui.els.inTarget.value = settings.targetReps;
  saveSettings();
});
ui.els.inRest.addEventListener('change', () => {
  settings.restSecs = Math.max(0, Math.min(600, parseInt(ui.els.inRest.value) || 0));
  ui.els.inRest.value = settings.restSecs;
  saveSettings();
});
ui.els.inWeight.addEventListener('change', () => {
  settings.weightKg = Math.max(20, Math.min(250, parseFloat(ui.els.inWeight.value) || 70));
  ui.els.inWeight.value = settings.weightKg;
  saveSettings();
});
ui.els.inVoice.addEventListener('change', () => {
  settings.voice = ui.els.inVoice.checked;
  bus.setVoice(settings.voice);
  saveSettings();
});
ui.els.inMirror.addEventListener('change', () => {
  settings.mirror = ui.els.inMirror.checked;
  ui.els.camStage.classList.toggle('mirrored', settings.mirror);
  saveSettings();
});
ui.els.inModel.addEventListener('change', async () => {
  settings.model = ui.els.inModel.value;
  saveSettings();
  app.modelReady = false;
  ui.setStatus('Switching model…');
  const ok = await ensureModel(true);
  if (ok) ui.setStatus(app.mode === 'idle' ? 'Camera off' : 'Live', app.mode === 'idle' ? '' : 'live');
  else ui.showError('Could not switch the model — check your connection.');
});

window.addEventListener('resize', () => ui.renderHistory(history));
window.addEventListener('beforeunload', () => pose.stopCamera());

/* ═══════════════════ boot ═══════════════════ */
function fmtClock(sec) {
  const t = Math.max(0, Math.round(sec));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function boot() {
  applySettingsToInputs();
  ui.buildExerciseChips(selectExercise);
  selectExercise(app.exerciseId);
  ui.renderHistory(history);
  ui.setControls({ started: false, paused: false });
  ui.setFeedback('Choose an exercise, then press Start.', 'info', 'ℹ️');
  setInterval(tick, 250);
  // Debug/testing hook (also handy in the browser console).
  window.__fitcam = {
    pose, engine, app,
    get settings() { return settings; },
    get session() { return session; },
    // Feed landmarks straight into the app as if the camera saw them.
    feedPose: (lm, t = performance.now()) => onPose(lm, t),
  };
  // Start downloading the model right away so the first Start is fast.
  ensureModel(true).then(() => {
    if (!app.cameraReady) ui.els.camStatusText.textContent = 'Model ready — tap Start to turn on the camera.';
  });
}
boot();
