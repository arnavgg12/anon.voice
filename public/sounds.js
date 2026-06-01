// UI sounds, synthesized with the Web Audio API — no audio files to host, works
// offline, tiny. A rising two-note chime for "connected", a falling one for
// "disconnected". All wrapped in try/catch so a missing/locked AudioContext can
// never break the app.

(function () {
  let ctx = null;
  function ac() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch { return null; }
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  // Play a sequence of short notes. notes: [{ freq, start, dur }]
  function play(notes, { type = 'sine', gain = 0.14 } = {}) {
    const c = ac();
    if (!c) return;
    const now = c.currentTime;
    for (const n of notes) {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = type;
      osc.frequency.value = n.freq;
      // soft attack + exponential release so it sounds like a chime, not a beep
      const t0 = now + n.start;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.dur);
      osc.connect(g).connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + n.dur + 0.02);
    }
  }

  const Sounds = {
    // Some browsers need a user gesture before audio can play; call once on the
    // first tap so the context is unlocked before the first chime.
    unlock() { ac(); },
    connected() {
      // rising perfect-fourth-ish: A5 -> D6
      play([
        { freq: 880.0, start: 0.00, dur: 0.16 },
        { freq: 1174.7, start: 0.10, dur: 0.22 },
      ], { type: 'triangle', gain: 0.16 });
    },
    disconnected() {
      // falling: D6 -> A5
      play([
        { freq: 1174.7, start: 0.00, dur: 0.16 },
        { freq: 783.99, start: 0.10, dur: 0.24 },
      ], { type: 'sine', gain: 0.13 });
    },
    // optional: a soft blip for incoming friend call
    ring() {
      play([
        { freq: 987.77, start: 0.00, dur: 0.18 },
        { freq: 987.77, start: 0.28, dur: 0.18 },
      ], { type: 'triangle', gain: 0.15 });
    },
  };

  window.Sounds = Sounds;
})();
