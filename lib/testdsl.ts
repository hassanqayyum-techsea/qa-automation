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
const unquote = (v: string) => v.trim().replace(/^"(.*)"$/, "$1").trim();

export function splitHeader(markdown: string): { body: string; device: string | null; session: string | null } {
  const res = { body: "", device: null as string | null, session: null as string | null };
  const body: string[] = [];
  for (const l of markdown.split(/\r?\n/)) {
    const m = l.trim().match(/^(device|session):\s*(.+)$/i);
    if (!m) body.push(l);
    else if (m[1].toLowerCase() === "device") res.device = unquote(m[2]);
    else res.session = unquote(m[2]);
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
  'type "000000"  (types into the focused field, waiting for one to get focus; works with one-box-per-digit OTP fields)',
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

/**
 * A step target is CSS when it starts with #, . or [, or with a tag name followed by one of them
 * (input[name='email'], button.primary, div#app). Anything else is a label, placeholder or text.
 * ponytail: a label that itself looks like "word.word" or "word#x" is read as CSS; quote-free labels like that are rare.
 */
export const isCss = (t: string) => /^(?:[#.[]|[a-z][a-z0-9-]*[[#.])/i.test(t);

/**
 * "wait for url /dashboard": a path matches the URL's path only, so a redirect like /login?next=/dashboard
 * doesn't count. Add "?" to the step to match the query too; anything not starting with "/" matches the full URL.
 */
export const urlMatches = (u: URL, want: string) =>
  want.startsWith("/") ? (want.includes("?") ? u.pathname + u.search : u.pathname).includes(want) : u.href.includes(want);

/** Runs one step. Returns a short note for the results list (e.g. "jobs = 24"). */
export async function runStep(
  page: Page,
  step: Step,
  ctx: { baseUrl: string; vars: Record<string, string>; values: Record<string, number>; hasTouch: boolean },
): Promise<string> {
  const v = (s: string) => fillVars(s, ctx.vars);
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
  // Last resort: the first field after a label with that text, for labels whose `for` points at the
  // wrong id (e.g. for="email" on an input with id="field-:r1:"), which leaves the field unlabelled.
  const field = async (t: string) => {
    if (isCss(t)) return page.locator(t).first();
    const label = page.locator("label", { hasText: t }).first();
    let loc = page.getByLabel(t).or(page.getByPlaceholder(t));
    const forId = await label.getAttribute("for", { timeout: 2000 }).catch(() => null);
    if (forId) loc = loc.or(page.locator(`[id="${forId.replace(/"/g, '\\"')}"]`));
    loc = loc.or(label.locator("xpath=following::*[self::input or self::textarea or self::select][not(@type='hidden')][1]"));
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
    case "type": {
      // Typing only makes sense into a field. Wait for one to have focus (an OTP screen often focuses its first
      // box a moment after it shows); if none does, fail rather than "pass" by typing into a button or the page.
      const focusedField = () => {
        const e = document.activeElement as HTMLElement | null;
        if (!e) return false;
        if (e.isContentEditable || e.tagName === "TEXTAREA" || e.tagName === "IFRAME") return true; // iframes: can't look inside
        return e.tagName === "INPUT" && !["button", "submit", "reset", "checkbox", "radio", "hidden", "image", "file", "range", "color"].includes((e as HTMLInputElement).type);
      };
      const ready = await page.waitForFunction(focusedField).then(() => true, () => false);
      if (!ready) {
        const what = await page.evaluate(() => {
          const e = document.activeElement as HTMLElement | null;
          if (!e || e === document.body) return "nothing";
          const text = (e.innerText || e.getAttribute("aria-label") || "").trim().slice(0, 40);
          return `<${e.tagName.toLowerCase()}>${text ? ` "${text}"` : ""}`;
        });
        throw new Error(`No text field has focus to type into (focus is on ${what}). Wait for the field first, e.g. wait for "OTP Code", or tap it.`);
      }
      await page.keyboard.type(v(step.text), { delay: 60 });
      return "";
    }
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
    case "waitUrl": {
      const want = v(step.fragment);
      await page.waitForURL((u) => urlMatches(u, want));
      // Single-page apps often show the URL for a moment, then redirect (e.g. to /login when signed out),
      // so let the page settle and check again where it actually ended up.
      await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
      if (!urlMatches(new URL(page.url()), want)) throw new Error(`Ended up on ${page.url()}, not ${want}.`);
      return page.url();
    }
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
