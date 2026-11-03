// Re-films the run of the demo test with a tall window, capturing the whole "Live run" column per frame.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://127.0.0.1:3100";
const TEST = process.argv[2];
const OUT = new URL("./run/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 2000 }, deviceScaleFactor: 2 })).newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(`${BASE}/login`);
await page.waitForLoadState("networkidle").catch(() => {});
await page.getByLabel("Email").fill("owner@example.com");
await page.getByRole("textbox", { name: "Password" }).fill("correct horse battery");
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForURL(`${BASE}/`);
await page.goto(TEST);
await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
await sleep(800);
await page.getByRole("tab", { name: "Preview" }).click();
await sleep(400);

const live = page.locator("section[aria-labelledby='live-heading']");
const editor = page.locator("section[aria-labelledby='editor-heading']");
await editor.screenshot({ path: `${OUT}editor.png` });
await page.getByRole("button", { name: "Run test" }).click();
const t0 = Date.now();
for (let f = 0; Date.now() - t0 < 120000; f++) {
  await live.screenshot({ path: `${OUT}f-${String(f).padStart(3, "0")}.png`, animations: "disabled" });
  if (f > 4 && (await page.getByRole("button", { name: "Run test" }).isVisible().catch(() => false))) break;
  await sleep(100);
}
await sleep(1000);
await live.screenshot({ path: `${OUT}done.png` });
await page.screenshot({ path: `${OUT}full.png`, fullPage: true });
console.log("frames done in", ((Date.now() - t0) / 1000).toFixed(1), "s");
await browser.close();
