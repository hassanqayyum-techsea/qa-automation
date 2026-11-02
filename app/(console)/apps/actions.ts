"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { z } from "zod";
import { audit, can, requirePermission } from "~/lib/auth";
import { col, ObjectId, oid, type App } from "~/lib/db";
import { decrypt, encrypt } from "~/lib/crypto";
import { queues, redis, runStopKey } from "~/lib/redis";
import { planRun, settingsOf, stepLabel } from "~/lib/plan";
import { DEVICE_NAMES } from "~/lib/devices";
import { DEFAULT_DEVICE, resolveDevice } from "~/lib/testdsl";
import { aiEnabled, generateTest } from "~/lib/ai";
import { fieldErrors, type ActionResult } from "~/lib/forms";

const appSchema = z.object({
  name: z.string().trim().min(1, "Give the app a name, e.g. AI Job Expert (dev).").max(80),
  baseUrl: z.url({ protocol: /^https?$/, message: "Enter the app's root URL, starting with https://" }),
  environment: z.enum(["dev", "staging", "production"], { message: "Pick dev, staging or production." }),
  loginEmail: z.union([z.literal(""), z.email("Enter a valid email for the test account, or leave it empty.")]),
  loginPassword: z.string().optional(),
});

/** Bind the app id for edits: saveApp.bind(null, id); bind null to create. */
export async function saveApp(appId: string | null, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("apps:manage");
  const parsed = appSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrors(parsed.error);
  const d = parsed.data;
  const existing = appId ? await col.apps.findOne({ _id: oid(appId) ?? undefined }) : null;
  if (appId && !existing) return { error: "That app was deleted. Reload the page." };

  let testLogin: App["testLogin"];
  if (d.loginEmail) {
    if (d.loginPassword) testLogin = { email: d.loginEmail, password: encrypt(d.loginPassword) };
    else if (existing?.testLogin) testLogin = { ...existing.testLogin, email: d.loginEmail }; // blank = keep the saved password
    else return { fieldErrors: { loginPassword: "Enter the test account's password." } };
  }
  const fields = { name: d.name, baseUrl: d.baseUrl.replace(/\/$/, ""), environment: d.environment };

  if (existing) {
    await col.apps.updateOne({ _id: existing._id }, testLogin ? { $set: { ...fields, testLogin } } : { $set: fields, $unset: { testLogin: "" } });
    await audit(user, "app.updated", d.name);
    refresh();
    return { ok: `${d.name} saved.` };
  }
  const _id = new ObjectId();
  await col.apps.insertOne({ _id, ...fields, ...(testLogin ? { testLogin } : {}), createdAt: new Date() });
  await audit(user, "app.created", d.name);
  redirect(`/apps/${_id}`);
}

export async function deleteApp(appId: string): Promise<ActionResult> {
  const user = await requirePermission("apps:manage");
  const _id = oid(appId);
  const app = _id && (await col.apps.findOne({ _id }));
  if (!app) return { error: "That app was already deleted." };
  const testIds = (await col.tests.find({ appId: app._id }, { projection: { _id: 1 } }).toArray()).map((t) => t._id);
  await Promise.all([
    col.runs.deleteMany({ appId: app._id }),
    col.versions.deleteMany({ testId: { $in: testIds } }),
    col.tests.deleteMany({ appId: app._id }),
    col.apps.deleteOne({ _id: app._id }),
  ]);
  await audit(user, "app.deleted", app.name);
  redirect("/apps");
}

const TEMPLATE = `# Sign in and look around
Steps are list items. Anything else, like this line, is a note for people.

- go to /login
- fill "Email address" with "{{email}}"
- fill "Password" with "{{password}}"
- tap "Sign in"
- wait for url /dashboard
- scroll to bottom
- count "a" as links
`;

/** Bind the app id: createTest.bind(null, appId). */
export async function createTest(appId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("tests:edit");
  const parsed = z
    .object({ name: z.string().trim().min(1, "Name the test, e.g. Login and search jobs.").max(120) })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrors(parsed.error);
  const app = await col.apps.findOne({ _id: oid(appId) ?? undefined });
  if (!app) return { error: "That app was deleted. Reload the page." };
  const _id = new ObjectId();
  await col.tests.insertOne({ _id, appId: app._id, name: parsed.data.name, markdown: TEMPLATE, device: DEFAULT_DEVICE, sessionTestId: null, updatedAt: new Date(), updatedBy: user.email });
  await audit(user, "test.created", `${app.name} / ${parsed.data.name}`);
  redirect(`/apps/${app._id}/tests/${_id}`);
}

