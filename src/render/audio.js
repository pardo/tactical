/**
 * Synthesised sound effects (WebAudio, no asset files). Sounds are panned and
 * attenuated by their position relative to the camera's focus point.
 * Browsers only allow audio after a user gesture, so call unlock() from one.
 */
const WEAPON_SOUND = {
  rifle: { dur: 0.09, freq: 1800, gain: 0.35 },
  carbine: { dur: 0.08, freq: 2200, gain: 0.3 },
  lmg: { dur: 0.07, freq: 1400, gain: 0.32 },
  sniper: { dur: 0.35, freq: 900, gain: 0.6 },
  shotgun: { dur: 0.22, freq: 700, gain: 0.55 },
};

export function createAudio() {
  let ctx = null;
  let master = null;
  let noise = null;
  let muted = false;
  try {
    muted = localStorage.getItem('tactical.muted') === '1';
  } catch {
    // storage blocked: default unmuted
  }

  function unlock() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.7;
    master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  /** Noise burst through a low-pass filter with an exponential decay. */
  function burst({ dur, freq, gain, pan = 0, delay = 0 }) {
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(80, freq * 0.25), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(filter).connect(g).connect(p).connect(master);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  function tone({ freq, dur, gain, type = 'sine', pan = 0, to = null }) {
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    o.connect(g).connect(p).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /**
   * Play sounds for a frame's events.
   * @param listener { x, z, yaw, range } camera focus; sounds beyond ~range fade out
   */
  function play(frame, listener) {
    if (!ctx || muted || ctx.state !== 'running') return;
    let shots = 0;
    for (const e of frame.events) {
      const x = e.x ?? e.tx;
      const z = e.z ?? e.tz;
      let gainMul = 1;
      let pan = 0;
      if (x !== undefined && listener) {
        const dx = x - listener.x;
        const dz = z - listener.z;
        // Screen-right in world space for the camera's yaw.
        const right = dx * Math.cos(listener.yaw) - dz * Math.sin(listener.yaw);
        pan = Math.max(-1, Math.min(1, right / (listener.range * 0.6)));
        gainMul = Math.max(0.15, 1 - Math.hypot(dx, dz) / (listener.range * 2));
      }
      if (e.type === 'shot' && shots++ < 6) {
        const w = WEAPON_SOUND[e.weapon] ?? WEAPON_SOUND.rifle;
        burst({ ...w, gain: w.gain * gainMul, pan });
      } else if (e.type === 'explosion') {
        if (e.kind === 'smoke') burst({ dur: 0.9, freq: 500, gain: 0.25 * gainMul, pan });
        else if (e.kind === 'flash') {
          burst({ dur: 0.4, freq: 4000, gain: 0.7 * gainMul, pan });
          tone({ freq: 3200, dur: 1.2, gain: 0.05 * gainMul, pan });
        } else burst({ dur: 0.9, freq: 400, gain: 0.9 * gainMul, pan });
      } else if (e.type === 'breach') {
        burst({ dur: 1.0, freq: 600, gain: 1 * gainMul, pan });
      } else if (e.type === 'door' && e.state === 'open') {
        tone({ freq: 140, to: 90, dur: 0.18, gain: 0.25 * gainMul, type: 'triangle', pan });
      } else if (e.type === 'reload') {
        tone({ freq: 900, dur: 0.05, gain: 0.08, type: 'square', pan });
      } else if (e.type === 'death') {
        tone({ freq: 220, to: 110, dur: 0.4, gain: 0.12, type: 'sawtooth', pan });
      }
    }
  }

  return {
    unlock,
    play,
    get muted() {
      return muted;
    },
    toggleMute() {
      muted = !muted;
      try {
        localStorage.setItem('tactical.muted', muted ? '1' : '0');
      } catch {
        // storage blocked: setting lasts for this session only
      }
      if (master) master.gain.value = muted ? 0 : 0.7;
      unlock();
    },
  };
}
