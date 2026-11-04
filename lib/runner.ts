import { chromium } from "playwright";
import { col, ObjectId, type StepResult } from "./db";
import { decrypt } from "./crypto";
import { LIVE, publish, redis, runChannel, runStopKey } from "./redis";
import { runStep } from "./testdsl";
import { contextFor } from "./devices";
import { planRun, stepLabel } from "./plan";
import { isBlockedHost } from "./net";

// Each action (click, fill, wait for text, ...) gets 2s to find its target. Page loads (go to, wait for url)
// keep longer, since a cold page often takes more than 2s. After every step that passes the run pauses
// for a hidden second so the app can react (redirects, spinners, focus moves) before the next one.
const STEP_TIMEOUT_MS = 2_000;
const PAGE_LOAD_TIMEOUT_MS = 15_000;
const STEP_SETTLE_MS = 1_000;


/** Messages on run:<id>. The browser's live panel renders exactly these. */
export type RunMessage =
  | { t: "frame"; d: string }
  | { t: "step"; i: number; step: StepResult }
  | { t: "status"; status: string; error?: string; values?: Record<string, number> };

export async function runTest(runId: string) {
  const _id = new ObjectId(runId);
  const run = await col.runs.findOne({ _id });
  if (!run || run.status !== "queued") return;
  const [test, app] = await Promise.all([col.tests.findOne({ _id: run.testId }), col.apps.findOne({ _id: run.appId })]);
  const send = (m: RunMessage) => publish(runChannel(runId), m);
  const finish = async (status: "passed" | "failed" | "stopped", error?: string, values: Record<string, number> = {}) => {
    await col.runs.updateOne({ _id }, { $set: { status, error, values, finishedAt: new Date() } });
    await send({ t: "status", status, error, values });
    await publish(LIVE, { type: "run.finished", runId, status });
  };
  if (!test || !app) return finish("failed", "The test or its app was deleted.");

  // Includes the session test's steps first, so the browser is signed in before this test's own steps.
  const parsed = await planRun(test);
  if (parsed.error) return finish("failed", parsed.error);

  const steps: StepResult[] = parsed.steps.map((s) => ({ text: stepLabel(s), status: "pending" }));
  await col.runs.updateOne({ _id }, { $set: { status: "running", startedAt: new Date(), steps, device: parsed.device } });
  await send({ t: "status", status: "running" });

  const vars: Record<string, string> = { baseUrl: app.baseUrl };
  if (app.testLogin) {
    vars.email = app.testLogin.email;
    vars.password = decrypt(app.testLogin.password);
  }
  const values: Record<string, number> = {};
  const { options: profile, ...viewport } = contextFor(parsed.device);
  const browser = await chromium.launch();
  // Stop works mid-step: closing the browser makes the step in progress (e.g. a 30s wait) fail at once.
  // ponytail: polls Redis every 500ms per running test; switch to pub/sub if many runs go in parallel.
  let stopped = false;
  const watch = setInterval(() => {
    void redis.get(runStopKey(runId)).then((v) => {
      if (v && !stopped) {
        stopped = true;
        void browser.close().catch(() => {});
      }
    }, () => {});
  }, 500);
  const stopAt = async (i: number) => {
    for (let j = i; j < steps.length; j++) {
      if (j === i && steps[j].status === "passed") continue; // finished just before the stop landed
      const interrupted = j === i && steps[j].status !== "pending";
      steps[j] = { ...steps[j], status: "skipped", ...(interrupted ? { note: "Stopped during this step." } : {}) };
      await send({ t: "step", i: j, step: steps[j] });
    }
    await col.runs.updateOne({ _id }, { $set: { steps } });
    await finish("stopped", "Stopped by a user.", values);
  };
  let current = 0;
  try {
    const context = await browser.newContext(profile);
    context.setDefaultTimeout(STEP_TIMEOUT_MS);
    context.setDefaultNavigationTimeout(PAGE_LOAD_TIMEOUT_MS);
    const appHost = new URL(app.baseUrl).hostname;
    await context.route("**/*", (route) => {
      let host = "";
      try {
        host = new URL(route.request().url()).hostname;
      } catch {}
      return host && isBlockedHost(host, appHost) ? route.abort("blockedbyclient") : route.fallback();
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    cdp.on("Page.screencastFrame", ({ data, sessionId }) => {
      void send({ t: "frame", d: data });
      cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 60,
      maxWidth: viewport.width,
      maxHeight: viewport.height,
    });

    for (const [i, { step }] of parsed.steps.entries()) {
      current = i;
      if (stopped || (await redis.get(runStopKey(runId)))) return await stopAt(i);
      steps[i] = { ...steps[i], status: "running" };
      await send({ t: "step", i, step: steps[i] });
      const started = Date.now();
      let failed: string | null = null;
      try {
        steps[i].note = await runStep(page, step, { baseUrl: app.baseUrl, vars, values, hasTouch: !!profile.hasTouch });
        steps[i].status = "passed";
      } catch (e) {
        failed = (e instanceof Error ? e.message : String(e)).split("\n")[0];
        steps[i].status = "failed";
        steps[i].note = failed;
      }
      steps[i].ms = Date.now() - started;
      if (!failed && !stopped) await page.waitForTimeout(STEP_SETTLE_MS).catch(() => {}); // not counted in the step's time
      if (stopped) return await stopAt(i);
      steps[i].screenshot = await page
        .screenshot({ type: "jpeg", quality: 55, scale: "css" })
        .then((b) => b.toString("base64"))
        .catch(() => undefined);
      await col.runs.updateOne({ _id }, { $set: { [`steps.${i}`]: steps[i] } });
      await send({ t: "step", i, step: { ...steps[i], screenshot: undefined } });
      if (failed) {
        for (let j = i + 1; j < steps.length; j++) {
          steps[j].status = "skipped";
          await send({ t: "step", i: j, step: steps[j] }); // so the live table shows Skipped, not Waiting
        }
        await col.runs.updateOne({ _id }, { $set: { steps } });
        return await finish("failed", `Step ${i + 1} failed: ${failed}`, values);
      }
    }
    await finish("passed", undefined, values);
  } catch (e) {
    if (stopped) await stopAt(current);
    else await finish("failed", e instanceof Error ? e.message : String(e), values);
  } finally {
    clearInterval(watch);
    await browser.close().catch(() => {});
    await redis.del(runStopKey(runId));
  }
}
