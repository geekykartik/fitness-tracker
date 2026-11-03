/**
 * ui.js — all direct DOM work lives here so main.js stays readable.
 * It only touches the page: build chips, update numbers, draw summaries.
 */
import { EXERCISES } from './config.js';
import { scoreBadge } from './engine.js';
import { drawWeeklyChart, weeklyData, weekTotals, dateKey } from './history.js';

/** Every element main.js needs, in one place. */
export const els = {};
const IDS = [
  'camStage', 'video', 'overlay', 'camPlaceholder', 'camStatusText', 'btnEnableCam',
  'statusPill', 'metricPill', 'fpsPill', 'angleTip',
  'feedbackBanner', 'feedbackIcon', 'feedbackText',
  'exercisePicker', 'repCount', 'repTarget', 'missedCount', 'setCount', 'setTargetSub',
  'formScore', 'formBadge', 'avgForm', 'avgFormSub', 'timer', 'phaseSub', 'restTimer', 'restSub',
  'btnStart', 'btnPause', 'btnReset', 'btnFinish',
  'inTarget', 'inRest', 'inWeight', 'inModel', 'inVoice', 'inMirror',
  'weekStats', 'weekChart', 'historyList', 'btnClearHistory',
  'summaryModal', 'summaryGrid', 'summaryTotals', 'btnCloseSummary', 'btnNewWorkout',
  'errorBanner', 'errorText', 'btnDismissError',
];
for (const id of IDS) els[id] = document.getElementById(id);

/** Build the horizontal exercise chips. */
export function buildExerciseChips(onSelect) {
  els.exercisePicker.innerHTML = '';
  for (const ex of EXERCISES) {
    const btn = document.createElement('button');
    btn.className = 'ex-chip';
    btn.dataset.id = ex.id;
    btn.innerHTML = `
      <span class="ex-emoji">${ex.emoji}</span>
      <span>${ex.name}</span>
      <span class="ex-cam">${ex.camera} view</span>`;
    btn.addEventListener('click', () => onSelect(ex.id));
    els.exercisePicker.appendChild(btn);
  }
}

export function setActiveChip(id) {
  for (const chip of els.exercisePicker.children) {
    chip.classList.toggle('active', chip.dataset.id === id);
  }
}

/** Big dashboard numbers. `d` comes from main.js each frame. */
export function renderDashboard(d) {
  els.repCount.textContent = d.reps;
  els.repTarget.textContent = `/ ${d.target}`;
  els.missedCount.textContent = d.missed ? `${d.missed} partial` + (d.missed > 1 ? 's' : '') : '';
  els.setCount.textContent = d.sets;
  els.setTargetSub.textContent = `target ${d.target} reps`;

  const badge = scoreBadge(d.score);
  els.formScore.textContent = d.score == null ? '—' : d.score;
  els.formBadge.textContent = badge.text;
  els.formBadge.className = 'badge ' + badge.cls;

  const avgBadge = scoreBadge(d.avgScore);
  els.avgForm.textContent = d.avgScore == null ? '—' : d.avgScore;
  els.avgFormSub.textContent = avgBadge.text === '—' ? 'this exercise' : `${d.repTotal} reps scored`;

  els.timer.textContent = d.timer;
  els.phaseSub.textContent = d.phaseText;
  els.restTimer.textContent = d.rest;
  els.restSub.textContent = d.restSub;
}

/** Feedback banner with colour level. */
export function setFeedback(text, level = 'info', icon = 'ℹ️') {
  if (els.feedbackText.textContent === text && els.feedbackBanner.dataset.level === level) return;
  els.feedbackText.textContent = text;
  els.feedbackBanner.dataset.level = level;
  els.feedbackIcon.textContent = icon;
}

export function setStatus(text, cls = '') {
  els.statusPill.textContent = text;
  els.statusPill.className = 'pill ' + cls;
}

