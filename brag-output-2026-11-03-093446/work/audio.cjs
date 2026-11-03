// Original soundtrack for the real-UI Tests walkthrough: A-minor synth bed at 112 bpm + UI sounds pitched to the same key.
// node audio.cjs → work/audio.wav
const fs = require("fs");
const ctx = { window: {} };
for (const f of ["rec.js", "edl.js"]) require("vm").runInNewContext(fs.readFileSync(__dirname + "/comp/" + f, "utf8"), ctx);
const E = ctx.window.EDL, C = E.cues;
const TL = { duration: E.DURATION, bpm: 112, clicks: C.clicks, hover: [], success: C.success,
  scenes: { list: [E.HOOK], device: [C.scenes[1]], run: C.run, outro: [E.END] } };

const SR = 44100, DUR = TL.duration + 0.6, N = Math.ceil(DUR * SR);
const L = new Float32Array(N), R = new Float32Array(N);
const beat = 60 / TL.bpm, S = TL.scenes;
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const add = (i, v, pan = 0) => { if (i >= 0 && i < N) { L[i] += v * (1 - pan) ; R[i] += v * (1 + pan); } };

// ---------- instruments ----------
function tone(t0, f, dur, gain, { attack = 0.005, decay = 0.3, harm = [1], pan = 0, vib = 0 } = {}) {
  const i0 = Math.floor(t0 * SR), n = Math.floor(dur * SR);
  for (let k = 0; k < n; k++) {
    const t = k / SR, a = Math.min(1, t / attack) * Math.exp(-t / decay);
    let v = 0; harm.forEach((h, j) => (v += Math.sin(2 * Math.PI * f * (j + 1) * t * (1 + vib * Math.sin(2 * Math.PI * 5 * t))) * h));
    add(i0 + k, v * a * gain, pan);
  }
}
function noise(t0, dur, gain, { attack = 0.001, decay = 0.05, hp = 0.0, lp = 1, pan = 0, swell = false } = {}) {
  const i0 = Math.floor(t0 * SR), n = Math.floor(dur * SR);
  let lo = 0, prev = 0;
  for (let k = 0; k < n; k++) {
    const t = k / SR;
    const a = swell ? Math.pow(t / dur, 2) * (1 - Math.pow(t / dur, 8)) : Math.min(1, t / attack) * Math.exp(-t / decay);
    const x = rnd(); lo += lp * (x - lo); const h = lo - prev * hp; prev = lo;
    add(i0 + k, h * a * gain, pan);
  }
}
function kick(t0, gain) {
  const i0 = Math.floor(t0 * SR), n = Math.floor(0.4 * SR); let ph = 0;
  for (let k = 0; k < n; k++) { const t = k / SR, f = 48 + 110 * Math.exp(-t / 0.03); ph += (2 * Math.PI * f) / SR; add(i0 + k, Math.tanh(Math.sin(ph) * 1.6) * Math.exp(-t / 0.22) * gain); }
}

// ---------- music ----------
const n = (name) => ({ A2: 110, C3: 130.81, D3: 146.83, E3: 164.81, F2: 87.31, F3: 174.61, G2: 98, G3: 196, A3: 220, B3: 246.94, C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392, A4: 440, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.51, A6: 1760 })[name];
const CHORDS = [
  { bass: "A2", pad: ["A3", "C4", "E4"], arp: ["A4", "C5", "E5", "C5"] },
  { bass: "F2", pad: ["F3", "A3", "C4"], arp: ["F4", "A4", "C5", "A4"] },
  { bass: "C3", pad: ["G3", "C4", "E4"], arp: ["E4", "G4", "C5", "G4"] },
  { bass: "G2", pad: ["G3", "B3", "D4"], arp: ["D4", "G4", "B4", "G4"] },
];
const barLen = beat * 4, chordLen = barLen * 2;
const chordAt = (t) => CHORDS[Math.floor(t / chordLen) % 4];
const end = S.outro[0];

// pad: soft detuned voices per chord
for (let c = 0; c * chordLen < DUR; c++) {
  const t0 = c * chordLen, ch = CHORDS[c % 4];
  const len = t0 >= end ? DUR - t0 : chordLen + 0.4;
  const final = t0 + chordLen > end && t0 <= end;
  ch.pad.forEach((nm, j) => [0.997, 1.003].forEach((d, k) =>
    tone(t0, n(nm) * d, final ? DUR - t0 : len, 0.022, { attack: 0.6, decay: final ? 3 : 6, harm: [1, 0.35, 0.12], pan: k ? 0.35 : -0.35 })));
}
// final resolve on A minor at the outro
CHORDS[0].pad.concat(["A4"]).forEach((nm, j) => tone(end, n(nm), DUR - end, 0.03, { attack: 0.05, decay: 2.2, harm: [1, 0.3], pan: (j - 1.5) * 0.2 }));
tone(end, n("A2"), DUR - end, 0.12, { attack: 0.01, decay: 1.6, harm: [1, 0.25] });

