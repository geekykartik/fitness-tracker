/**
 * feedback.js — on-screen message queue, voice cues (speechSynthesis)
 * and the "set complete" beep (Web Audio). All of it runs on-device.
 */

/** Short beep / two-tone chime built with the Web Audio API. */
export function beep({ freq = 740, dur = 0.12, delay = 0, gain = 0.25 } = {}) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!beep.ctx) beep.ctx = new AC();
    const ctx = beep.ctx;
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  } catch (e) {
    /* audio not available — ignore */
  }
}

/** Cheerful two-tone chime when a set is finished. */
export function setCompleteChime() {
  beep({ freq: 660, dur: 0.14, delay: 0 });
  beep({ freq: 880, dur: 0.22, delay: 0.16 });
}

/**
 * FeedbackBus decides WHAT to show and WHAT to say.
 *  - only the highest-priority message is displayed,
 *  - voice is rate-limited so it never talks over itself,
 *  - the same sentence isn't repeated for 12 seconds.
 */
export class FeedbackBus {
  constructor() {
    this.voiceOn = true;
    this.lastSpoken = '';
    this.lastSpokenAt = 0;
    this.lastSpokeAt = 0;
    this.current = null;
  }

  setVoice(on) {
    this.voiceOn = on;
    if (!on && window.speechSynthesis) window.speechSynthesis.cancel();
  }

  /**
   * @param {string|null} text  message to display (null = clear)
   * @param {number} priority   lower number = more important
   * @param {boolean} speak     whether this message may be spoken aloud
   */
  update(text, priority = 5, speak = true) {
    this.current = text ? { text, priority } : null;
    if (!text || !speak || !this.voiceOn) return;
    const now = Date.now();
    if (text === this.lastSpoken && now - this.lastSpokenAt < 12000) return;
    if (now - this.lastSpokeAt < 3500) return;      // don't talk over ourselves
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      u.pitch = 1;
      u.volume = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
      this.lastSpoken = text;
      this.lastSpokenAt = now;
      this.lastSpokeAt = now;
    } catch (e) {
      /* no speech engine — on-screen text still works */
    }
  }

  /** Speak immediately (set-complete announcement etc.), bypassing cooldown. */
  sayNow(text) {
    if (!this.voiceOn) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
      this.lastSpoken = text;
      this.lastSpokenAt = Date.now();
      this.lastSpokeAt = Date.now();
    } catch (e) { /* ignore */ }
  }
}
