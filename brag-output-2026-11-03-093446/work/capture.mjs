// Screen-records the real Tests tab (CDP screenshots at 3200×1800, ~20 fps) while a scripted user works through it.
// node capture.mjs <framesDir>   → <framesDir>/f-*.jpg, frames.json, marks.json
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = "http://127.0.0.1:3100";
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now() / 1000;

// Blur for any unmasked email address (privacy).
const INIT = () => {
  const boot = () => {
    if (window.__scrub) return;
    window.__scrub = 1;
    const RE = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
    const scrub = (root) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const hits = [];
      for (let n; (n = w.nextNode()); ) if (RE.test(n.nodeValue) && !n.nodeValue.match(RE)[0].includes("*") && !n.parentElement?.closest("[data-blur]")) hits.push(n);
      for (const n of hits) {
        const m = n.nodeValue.match(RE), after = n.splitText(m.index), rest = after.splitText(m[0].length);
        const s = document.createElement("span");
        s.dataset.blur = "1";
        s.style.filter = "blur(5px)";
        after.replaceWith(s);
        s.appendChild(after);
        void rest;
      }
    };
    // Run-detail screenshots taken while the sign-in form is filled show the test account's email: blur that field.
    const shield = () => document.querySelectorAll('[role=img][aria-label^="Screen after step"]').forEach((el) => {
      if (el.dataset.sh) return;
      const h = el.closest("article")?.querySelector("h3")?.textContent || "";
      if (!/Email address|Password|Sign in/.test(h)) return void (el.dataset.sh = "0");
      const svg = el.querySelector("svg"), a = el.getBoundingClientRect(), b = svg?.getBoundingClientRect();
      if (!b?.width) return;
      el.dataset.sh = "1";
      el.style.position = "relative";
      const d = document.createElement("div");
      Object.assign(d.style, { position: "absolute", left: b.left - a.left + b.width * 0.08 + "px", top: b.top - a.top + b.height * 0.35 + "px", width: b.width * 0.84 + "px", height: b.height * 0.1 + "px", backdropFilter: "blur(8px)", webkitBackdropFilter: "blur(8px)", background: "rgba(255,255,255,.25)", borderRadius: "6px", pointerEvents: "none" });
      el.appendChild(d);
    });
    setInterval(shield, 200);
    scrub(document.body);
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.nodeType === 1 ? scrub(n) : n.nodeType === 3 && n.parentElement && scrub(n.parentElement)))).observe(document.body, { childList: true, subtree: true, characterData: true });
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", boot);
  else boot();
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2, colorScheme: "light" });
await ctx.addInitScript(INIT);
const page = await ctx.newPage();
const settle = () => page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

await page.goto(`${BASE}/login`);
await settle();
await page.getByLabel("Email").fill("owner@example.com");
await page.getByRole("textbox", { name: "Password" }).fill("correct horse battery");
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForURL(`${BASE}/`);
await settle();
await sleep(1500);

// ---- recording helpers ----
const marks = [];
const mark = async (name, loc) => {
  const m = { name, t: now() };
  if (loc) m.box = await loc.boundingBox().catch(() => null);
  m.scrollY = await getY();
  marks.push(m);
  console.log(name, (m.t - t0).toFixed(2));
};
let mx = 1100, my = 700;
const mouse = [], clicks = [];
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const moveTo = async (x, y, ms = 650) => {
  const sx = mx, sy = my, n = Math.max(8, Math.round(ms / 16));
  for (let i = 1; i <= n; i++) { const k = ease(i / n), px = sx + (x - sx) * k, py = sy + (y - sy) * k; await page.mouse.move(px, py); mouse.push([now(), px, py]); await sleep(16); }
  mx = x; my = y;
};
const hover = async (loc, { dx = 0.5, dy = 0.5, ms } = {}) => {
  let b = await loc.boundingBox();
  if (!b || b.y < 50 || b.y + b.height > 860) { await scrollToEl(loc, 330, 750); await sleep(150); b = await loc.boundingBox(); }
  await moveTo(b.x + b.width * dx, b.y + b.height * dy, ms);
};
const click = async (loc, o) => { await hover(loc, o); await sleep(120); clicks.push(now()); await page.mouse.down(); await sleep(90); await page.mouse.up(); };
const SC = `(() => [...document.querySelectorAll("*")].find((e) => e.scrollHeight > e.clientHeight + 10 && /(auto|scroll)/.test(getComputedStyle(e).overflowY)) || document.scrollingElement)()`;
const getY = () => page.evaluate((sc) => eval(sc).scrollTop, SC);
// Scrolls run 2.5× slower than they'll play, so the ~14 fps capture still gives smooth motion once sped back up.
const SLOW = 2.5, scrolls = [];
const scrollTo = async (y, ms = 1100) => {
  const s = await getY(), n = Math.round((ms * SLOW) / 16);
  if (Math.abs(y - s) < 2) return;
  const a = now();
  for (let i = 1; i <= n; i++) { await page.evaluate(([sc, v]) => (eval(sc).scrollTop = v), [SC, s + (y - s) * ease(i / n)]); await sleep(16); }
  scrolls.push([a, now()]);
};
const scrollToEl = async (loc, top = 90, ms) => {
  const y = await loc.evaluate((e, [t, sc]) => { const c = eval(sc); return e.getBoundingClientRect().top - (c === document.scrollingElement ? 0 : c.getBoundingClientRect().top) + c.scrollTop - t; }, [top, SC]);
  await scrollTo(Math.max(0, y), ms);
};

