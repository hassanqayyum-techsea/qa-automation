// node render.mjs stills 1.5 4.5 ...   → work/stills/t-<s>.png
// node render.mjs video                → work/video.mp4 (silent, 30 fps)
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const here = new URL(".", import.meta.url).pathname;
const [mode, ...times] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on("console", (m) => m.type() === "error" && console.error(m.text()));
await page.goto(`file://${here}comp/index.html`);
await page.evaluate(() => window.ready);
const TL = await page.evaluate(() => window.TL);

if (mode === "stills") {
  mkdirSync(`${here}stills`, { recursive: true });
  for (const s of times) {
    await page.evaluate((t) => window.seek(t), Number(s));
    await page.screenshot({ path: `${here}stills/t-${s}.png` });
  }
} else {
  const n = Math.round(TL.duration * TL.fps);
  const ff = spawn("ffmpeg", ["-loglevel", "error", "-y", "-f", "image2pipe", "-framerate", String(TL.fps), "-c:v", "mjpeg", "-i", "-",
    "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", `${here}video.mp4`], { stdio: ["pipe", "inherit", "inherit"] });
  for (let f = 0; f < n; f++) {
    await page.evaluate((t) => window.seek(t), f / TL.fps);
    const buf = await page.screenshot({ type: "jpeg", quality: 95 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if (f % 150 === 0) console.log(`frame ${f}/${n}`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
}
await browser.close();
