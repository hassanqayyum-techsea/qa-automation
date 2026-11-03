// Shared by the composition (browser) and the soundtrack (node): scene boundaries and sound cues.
const TL = {
  fps: 30,
  duration: 39.8,
  bpm: 112,
  scenes: {
    hook: [0, 3.6],
    list: [3.6, 7.0],
    app: [7.0, 10.0],
    device: [10.0, 14.8],
    session: [14.8, 18.0],
    ai: [18.0, 24.8],
    run: [24.8, 33.8],
    versions: [33.8, 37.0],
    outro: [37.0, 39.8],
  },
  clicks: [5.2, 8.6, 10.9, 11.9, 12.9, 15.3, 16.4, 20.8],
  hover: [36.0],
  typing: [18.3, 20.6],
  success: 31.8,
  // run scene: phone frames were captured ~0.26 s apart; real run time r maps onto video time u.
  run: {
    frameDt: 0.2608,
    frames: 51,
    warp: [[0, 0], [1.6, 9.0], [7.0, 13.3]],
    start: 1.71,
    steps: [
      ["Login Test", 'go to /login', 7390],
      ["Login Test", 'fill "Email address" with "{{email}}"', 23],
      ["Login Test", 'fill "Password" with "{{password}}"', 22],
      ["Login Test", 'click "Sign in"', 46],
      ["Login Test", "wait 1s", 1001],
      ["Login Test", 'type "000000"', 384],
      ["Login Test", 'click "Verify Code"', 40],
      ["Login Test", "wait for url /dashboard", 656],
      ["Login Test", 'expect text "Welcome"', 2],
      [null, "wait for url /dashboard", 0],
      [null, 'expect text "Welcome"', 3],
      [null, "scroll to bottom", 604],
      [null, 'count "a" as links', 2],
    ],
  },
};
if (typeof module !== "undefined") module.exports = TL;
else window.TL = TL;
