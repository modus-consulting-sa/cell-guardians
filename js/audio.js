// Fully procedural audio (Web Audio): ambient generative music + sound effects.
let ctx = null, master, sfxBus, musicBus, verb;
let muted = false;
try {
  muted = localStorage.getItem('cg-muted') === '1';
} catch {}
let music = null;

function impulse(seconds = 2.6) {
  const len = ctx.sampleRate * seconds;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
  }
  return buf;
}

export function initAudio() {
  if (ctx) {
    ctx.resume?.();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.9;
  master.connect(ctx.destination);
  verb = ctx.createConvolver();
  verb.buffer = impulse();
  const verbGain = ctx.createGain();
  verbGain.gain.value = 0.35;
  verb.connect(verbGain).connect(master);
  sfxBus = ctx.createGain();
  sfxBus.gain.value = 0.55;
  sfxBus.connect(master);
  sfxBus.connect(verb);
  musicBus = ctx.createGain();
  musicBus.gain.value = 0.22;
  musicBus.connect(master);
  musicBus.connect(verb);
}

export function isMuted() {
  return muted;
}
export function toggleMute() {
  muted = !muted;
  try {
    localStorage.setItem('cg-muted', muted ? '1' : '0');
  } catch {}
  if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.05);
  return muted;
}

function tone({ f = 440, f2 = null, type = 'sine', t = 0, dur = 0.4, vol = 0.3, a = 0.005, bus = sfxBus, lp = null }) {
  if (!ctx) return;
  const t0 = ctx.currentTime + t;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let node = o;
  if (lp) {
    const fl = ctx.createBiquadFilter();
    fl.type = 'lowpass';
    fl.frequency.value = lp;
    o.connect(fl);
    node = fl;
  }
  node.connect(g).connect(bus);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function noise({ t = 0, dur = 0.3, vol = 0.3, freq = 800, q = 1, type = 'bandpass', sweep = null }) {
  if (!ctx) return;
  const t0 = ctx.currentTime + t;
  const len = Math.ceil(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const fl = ctx.createBiquadFilter();
  fl.type = type;
  fl.frequency.setValueAtTime(freq, t0);
  if (sweep) fl.frequency.exponentialRampToValueAtTime(sweep, t0 + dur);
  fl.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(fl).connect(g).connect(sfxBus);
  src.start(t0);
}

export function sfx(name) {
  if (!ctx || muted) return;
  switch (name) {
    case 'clue':
      [1046.5, 1318.5, 1568, 2093].forEach((f, i) => tone({ f, type: 'triangle', t: i * 0.07, dur: 0.9, vol: 0.18 }));
      tone({ f: 523.25, type: 'sine', dur: 1.2, vol: 0.12 });
      break;
    case 'correct':
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone({ f, type: 'triangle', t: i * 0.09, dur: 0.7, vol: 0.2 }));
      break;
    case 'wrong':
      tone({ f: 233, f2: 160, type: 'sawtooth', dur: 0.45, vol: 0.14, lp: 900 });
      tone({ f: 220, f2: 150, type: 'square', t: 0.05, dur: 0.4, vol: 0.06, lp: 700 });
      break;
    case 'hurt':
      noise({ dur: 0.25, vol: 0.35, freq: 500, q: 0.8 });
      tone({ f: 140, f2: 60, type: 'sine', dur: 0.3, vol: 0.4 });
      break;
    case 'jump':
      tone({ f: 330, f2: 620, type: 'sine', dur: 0.16, vol: 0.08 });
      break;
    case 'land':
      noise({ dur: 0.08, vol: 0.08, freq: 300, type: 'lowpass' });
      break;
    case 'open':
      [261.63, 329.63, 392, 523.25, 659.25].forEach((f, i) => tone({ f, type: 'sine', t: i * 0.12, dur: 2.4, vol: 0.14, a: 0.2 }));
      noise({ dur: 2, vol: 0.12, freq: 300, sweep: 4000, q: 2 });
      break;
    case 'portal':
      tone({ f: 180, f2: 1400, type: 'sine', dur: 1.4, vol: 0.2, a: 0.1 });
      noise({ dur: 1.4, vol: 0.18, freq: 200, sweep: 6000, q: 3 });
      break;
    case 'join':
      tone({ f: 659.25, type: 'triangle', dur: 0.25, vol: 0.15 });
      tone({ f: 987.77, type: 'triangle', t: 0.1, dur: 0.35, vol: 0.15 });
      break;
    case 'leave':
      tone({ f: 659.25, type: 'triangle', dur: 0.25, vol: 0.12 });
      tone({ f: 440, type: 'triangle', t: 0.1, dur: 0.35, vol: 0.12 });
      break;
    case 'chat':
      tone({ f: 1318.5, type: 'sine', dur: 0.12, vol: 0.08 });
      break;
    case 'click':
      tone({ f: 900, type: 'sine', dur: 0.05, vol: 0.06 });
      break;
    case 'win':
      [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568].forEach((f, i) => tone({ f, type: 'triangle', t: i * 0.13, dur: 1.4, vol: 0.18 }));
      break;
  }
}

const SCALES = [
  { root: 110, pad: [1, 1.5, 2, 2.25, 3], notes: [1, 1.125, 1.25, 1.5, 1.6875, 2, 2.25, 2.5, 3] },
  { root: 98, pad: [1, 1.2, 1.5, 2, 2.4], notes: [1, 1.2, 1.333, 1.5, 1.8, 2, 2.4, 2.667, 3] },
  { root: 130.81, pad: [1, 1.25, 1.5, 1.875, 2.5], notes: [1, 1.125, 1.25, 1.5, 1.667, 2, 2.25, 2.5, 3] },
];

export function playMusic(world) {
  if (!ctx) return;
  stopMusic();
  const S = SCALES[world % SCALES.length];
  const out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, ctx.currentTime);
  out.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 3);
  out.connect(musicBus);
  const fl = ctx.createBiquadFilter();
  fl.type = 'lowpass';
  fl.frequency.value = 700;
  fl.Q.value = 0.7;
  fl.connect(out);
  const lfo = ctx.createOscillator();
  const lfoG = ctx.createGain();
  lfo.frequency.value = 0.07;
  lfoG.gain.value = 380;
  lfo.connect(lfoG).connect(fl.frequency);
  lfo.start();
  const oscs = [lfo];
  for (const m of S.pad) {
    for (const det of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = S.root * m;
      o.detune.value = det;
      const g = ctx.createGain();
      g.gain.value = 0.05;
      o.connect(g).connect(fl);
      o.start();
      oscs.push(o);
    }
  }
  // gentle generative plucks
  const timer = setInterval(() => {
    if (muted || document.hidden) return;
    if (Math.random() < 0.55) {
      const n = S.notes[Math.floor(Math.random() * S.notes.length)];
      tone({ f: S.root * 4 * n, type: 'sine', dur: 2.2, vol: 0.05 + Math.random() * 0.04, a: 0.01, bus: musicBus });
    }
  }, 620);
  music = { out, oscs, timer };
}

export function stopMusic() {
  if (!music || !ctx) return;
  const m = music;
  music = null;
  clearInterval(m.timer);
  m.out.gain.cancelScheduledValues(ctx.currentTime);
  m.out.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.6);
  setTimeout(() => m.oscs.forEach((o) => o.stop()), 3000);
}
