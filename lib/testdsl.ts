// Structured Markdown test steps. Pure module (type-only imports) so `node --test` can run its check.
import type { Page } from "playwright";

export const DEFAULT_DEVICE = "iPhone 15";
/** Shorthands people write; each maps to a Playwright device name. */
const DEVICE_ALIASES: Record<string, string> = {
  phone: "iPhone 15",
  mobile: "iPhone 15",
  tablet: "iPad Pro 11",
  desktop: "Desktop Chrome",
  laptop: "Desktop Chrome",
};

/** "1366x768" is a desktop window; "390x844 mobile" is a touch phone. */
export function customSize(device: string) {
  const m = device.trim().match(/^(\d{3,4})\s*[x×]\s*(\d{3,4})(\s+mobile)?$/i);
  if (!m) return null;
  const width = Number(m[1]), height = Number(m[2]);
  if (width < 240 || height < 240 || width > 3840 || height > 2160 * 2) return null;
  return { width, height, mobile: !!m[3] };
}

/** How the live view frames a screen: inside the phone mockup only when the shape matches it. */
export const frameShape = (width: number, height: number, mobile: boolean) =>
  mobile && height / width >= 2 && height / width <= 2.3 ? "phone" : height > width ? "portrait" : "landscape";
export type FrameShape = ReturnType<typeof frameShape>;

/** Canonical device for what someone wrote: a known name (any case), a shorthand, or a size. Null if unknown. */
export function resolveDevice(want: string, names: readonly string[]) {
  const size = customSize(want);
  if (size) return `${size.width}x${size.height}${size.mobile ? " mobile" : ""}`;
  const name = (DEVICE_ALIASES[want.trim().toLowerCase()] ?? want).trim().toLowerCase();
  return names.find((n) => n.toLowerCase() === name) ?? null;
}

/**
 * Device and session are settings, not part of the Markdown. Older tests (and some AI answers) carry them as
 * `device: …` / `session: …` lines; this pulls those lines out so they can be moved into the settings.
 */
export function splitHeader(markdown: string): { body: string; device: string | null; session: string | null } {
  const res = { body: "", device: null as string | null, session: null as string | null };
  const body: string[] = [];
  for (const l of markdown.split(/\r?\n/)) {
    const m = l.trim().match(/^(device|session):\s*(.+)$/i);
    if (!m) body.push(l);
    else if (m[1].toLowerCase() === "device") res.device = m[2].trim();
    else res.session = m[2].trim();
  }
  res.body = body.join("\n");
  return res;
}

export type Step =
  | { kind: "goto"; url: string }
  | { kind: "click" | "tap"; target: string }
  | { kind: "fill"; target: string; value: string }
  | { kind: "press"; key: string }
  | { kind: "waitUrl"; fragment: string }
  | { kind: "waitText"; text: string }
  | { kind: "waitFor"; target: string }
  | { kind: "type"; text: string }
  | { kind: "scroll"; to: "top" | "bottom" }
  | { kind: "scrollBy"; px: number }
  | { kind: "count"; selector: string; name: string }
  | { kind: "expectAtLeast"; min: number; selector: string }
  | { kind: "wait"; ms: number };

export type ParsedStep = { line: number; text: string; step: Step };
export type ParseResult = { steps: ParsedStep[]; errors: { line: number; message: string }[] };

/** Shown next to the editor. Keep in sync with GRAMMAR below. */
export const STEP_HELP = [
  "go to /login  (a path on the app, or a full URL)",
  'click "Sign in"  (button, link, label, exact text, or a CSS selector like "#submit")',
  'tap "Menu"  (same as click, as a finger tap)',
  'fill "Email address" with "{{email}}"  (label, placeholder, or a CSS selector like "#email")',
  'type "000000"  (types into whatever is focused, e.g. one-box-per-digit OTP fields)',
  'press "Enter"',
  'wait for "OTP Code"  (until a field, button or text is on screen, up to 30s)',
  "wait for url /dashboard",
  'expect text "Welcome"',
  "scroll to bottom",
  "scroll to top",
  "scroll down 800",
  'count ".job-card" as jobs  (CSS selector, saved as a result)',
  'expect at least 1 ".job-card"',
  "wait 2s",
];

const q = '"([^"]*)"';
const GRAMMAR: [RegExp, (m: RegExpMatchArray) => Step][] = [
  [/^go to (\S+)$/i, (m) => ({ kind: "goto", url: m[1] })],
  [new RegExp(`^(click|tap) ${q}$`, "i"), (m) => ({ kind: m[1].toLowerCase() as "click" | "tap", target: m[2] })],
  [new RegExp(`^(?:fill|enter) ${q} (?:with|to) ${q}$`, "i"), (m) => ({ kind: "fill", target: m[1], value: m[2] })],
  [new RegExp(`^type ${q}$`, "i"), (m) => ({ kind: "type", text: m[1] })],
  [new RegExp(`^press ${q}$`, "i"), (m) => ({ kind: "press", key: m[1] })],
  [/^wait for url (\S+)$/i, (m) => ({ kind: "waitUrl", fragment: m[1] })],
  [new RegExp(`^(?:wait for|expect) text ${q}$`, "i"), (m) => ({ kind: "waitText", text: m[1] })],
  [new RegExp(`^wait for ${q}$`, "i"), (m) => ({ kind: "waitFor", target: m[1] })],
  [/^scroll to (top|bottom)$/i, (m) => ({ kind: "scroll", to: m[1].toLowerCase() as "top" | "bottom" })],
  [/^scroll (down|up) (\d+)$/i, (m) => ({ kind: "scrollBy", px: (m[1].toLowerCase() === "up" ? -1 : 1) * Number(m[2]) })],
  [new RegExp(`^count ${q} as (\\w+)$`, "i"), (m) => ({ kind: "count", selector: m[1], name: m[2] })],
  [new RegExp(`^expect at least (\\d+) ${q}$`, "i"), (m) => ({ kind: "expectAtLeast", min: Number(m[1]), selector: m[2] })],
  [/^wait (\d+(?:\.\d+)?)s$/i, (m) => ({ kind: "wait", ms: Math.min(Number(m[1]), 60) * 1000 })],
];