// ---- screencast ----
const cdp = await ctx.newCDPSession(page);
const frames = [];
let fi = 0, recording = true;
await page.mouse.move(mx, my);
const loop = (async () => {
  while (recording) {
    const a = now();
    const { data } = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 90, optimizeForSpeed: true, clip: { x: 0, y: 0, width: 1600, height: 900, scale: 2 } }).catch(() => ({}));
    if (!data) { await sleep(20); continue; }
    const f = `f-${String(fi++).padStart(5, "0")}.jpg`;
    writeFileSync(`${OUT}/${f}`, Buffer.from(data, "base64"));
    frames.push({ f, t: (a + now()) / 2 });
  }
})();
const t0 = now();
await sleep(1200);

// 1. Nav → Tests list
await mark("start");
await click(page.getByRole("link", { name: "Tests" }).first());
await page.waitForURL(`${BASE}/apps`);
await settle();
await mark("apps");
await sleep(2200);

// 2. Open the app
const appLink = page.getByText("AI Job Expert (dev)").first();
await hover(appLink);
await sleep(500);
await mark("click-app", appLink);
clicks.push(now()); await page.mouse.down(); await sleep(90); await page.mouse.up();
await page.waitForURL(/\/apps\/[a-f0-9]{24}$/, { timeout: 4000 }).catch(() => page.goto(`${BASE}/apps/6ae87449215e8f3d9fc1c530`));
await page.getByRole("button", { name: "New test" }).waitFor();
await settle();
await mark("app", page.locator(`:is(table,[role=grid],[role=table])[aria-label="Tests"]`));
await hover(page.locator(`:is(table,[role=grid],[role=table])[aria-label="Tests"]`).getByRole("row").nth(1), { dx: 0.3 });
await sleep(1800);

// 3. New test
await click(page.getByRole("button", { name: "New test" }));
await page.getByLabel("Test name").waitFor();
await mark("modal", page.getByRole("dialog"));
await sleep(500);
await page.getByLabel("Test name").pressSequentially("Dashboard check", { delay: 70 });
await sleep(700);
await click(page.getByRole("button", { name: "Create test" }));
await page.waitForURL(/\/tests\/[a-f0-9]{24}$/);
await settle();
const testUrl = page.url();
await mark("workbench");
await sleep(1800);
const md = page.getByLabel("Test (Markdown)");
await scrollToEl(md, 150, 1000);
await mark("markdown", md);
await hover(md, { dx: 0.55, dy: 0.3 });
await sleep(2600);
const help = page.getByText("Steps you can write");
await scrollToEl(help, 120, 1000);
await mark("help", help);
await sleep(2800);
await scrollTo(0, 1000);

