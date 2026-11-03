// Captures the real Tests tab from the running local app (dev server + worker) as PNG stills/sequences.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://127.0.0.1:3100";
const OUT = new URL("./shots/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "light" });
const page = await ctx.newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (name, loc) => (loc ?? page).screenshot({ path: `${OUT}${name}.png`, animations: "disabled", caret: "hide" });
const settle = () => page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

await page.goto(`${BASE}/login`);
await settle();
await page.getByLabel("Email").fill("owner@example.com");
await page.getByRole("textbox", { name: "Password" }).fill("correct horse battery");
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForURL(`${BASE}/`);
console.log("signed in");

await page.goto(`${BASE}/apps`);
await settle();
await shot("01-apps");

await page.goto(`${BASE}/apps/6ae87449215e8f3d9fc1c530`);
await page.getByRole("heading", { name: "AI Job Expert (dev)" }).waitFor().catch(()=>{});
await settle();
await shot("02-app");

// New test from the modal.
await page.getByRole("button", { name: "New test" }).click();
await page.getByLabel("Test name").fill("Dashboard check");
await sleep(300);
await shot("03-new-test-modal");
await page.getByRole("button", { name: "Create test" }).click();
await page.waitForURL(/\/tests\/[a-f0-9]{24}$/);
await settle();
await sleep(500);
const testUrl = page.url();
console.log("test", testUrl);
await shot("04-workbench-template");

// Device: Phone / Tablet / Desktop / Custom.
const setup = page.locator("div.rounded-xl").filter({ has: page.getByText("Start signed in with") }).first();
await setup.scrollIntoViewIfNeeded();
await shot("05-setup-phone", setup);
for (const [k, n] of [["Tablet", "06-setup-tablet"], ["Desktop", "07-setup-desktop"], ["Custom size", "08-setup-custom"]]) {
  await page.getByRole("radio", { name: k }).or(page.getByRole("button", { name: k, exact: true })).first().click();
  await sleep(400);
  await shot(n, setup);
}
await page.getByRole("radio", { name: "Phone" }).or(page.getByRole("button", { name: "Phone", exact: true })).first().click();
await sleep(400);

// Session: start signed in with "Login Test".
await page.getByRole("button", { name: /Start signed in with/ }).click();
await sleep(400);
await shot("09-session-open");
await page.getByRole("option", { name: "Login Test", exact: true }).click();
await sleep(400);
await shot("10-setup-session", setup);

// AI: type the prompt, generate.
const ai = page.getByLabel("Generate with AI");
const aiCard = page.locator("div.rounded-xl").filter({ has: ai }).first();
await page.evaluate(() => window.scrollTo(0, 0));
const prompt = "After signing in, check we are on /dashboard and it says Welcome, then scroll to the bottom and count the links";
await ai.click();
for (let i = 0, f = 0; i < prompt.length; i += 4, f++) {
  await ai.pressSequentially(prompt.slice(i, i + 4));
  await shot(`11-type-${String(f).padStart(3, "0")}`, aiCard);
}
await page.getByRole("button", { name: /Update test with AI|Generate steps/ }).click();
await sleep(250);
await shot("12-generating");
await page.getByRole("button", { name: /Update test with AI|Generate steps/ }).waitFor({ timeout: 90000 });
await sleep(800);
await page.getByLabel("Test (Markdown)").scrollIntoViewIfNeeded();
await shot("13-ai-result");
await shot("13b-ai-result-editor", page.getByLabel("Test (Markdown)"));

await page.getByRole("tab", { name: "Preview" }).click();
await sleep(500);
await shot("14-preview");
const previewBox = page.getByRole("list", { name: "Steps" }).first().locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]");
await shot("14b-preview-box", previewBox);

await page.getByRole("button", { name: "Save" }).click();
await sleep(1200);

// Run it and film the live column.
await page.evaluate(() => window.scrollTo(0, 0));
await page.getByRole("button", { name: "Run test" }).click();
const live = page.locator("section[aria-labelledby='live-heading']");
const t0 = Date.now();
for (let f = 0; Date.now() - t0 < 120000; f++) {
  await shot(`15-run-${String(f).padStart(3, "0")}`);
  const done = await page.getByRole("button", { name: "Run test" }).isVisible().catch(() => false);
  if (done && f > 4) break;
  await sleep(150);
}
await sleep(800);
await shot("16-run-done");
await shot("16b-live-done", live);

// Versions + run history.
const versions = page.getByRole("table", { name: "Versions" });
await versions.scrollIntoViewIfNeeded();
await sleep(300);
await shot("17-versions");
await shot("17b-versions-card", versions.locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]"));

console.log(JSON.stringify({ testUrl, runFrames: "see shots" }));
await browser.close();
