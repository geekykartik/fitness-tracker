/**
 * Smoke test: drives the ExerciseEngine with synthetic 33-landmark frames
 * (no camera needed) and asserts that reps/partials are counted correctly.
 * Run: node engine_test.mjs
 */
import { ExerciseEngine } from './js/engine.js';
import { EXERCISE_MAP } from './js/config.js';

/** Build a full 33-landmark array from a few named points. */
function pose(points) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  for (const [i, p] of Object.entries(points)) lm[+i] = { ...p, z: 0, visibility: 1 };
  return lm;
}

// Standing squat pose (side view): shoulder 11/12, hip 23/24, knee 25/26, ankle 27/28, heel 31/32, toe 29/30
const STAND = pose({
  11: { x: 0.48, y: 0.30 }, 12: { x: 0.52, y: 0.30 },
  13: { x: 0.47, y: 0.45 }, 14: { x: 0.53, y: 0.45 },
  15: { x: 0.47, y: 0.55 }, 16: { x: 0.53, y: 0.55 },
  23: { x: 0.50, y: 0.52 }, 24: { x: 0.51, y: 0.52 },
  25: { x: 0.50, y: 0.70 }, 26: { x: 0.51, y: 0.70 },
  27: { x: 0.50, y: 0.90 }, 28: { x: 0.51, y: 0.90 },
  29: { x: 0.56, y: 0.92 }, 30: { x: 0.57, y: 0.92 },
  31: { x: 0.46, y: 0.92 }, 32: { x: 0.47, y: 0.92 },
});
// Deep squat: hips drop, knees shoot forward → hip-knee-ankle ≈ 90°
const DOWN = pose({
  11: { x: 0.44, y: 0.38 }, 12: { x: 0.48, y: 0.38 },
  13: { x: 0.42, y: 0.50 }, 14: { x: 0.46, y: 0.50 },
  15: { x: 0.42, y: 0.58 }, 16: { x: 0.46, y: 0.58 },
  23: { x: 0.50, y: 0.64 }, 24: { x: 0.51, y: 0.64 },
  25: { x: 0.62, y: 0.77 }, 26: { x: 0.63, y: 0.77 },
  27: { x: 0.50, y: 0.90 }, 28: { x: 0.51, y: 0.90 },
  29: { x: 0.56, y: 0.92 }, 30: { x: 0.57, y: 0.92 },
  31: { x: 0.46, y: 0.92 }, 32: { x: 0.47, y: 0.92 },
});
// Half squat (knee ≈ 130°): too shallow → must NOT count, should warn "Go lower"
const HALF = pose({
  11: { x: 0.46, y: 0.34 }, 12: { x: 0.50, y: 0.34 },
  13: { x: 0.44, y: 0.47 }, 14: { x: 0.48, y: 0.47 },
  15: { x: 0.44, y: 0.56 }, 16: { x: 0.48, y: 0.56 },
  23: { x: 0.50, y: 0.60 }, 24: { x: 0.51, y: 0.60 },
  25: { x: 0.58, y: 0.75 }, 26: { x: 0.59, y: 0.75 },
  27: { x: 0.50, y: 0.90 }, 28: { x: 0.51, y: 0.90 },
  29: { x: 0.56, y: 0.92 }, 30: { x: 0.57, y: 0.92 },
  31: { x: 0.46, y: 0.92 }, 32: { x: 0.47, y: 0.92 },
});

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log('  PASS  ' + name);
  else { failures++; console.log('  FAIL  ' + name + '  ' + extra); }
}

function runFrames(engine, frames) {
  const events = [];
  let lastSnap = null;
  let t = 1000;
  for (const lm of frames) {
    t += 33;
    const snap = engine.update(lm, t);
    if (snap?.event) events.push(snap.event);
    lastSnap = snap;
  }
  return { events, lastSnap };
}

/* ── Test 1: two full squat reps ── */
{
  console.log('Squat: 2 full reps');
  const eng = new ExerciseEngine();
  eng.setExercise(EXERCISE_MAP.squat);
  const frames = [
    ...Array(10).fill(STAND),
    ...Array(8).fill(DOWN),
    ...Array(8).fill(STAND),
    ...Array(8).fill(DOWN),
    ...Array(8).fill(STAND),
  ];
  const { events } = runFrames(eng, frames);
  const reps = events.filter((e) => e.type === 'rep');
  check('counts exactly 2 reps', reps.length === 2, `got ${reps.length}`);
  check('scores are 0-100', reps.every((r) => r.score >= 0 && r.score <= 100), JSON.stringify(reps));
  check('phase returns to up', eng.state === 'up', eng.state);
}

/* ── Test 2: shallow squat → no rep, partial warning ── */
{
  console.log('Squat: shallow rep must not count');
  const eng = new ExerciseEngine();
  eng.setExercise(EXERCISE_MAP.squat);
  const frames = [
    ...Array(10).fill(STAND),
    ...Array(8).fill(HALF),   // not deep enough
    ...Array(8).fill(STAND),  // comes back up
  ];
  const { events } = runFrames(eng, frames);
  const reps = events.filter((e) => e.type === 'rep');
  const partials = events.filter((e) => e.type === 'partial');
  check('no rep counted', reps.length === 0, `got ${reps.length}`);
  check('partial warning fired', partials.length >= 1, `got ${partials.length}`);
  check('partial says "Go lower"', partials[0]?.label === 'Go lower', partials[0]?.label);
}

