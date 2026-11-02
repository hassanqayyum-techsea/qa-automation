// Run: node --test lib/testdsl.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { customSize, fillVars, frameShape, parseTest, resolveDevice, splitHeader } from "./testdsl.ts";

test("parses every step form and ignores prose, header lines and code fences", () => {
  const r = parseTest(`# Login and count jobs
device: Pixel 7
Some notes for humans.
- go to /login
- fill "Email address" with "{{email}}"
* tap "Sign in"
1. wait for url /dashboard
- scroll to bottom
- scroll up 300
- count ".job-card" as jobs
- expect at least 1 ".job-card"
- expect text "Welcome"
- press "Enter"
- wait 1.5s
- enter "OTP Code" to "000000"
- type "000000"
- wait for "OTP Code"
\`\`\`
- this is not a step
\`\`\``);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(
    r.steps.map((s) => s.step),
    [
      { kind: "goto", url: "/login" },
      { kind: "fill", target: "Email address", value: "{{email}}" },
      { kind: "tap", target: "Sign in" },
      { kind: "waitUrl", fragment: "/dashboard" },
      { kind: "scroll", to: "bottom" },
      { kind: "scrollBy", px: -300 },
      { kind: "count", selector: ".job-card", name: "jobs" },
      { kind: "expectAtLeast", min: 1, selector: ".job-card" },
      { kind: "waitText", text: "Welcome" },
      { kind: "press", key: "Enter" },
      { kind: "wait", ms: 1500 },
      { kind: "fill", target: "OTP Code", value: "000000" },
      { kind: "type", text: "000000" },
      { kind: "waitFor", target: "OTP Code" },
    ],
  );
  assert.equal(r.steps[0].line, 4);
});

test("reports unknown steps with line numbers", () => {
  const r = parseTest("device: Nokia\n- go to /\n- dance wildly");
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].line, 3);
});

test("empty test is an error; vars substitute and unknown vars stay visible", () => {
  assert.equal(parseTest("just prose").errors.length, 1);
  assert.equal(fillVars("{{email}} / {{nope}}", { email: "a@b.c" }), "a@b.c / {{nope}}");
});

test("devices: known names, shorthands and custom sizes", () => {
  const names = ["iPhone 15", "Desktop Chrome", "iPad Pro 11"];
  assert.equal(resolveDevice("desktop chrome", names), "Desktop Chrome");
  assert.equal(resolveDevice("Desktop", names), "Desktop Chrome");
  assert.equal(resolveDevice("1366 x 768", names), "1366x768");
  assert.equal(resolveDevice("390x844 Mobile", names), "390x844 mobile");
  assert.equal(resolveDevice("10x10", names), null);
  assert.equal(resolveDevice("Nokia", names), null);
  assert.deepEqual(customSize("1280x720"), { width: 1280, height: 720, mobile: false });
  assert.equal(frameShape(393, 852, true), "phone");
  assert.equal(frameShape(834, 1194, true), "portrait");
  assert.equal(frameShape(1280, 720, false), "landscape");
});

test("splitHeader moves device and session lines out of the Markdown", () => {
  assert.deepEqual(splitHeader("# T\ndevice: iPhone 15\nsession: Login\n- go to /"), { body: "# T\n- go to /", device: "iPhone 15", session: "Login" });
  assert.deepEqual(splitHeader("- go to /"), { body: "- go to /", device: null, session: null });
});
