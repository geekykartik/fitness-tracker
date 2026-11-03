/**
 * engine.js — the rep state machine, form scoring and feedback rules.
 *
 * One engine instance is reconfigured whenever the user switches exercise
 * (engine.setExercise(cfg)). Every video frame we call update() with the 33
 * MediaPipe landmarks; it answers with everything the UI needs:
 *   - smoothed metrics + current phase ("up"/"down")
 *   - which feedback messages are active right now
 *   - an optional event: a finished rep (with score), a partial rep, or a stall
 */
import { MovingAverage, clamp, visibilityOk } from './angles.js';
import { REQUIRED_LANDMARKS } from './config.js';

export class ExerciseEngine {
  constructor() {
    this.cfg = null;
    this.smoothers = new Map();   // metric name → MovingAverage
    this.ruleState = new Map();   // rule id → { frames, recorded }
    this.base = null;             // standing baseline (for heel-lift etc.)
    this.reset();
  }

  /** Switch to a different exercise (called when a chip is tapped). */
  setExercise(cfg) {
    this.cfg = cfg;
    this.smoothers.clear();
    this.reset();
  }

  /** Clear the state machine (Reset button / new set). */
  reset() {
    this.state = 'up';            // "up" = the extended / standing position
    this.stateSince = performance.now();
    this.attemptActive = false;   // true while a rep is in progress
    this.stallFired = false;
    this.stallLabel = null;
    this.repViolations = new Map(); // rule id → { label, weight } for this rep
    this.metrics = null;          // smoothed metrics of the latest frame
    this.raw = null;
    this.lastScore = null;        // score of the last completed rep
    this.ruleState.clear();
    this.base = null;
    this.phase = 'up';
  }

