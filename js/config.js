/**
 * config.js — EVERY exercise is described here.
 *
 * To add a new exercise you normally only touch this file:
 *   1. copy one of the objects in EXERCISES,
 *   2. set id / name / cameraTip,
 *   3. write metrics(lm) → returns the joint angles/values you need,
 *   4. write isDown(m) / isUp(m) → the two ends of the movement,
 *   5. add feedback rules: { id, label, weight, priority, test(m, ctx) }.
 *
 * Rep counting uses a tiny state machine (see engine.js):
 *      "up"  --(isDown)-->  "down"  --(isUp)-->  "up"  = 1 rep
 * Thresholds have a wide gap (e.g. 100° vs 160°) which gives free hysteresis,
 * so noise can't make the counter jump back and forth.
 */
import { angleAt, midpoint, leanFromVertical, dist, LM } from './angles.js';

/* Metabolic equivalents (kcal · kg⁻¹ · h⁻¹) used for the calorie estimate. */
export const MET = {
  squat: 5.0, curl: 3.5, press: 4.0, pushup: 6.0, lunge: 5.0, jack: 8.0,
};

/** Shared helpers used inside metrics(). */
function meanAngle(lm, a, b, c, d) {
  return (angleAt(lm[a], lm[b], lm[c]) + angleAt(lm[d[0]], lm[d[1]], lm[d[2]])) / 2;
}
function twoArmAngle(lm, sh, el, wr) {
  return (
    (angleAt(lm[sh[0]], lm[el[0]], lm[wr[0]]) +
      angleAt(lm[sh[1]], lm[el[1]], lm[wr[1]])) / 2
  );
}