/**
 * List items (`- `, `* `, `1. `) are steps; everything else is free text for humans.
 * Device and session live in the test's settings, not here. Fenced code blocks are ignored.
 */
export function parseTest(markdown: string): ParseResult {
  const res: ParseResult = { steps: [], errors: [] };
  let inFence = false;
  markdown.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const s = raw.trim();
    if (s.startsWith("```")) return void (inFence = !inFence);
    if (inFence) return;
    const item = s.match(/^(?:[-*]|\d+\.)\s+(.+)$/);
    if (!item) return;
    const text = item[1].trim();
    for (const [re, build] of GRAMMAR) {
      const m = text.match(re);
      if (m) return void res.steps.push({ line, text, step: build(m) });
    }
    res.errors.push({
      line,
      message: `Line ${line}: "${text}" isn't a step this runner understands. Write notes as plain text, not list items, and put one step per line.`,
    });
  });
  if (!res.steps.length && !res.errors.length) res.errors.push({ line: 1, message: "Add at least one step as a list item, e.g. - go to /" });
  return res;
}

export const fillVars = (s: string, vars: Record<string, string>) =>
  s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? `{{${k}}}`);

/** Runs one step. Returns a short note for the results list (e.g. "jobs = 24"). */
export async function runStep(
  page: Page,
  step: Step,
  ctx: { baseUrl: string; vars: Record<string, string>; values: Record<string, number>; hasTouch: boolean },
): Promise<string> {
  const v = (s: string) => fillVars(s, ctx.vars);
  const isCss = (t: string) => /^[#.[]/.test(t);
  const find = (t: string) =>
    isCss(t)
      ? page.locator(t).first()
      : page
          .getByRole("button", { name: t })
          .or(page.getByRole("link", { name: t }))
          .or(page.getByLabel(t))
          .or(page.getByText(t, { exact: true }))
          .first();
  // Label, placeholder, or CSS. Also follows a visible <label for="…"> directly, because some pages
  // override the label with a broken aria-labelledby and the field ends up with no accessible name.
  const field = async (t: string) => {
    if (isCss(t)) return page.locator(t).first();
    let loc = page.getByLabel(t).or(page.getByPlaceholder(t));
    const forId = await page.locator("label", { hasText: t }).first().getAttribute("for", { timeout: 2000 }).catch(() => null);
    if (forId) loc = loc.or(page.locator(`[id="${forId.replace(/"/g, '\\"')}"]`));
    return loc.first();
  };
  switch (step.kind) {
    case "goto":
      await page.goto(new URL(v(step.url), ctx.baseUrl).toString(), { waitUntil: "domcontentloaded" });
      return page.url();
    case "click":
      await find(v(step.target)).click();
      return "";
    case "tap":
      // Desktop profiles have no touchscreen; a click is the closest equivalent there.
      await (ctx.hasTouch ? find(v(step.target)).tap() : find(v(step.target)).click());
      return "";
    case "fill":
      await (await field(v(step.target))).fill(v(step.value));
      return "";
    case "type":
      await page.keyboard.type(v(step.text), { delay: 60 });
      return "";
    case "waitFor": {
      const t = v(step.target);
      const target = isCss(t)
        ? page.locator(t)
        : page.getByLabel(t).or(page.getByPlaceholder(t)).or(page.getByRole("button", { name: t })).or(page.getByText(t));
      await target.first().waitFor({ state: "visible", timeout: 30_000 }); // screens behind a login or OTP can be slow
      return "";
    }
    case "press":
      await page.keyboard.press(step.key);
      return "";
    case "waitUrl":
      await page.waitForURL((u) => u.href.includes(v(step.fragment)));
      return page.url();
    case "waitText":
      await page.getByText(v(step.text)).first().waitFor({ state: "visible" });
      return "";
    case "scroll":
      await page.evaluate((to) => {
        const el = document.scrollingElement ?? document.documentElement;
        el.scrollTo({ top: to === "bottom" ? el.scrollHeight : 0 });
      }, step.to);
      await page.waitForTimeout(600); // let lazy-loaded content arrive
      return "";
    case "scrollBy":
      await page.evaluate((px) => (document.scrollingElement ?? document.documentElement).scrollBy({ top: px }), step.px);
      await page.waitForTimeout(400);
      return "";
    case "count": {
      const n = await page.locator(step.selector).count();
      ctx.values[step.name] = n;
      return `${step.name} = ${n}`;
    }
    case "expectAtLeast": {
      const n = await page.locator(step.selector).count();
      if (n < step.min) throw new Error(`Expected at least ${step.min} "${step.selector}", found ${n}`);
      return `found ${n}`;
    }
    case "wait":
      await page.waitForTimeout(step.ms);
      return "";
  }
}
