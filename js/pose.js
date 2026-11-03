/**
 * pose.js — webcam + MediaPipe Pose Landmarker + canvas drawing.
 *
 * NOTHING is uploaded: the model runs locally in your browser (WASM + WebGL),
 * the video stream never leaves the page. The only network traffic is the
 * one-time download of the MediaPipe library and model file (then cached).
 */
import { POSE_CONNECTIONS } from './angles.js';

const VISION_SOURCES = [
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm',
  'https://esm.sh/@mediapipe/tasks-vision@0.10.14',
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs',
];
const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL = (quality) =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${quality}/float16/1/pose_landmarker_${quality}.task`;

/** Import the MediaPipe library, trying a few CDNs in order. */
async function importVision() {
  let lastErr;
  for (const url of VISION_SOURCES) {
    try {
      return await import(/* @vite-ignore */ url);
    } catch (err) {
      lastErr = err;
      console.warn('[pose] CDN failed:', url, err);
    }
  }
  throw new Error('Could not load the MediaPipe library. Check your internet connection (needed once). ' + lastErr);
}

export class PoseSession {
  /**
   * @param {HTMLVideoElement} video  the <video> showing the camera
   * @param {HTMLCanvasElement} overlay the <canvas> we draw the skeleton on
   * @param {(result) => void} onPose called once per detected frame
   */
  constructor(video, overlay, onPose) {
    this.video = video;
    this.overlay = overlay;
    this.onPose = onPose;
    this.landmarker = null;
    this.stream = null;
    this.rafId = 0;
    this.lastVideoTime = -1;
    this.running = false;
    this.lastDetectErr = 0;
    this.fps = 0;
    this._fpsAcc = [];
  }

  /** Load the pose model (call once; safe to call again to switch quality). */
  async loadModel(quality = 'full', onStatus = () => {}) {
    onStatus('Loading MediaPipe…');
    const vision = await importVision();
    onStatus('Loading pose model (' + quality + ')…');
    const fileset = await vision.FilesetResolver.forVisionTasks(WASM_ROOT);
    let opts = {
      baseOptions: { modelAssetPath: MODEL_URL(quality), delegate: 'GPU' },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    };
    try {
      this.landmarker = await vision.PoseLandmarker.createFromOptions(fileset, opts);
    } catch (e) {
      // Some devices have no usable WebGL — retry on the CPU delegate.
      console.warn('[pose] GPU init failed, retrying on CPU', e);
      opts = { ...opts, baseOptions: { ...opts.baseOptions, delegate: 'CPU' } };
      this.landmarker = await vision.PoseLandmarker.createFromOptions(fileset, opts);
    }
    this.vision = vision;
    onStatus('Model ready');
    return true;
  }

  /** Ask the browser for the camera. Throws a friendly Error on failure. */
  async startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('No camera API here — open the app on HTTPS or localhost.');
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        throw new Error('Camera permission denied — allow camera access in your browser (the 🔒 icon in the address bar).');
      }
      if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
        throw new Error('No camera found on this device.');
      }
      if (err.name === 'NotReadableError') {
        throw new Error('Camera is busy in another app — close it and try again.');
      }
      throw new Error('Camera error: ' + err.message);
    }
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});
    return true;
  }

  stopCamera() {
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    this.video.srcObject = null;
  }

  /** Start the detection + drawing loop (requestAnimationFrame). */
  startLoop() {
    if (this.running) return;
    this.running = true;
    const tick = (now) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(tick);
      try {
        this.step(now);
      } catch (err) {
        // Don't let one bad frame kill the loop.
        console.error('[pose] frame error', err);
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stopLoop() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  step(now) {
    const v = this.video;
    if (!v || v.readyState < 2 || !v.videoWidth) return;

    // Keep the overlay canvas exactly the size of the video frames.
    if (this.overlay.width !== v.videoWidth || this.overlay.height !== v.videoHeight) {
      this.overlay.width = v.videoWidth;
      this.overlay.height = v.videoHeight;
    }

    let result = null;
    if (this.landmarker && v.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = v.currentTime;
      const t0 = performance.now();
      result = this.landmarker.detectForVideo(v, now);
      // FPS estimate (EMA) for the status pill.
      const dt = performance.now() - t0;
      this.fps = this.fps ? this.fps * 0.9 + (1000 / Math.max(dt, 1)) * 0.1 : 1000 / Math.max(dt, 1);
      this.lastDetectErr = 0;
    }

    if (result?.landmarks?.length) {
      this.onPose(result.landmarks[0], now);
      this.draw(result.landmarks[0], this.lastPhase);
    } else {
      this.onPose(null, now);
      this.clear();
    }
  }

  /** Phase hint passed by the main app so the skeleton can change colour. */
  setPhase(phase) {
    this.lastPhase = phase;
  }

  clear() {
    const ctx = this.overlay.getContext('2d');
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  /** Draw the skeleton + joints over the video. */
  draw(lm, phase) {
    const c = this.overlay;
    const ctx = c.getContext('2d');
    const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);

    // Green while everything is fine, amber when a form rule is active.
    const warn = phase === 'warn';
    const line = warn ? 'rgba(255,184,77,0.95)' : 'rgba(76,255,173,0.92)';
    const joint = warn ? '#ffb84d' : '#4cffad';

    ctx.lineWidth = Math.max(3, W / 260);
    ctx.lineCap = 'round';
    ctx.strokeStyle = line;
    for (const [a, b] of POSE_CONNECTIONS) {
      const pa = lm[a], pb = lm[b];
      if (!pa || !pb) continue;
      if ((pa.visibility ?? 1) < 0.35 || (pb.visibility ?? 1) < 0.35) continue;
      ctx.beginPath();
      ctx.moveTo(pa.x * W, pa.y * H);
      ctx.lineTo(pb.x * W, pb.y * H);
      ctx.stroke();
    }

    ctx.fillStyle = joint;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 2;
    const r = Math.max(4, W / 170);
    for (const p of lm) {
      if (!p || (p.visibility ?? 1) < 0.35) continue;
      ctx.beginPath();
      ctx.arc(p.x * W, p.y * H, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}