/* ── Test 3: full-range curl (bent < 45°, straight > 160°) ── */
{
  console.log('Curl: 1 full rep');
  const eng = new ExerciseEngine();
  eng.setExercise(EXERCISE_MAP.curl);
  // Front view: shoulder/elbow/wrist — extended (arm hanging) vs curled (wrist at shoulder)
  const EXT = pose({
    11: { x: 0.42, y: 0.30 }, 12: { x: 0.58, y: 0.30 },
    13: { x: 0.41, y: 0.48 }, 14: { x: 0.59, y: 0.48 },
    15: { x: 0.41, y: 0.66 }, 16: { x: 0.59, y: 0.66 },
    23: { x: 0.46, y: 0.55 }, 24: { x: 0.54, y: 0.55 },
    25: { x: 0.46, y: 0.73 }, 26: { x: 0.54, y: 0.73 },
    27: { x: 0.46, y: 0.92 }, 28: { x: 0.54, y: 0.92 },
  });
  // Elbow angle≈ 30°: forearm folds up so wrist sits next to the shoulder
  const CURLD = pose({
    11: { x: 0.42, y: 0.30 }, 12: { x: 0.58, y: 0.30 },
    13: { x: 0.41, y: 0.48 }, 14: { x: 0.59, y: 0.48 },
    15: { x: 0.43, y: 0.31 }, 16: { x: 0.57, y: 0.31 },
    23: { x: 0.46, y: 0.55 }, 24: { x: 0.54, y: 0.55 },
    25: { x: 0.46, y: 0.73 }, 26: { x: 0.54, y: 0.73 },
    27: { x: 0.46, y: 0.92 }, 28: { x: 0.54, y: 0.92 },
  });
  const frames = [
    ...Array(10).fill(EXT),
    ...Array(8).fill(CURLD),
    ...Array(8).fill(EXT),
  ];
  const { events } = runFrames(eng, frames);
  const reps = events.filter((e) => e.type === 'rep');
  check('counts 1 curl rep', reps.length === 1, `got ${reps.length}`);
}

/* ── Test 4: jumping jack (legs wide = up, together = down) ── */
{
  console.log('Jumping jack: 1 rep');
  const eng = new ExerciseEngine();
  eng.setExercise(EXERCISE_MAP.jack);
  const CLOSED = pose({
    11: { x: 0.44, y: 0.30 }, 12: { x: 0.56, y: 0.30 },
    15: { x: 0.42, y: 0.55 }, 16: { x: 0.58, y: 0.55 },
    23: { x: 0.47, y: 0.55 }, 24: { x: 0.53, y: 0.55 },
    27: { x: 0.48, y: 0.92 }, 28: { x: 0.52, y: 0.92 },
  });
  const OPEN = pose({
    11: { x: 0.44, y: 0.30 }, 12: { x: 0.56, y: 0.30 },
    15: { x: 0.34, y: 0.12 }, 16: { x: 0.66, y: 0.12 },   // hands overhead
    23: { x: 0.47, y: 0.55 }, 24: { x: 0.53, y: 0.55 },
    27: { x: 0.30, y: 0.92 }, 28: { x: 0.70, y: 0.92 },   // feet wide
  });
  // Start standing closed → machine parks in "down", first opening = rep 1
  const frames = [
    ...Array(6).fill(CLOSED),
    ...Array(6).fill(OPEN),
    ...Array(6).fill(CLOSED),
    ...Array(6).fill(OPEN),
  ];
  const { events } = runFrames(eng, frames);
  const reps = events.filter((e) => e.type === 'rep');
  check('counts 2 jack reps', reps.length === 2, `got ${reps.length}`);
}

/* ── Test 5: low visibility → no counting, visibility warning shown ── */
{
  console.log('Visibility: body partly out of frame');
  const eng = new ExerciseEngine();
  eng.setExercise(EXERCISE_MAP.squat);
  const cropped = JSON.parse(JSON.stringify(DOWN));
  cropped[27].visibility = 0.1;   // ankle no longer visible
  const snap = eng.update(cropped, 2000);
  check('no rep while invisible', snap != null && snap.event == null);
  check('shows step-back warning', /step back/i.test(snap?.visibleMessage || ''), snap?.visibleMessage);
}

/* ── Test 6: push-up rep + hip sag penalty ── */
{
  console.log('Push-up: 1 rep with sagging hips penalty');
  const eng = new ExerciseEngine();
  eng.setExercise(EXERCISE_MAP.pushup);
  // Side view plank: shoulders left, ankles right; arms straight (top) or
  // bent (bottom); hips below the shoulder→ankle line when sagging.
  const plank = (elbowBent, sagY) => pose({
    11: { x: 0.20, y: 0.45 }, 12: { x: 0.22, y: 0.45 },
    13: elbowBent ? { x: 0.34, y: 0.58 } : { x: 0.20, y: 0.60 },
    14: elbowBent ? { x: 0.36, y: 0.58 } : { x: 0.22, y: 0.60 },
    15: { x: 0.20, y: 0.72 }, 16: { x: 0.22, y: 0.72 },
    23: { x: 0.52, y: sagY }, 24: { x: 0.54, y: sagY },
    25: { x: 0.74, y: 0.54 }, 26: { x: 0.76, y: 0.54 },
    27: { x: 0.94, y: 0.52 }, 28: { x: 0.95, y: 0.52 },
  });
  const top = plank(false, 0.49);     // straight body, arms extended
  const bottom = plank(true, 0.62);   // elbows bent + hips below the line
  const frames = [
    ...Array(8).fill(top),
    ...Array(8).fill(bottom),
    ...Array(8).fill(top),
  ];
  const { events } = runFrames(eng, frames);
  const reps = events.filter((e) => e.type === 'rep');
  check('counts 1 push-up', reps.length === 1, `got ${reps.length}`);
  check('sag recorded as a mistake', reps[0]?.violations.some((v) => /sag/i.test(v)), JSON.stringify(reps[0]?.violations));
  check('score penalised below 100', reps[0].score < 100, `score ${reps[0].score}`);
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
