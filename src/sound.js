// Tiny synthesized sound effects (Web Audio), so the app ships no audio files.

let ctx = null;
let enabled = true;
let noiseBuffer = null;

export function setSoundEnabled(on) {
  enabled = on;
}

/** Browsers only allow audio after a user gesture; call this from one. */
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function envelope(gainNode, t0, dur, peak) {
  const g = gainNode.gain;
  g.setValueAtTime(0.0001, t0);
  g.exponentialRampToValueAtTime(peak, t0 + 0.005);
  g.exponentialRampToValueAtTime(0.0001, t0 + dur);
}

function tone(freq, dur, { type = 'sine', gain = 0.1, delay = 0, to } = {}) {
  if (!enabled || !ctx) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  envelope(g, t0, dur, gain);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(dur, { gain = 0.2, delay = 0, freq = 2000, q = 0.8 } = {}) {
  if (!enabled || !ctx) return;
  if (!noiseBuffer) {
    noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const t0 = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = ctx.createGain();
  envelope(g, t0, dur, gain);
  src.connect(filter).connect(g).connect(ctx.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

export const sfx = {
  deal: () => noise(0.07, { gain: 0.35, freq: 3500, q: 0.6 }),
  flip: () => noise(0.1, { gain: 0.3, freq: 2400 }),
  chip: () => {
    tone(2200, 0.045, { type: 'triangle', gain: 0.08 });
    tone(2900, 0.045, { type: 'triangle', gain: 0.06, delay: 0.035 });
  },
  chips: () => {
    for (let i = 0; i < 4; i++) tone(1900 + Math.random() * 1300, 0.04, { type: 'triangle', gain: 0.06, delay: i * 0.045 });
  },
  check: () => {
    tone(160, 0.07, { gain: 0.3 });
    tone(160, 0.07, { gain: 0.3, delay: 0.11 });
  },
  fold: () => noise(0.18, { gain: 0.15, freq: 900 }),
  allin: () => tone(220, 0.35, { type: 'sawtooth', gain: 0.05, to: 440 }),
  turn: () => tone(880, 0.12, { gain: 0.06 }),
  win: () => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 0.22, { type: 'triangle', gain: 0.1, delay: i * 0.09 })),
};