export type TestDraft = { markdown: string; device: string; sessionTestId: string | null };
const MAX_VERSIONS = 30;

/** Snapshot a test state, skipping exact repeats of the newest one, and keep only the newest MAX_VERSIONS. */
async function recordVersion(
  testId: ObjectId,
  v: { markdown: string; device: string; sessionTestId: ObjectId | null },
  meta: { source: "saved" | "draft" | "ai"; by: string; prompt?: string },
) {
  const last = await col.versions.findOne({ testId }, { sort: { at: -1 } });
  const same = last && last.markdown === v.markdown && last.device === v.device && String(last.sessionTestId) === String(v.sessionTestId);
  if (same && meta.source !== "ai") return;
  await col.versions.insertOne({ _id: new ObjectId(), testId, ...v, ...meta, at: new Date() });
  const cutoff = await col.versions.find({ testId }).sort({ at: -1 }).skip(MAX_VERSIONS).limit(1).next();
  if (cutoff) await col.versions.deleteMany({ testId, at: { $lte: cutoff.at } });
}

/** Device and session checks shared by Save and Generate. */
async function checkDraft(test: { _id: ObjectId; appId: ObjectId }, draft: TestDraft) {
  if (draft.markdown.length > 50_000) return { error: "This test is over 50,000 characters. Split it into smaller tests." };
  const device = resolveDevice(draft.device, DEVICE_NAMES);
  if (!device) return { error: `Unknown device "${draft.device}". Pick one with the Device buttons.` };
  let sessionTestId: ObjectId | null = null;
  if (draft.sessionTestId) {
    sessionTestId = oid(draft.sessionTestId);
    const ok = sessionTestId && !sessionTestId.equals(test._id) && (await col.tests.countDocuments({ _id: sessionTestId, appId: test.appId }));
    if (!ok) return { error: "The test picked under Start signed in with no longer exists. Pick another one." };
  }
  return { value: { markdown: draft.markdown, device, sessionTestId } };
}

export async function saveTest(testId: string, draft: TestDraft): Promise<ActionResult> {
  const user = await requirePermission("tests:edit");
  const test = await col.tests.findOne({ _id: oid(testId) ?? undefined });
  if (!test) return { error: "That test was deleted. Copy your text before reloading." };
  const checked = await checkDraft(test, draft);
  if (!checked.value) return { error: checked.error };
  await col.tests.updateOne({ _id: test._id }, { $set: { ...checked.value, updatedAt: new Date(), updatedBy: user.email } });
  await recordVersion(test._id, checked.value, { source: "saved", by: user.email });
  refresh(); // the versions list
  return { ok: "Test saved." };
}

export async function deleteTest(testId: string): Promise<ActionResult> {
  const user = await requirePermission("tests:edit");
  const test = await col.tests.findOne({ _id: oid(testId) ?? undefined });
  if (!test) return { error: "That test was already deleted." };
  await Promise.all([
    col.runs.deleteMany({ testId: test._id }),
    col.versions.deleteMany({ testId: test._id }),
    col.tests.deleteOne({ _id: test._id }),
    col.tests.updateMany({ sessionTestId: test._id }, { $set: { sessionTestId: null } }), // tests that signed in with it start signed out
  ]);
  await audit(user, "test.deleted", test.name);
  redirect(`/apps/${test.appId}`);
}

/** Queues a run of the saved test. Returns the run id the live panel subscribes to. */
export async function startRun(testId: string): Promise<{ runId?: string; error?: string }> {
  const user = await requirePermission("tests:run");
  const test = await col.tests.findOne({ _id: oid(testId) ?? undefined });
  const app = test && (await col.apps.findOne({ _id: test.appId }));
  if (!test || !app) return { error: "That test or its app was deleted." };
  if (app.environment === "production" && !can(user, "tests:run-production")) {
    return { error: "Your role can't run tests against production apps. Ask an Owner for the production permission." };
  }
  const parsed = await planRun(test);
  if (parsed.error) return { error: `Fix the test first: ${parsed.error}` };

  const _id = new ObjectId();
  await col.runs.insertOne({
    _id,
    testId: test._id,
    appId: app._id,
    testName: test.name,
    device: parsed.device,
    status: "queued",
    steps: parsed.steps.map((s) => ({ text: stepLabel(s), status: "pending" })),
    values: {},
    createdAt: new Date(),
    by: user.email,
  });
  await queues.tests.add("run", { runId: _id.toString() });
  await audit(user, "test.run", `${app.name} / ${test.name}`, { environment: app.environment });
  return { runId: _id.toString() };
}

