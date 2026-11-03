# 🏋️ FitCam AI — Camera-Based AI Fitness Tracker

A fully in-browser workout coach: it watches you through the webcam, draws a
skeleton over the video with **MediaPipe Pose (33 landmarks)**, counts reps with
a joint-angle state machine, scores your form 0–100, talks to you with voice
feedback, and keeps your workout history on your device.

> 🔒 **Privacy:** video is processed entirely on-device. Nothing is uploaded.
> The only network traffic is the one-time download of the MediaPipe library +
> pose model (then cached by the browser).

## ✨ Features

- **Exercises with auto rep counting:** Squat · Bicep curl · Shoulder press ·
  Push-up · Lunge · Jumping jacks
- **State machine counting** (`up → down → up = 1 rep`) using smoothed joint
  angles — e.g. squat down < 100°, up > 160°
- **Live form feedback** on screen *and* by voice: "Go lower", "Knees caving
  in", "Heels are lifting", "Hips are sagging", "Don't swing your body",
  "Lock out at the top", …
- **Per-rep form score (0–100)** with Good / Needs work badge + running average
- **Visibility & lighting warnings** ("Step back — show your full body",
  "Too dark") and a **best camera-angle tip per exercise**
  (side view for squats/push-ups/lunges, front view for curls/presses/jacks)
- **Dashboard:** big rep count, sets, form score, timer, rest timer
- **Start / Pause / Reset / Finish**, target reps (default 12), rest timer
  between sets, beep + voice cue when a set is done
- **Workout summary:** reps per exercise, sets, average form, duration,
  estimated calories, most common form mistake
- **History:** saved in `localStorage`, with a **weekly chart** (reps per day +
  form-score trend)
- **Dark, mobile-friendly UI** with large text; works on phone and laptop

## 🚀 How to run

The app is plain HTML/CSS/JS — no build step — but browsers only allow camera
access on `localhost` or `https`, so serve it over a local server:

```bash
# option A — Python (usually preinstalled)
python -m http.server 8080

# option B — Node
npx http-server -p 8080
```

Then open **http://localhost:8080** and click **Enable camera / Start**,
allow camera access, pick an exercise and go.

### 📱 On a phone

Phone browsers require **HTTPS** for the camera:

- easiest: deploy the folder to any static host (GitHub Pages, Netlify,
  Cloudflare Pages) and open the HTTPS URL, or
- on a laptop: `adb reverse tcp:8080 tcp:8080` then open
  `http://localhost:8080` on the phone.

> First launch downloads the MediaPipe library + pose model (a few MB) —
> afterwards it's cached and works offline.

## 📂 Project structure

```
index.html          page layout / dashboard / modal
css/style.css       dark, mobile-first styling
js/angles.js        ONE angle function + smoothing + landmark helpers
js/config.js        ⭐ every exercise: metrics, thresholds, feedback rules
js/engine.js        rep state machine, form scoring, visibility checks
js/pose.js          webcam + MediaPipe Pose Landmarker + canvas skeleton
js/feedback.js      voice (speechSynthesis) + beep (Web Audio)
js/history.js       localStorage history + weekly chart drawing
js/ui.js            all DOM updates
js/main.js          glue: timers, sets/rest, summary, events
engine_test.mjs     unit tests for the rep state machine (node engine_test.mjs)
```

### ➕ Adding a new exercise

Add one object to `EXERCISES` in `js/config.js`:

```js
{
  id: 'jumpSquat', name: 'Jump Squat', emoji: '🐇',
  camera: 'side', cameraTip: 'Side view …',
  primary: 'knee', primaryLabel: 'Knee angle',
  thresholds: { down: 100, up: 160 },   // state machine ends
  metrics(lm) { return { knee: angleAt(lm[23], lm[25], lm[27]) }; },
  isDown: (m) => m.knee < 100,
  isUp:   (m) => m.knee > 160,
  rangeLabels: { min: 'Go lower', max: 'Jump higher' },
  rules: [ { id: 'x', label: 'Feedback text', weight: 15, priority: 2,
             test: (m, ctx) => m.something > 0.5 } ],
}
```

That's it — the engine, UI, scoring, voice and summary all pick it up.

## 🧪 Tests

```bash
node engine_test.mjs     # state-machine logic with synthetic landmarks
```