export const EXERCISES = [
  /* ─────────────────────────── SQUAT ─────────────────────────── */
  {
    id: 'squat',
    name: 'Squat',
    emoji: '🦵',
    camera: 'side',
    cameraTip: 'Side view — stand sideways so your whole body (head to toes) fits the frame.',
    extent: 'vertical',          // we check the body's HEIGHT in the frame
    primary: 'knee',                     // metric that drives the state machine
    primaryLabel: 'Knee angle',
    thresholds: { down: 100, up: 160 },   // knee angle: bent < 100°, straight > 160°
    smoothing: 5,
    stallSeconds: 5,
    rangeLabels: { min: 'Go lower', max: 'Stand up fully' },

    metrics(lm) {
      const knee =
        (angleAt(lm[LM.L_HIP], lm[LM.L_KNEE], lm[LM.L_ANKLE]) +
          angleAt(lm[LM.R_HIP], lm[LM.R_KNEE], lm[LM.R_ANKLE])) / 2;
      const shMid = midpoint(lm[LM.L_SHOULDER], lm[LM.R_SHOULDER]);
      const hipMid = midpoint(lm[LM.L_HIP], lm[LM.R_HIP]);
      const lean = leanFromVertical(shMid, hipMid);

      // "Knees caving in" (valgus): the knee has drifted toward the middle of
      // the body compared with the ankle. Works mirrored or not.
      const midX = hipMid.x;
      let cave = 0;
      for (const [ki, ai] of [[LM.L_KNEE, LM.L_ANKLE], [LM.R_KNEE, LM.R_ANKLE]]) {
        const dk = lm[ki].x - midX, da = lm[ai].x - midX;
        if (dk * da > 0) cave = Math.max(cave, Math.abs(da) - Math.abs(dk));
      }

      // Heel lift: how high the heels are above the toes. The engine keeps a
      // standing baseline so camera height/angle doesn't cause false alarms.
      let heelLift = 0;
      if ((lm[LM.L_HEEL]?.visibility ?? 0) > 0.3 && (lm[LM.L_FOOT]?.visibility ?? 0) > 0.3) {
        heelLift =
          (lm[LM.L_FOOT].y - lm[LM.L_HEEL].y + (lm[LM.R_FOOT].y - lm[LM.R_HEEL].y)) / 2;
      }
      return { knee, lean, cave, heelLift };
    },
    isDown: (m) => m.knee < 100,
    isUp: (m) => m.knee > 160,
    rules: [
      { id: 'knees', label: 'Knees caving in — push them out', weight: 20, priority: 2,
        test: (m) => m.cave > 0.045 },
      { id: 'heels', label: 'Heels are lifting — keep them flat', weight: 15, priority: 2,
        test: (m, ctx) => m.heelLift - (ctx.base?.heelLift ?? m.heelLift) > 0.04 },
      { id: 'back', label: 'Keep your back straight — chest up', weight: 15, priority: 3,
        test: (m) => m.lean > 50 },
    ],
  },

  /* ─────────────────── DUMBBELL BICEP CURL ─────────────────── */
  {
    id: 'curl',
    name: 'Bicep Curl',
    emoji: '💪',
    camera: 'front',
    cameraTip: 'Front view — face the camera, hips and hands visible.',
    extent: 'vertical',
    primary: 'elbow',
    primaryLabel: 'Elbow angle',
    thresholds: { down: 45, up: 160 },    // curled < 45°, extended > 160°
    smoothing: 5,
    stallSeconds: 5,
    rangeLabels: { min: 'Curl all the way up', max: 'Full range, extend your arm fully' },

    metrics(lm) {
      const elbow = twoArmAngle(lm, [LM.L_SHOULDER, LM.R_SHOULDER], [LM.L_ELBOW, LM.R_ELBOW], [LM.L_WRIST, LM.R_WRIST]);
      const shMid = midpoint(lm[LM.L_SHOULDER], lm[LM.R_SHOULDER]);
      const hipMid = midpoint(lm[LM.L_HIP], lm[LM.R_HIP]);
      const lean = leanFromVertical(shMid, hipMid);   // torso sway = "swinging"

      // Elbow flare: positive when the elbow sits OUTSIDE the shoulder line
      // (elbows flying out instead of staying pinned to the ribs).
      let flare = 0;
      for (const [si, ei] of [[LM.L_SHOULDER, LM.L_ELBOW], [LM.R_SHOULDER, LM.R_ELBOW]]) {
        flare += Math.abs(lm[ei].x - hipMid.x) - Math.abs(lm[si].x - hipMid.x);
      }
      return { elbow, lean, flare: flare / 2 };
    },
    isDown: (m) => m.elbow < 45,     // fully curled
    isUp: (m) => m.elbow > 160,      // fully extended
    rules: [
      { id: 'swing', label: "Don't swing your body — keep your torso still", weight: 20, priority: 2,
        test: (m) => m.lean > 15 },
      { id: 'elbows', label: 'Keep elbows close to your body', weight: 15, priority: 3,
        test: (m) => m.flare > 0.06 },
    ],
  },

  /* ─────────────── DUMBBELL SHOULDER PRESS ─────────────── */
  {
    id: 'press',
    name: 'Shoulder Press',
    emoji: '🏋️',
    camera: 'front',
    cameraTip: 'Front view — face the camera and keep your hands in frame at the top.',
    extent: 'vertical',
    primary: 'elbow',
    primaryLabel: 'Elbow angle',
    thresholds: { down: 110, up: 155 },
    smoothing: 5,
    stallSeconds: 5,
    rangeLabels: { min: 'Lower hands to shoulder height', max: 'Lock out at the top' },

    metrics(lm) {
      const elbow = twoArmAngle(lm, [LM.L_SHOULDER, LM.R_SHOULDER], [LM.L_ELBOW, LM.R_ELBOW], [LM.L_WRIST, LM.R_WRIST]);
      const shMid = midpoint(lm[LM.L_SHOULDER], lm[LM.R_SHOULDER]);
      const hipMid = midpoint(lm[LM.L_HIP], lm[LM.R_HIP]);
      const shY = (lm[LM.L_SHOULDER].y + lm[LM.R_SHOULDER].y) / 2;
      const wrY = (lm[LM.L_WRIST].y + lm[LM.R_WRIST].y) / 2;
      const handHeight = shY - wrY;      // > 0 = hands above the shoulders
      const lean = leanFromVertical(shMid, hipMid);
      const arch = hipMid.z - shMid.z;   // best-effort: chest thrust toward camera
      return { elbow, handHeight, lean, arch };
    },
    // Press has TWO conditions per phase, so a plain angle test isn't enough:
    // "down" = elbows bent AND hands at shoulder height (the rack position),
    // "up"   = arms locked out AND hands overhead.
    isDown: (m) => m.elbow < 110 && m.handHeight > -0.08 && m.handHeight < 0.12,
    isUp: (m) => m.elbow > 155 && m.handHeight > 0.05,
    // An attempt only starts when the hands are near the shoulders, so simply
    // bending your arms while standing doesn't trigger the state machine.
    attemptTest: (m) => m.elbow < 130 && m.handHeight > -0.09 && m.handHeight < 0.12,
    rules: [
      { id: 'arch', label: "Don't arch your back — brace your core", weight: 25, priority: 2,
        test: (m) => m.lean > 20 || m.arch > 0.12 },
    ],
  },

  /* ─────────────────────────── PUSH-UP ─────────────────────────── */
  {
    id: 'pushup',
    name: 'Push-up',
    emoji: '🙇',
    camera: 'side',
    cameraTip: 'Side view — put the camera on the floor or a low shelf so your body spans the frame.',
    extent: 'horizontal',        // a plank is wide, not tall — check WIDTH
    primary: 'elbow',
    primaryLabel: 'Elbow angle',
    thresholds: { down: 90, up: 155 },
    smoothing: 5,
    stallSeconds: 5,
    rangeLabels: { min: 'Go lower — chest to elbow height', max: 'Push back up to a straight arm' },

    metrics(lm) {
      const elbow = twoArmAngle(lm, [LM.L_SHOULDER, LM.R_SHOULDER], [LM.L_ELBOW, LM.R_ELBOW], [LM.L_WRIST, LM.R_WRIST]);
      const shMid = midpoint(lm[LM.L_SHOULDER], lm[LM.R_SHOULDER]);
      const hipMid = midpoint(lm[LM.L_HIP], lm[LM.R_HIP]);
      const ankMid = midpoint(lm[LM.L_ANKLE], lm[LM.R_ANKLE]);

      // Is the hip below / above the straight shoulder→ankle line?
      // (Image y grows downward, so "below the line" = larger y = sagging.)
      let sag = 0, pike = 0;
      if (Math.abs(ankMid.x - shMid.x) > 0.06) {
        const t = (hipMid.x - shMid.x) / (ankMid.x - shMid.x);
        const lineY = shMid.y + t * (ankMid.y - shMid.y);
        const d = hipMid.y - lineY;
        if (d > 0) sag = d; else pike = -d;
      }
      // Only count as a push-up attempt if the body is roughly horizontal —
      // this stops bending your arms while standing from triggering it.
      const plank =
        Math.abs(shMid.y - hipMid.y) < 0.25 && Math.abs(hipMid.y - ankMid.y) < 0.25;
      return { elbow, sag, pike, plank };
    },
    isDown: (m) => m.elbow < 90,
    isUp: (m) => m.elbow > 155,
    attemptTest: (m) => m.elbow < 125 && m.plank,
    rules: [
      { id: 'sag', label: 'Hips are sagging — squeeze your glutes', weight: 25, priority: 1,
        test: (m) => m.sag > 0.045 },
      { id: 'pike', label: 'Keep your body in a straight line — hips too high', weight: 15, priority: 3,
        test: (m) => m.pike > 0.055 },
    ],
  },

  /* ─────────────────────────── LUNGE ─────────────────────────── */
  {
    id: 'lunge',
    name: 'Lunge',
    emoji: '🚶',
    camera: 'side',
    cameraTip: 'Side view — stand sideways so both legs and your torso are visible.',
    extent: 'vertical',
    primary: 'knee',
    primaryLabel: 'Knee angle',
    thresholds: { down: 110, up: 160 },   // average of both knees
    smoothing: 5,
    stallSeconds: 5,
    rangeLabels: { min: 'Go lower — bend both knees to ~90°', max: 'Step back up to standing' },

    metrics(lm) {
      const knee =
        (angleAt(lm[LM.L_HIP], lm[LM.L_KNEE], lm[LM.L_ANKLE]) +
          angleAt(lm[LM.R_HIP], lm[LM.R_KNEE], lm[LM.R_ANKLE])) / 2;
      const shMid = midpoint(lm[LM.L_SHOULDER], lm[LM.R_SHOULDER]);
      const hipMid = midpoint(lm[LM.L_HIP], lm[LM.R_HIP]);
      const lean = leanFromVertical(shMid, hipMid);

      // Front knee past the toes (best effort): the front foot is the ankle
      // furthest from the hips in a side view; a violation means the knee
      // sticks out further forward than that foot.
      let over = 0;
      let front = null, best = -1;
      for (const [ki, ai] of [[LM.L_KNEE, LM.L_ANKLE], [LM.R_KNEE, LM.R_ANKLE]]) {
        const d = Math.abs(lm[ai].x - hipMid.x);
        if (d > best) { best = d; front = [ki, ai]; }
      }
      if (front && knee < 150) {
        const dk = lm[front[0]].x - hipMid.x;
        const da = lm[front[1]].x - hipMid.x;
        if (dk * da > 0) over = Math.abs(dk) - Math.abs(da);
      }
      return { knee, lean, over };
    },
    isDown: (m) => m.knee < 110,
    isUp: (m) => m.knee > 160,
    rules: [
      { id: 'chest', label: 'Keep your chest up — back straight', weight: 20, priority: 2,
        test: (m) => m.lean > 30 },
      { id: 'kneeToe', label: 'Front knee is going past your toes', weight: 15, priority: 3,
        test: (m) => m.over > 0.035, holdFrames: 4 },
    ],
  },

  /* ─────────────────────── JUMPING JACK ─────────────────────── */
  {
    id: 'jack',
    name: 'Jumping Jack',
    emoji: '⭐',
    camera: 'front',
    cameraTip: 'Front view — stand back so your feet and raised hands both stay in frame.',
    extent: 'vertical',
    primary: 'ratio',
    primaryLabel: 'Leg spread',
    thresholds: { down: 1.15, up: 1.5 },  // ankle spread ÷ shoulder width
    smoothing: 5,
    stallSeconds: 5,
    rangeLabels: { min: 'Land with feet together', max: 'Jump out — feet wide, arms overhead' },

    metrics(lm) {
      const spread = dist(lm[LM.L_ANKLE], lm[LM.R_ANKLE]);
      const shoulderW = Math.max(dist(lm[LM.L_SHOULDER], lm[LM.R_SHOULDER]), 0.05);
      const ratio = spread / shoulderW;
      const shY = (lm[LM.L_SHOULDER].y + lm[LM.R_SHOULDER].y) / 2;
      const wrY = (lm[LM.L_WRIST].y + lm[LM.R_WRIST].y) / 2;
      return { ratio, handHeight: shY - wrY };   // handHeight > 0 = hands overhead
    },
    // Counting uses the LEGS only (robust); arm position is pure feedback.
    isDown: (m) => m.ratio < 1.15,   // feet together
    isUp: (m) => m.ratio > 1.5,      // feet wide
    rules: [
      { id: 'arms', label: 'Clap overhead — raise your arms', weight: 15, priority: 2,
        test: (m) => m.ratio > 1.35 && m.handHeight < 0.02, holdFrames: 6 },
      { id: 'width', label: 'Jump your feet wider', weight: 10, priority: 3,
        test: (m) => m.ratio < 1.2 && m.handHeight > 0.08, holdFrames: 8 },
    ],
  },
];