export async function stopRun(runId: string): Promise<ActionResult> {
  await requirePermission("tests:run");
  const _id = oid(runId);
  if (!_id) return { error: "Unknown run." };
  // A queued run never started a browser, so it can be closed right here.
  const queued = await col.runs.updateOne({ _id, status: "queued" }, { $set: { status: "stopped", error: "Stopped before it started.", finishedAt: new Date() } });
  if (!queued.modifiedCount) await redis.set(runStopKey(runId), "1", "EX", 600); // the runner polls this and closes the browser
  return { ok: "Stopping the run." };
}

/**
 * "Generate with AI": plain English in, an edited version of the editor's current test out. Nothing is saved;
 * the editor shows the result for review. Both the state before and the AI's answer are kept as versions.
 */
export async function generateSteps(
  testId: string,
  prompt: string,
  draft: TestDraft,
): Promise<{ markdown?: string; device?: string; sessionTestId?: string | null; warning?: string; error?: string }> {
  const user = await requirePermission("tests:edit");
  if (!aiEnabled()) return { error: "AI generation isn't set up. Add GROQ_API_KEY to the server's environment." };
  let text = prompt.trim();
  if (text.length < 10) return { error: "Describe the test in a sentence or two, e.g. log in, open Jobs and check at least one job shows." };
  if (text.length > 2000) return { error: "Keep the description under 2,000 characters." };
  const test = await col.tests.findOne({ _id: oid(testId) ?? undefined });
  const app = test && (await col.apps.findOne({ _id: test.appId }));
  if (!test || !app) return { error: "That test or its app was deleted." };
  const checked = await checkDraft(test, draft);
  if (!checked.value) return { error: checked.error };
  const before = checked.value;

  // The saved test account never goes to the AI service: its email and password become placeholders.
  const secrets: [string, string][] = app.testLogin
    ? [
        [decrypt(app.testLogin.password), "{{password}}"],
        [app.testLogin.email, "{{email}}"],
      ]
    : [];
  const scrub = (s: string) => secrets.reduce((acc, [secret, ph]) => (secret ? acc.split(secret).join(ph) : acc), s);
  text = scrub(text);

  const appTests = await col.tests.find({ appId: app._id }).sort({ updatedAt: -1 }).toArray();
  const others = appTests.filter((t) => !t._id.equals(test._id));
  const sessionName = before.sessionTestId ? others.find((t) => t._id.equals(before.sessionTestId!))?.name ?? null : null;
  try {
    const out = await generateTest({
      prompt: text,
      current: scrub(before.markdown),
      device: before.device,
      session: sessionName,
      baseUrl: app.baseUrl,
      hasTestAccount: !!app.testLogin,
      examples: others.slice(0, 3).map((t) => settingsOf(t, appTests).body),
      tests: others.map((t) => t.name),
    });
    const markdown = scrub(out.markdown);
    if (!markdown) return { error: "The AI returned nothing. Try describing the test differently." };
    const session = out.session ? others.find((t) => t.name.toLowerCase() === out.session!.toLowerCase()) : null;
    const after = { markdown, device: out.device ?? before.device, sessionTestId: session?._id ?? null };

    await recordVersion(test._id, before, { source: "draft", by: user.email });
    await recordVersion(test._id, after, { source: "ai", by: user.email, prompt: text.slice(0, 500) });
    refresh();

    const warnings = [...out.errors];
    if (out.session && !session) warnings.push(`There's no test named "${out.session}" to sign in with, so no session was set.`);
    if (/\bfill "[^"]*password[^"]*" (?:with|to) "(?!\{\{)[^"]+"/i.test(markdown)) {
      warnings.push("The test has a password typed into it. Save it as the app's test account and use {{password}} instead.");
    }
    return {
      markdown,
      device: after.device,
      sessionTestId: after.sessionTestId?.toString() ?? null,
      warning: warnings.length ? `Check these: ${warnings.join(" ")}` : undefined,
    };
  } catch (e) {
    return { error: `The AI service didn't answer (${e instanceof Error ? e.message : String(e)}). Try again in a minute.` };
  }
}