// 4. Device picker
const setup = page.locator("div.rounded-xl").filter({ has: page.getByText("Start signed in with") }).first();
await mark("setup", setup);
for (const k of ["Tablet", "Desktop", "Custom size"]) {
  await click(page.getByRole("radio", { name: k }).or(page.getByRole("button", { name: k, exact: true })).first());
  await mark(`device-${k}`, setup);
  await sleep(k === "Custom size" ? 2200 : 1500);
}
await click(page.getByRole("radio", { name: "Phone" }).or(page.getByRole("button", { name: "Phone", exact: true })).first());
await mark("device-Phone", setup);
await sleep(900);
const combo = page.getByRole("combobox", { name: "Phone" });
await click(combo, { dx: 0.3 });
await sleep(200);
await page.keyboard.press("ArrowDown");
await sleep(1700);
await mark("phone-list", setup);
await page.keyboard.press("Escape");
await sleep(600);

// 5. Session
await click(page.getByRole("button", { name: /Start signed in with/ }));
await sleep(1100);
await mark("session-open", setup);
await click(page.getByRole("option", { name: "Login Test", exact: true }));
await sleep(1600);
await mark("session-set", setup);

// 6. AI
const ai = page.getByLabel("Generate with AI");
const aiCard = page.locator("div.rounded-xl").filter({ has: ai }).first();
await scrollTo(0, 700);
await click(ai, { dx: 0.3 });
await mark("ai-type", aiCard);
await ai.pressSequentially("After signing in, check we are on /dashboard and it says Welcome, then scroll to the bottom and count the links", { delay: 38 });
await sleep(600);
const gen = page.getByRole("button", { name: /Update test with AI|Generate steps/ });
await click(gen);
await mark("ai-gen", aiCard);
await page.getByRole("button", { name: /Update test with AI|Generate steps/ }).waitFor({ timeout: 90000 });
await scrollToEl(md, 200, 900);
await mark("ai-done", md);
await hover(page.getByLabel("Test (Markdown)"), { dx: 0.7, dy: 0.25 });
await sleep(2600);
await click(page.getByRole("tab", { name: "Preview" }));
await sleep(400);
await mark("preview", page.locator("section[aria-labelledby='editor-heading']"));
await sleep(2800);

// 7. Run
await scrollTo(0, 500);
await click(page.getByRole("button", { name: "Run test" }));
await mark("run");
await scrollTo(0, 900);
await page.getByRole("button", { name: "Stop run" }).waitFor({ timeout: 15000 }).catch(() => {});
await mark("running", page.locator("section[aria-labelledby='live-heading']"));
await moveTo(1520, 640, 900);
await page.getByRole("button", { name: "Run test" }).waitFor({ timeout: 180000 });
await mark("run-done", page.locator("section[aria-labelledby='live-heading']"));
await sleep(1500);
const progress = page.locator(`:is(table,[role=grid],[role=table])[aria-label="Run progress"]`);
await scrollToEl(progress, 120, 1300);
await mark("progress", progress);
await sleep(2600);

// 8. Versions
const versions = page.locator(`:is(table,[role=grid],[role=table])[aria-label="Versions"]`);
await scrollToEl(versions, 200, 1300);
await sleep(400);
await mark("versions", versions);
await hover(versions.getByRole("button").first());
await sleep(2200);

// 9. Run history → run detail
const hist = page.locator(`:is(table,[role=grid],[role=table])[aria-label="Run history"]`);
await scrollToEl(hist, 200, 1100);
await mark("history", hist);
await sleep(1200);
await click(hist.getByRole("row").nth(1).getByRole("link").or(hist.getByRole("row").nth(1).getByRole("button")).first());
await page.waitForURL(/\/runs\/[a-f0-9]{24}$/);
await settle();
await sleep(600);
await mark("detail");
await sleep(2200);
const steps = page.locator("section[aria-labelledby='steps-heading']");
await scrollToEl(steps, 80, 1500);
await mark("detail-steps");
await sleep(1800);
const total = await page.evaluate((sc) => { const c = eval(sc); return c.scrollHeight - c.clientHeight; }, SC);
await scrollTo(total, 7000);
await mark("detail-end");
await sleep(1500);

recording = false;
await loop;
await sleep(300);
writeFileSync(`${OUT}/frames.json`, JSON.stringify(frames));
writeFileSync(`${OUT}/marks.json`, JSON.stringify({ t0, testUrl, marks, mouse, clicks, scrolls, SLOW }));
console.log("frames", frames.length, "dur", (now() - t0).toFixed(1), testUrl);
await browser.close();
