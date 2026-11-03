/**
 * history.js — workout history in localStorage + the weekly progress chart.
 * Everything stays on this device (localStorage). Nothing is uploaded.
 */
const KEY = 'fitcam_history_v1';

/** Load all saved sessions (newest first). */
export function loadHistory() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** Save a finished workout session. Returns the updated list. */
export function saveSession(session) {
  const list = loadHistory();
  list.unshift(session);
  // Keep the last 90 workouts so storage can't grow forever.
  const trimmed = list.slice(0, 90);
  try {
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.warn('Could not save history', e);
  }
  return trimmed;
}

export function clearHistory() {
  localStorage.removeItem(KEY);
}

/** 'YYYY-MM-DD' for a timestamp (local time). */
export function dateKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Last 7 days (oldest → newest) aggregated from history: reps + form score. */
export function weeklyData(history, now = Date.now()) {
  const days = [];
  const byKey = {};
  for (const s of history) {
    const k = s.dateKey || dateKey(s.ts);
    (byKey[k] ||= []).push(s);
  }
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const k = dateKey(d.getTime());
    const sessions = byKey[k] || [];
    const reps = sessions.reduce((a, s) => a + (s.totalReps || 0), 0);
    const scores = sessions.map((s) => s.avgScore).filter((v) => typeof v === 'number');
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    days.push({
      key: k,
      label: d.toLocaleDateString(undefined, { weekday: 'short' }),
      reps,
      score: avg,
      workouts: sessions.length,
    });
  }
  return days;
}

/** Totals for the current week (Mon-based would be nice; rolling 7 days ok). */
export function weekTotals(history) {
  const days = weeklyData(history);
  return {
    reps: days.reduce((a, d) => a + d.reps, 0),
    workouts: days.reduce((a, d) => a + d.workouts, 0),
    scores: days.filter((d) => d.score != null).map((d) => d.score),
  };
}

/**
 * Draw the weekly chart on a canvas: bars = reps per day, line = form score.
 * Uses devicePixelRatio so text stays crisp on phones.
 */
export function drawWeeklyChart(canvas, days) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 320;
  const cssH = 200;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);

  const padL = 34, padR = 34, padT = 16, padB = 28;
  const w = cssW - padL - padR;
  const h = cssH - padT - padB;
  const maxReps = Math.max(10, ...days.map((d) => d.reps));
  const slot = w / days.length;

  // Grid lines + reps axis (left)
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const y = padT + h - (h * i) / 4;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + w, y);
    ctx.stroke();
    ctx.fillText(String(Math.round((maxReps * i) / 4)), padL - 6, y + 3);
  }

  // Bars = reps per day
  days.forEach((d, i) => {
    const bw = Math.min(30, slot * 0.55);
    const x = padL + slot * i + (slot - bw) / 2;
    const bh = (d.reps / maxReps) * h;
    ctx.fillStyle = d.reps > 0 ? '#4cffad' : 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, padT + h - bh, bw, bh, 4);
    else ctx.rect(x, padT + h - bh, bw, bh);
    ctx.fill();
    // Day label
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.textAlign = 'center';
    ctx.fillText(d.label, padL + slot * i + slot / 2, cssH - 10);
  });

  // Line = form score trend (right axis 0–100)
  const pts = days.filter((d) => d.score != null);
  if (pts.length > 1) {
    ctx.strokeStyle = '#7cc4ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach((d, idx) => {
      const i = days.indexOf(d);
      const x = padL + slot * i + slot / 2;
      const y = padT + h - (d.score / 100) * h;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = '#7cc4ff';
    for (const d of pts) {
      const i = days.indexOf(d);
      const x = padL + slot * i + slot / 2;
      const y = padT + h - (d.score / 100) * h;
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Form-score axis labels (right)
  ctx.fillStyle = 'rgba(124,196,255,0.8)';
  ctx.textAlign = 'left';
  ctx.fillText('100', padL + w + 6, padT + 8);
  ctx.fillText('0', padL + w + 6, padT + h);

  // Legend
  ctx.textAlign = 'left';
  ctx.fillStyle = '#4cffad';
  ctx.fillRect(padL, 4, 8, 8);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('reps', padL + 12, 12);
  ctx.fillStyle = '#7cc4ff';
  ctx.fillRect(padL + 46, 4, 8, 8);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('form', padL + 58, 12);
}