export function setMetric(text) { els.metricPill.textContent = text; }
export function setFps(text) { els.fpsPill.textContent = text; }
export function setAngleTip(text) { els.angleTip.textContent = '📷 ' + text; }

export function showError(msg) {
  els.errorText.textContent = msg;
  els.errorBanner.hidden = false;
}
export function hideError() { els.errorBanner.hidden = true; }

export function setControls({ started, paused }) {
  els.btnStart.disabled = started && !paused;
  els.btnPause.disabled = !started || paused;
  els.btnStart.textContent = started && paused ? '▶ Resume' : '▶ Start';
  els.btnPause.textContent = '⏸ Pause';
}

/** Fill the workout-summary modal. */
export function renderSummary(s) {
  els.summaryGrid.innerHTML = '';
  for (const [id, ex] of Object.entries(s.exercises)) {
    if (!ex.reps && !ex.scores.length) continue;
    const row = document.createElement('div');
    row.className = 'summary-row';
    const avg = ex.scores.length
      ? Math.round(ex.scores.reduce((a, b) => a + b, 0) / ex.scores.length)
      : null;
    const top = Object.entries(ex.mistakes || {}).sort((a, b) => b[1] - a[1])[0];
    row.innerHTML = `
      <span class="sr-title">${ex.emoji || ''} ${ex.name}</span>
      <span class="sr-score">${avg == null ? '—' : avg + ' form'}</span>
      <span class="sr-stats">
        ${ex.reps} reps · ${ex.sets} set${ex.sets === 1 ? '' : 's'}${ex.missed ? ` · ${ex.missed} partials` : ''}
        ${top ? `<br>Most common mistake: <b>${top[0]}</b> (×${top[1]})` : '<br>No form mistakes recorded 🎉'}
      </span>`;
    els.summaryGrid.appendChild(row);
  }

  els.summaryTotals.innerHTML = `
    <div class="st"><div class="v">${s.totalReps}</div><div class="k">total reps</div></div>
    <div class="st"><div class="v">${s.avgScore == null ? '—' : s.avgScore}</div><div class="k">avg form</div></div>
    <div class="st"><div class="v">${fmtClock(s.durationSec)}</div><div class="k">duration</div></div>
    <div class="st"><div class="v">${s.calories}</div><div class="k">kcal (est.)</div></div>
    <div class="st wide"><div class="v" style="font-size:16px">${s.topMistake || 'Great form all round!'}</div><div class="k">most common mistake</div></div>`;
}

/** Refresh history list + weekly chart. */
export function renderHistory(history) {
  const days = weeklyData(history);
  drawWeeklyChart(els.weekChart, days);
  const totals = weekTotals(history);
  const avg = totals.scores.length
    ? Math.round(totals.scores.reduce((a, b) => a + b, 0) / totals.scores.length)
    : null;
  els.weekStats.innerHTML = totals.workouts
    ? `Last 7 days: <b>${totals.reps} reps</b> · <b>${totals.workouts} workout${totals.workouts > 1 ? 's' : ''}</b> · avg form <b>${avg ?? '—'}</b>`
    : 'No workouts yet this week.';

  els.historyList.innerHTML = '';
  if (!history.length) {
    els.historyList.innerHTML = '<li class="empty">Finish a workout to start your history.</li>';
    return;
  }
  for (const s of history.slice(0, 6)) {
    const li = document.createElement('li');
    const when = new Date(s.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    li.innerHTML = `
      <span>
        <span class="hl-main">${when}</span>
        <span class="hl-sub"> · ${fmtClock(s.durationSec)} · ${s.totalReps} reps</span>
      </span>
      <span class="hl-sub">form ${s.avgScore ?? '—'} · ${s.calories} kcal</span>`;
    els.historyList.appendChild(li);
  }
}

/** 125 → "2:05", 3725 → "1:02:05" */
export function fmtClock(totalSec) {
  const t = Math.max(0, Math.round(totalSec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export { dateKey };
