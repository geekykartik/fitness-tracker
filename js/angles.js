/**
 * angles.js — small geometry helpers shared by every exercise.
 * All coordinates come from MediaPipe as "normalized" values:
 * x = 0 is the left edge of the video, x = 1 the right edge,
 * y = 0 the top, y = 1 the bottom.
 */

/** Straight-line distance between two landmarks (in normalized units). */
export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Midpoint between two landmarks. */
export function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z || 0) + (b.z || 0)) / 2 };
}

/**
 * The angle ABC in degrees, with the vertex (the corner) at point b.
 *
 *   a ──── b ──── c   →  180° (straight line)
 *   a          c
 *    \       /        →  ~90° (right angle)
 *      \   /
 *        b
 *
 * This ONE function is used for every joint angle in the app
 * (knee, elbow, hip, ...). Example: hip-knee-ankle angle =
 * angleAt(hip, knee, ankle) → the angle at the knee.
 */
export function angleAt(a, b, c) {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const m1 = Math.hypot(v1.x, v1.y);
  const m2 = Math.hypot(v2.x, v2.y);
  if (m1 === 0 || m2 === 0) return 180;
  // Clamp because floating point can push the value slightly past ±1,
  // which would make Math.acos() return NaN.
  const cos = Math.max(-1, Math.min(1, dot / (m1 * m2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * How far a line from `bottom` (hips) to `top` (shoulders) leans away from
 * perfectly upright. 0° = standing straight, 90° = horizontal.
 */
export function leanFromVertical(top, bottom) {
  const dx = top.x - bottom.x;
  const dy = bottom.y - top.y; // positive when `top` is above `bottom` in the image
  if (dy <= 0.0001) return 90;
  return (Math.atan2(Math.abs(dx), dy) * 180) / Math.PI;
}

/** Clamp a number into a range. */
export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/**
 * Moving average — smooths noisy landmark values so a single jittery frame
 * can't flip the rep state machine. Window size ≈ 5 frames (~0.2 s at 30 fps).
 */
export class MovingAverage {
  constructor(size = 5) {
    this.size = size;
    this.buf = [];
    this.sum = 0;
  }
  push(v) {
    this.buf.push(v);
    this.sum += v;
    if (this.buf.length > this.size) this.sum -= this.buf.shift();
    return this.sum / this.buf.length;
  }
  reset() {
    this.buf = [];
    this.sum = 0;
  }
}

/** True when every listed landmark exists and is confident enough. */
export function visibilityOk(lm, indices, thr = 0.5) {
  for (const i of indices) {
    const p = lm[i];
    if (!p || (p.visibility ?? 1) < thr) return false;
  }
  return true;
}

/** MediaPipe Pose landmark indices we care about. */
export const LM = {
  NOSE: 0,
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13, R_ELBOW: 14,
  L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24,
  L_KNEE: 25, R_KNEE: 26,
  L_ANKLE: 27, R_ANKLE: 28,
  L_FOOT: 29, R_FOOT: 30,
  L_HEEL: 31, R_HEEL: 32,
};

/** Skeleton lines drawn over the video (MediaPipe's standard connections). */
export const POSE_CONNECTIONS = [
  [0, 1], [0, 2], [1, 3], [2, 4], [3, 5], [4, 6], [5, 7], [6, 8],
  [7, 9], [8, 10], [5, 6], [5, 11], [6, 12], [11, 12],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [15, 17], [16, 18], [15, 19], [16, 20], [17, 19], [18, 20],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 31], [27, 29],
  [24, 26], [26, 28], [28, 32], [28, 30], [31, 32],
];
