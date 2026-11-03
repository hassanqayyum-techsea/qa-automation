// Edit decision list over the real screen recording (REC, times in seconds from the recording start).
// Shared by the composition (browser) and the soundtrack (node). Cameras are [x, y, width] in the app's
// 1600×900 CSS viewport (height = width × 9/16). Speeds are [srcTime, speed, fastForwardBadge?].
(function (G) {
  const R = G.REC;
  const HOOK = 3.4, OUTRO = 4.2, XF = 0.3;
  const FULL = [0, 0, 1600];
  const SEG = [
    { id: "apps", src: [1.6, 7.6], speed: 1.1, cam: [[1.6, FULL]],
      cap: [{ at: 2.0, k: "01 · Tests", t: "Every app under test", s: "With its number of tests and its latest run.", pos: "bl" }] },
    { id: "app", src: [7.6, 12.9], speed: 1.15, cam: [[7.6, FULL]],
      cap: [{ at: 7.9, k: "02 · App", t: "Open an app to see its tests", s: "Steps, device, latest result and who edited it last.", pos: "bl" }] },
    { id: "new", src: [12.9, 19.9], speed: 2, cam: [[12.9, FULL], [13.1, [400, 190, 800]]],
      cap: [{ at: 13.2, k: "03 · New test", t: "Give it a name", pos: "tl" }] },
    { id: "md", src: [19.9, 39.2], speed: 1.25, cam: [[19.9, FULL], [24.4, [230, 120, 760]], [28.9, FULL], [32.6, [260, 140, 1040]], [35.6, FULL]],
      cap: [
        { at: 20.2, to: 28.9, k: "04 · Steps", t: "A test is plain Markdown", s: "One step per line. Lines that aren’t steps are notes.", pos: "br" },
        { at: 32.7, to: 35.7, k: "04 · Steps", t: "Every step you can write, listed", s: "go to, click, tap, fill, type, wait, expect, scroll, count.", pos: "bl" },
      ] },
    { id: "device", src: [39.2, 53.2], speed: 1.5, cam: [[39.2, [160, 56, 1440]]],
      cap: [{ at: 39.6, k: "05 · Device", t: "Pick the device", s: "Phone, tablet, desktop, or any custom size.", pos: "br" }] },
    { id: "phones", src: [53.2, 57.4], speed: 1, cam: [[53.2, [160, 56, 1440]], [53.7, [240, 280, 900]]],
      cap: [{ at: 54.0, k: "05 · Device", t: "Every model has its real screen", s: "iPhone 15 is 393×852. iPhone 15 Pro Max is 430×932.", pos: "br" }] },
    { id: "session", src: [57.4, 66.0], speed: 1.2, cam: [[57.4, FULL]],
      cap: [{ at: 57.8, k: "06 · Session", t: "Start signed in", s: "Pick a login test. It runs first in the same browser, so this test starts with its session.", pos: "br" }] },
    { id: "ai", src: [66.0, 78.9], speed: [[66, 1.2], [69.8, 1.7], [76.7, 1]], cam: [[66, FULL], [68.4, [250, 150, 850]]],
      cap: [{ at: 69.0, k: "07 · AI", t: "Describe it. AI writes the steps.", s: "Plain English in, runnable Markdown out.", pos: "br" }] },
    { id: "aidone", src: [78.9, 91.0], speed: 1.1, cam: [[78.9, FULL], [82.4, [230, 60, 900]], [87.4, [230, 0, 1000]]],
      cap: [
        { at: 79.3, to: 87.4, k: "07 · AI", t: "No sign-in steps needed", s: "The session signs in, so AI wrote only the 4 new steps. The old version is kept.", pos: "br" },
        { at: 88.0, k: "08 · Preview", t: "Preview shows exactly what will run", s: "4 steps on iPhone 15, after signing in with “Login Test”.", pos: "br" },
      ] },
    { id: "runbtn", src: [95.4, 97.6], speed: 1, cam: [[95.4, FULL]],
      cap: [{ at: 95.5, k: "09 · Run", t: "Run test", s: "Unsaved edits are saved first.", pos: "tr" }] },
    { id: "run", src: [97.6, 108.2], speed: [[97.6, 1], [100.6, 1.6, true], [103.0, 1]], cam: [[97.6, FULL], [100.3, [320, 225, 1200]]],
      cap: [
        { at: 98.0, to: 103.4, k: "09 · Live run", t: "A real iPhone 15 browser on the server", s: "Streamed here, frame by frame.", pos: "bl" },
        { at: 103.6, k: "09 · Live run", t: "The session signs in first", s: "Email, password and the OTP code, then this test’s 4 steps.", pos: "bl" },
      ] },
    { id: "progress", src: [108.2, 116.2], speed: 1, cam: [[108.2, [320, 225, 1200]], [113.3, [560, 0, 1040]], [114.6, [560, 315, 1040]]],
      cap: [{ at: 108.3, k: "10 · Result", t: "13 of 13 steps passed", s: "Each step with its time, plus counted values: links = 18.", pos: "bl" }] },
    { id: "versions", src: [116.2, 128.0], speed: 1.1, cam: [[116.2, FULL], [120.5, [260, 250, 1100]]],
      cap: [{ at: 120.7, k: "11 · Versions", t: "Every save and AI edit is a version", s: "Restore puts one back in the editor. Save keeps it.", pos: "br" }] },
    { id: "history", src: [128.0, 133.9], speed: 1.2, cam: [[128, [260, 250, 1100]], [128.5, FULL]],
      cap: [{ at: 128.6, k: "12 · Run history", t: "Every run is kept", s: "Open one to see what happened.", pos: "br" }] },
    { id: "detail", src: [133.9, 166.4], speed: [[133.9, 1], [141.4, 1.7]], cam: [[133.9, FULL]],
      cap: [{ at: 134.3, k: "12 · Run history", t: "A screenshot for every step", s: "See exactly what the phone showed after each one.", pos: "tr" }] },
  ];
  // The live phone shows the test account's email while the sign-in form is filled: blur that field.
  const BLUR = [{ src: [103.0, 105.75], rect: [1098, 480, 268, 50] }];

  const inScroll = (s) => R.scrolls.some(([a, b]) => s >= a && s < b);
  const speedAt = (seg, s) => {
    if (typeof seg.speed === "number") return [seg.speed, false];
    let v = seg.speed[0];
    for (const x of seg.speed) if (s >= x[0]) v = x;
    return [v[1], !!v[2]];
  };
  // Pieces: constant-rate stretches of source time.
  const pieces = [];
  let o = HOOK;
  SEG.forEach((seg, si) => {
    seg.o0 = o;
    const cuts = new Set([seg.src[0], seg.src[1]]);
    R.scrolls.flat().forEach((x) => x > seg.src[0] && x < seg.src[1] && cuts.add(x));
    if (Array.isArray(seg.speed)) seg.speed.forEach((x) => x[0] > seg.src[0] && x[0] < seg.src[1] && cuts.add(x[0]));
    const pts = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i < pts.length - 1; i++) {
      const [sp, ff] = speedAt(seg, pts[i]);
      const rate = sp * (inScroll(pts[i]) ? R.slow : 1);
      const d = (pts[i + 1] - pts[i]) / rate;
      pieces.push({ si, s0: pts[i], s1: pts[i + 1], o0: o, o1: o + d, rate, ff });
      o += d;
    }
    seg.o1 = o;
    seg.cut = si > 0 && Math.abs(SEG[si - 1].src[1] - seg.src[0]) > 0.05;
  });
  const END = o, DURATION = END + OUTRO;

  const srcAt = (t) => {
    if (t < HOOK) return { si: 0, s: SEG[0].src[0], piece: null };
    for (const p of pieces) if (t < p.o1) return { si: p.si, s: p.s0 + (t - p.o0) * p.rate, piece: p };
    const p = pieces.at(-1);
    return { si: p.si, s: p.s1, piece: null };
  };
  const outAt = (s, si) => {
    for (const p of pieces) if ((si === undefined || p.si === si) && s >= p.s0 && s <= p.s1) return p.o0 + (s - p.s0) / p.rate;
    return null;
  };
  // Camera keys in output time; contiguous segments glide, cuts jump.
  const camKeys = [];
  SEG.forEach((seg, si) => seg.cam.forEach(([s, r], k) => camKeys.push({ o: outAt(Math.max(s, seg.src[0]), si) ?? seg.o0, r, jump: k === 0 && (si === 0 || seg.cut) })));
  const easeIO = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const CAM_T = 0.85;
  const camAt = (t) => {
    let cur = camKeys[0].r;
    for (let i = 0; i < camKeys.length; i++) {
      const k = camKeys[i];
      if (t < k.o) break;
      if (k.jump) { cur = k.r; continue; }
      const e = easeIO((t - k.o) / CAM_T), from = cur;
      cur = from.map((v, j) => v + (k.r[j] - v) * e);
    }
    return cur;
  };
  const captions = [];
  SEG.forEach((seg, si) => seg.cap.forEach((c) => {
    const a = outAt(c.at, si) ?? seg.o0, b = c.to !== undefined ? outAt(c.to, si) ?? seg.o1 : seg.o1;
    captions.push({ ...c, o0: a, o1: b });
  }));
  const cues = {
    clicks: R.clicks.map((c) => outAt(c)).filter((x) => x !== null),
    typing: [[13.0, 19.0], [69.7, 76.7]].map(([a, b]) => [outAt(a), outAt(b)]),
    success: outAt(107.35),
    scenes: SEG.map((s) => s.o0),
    run: [SEG.find((s) => s.id === "run").o0, SEG.find((s) => s.id === "progress").o1],
  };
  G.EDL = { R, HOOK, OUTRO, XF, END, DURATION, SEG, BLUR, pieces, srcAt, outAt, camAt, captions, cues, fps: 30 };
})(typeof window !== "undefined" ? window : globalThis);
