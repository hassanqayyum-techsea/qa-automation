# Brag plan: Repo Pulse "Tests" tab, real-UI walkthrough

**Ask.** A more detailed take on the first cut, using the real UI instead of cropped cards.
**What it is.** A 1:45 screen recording of the real app at 1600×900, captured at 2×. A scripted user works through the whole Tests tab. Cameras zoom on what matters, captions explain each step, and the cursor and clicks are drawn on top.
**Most impressive claim (real, from this recording).** One English sentence became 4 steps. With the "Login Test" session first, all 13 of 13 steps passed on an iPhone 15 browser and it counted 18 links.
**Tone.** `app-store` walkthrough: calm pacing with readable captions, and a fast-forward badge wherever real time is sped up.

## How it was made
1. **Recording.** `work/capture.mjs` drives the real app (`next start` on 127.0.0.1:3100) with Playwright and grabs about 14 full-resolution frames per second. The scripted scrolls run 2.5× slower than they play back, so they come out smooth.
   - It logs every mouse position, click and scroll with its timestamp.
   - Unmasked email addresses on the page are blurred in the DOM.
   - Run-detail screenshots taken while the sign-in form is filled get a blur over the email field.
2. **Edit.** `work/comp/edl.js` is the edit decision list.
   - It defines segments of source time, each with a speed, camera keys and captions.
   - It also lists the privacy blur on the live phone's email field.
   - Cuts between non-adjacent segments cross-fade.
3. **Render.** `work/comp/index.html` turns each output time into a source frame, the camera, the cursor and the overlays. `work/render.mjs` renders it to H.264.
4. **Sound.** `work/audio.cjs` writes an original synth bed (A minor, 112 bpm) with clicks, typing and a success chime placed on the edit's own cues.

## Storyboard (output seconds)
| # | Time | Chapter | What's shown (real UI) |
|---|------|---------|------------------------|
| 0 | 0.0–3.4 | Hook | "Write a test in plain English. Watch it pass on a real phone." over the blurred passed run |
| 1 | 3.4–8.9 | Tests | Sidebar "Tests" leads to "Apps under test" (tests count, latest run) |
| 2 | 8.9–13.5 | App | AI Job Expert (dev) tests table, then the "New test" button |
| 3 | 13.5–17.0 | New test | Modal, typing "Dashboard check", Create test (zoomed) |
| 4 | 17.0–27.3 | Steps | Template Markdown (zoomed), then the "Steps you can write" cheat sheet |
| 5 | 27.3–40.8 | Device | Phone, Tablet (iPad Pro 11), Desktop, Custom size 393×852, back to Phone, then the iPhone model list |
| 6 | 40.8–46.4 | Session | "Start signed in with" set to Login Test |
| 7 | 46.4–64.1 | AI + Preview | The prompt is typed, Update test with AI writes 4 steps (no sign-in), the toast appears, then Preview |
| 8 | 64.1–73.6 | Run | Run test. The live iPhone 15 screen shows sign-in, OTP, then the dashboard; the blank load plays at 1.6× with a badge |
| 9 | 73.6–78.9 | Result | Progress: 13 of 13 passed with per-step times; links = 18 |
| 10 | 78.9–85.4 | Versions | AI edit, then Before AI edit with Restore |
| 11 | 85.4–100.4 | Run history | The run row opens the run page with a screenshot for every step |
| 12 | 100.4–104.6 | Outro | "Markdown steps. Real devices. Live runs you can watch." plus six feature chips |

## Privacy
- **Test-account email blurred everywhere it appears:**
  - the app header
  - the "by" columns
  - the live phone's sign-in field (103.0–105.75 s of the recording)
  - the run-detail screenshots for steps 2–4
- **Masked address left visible:** the OTP screen's `a****@techsea.io` is the app's own masking.
