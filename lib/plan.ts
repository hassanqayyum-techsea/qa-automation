// A test's settings, and what a run will actually do: the session test's steps (and its session's) first, then its own.
import { col, type ObjectId, type Test } from "./db";
import { DEVICE_NAMES } from "./devices";
import { DEFAULT_DEVICE, parseTest, resolveDevice, splitHeader, type ParsedStep } from "./testdsl";

export type PlannedStep = ParsedStep & { from?: string };
export type RunPlan = { device: string; steps: PlannedStep[]; error: string | null };
type TestLike = Pick<Test, "_id" | "name" | "markdown" | "device" | "sessionTestId">;

const MAX_CHAIN = 3;

/**
 * Device, session and Markdown body of a test. Tests saved before device and session became settings
 * still have them as `device:` / `session:` lines; those are read here until the test is next saved.
 */
export function settingsOf(test: TestLike, appTests: Pick<Test, "_id" | "name">[]) {
  if (test.device !== undefined) return { body: test.markdown, device: test.device, sessionTestId: test.sessionTestId ?? null };
  const h = splitHeader(test.markdown);
  const session = h.session ? appTests.find((t) => t.name.toLowerCase() === h.session!.toLowerCase()) : undefined;
  return {
    body: h.body,
    device: (h.device && resolveDevice(h.device, DEVICE_NAMES)) || DEFAULT_DEVICE,
    sessionTestId: session?._id ?? null,
  };
}

export async function planRun(test: TestLike & { appId: ObjectId }): Promise<RunPlan> {
  const appTests = await col.tests.find({ appId: test.appId }).toArray();
  const main = settingsOf(test, appTests);
  const fail = (error: string): RunPlan => ({ device: main.device, steps: [], error });

  const parsed = parseTest(main.body);
  if (parsed.errors.length) return fail(parsed.errors.map((e) => e.message).join(" "));

  // Walk session → session → … and prepend each test's steps; the main test's device is used throughout.
  const steps: PlannedStep[] = [...parsed.steps];
  const seen = new Set([test._id.toString()]);
  for (let id = main.sessionTestId; id; ) {
    const setup = appTests.find((t) => t._id.equals(id!));
    if (!setup) return fail("The test this one signs in with was deleted. Pick another under Start signed in with.");
    if (seen.has(id.toString())) return fail(`The session tests sign in with each other in a loop ("${setup.name}").`);
    if (seen.size > MAX_CHAIN) return fail(`Sessions can chain at most ${MAX_CHAIN} tests deep.`);
    seen.add(id.toString());
    const s = settingsOf(setup, appTests);
    const p = parseTest(s.body);
    if (p.errors.length) return fail(`The session test "${setup.name}" has errors: ${p.errors[0].message}`);
    steps.unshift(...p.steps.map((st) => ({ ...st, from: setup.name })));
    id = s.sessionTestId;
  }
  return { device: main.device, steps, error: null };
}

/** The label a step gets in run results: setup steps say which test they came from. */
export const stepLabel = (s: PlannedStep) => (s.from ? `[${s.from}] ${s.text}` : s.text);
