// End-to-end smoke test against a running app + worker (fresh database).
// Run: node e2e/smoke.mjs   (BASE_URL defaults to http://localhost:3000)
// Covers: owner setup, every active page, app + test creation, and a live test run.
import { chromium } from "playwright";
import { MongoClient } from "mongodb";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const mongo = new MongoClient(env.MONGODB_URI);
const db = mongo.db();
const step = (s) => console.log(`• ${s}`);

// Starts from an empty database (built-in roles are kept). Refuses anything but a local database.
if (!/127\.0\.0\.1|localhost/.test(env.MONGODB_URI)) throw new Error("smoke test only runs against a local MongoDB");
for (const c of ["users", "apps", "tests", "testRuns", "testVersions", "auditLog"]) {
  await db.collection(c).deleteMany({});
}

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));

try {
  step("owner setup");
  await page.goto(`${BASE}/login`);
  await page.getByRole("heading", { name: "Create the owner account" }).waitFor();
  await page.getByLabel("Your name").fill("Olivia Owner");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel(/^Password/).fill("correct horse battery");
  await page.getByRole("button", { name: "Create owner account" }).click();
  await page.waitForURL(`${BASE}/apps`);
  await page.getByRole("heading", { name: "Tests" }).waitFor();

  step("every page renders");
  for (const [path, heading] of [
    ["/apps", "Tests"],
    ["/settings/users", "Users"],
    ["/settings/roles", "Roles"],
    ["/settings/audit", "Audit log"],
  ]) {
    const res = await page.goto(`${BASE}${path}`);
    assert.equal(res.status(), 200, `${path} returned ${res.status()}`);
    await page.getByRole("heading", { level: 1, name: heading }).waitFor({ timeout: 15000 });
  }

  step("add app + test, run it live against app.aijobexpert.com");
  await page.goto(`${BASE}/apps`);
  await page.getByRole("button", { name: "Add app" }).first().click();
  await page.getByLabel("Name").fill("AI Job Expert (dev)");
  await page.getByLabel("Root URL").fill("https://app.aijobexpert.com");
  await page.getByRole("button", { name: "Add app", exact: true }).last().click();
  await page.waitForURL(/\/apps\/[a-f0-9]{24}$/);
  await page.getByRole("button", { name: "New test" }).first().click();
  await page.getByLabel("Test name").fill("Login screen loads");
  await page.getByRole("button", { name: "Create test" }).click();
  await page.waitForURL(/\/tests\//);
  await page.getByLabel("Test (Markdown)").fill(`# Login screen
- go to /
- wait for url /login
- fill "Email address" with "demo.user@example.com"
- fill "Password" with "not-a-real-password"
- tap "SHOW"
- count "input" as inputs
- expect at least 2 "input"`);
  await page.getByText("7 steps on iPhone 15.").waitFor();
  await page.getByRole("button", { name: "Run test" }).click();
  // Wait for the live screen to show a streamed frame, then for the run to pass.
  await page.waitForFunction(() => document.querySelector("image")?.getAttribute("xlink:href")?.startsWith("data:image/jpeg"), null, { timeout: 60000 });
  await page.getByRole("status").filter({ hasText: /Run passed/ }).waitFor({ timeout: 90000 }).catch(async () => {
    throw new Error(`run did not pass: ${await page.locator("main").innerText()}`);
  });
  const run = await db.collection("testRuns").findOne({}, { sort: { createdAt: -1 } });
  assert.equal(run.status, "passed");
  assert.equal(run.values.inputs >= 2, true, `inputs counted: ${run.values.inputs}`);
  assert.ok(run.steps.every((s) => s.screenshot), "every step has a screenshot");

  step("run detail page shows every step");
  await page.goto(`${BASE}/runs/${run._id}`);
  await page.getByRole("heading", { name: /7\. expect at least 2/ }).waitFor();

  const KNOWN = /Download the React DevTools/;
  assert.deepEqual(errors.filter((e) => !KNOWN.test(e)), [], "browser console errors");
  console.log("✔ smoke test passed");
} catch (e) {
  await page.screenshot({ path: new URL("./failure.png", import.meta.url).pathname, fullPage: true }).catch(() => {});
  console.error("✘", e.message, errors.length ? `\nconsole: ${errors.join("\n")}` : "");
  process.exitCode = 1;
} finally {
  await browser.close();
  await mongo.close();
}