/** Fast lookup: id → exercise config. */
export const EXERCISE_MAP = Object.fromEntries(EXERCISES.map((e) => [e.id, e]));

/**
 * Landmarks that must be visible for the exercise to work.
 * If these drop below 0.5 visibility we tell the user to step back.
 */
export const REQUIRED_LANDMARKS = {
  squat: [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP, LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE],
  curl: [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_ELBOW, LM.R_ELBOW, LM.L_WRIST, LM.R_WRIST, LM.L_HIP, LM.R_HIP],
  press: [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_ELBOW, LM.R_ELBOW, LM.L_WRIST, LM.R_WRIST, LM.L_HIP, LM.R_HIP],
  pushup: [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_ELBOW, LM.R_ELBOW, LM.L_WRIST, LM.R_WRIST, LM.L_HIP, LM.R_HIP, LM.L_ANKLE, LM.R_ANKLE],
  lunge: [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP, LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE],
  jack: [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_WRIST, LM.R_WRIST, LM.L_HIP, LM.R_HIP, LM.L_ANKLE, LM.R_ANKLE],
};

/** Default settings (overridden by what's saved in localStorage). */
export const DEFAULT_SETTINGS = {
  targetReps: 12,
  restSecs: 60,
  weightKg: 70,
  voice: true,
  mirror: true,
  model: 'full',   // 'lite' | 'full' | 'heavy'
};
