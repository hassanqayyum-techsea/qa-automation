import "server-only";
import { STEP_HELP, parseTest, resolveDevice, splitHeader } from "./testdsl";
import { DEVICE_NAMES } from "./devices";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

export const aiEnabled = () => !!process.env.GROQ_API_KEY;

/** Example tests are sent to Groq; blank out literal values so typed-in passwords never leave the server. */
const redact = (md: string) => md.replace(/\b(with|to) "(?!\{\{)[^"]*"/gi, '$1 "…"');

const SYSTEM = `You write and edit browser tests for a test runner that only understands these steps, one per Markdown list item:
${STEP_HELP.map((s) => `- ${s}`).join("\n")}

Output format:
- Only the test as Markdown: a "# Title" line, optionally a "device: <name>" line and a "session: <test name>" line, then the steps as "- " list items. No code fences, no explanations.
- Anything that isn't a step must not be a list item. Exactly one step per list item.

Editing:
- You are given the current test. Apply the request to it and return the whole updated test. Keep steps and notes the request doesn't change.
- If the current test is the starter template or unrelated to the request, replace it completely.

Rules:
- Keep the description's order exactly. A wait mentioned between two actions (e.g. "sign in, wait 2s, then enter the code") becomes "wait 2s" between those two steps, never at the end.
- Read the description as a sequence even when it's written as notes or a list: credentials → sign in; then each "and …" in order.
- If the description says how to sign in (email, password, OTP, the sign-in screen), write those steps out and do not add a session line.
- Keep the current session line if it still applies; leaving it out removes the session.
- Add "session: <exact test name>" only when the description assumes an already signed-in user and doesn't describe signing in, and one of the listed tests is a sign-in flow.
- Write "device: <name>" only when the description asks for a device (a name like iPhone 15, Pixel 7, iPad Pro 11, Desktop Chrome, or a size like 1366x768).
- Use {{email}} and {{password}} for the saved test account. Never write a real password into the test.
- Use the exact visible text of buttons, links and field labels. Prefer names you see in the example tests.
- Never invent page text for "wait for", "expect text" or "click". Use only texts the description or the example tests give, copied exactly. If you don't know a screen's text, wait for its URL or a field label from the examples instead.
- To verify that a page opened, use "wait for url <path>".
- One-time codes in separate digit boxes: wait for the code screen's heading, then type "<code>", then click the submit button.
- After an action that changes page, add "wait for url <path>" or "wait for \"<text>\"" before checking things.`;

async function chat(messages: { role: "system" | "user" | "assistant"; content: string }[]) {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.2 }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Groq returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return (data.choices?.[0]?.message?.content ?? "").replace(/^```(?:markdown|md)?\s*|\s*```$/g, "").trim();
}

/**
 * Turns a plain-English request into runner steps, starting from the current test. If the answer has lines the
 * parser rejects, the errors go back to the model once for a fix; whatever still fails is returned to the user.
 */
export async function generateTest(input: {
  prompt: string;
  current: string;
  device: string;
  session: string | null;
  baseUrl: string;
  hasTestAccount: boolean;
  examples: string[];
  tests: string[];
}) {
  const context = [
    `The app under test: ${input.baseUrl}. Paths like /login are relative to it.`,
    input.hasTestAccount ? "A test account is saved: use {{email}} and {{password}}." : "No test account is saved for this app.",
    input.examples.length
      ? `Other tests for this app (real labels; values hidden):\n\n${input.examples.map(redact).join("\n\n---\n\n")}`
      : "There are no other tests for this app yet, so guess labels from common wording.",
    input.tests.length ? `Tests that can be used as "session:": ${input.tests.map((t) => `"${t}"`).join(", ")}` : "",
    `Current settings: device ${input.device}; ${input.session ? `session "${input.session}"` : "no session"}.`,
    `Current test:\n\n${input.current}`,
    `Request:\n${input.prompt}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const messages: Parameters<typeof chat>[0] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: context },
  ];
  let answer = splitHeader(await chat(messages));
  let parsed = parseTest(answer.body);
  if (parsed.errors.length) {
    messages.push({ role: "assistant", content: answer.body });
    messages.push({
      role: "user",
      content: `The runner rejected these lines:\n${parsed.errors.map((e) => `- ${e.message}`).join("\n")}\nRewrite the whole test using only the allowed steps.`,
    });
    answer = splitHeader(await chat(messages));
    parsed = parseTest(answer.body);
  }
  return {
    markdown: answer.body.trim(),
    device: answer.device ? resolveDevice(answer.device, DEVICE_NAMES) : null,
    session: answer.session,
    errors: parsed.errors.map((e) => e.message),
  };
}
