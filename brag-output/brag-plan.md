# Brag plan: Repo Pulse "Tests" tab

**What it is.** The Tests tab in Repo Pulse: write a browser test as Markdown steps (or describe it to AI), pick a device, start signed in with another test, then watch it run live on a server-side phone, step by step.
**Who it's for.** QA and dev teams testing their own web apps (here: AI Job Expert, dev).
**What sets it apart.** Steps are plain Markdown; a login test becomes a reusable session; the run streams the real phone screen; every AI edit is a restorable version.
**Most impressive claim (real, from this run).** One sentence of English became 4 steps; with the "Login Test" session prepended it ran 13 of 13 steps on iPhone 15 and counted 18 links.
**Visual hook.** The finished phone run with "Passed" next to the sentence that produced it.
**Tone.** `app-store` (clean feature cards) with polished pacing. The user asked for "detailed", so it runs about 39 s instead of the usual 20.
**Share caption.** "One sentence → 13 passing steps on a real iPhone 15 browser."

## Angle
"From one sentence to a passing run." Every scene is the real UI captured from the local app: the Tests list, the device picker, the session select, AI typing, the Markdown preview, the live phone run, Versions.

## Storyboard (1920×1080, 30 fps)
| # | Time | Scene | On screen | Motion / SFX |
|---|------|-------|-----------|--------------|
| 1 | 0.0–3.2 | Hook | "Write a test in plain English." / "Watch it pass on a real phone." + the finished phone (Passed) | lines rise in, phone slides up; soft riser → hit |
| 2 | 3.2–6.6 | Tests list | Real Tests page in a window frame; nav "Tests" highlighted. Caption "Every app under test, with its latest run." | slow push-in; cursor glides to Tests |
| 3 | 6.6–9.6 | App + New test | Tests table (Login Flow Test / Login Test, Passed) → "New test" modal "Dashboard check" | cursor click, modal pops; click tick |
| 4 | 9.6–14.4 | Device | Device card cycling Phone → Tablet → Desktop → Custom size (393×852) | button clicks highlighted; ticks |
| 5 | 14.4–17.6 | Session | "Start signed in with" → Login Test. Caption "Reuse a login test as the session." | dropdown pop; tick |
| 6 | 17.6–24.4 | AI | Prompt types in, "Generating…", then the 4-step Markdown + Preview. Caption "Describe it. AI writes the steps." / "No sign-in steps. The session handles it." | typing ticks; whoosh |
| 7 | 24.4–33.4 | Live run | Real phone frames (blank → Welcome back → OTP → dashboard) left; step list right flipping Waiting → Running → Passed from the real run's timings; ends "13 of 13 passed · links = 18" | rows tick in key; success chord |
| 8 | 33.4–36.4 | Versions | Real Versions card: AI edit with the prompt, Before AI edit with Restore | slide up; soft tick on Restore |
| 9 | 36.4–39.0 | Outro | "Repo Pulse · Tests" + "Markdown steps. Real devices. Live runs." | settle; final chord |

## Visual identity
Geist (the app's font), navy text #10244F, brand purple #563BDB, app grey #F5F5F5, success green from the Passed badge. Screens sit in rounded white cards with soft shadows on a pale lavender background.

## Music cue guidance
Original synth bed at 112 bpm in A minor, written for this cut: soft pad + pluck arpeggio, light kick from scene 2, lift at the run (24.4 s), resolve on the outro. UI ticks and the success chord are pitched to A minor and mixed under the music.

## Privacy
The real test-account email on the app header is cropped out. The phone frames show the app's own masked address only.