// arp (8ths) from the reveal, brighter during the run
for (let t = S.list[0]; t < end; t += beat / 2) {
  const ch = chordAt(t), i = Math.round((t - S.list[0]) / (beat / 2));
  const lift = t >= S.run[0] && t < S.run[1] ? 1.35 : 1;
  tone(t, n(ch.arp[i % 4]) * (i % 8 >= 4 ? 2 : 1), 0.5, 0.032 * lift, { decay: 0.16, harm: [1, 0.25, 0.1], pan: i % 2 ? 0.3 : -0.3 });
}
// bass + kick + hats
for (let b = Math.round(S.list[0] / beat); b * beat < end + 0.01; b++) {
  const t = b * beat, ch = chordAt(t);
  kick(t, t >= S.run[0] && t < S.run[1] ? 0.34 : 0.26);
  tone(t, n(ch.bass), beat * 0.9, 0.11, { attack: 0.01, decay: 0.32, harm: [1, 0.4, 0.15] });
  if (t >= S.device[0]) noise(t + beat / 2, 0.06, 0.035, { decay: 0.018, hp: 0.98, lp: 0.9, pan: 0.25 });
  if (t >= S.run[0] && t < S.run[1]) {
    noise(t + beat / 4, 0.05, 0.018, { decay: 0.012, hp: 0.98, lp: 0.9, pan: -0.25 });
    noise(t + (3 * beat) / 4, 0.05, 0.018, { decay: 0.012, hp: 0.98, lp: 0.9, pan: -0.25 });
    if (b % 2) noise(t, 0.2, 0.06, { decay: 0.07, hp: 0.6, lp: 0.5 }); // soft clap on 2 and 4
  }
}
// hook riser into the reveal, then a soft hit
noise(0.2, S.list[0] - 0.2, 0.05, { swell: true, hp: 0.9, lp: 0.35 });
tone(0, n("A2"), S.list[0], 0.06, { attack: 1.5, decay: 4, harm: [1, 0.3] });
noise(S.list[0], 1.4, 0.035, { decay: 0.5, hp: 0.95, lp: 0.6 });

// ---------- UI sounds (same key, under the music) ----------
for (const c of TL.clicks) { tone(c, n("E5"), 0.18, 0.05, { decay: 0.05, harm: [1, 0.2] }); noise(c, 0.02, 0.05, { decay: 0.004, hp: 0.9 }); }
for (const h of TL.hover) tone(h, n("A5"), 0.2, 0.03, { decay: 0.06 });
for (const [a, b] of C.typing) { for (let t = a; t < b; t += 0.07 + 0.03 * Math.abs(rnd())) noise(t, 0.015, 0.03 + 0.012 * Math.abs(rnd()), { decay: 0.004, hp: 0.85, lp: 0.8, pan: rnd() * 0.2 }); }
// scene whooshes
for (const t of C.scenes.slice(1).concat([E.END])) noise(t - 0.3, 0.42, 0.018, { swell: true, hp: 0.92, lp: 0.4 });
// each passing step in the run: a tiny tick; then the success bells
// (no per-step ticks: the real progress table carries that)
["A5", "C6", "E6", "A6"].forEach((nm, i) => { const t = TL.success + i * 0.075; tone(t, n(nm), 1.6, 0.045, { decay: 0.7, harm: [1, 0, 0.15] }); tone(t, n(nm) * 2.76, 0.6, 0.008, { decay: 0.2 }); });

// ---------- master ----------
let peak = 0;
const fadeIn = 0.05, fadeOut = 0.9;
for (let i = 0; i < N; i++) {
  const t = i / SR, g = Math.min(1, t / fadeIn) * Math.min(1, Math.max(0, (DUR - 0.2 - t) / fadeOut));
  L[i] = Math.tanh(L[i] * 1.2 * g) / 1.2; R[i] = Math.tanh(R[i] * 1.2 * g) / 1.2;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const norm = 0.89 / peak;
const buf = Buffer.alloc(44 + N * 4);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write("data", 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.round(L[i] * norm * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(R[i] * norm * 32767), 46 + i * 4); }
fs.writeFileSync(__dirname + "/audio.wav", buf);
console.log("audio.wav", DUR.toFixed(1), "s, peak scale", norm.toFixed(2));