  /** Called every frame. Returns a state snapshot for the UI. */
  update(lm, now = performance.now()) {
    const cfg = this.cfg;
    if (!cfg || !lm) return null;

    const out = {
      metrics: this.metrics,
      phase: this.state,
      attemptActive: this.attemptActive,
      activeRules: [],
      feedback: null,     // { label, priority }
      event: null,        // { type:'rep'|'partial'|'stall', ... }
      visible: true,
      visibleMessage: null,
    };

    /* ── 1. Visibility check: is the whole body in frame? ────────────── */
    const required = REQUIRED_LANDMARKS[cfg.id] || [];
    const ok = visibilityOk(lm, required, 0.5);
    out.visible = ok;
    if (!ok) {
      out.feedback = { label: 'Step back — show your full body in the camera', priority: 0 };
      out.visibleMessage = out.feedback.label;
      // Keep drawing, but don't let a half-visible body move the counters.
      return out;
    }

    /* ── 2. Smooth the raw values (moving average) ───────────────────── */
    const raw = cfg.metrics(lm, this.base);
    const sm = {};
    for (const [k, rawV] of Object.entries(raw)) {
      // Booleans (e.g. "body is in a plank") become 1/0 so they can be smoothed.
      const v = typeof rawV === 'boolean' ? (rawV ? 1 : 0) : rawV;
      if (typeof v !== 'number' || !isFinite(v)) { sm[k] = this.metrics?.[k] ?? 0; continue; }
      if (!this.smoothers.has(k)) this.smoothers.set(k, new MovingAverage(cfg.smoothing || 5));
      sm[k] = this.smoothers.get(k).push(v);
    }
    this.raw = raw;
    this.metrics = sm;
    this.phase = this.state;

    const ctx = { state: this.state, attemptActive: this.attemptActive, base: this.base, lm };

    /* ── 3. Update the standing baseline (EMA) between reps ──────────── */
    if (this.state === 'up' && !this.attemptActive) {
      if (!this.base) this.base = { ...sm };
      else for (const k of Object.keys(sm)) this.base[k] = this.base[k] * 0.98 + sm[k] * 0.02;
    }

    /* ── 4. Evaluate feedback rules (debounced so flickers don't count) ─ */
    const active = [];
    for (const rule of cfg.rules) {
      let hit = false;
      try { hit = !!rule.test(sm, ctx); } catch { hit = false; }
      const st = this.ruleState.get(rule.id) || { frames: 0, recorded: false };
      if (hit) st.frames++;
      else { st.frames = 0; st.recorded = false; }
      const hold = rule.holdFrames ?? 3;
      if (st.frames >= hold) {
        active.push(rule);
        // Record the violation against the rep that is currently in progress.
        if (this.attemptActive && !st.recorded) {
          this.repViolations.set(rule.id, { label: rule.label, weight: rule.weight });
          st.recorded = true;
        }
      }
      this.ruleState.set(rule.id, st);
    }
    out.activeRules = active;

    /* ── 5. The state machine: up → down → up = 1 rep ───────────────── */
    const towardDown = this.towardDown(sm);
    if (this.state === 'up') {
      if (!this.attemptActive && towardDown) {
        // The movement started — begin tracking a rep attempt.
        this.attemptActive = true;
        this.repViolations.clear();
        for (const st of this.ruleState.values()) st.recorded = false;
      } else if (this.attemptActive && cfg.isUp(sm)) {
        // Came back up WITHOUT ever reaching the bottom → partial rep.
        // (No rep counted, but the user gets told what to fix.)
        const label = cfg.rangeLabels?.min;
        if (label) {
          out.event = { type: 'partial', label };
          out.feedback = { label, priority: 2 };
        }
        this.attemptActive = false;
        this.repViolations.clear();
      }
      if (cfg.isDown(sm)) {
        this.state = 'down';
        this.stateSince = now;
        this.stallFired = false;
        this.stallLabel = null;
      }
    } else if (this.state === 'down') {
      if (cfg.isUp(sm)) {
        // ── Completed: down phase + up phase = 1 rep ──
        this.state = 'up';
        this.stateSince = now;
        this.stallFired = false;
        this.stallLabel = null;
        this.attemptActive = false;
        const score = this.scoreRep();
        this.lastScore = score;
        out.event = {
          type: 'rep',
          score,
          violations: [...this.repViolations.values()].map((v) => v.label),
        };
        this.repViolations.clear();
      } else {
        // Stuck at the bottom for too long → nudge (and count it as a
        // form mistake on the rep if one eventually completes).
        const secs = (now - this.stateSince) / 1000;
        if (secs > (cfg.stallSeconds ?? 5) && !this.stallFired) {
          this.stallFired = true;
          this.stallLabel = cfg.rangeLabels?.max || null;
          if (this.stallLabel && this.attemptActive) {
            this.repViolations.set('stall', { label: this.stallLabel, weight: 12 });
          }
        }
        if (this.stallLabel) out.feedback = { label: this.stallLabel, priority: 2 };
      }
    }

    /* ── 6. Pick the message to show (highest priority wins) ─────────── */
    if (out.event?.type === 'partial') out.feedback = { label: out.event.label, priority: 2 };
    if (!out.feedback) {
      let best = null;
      for (const r of active) if (!best || r.priority < best.priority) best = r;
      if (best) out.feedback = { label: best.label, priority: best.priority };
    }

    /* ── 7. Live form score (100 minus active penalties) ─────────────── */
    let live = 100;
    for (const r of active) live -= r.weight;
    out.liveScore = clamp(Math.round(live), 0, 100);
    out.score = this.attemptActive ? out.liveScore : this.lastScore;
    return out;
  }

  /** True while the metric is halfway toward the "down" threshold. */
  towardDown(m) {
    if (this.cfg.attemptTest) return this.cfg.attemptTest(m);
    const key = this.primaryKey();
    const v = m[key];
    const { down, up } = this.cfg.thresholds;
    if (down < up) return v < down + (up - down) / 2;   // angles: down is smaller
    return v > down - (down - up) / 2;                  // ratios: down is larger
  }

  /** Which smoothed metric drives the state machine. */
  primaryKey() {
    return this.cfg.primary;
  }

  /** Final score for a completed rep: 100 minus every recorded penalty. */
  scoreRep() {
    let s = 100;
    for (const v of this.repViolations.values()) s -= v.weight;
    return clamp(Math.round(s), 0, 100);
  }
}

/** Good / Needs work badge for a score. */
export function scoreBadge(score) {
  if (score == null) return { text: '—', cls: '' };
  return score >= 80 ? { text: 'Good', cls: 'good' } : { text: 'Needs work', cls: 'warn' };
}
