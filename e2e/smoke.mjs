// End-to-end smoke test against a running app + worker (fresh database).
// Run: node e2e/smoke.mjs   (BASE_URL defaults to http://localhost:3000)
// Covers: owner setup, every page renders, app + test creation, a live test run against
// https://app.aijobexpert.com, and a signed webhook reaching the hook function.
import { chromium } from "playwright";
import { MongoClient, ObjectId } from "mongodb";
import { createHmac, createCipheriv, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const mongo = new MongoClient(env.MONGODB_URI);
const db = mongo.db();
const encrypt = (plain) => {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", Buffer.from(env.ENCRYPTION_KEY, "base64"), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
};
const step = (s) => console.log(`• ${s}`);

// Starts from an empty database (built-in roles are kept). Refuses anything but a local database.
if (!/127\.0\.0\.1|localhost/.test(env.MONGODB_URI)) throw new Error("smoke test only runs against a local MongoDB");
for (const c of ["users", "orgs", "repos", "contributors", "commits", "pullRequests", "hookEvents", "apps", "tests", "testRuns", "testVersions", "auditLog"]) {
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
  await page.waitForURL(`${BASE}/`);
  await page.getByRole("heading", { name: "Dashboard" }).waitFor();

  step("seed analytics data (org, repo, commits, PRs)");
  const orgId = new ObjectId();
  const repoId = new ObjectId();
  const webhookSecret = "test-secret-123";
  await db.collection("orgs").insertOne({
    _id: orgId, ghId: 999001, login: "acme-inc", token: encrypt("ghp_fake"), tokenScopes: null,
    webhookSecret: encrypt(webhookSecret), enabled: true, hidden: false, createdAt: new Date(), lastSyncAt: new Date(),
  });
  await db.collection("repos").insertOne({
    _id: repoId, ghId: 999101, orgId, name: "web", fullName: "acme-inc/web", isPrivate: true, isArchived: false,
    defaultBranch: "main", enabled: true, hidden: false, lastSyncAt: new Date(),
  });
  await db.collection("contributors").insertMany([
    { _id: "gh:1", login: "ana", name: "Ana Lima", emails: ["ana@acme.test"] },
    { _id: "email:bo@acme.test", name: "Bo", emails: ["bo@acme.test"] },
  ]);
  const day = (n) => new Date(Date.now() - n * 864e5);
  await db.collection("commits").insertMany([
    { repoId, sha: "a1", contributorId: "gh:1", committedAt: day(1), additions: 120, deletions: 30, isMerge: false, message: "Add search", url: "https://github.com" },
    { repoId, sha: "a2", contributorId: "gh:1", committedAt: day(3), additions: 40, deletions: 10, isMerge: false, message: "Fix filters", url: "https://github.com" },
    { repoId, sha: "a3", contributorId: "email:bo@acme.test", committedAt: day(2), additions: 15, deletions: 5, isMerge: false, message: "Copy tweaks", url: "https://github.com" },
    { repoId, sha: "m1", contributorId: "gh:1", committedAt: day(2), additions: 999, deletions: 999, isMerge: true, message: "Merge branch", url: "https://github.com" },
  ]);
  await db.collection("pullRequests").insertOne({
    repoId, number: 7, title: "Search page", contributorId: "gh:1", state: "MERGED", createdAt: day(4), updatedAt: day(1),
    mergedAt: day(1), additions: 160, deletions: 40, commitCount: 2, url: "https://github.com",
  });

  step("dashboard shows totals without merge commits");
  await page.reload();
  await page.getByText("Top performers").waitFor();
  const lines = await page.getByRole("group", { name: /Lines added/ }).innerText();
  assert.match(lines, /175/, `lines added should be 120+40+15=175, merge excluded. Got: ${lines}`);
  await page.getByRole("row", { name: /Ana Lima/ }).waitFor();

  step("every page renders");
  for (const [path, heading] of [
    ["/contributors", "Contributors"],
    ["/contributors/gh%3A1", "Ana Lima"],
    ["/repos", "Repositories"],
    ["/hooks", "Webhooks"],
    ["/apps", "Tests"],
    ["/settings/users", "Users"],
    ["/settings/roles", "Roles"],
    ["/settings/audit", "Audit log"],
  ]) {
    const res = await page.goto(`${BASE}${path}`);
    assert.equal(res.status(), 200, `${path} returned ${res.status()}`);
    await page.getByRole("heading", { level: 1, name: heading }).waitFor({ timeout: 15000 });
  }

  step("signed webhook runs the hook once (duplicate delivery ignored)");
  const body = JSON.stringify({
    ref: "refs/heads/main", commits: [{}, {}], pusher: { name: "ana" },
    organization: { id: 999001 }, repository: { id: 999101, full_name: "acme-inc/web", owner: { id: 999001 } },
  });
  const sig = "sha256=" + createHmac("sha256", webhookSecret).update(body).digest("hex");
  const post = (s) => fetch(`${BASE}/api/webhooks/github`, {
    method: "POST", body,
    headers: { "content-type": "application/json", "x-github-event": "push", "x-github-delivery": "delivery-1", "x-hub-signature-256": s },
  });
  assert.equal((await post("sha256=bad")).status, 401, "bad signature must be rejected");
  assert.equal((await post(sig)).status, 202);
  assert.equal((await post(sig)).status, 200, "redelivery should be acknowledged, not re-run");
  let ev;
  for (let i = 0; i < 20 && ev?.status !== "done"; i++) {
    await new Promise((r) => setTimeout(r, 500));
    ev = await db.collection("hookEvents").findOne({ deliveryId: "delivery-1" });
  }
  assert.equal(ev?.status, "done", "worker should have run the hook");
  await page.goto(`${BASE}/hooks`);
  await page.getByText("ana pushed 2 commit(s) to main in acme-inc/web").waitFor();

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
