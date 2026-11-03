# QA Automation

Create, run, and review live browser tests for your apps.

- **Tests**: add an app (e.g. `https://app.aijobexpert.com`), write tests as Markdown steps, press Run and watch a real phone browser do it live.
- **RBAC**: built-in Owner / Admin / Viewer roles plus custom roles. Every page, action and stream checks permissions on the server.

## Run it locally

Needs Node 24, MongoDB and Redis running locally (`brew services start mongodb-community redis`).

```bash
export NPM_TOKEN=<GitHub token with read:packages>   # .npmrc reads it for the private Odyssey UI package
npm install
npx playwright install chromium
cp .env.example .env.local     # then fill SESSION_SECRET and ENCRYPTION_KEY (commands are in the file)
npm run dev                    # web app on http://localhost:3000
npm run worker                 # second terminal: browser test runs
```

Open http://localhost:3000. The first visit asks you to create the Owner account.

## Writing tests

Steps are Markdown list items. Everything else is notes for people. The editor has **Write** and **Preview** tabs; Preview numbers each step and flags lines the runner can't understand.

```md
# Sign in and count jobs

- go to /login
- fill "Email address" with "{{email}}"
- fill "Password" with "{{password}}"
- tap "Sign in"
- wait for url /dashboard
- scroll to bottom
- count ".job-card" as jobs
- expect at least 1 ".job-card"
```

Login with a one-time code (one box per digit), as used on AI Job Expert dev:

```md
- click "Sign in"
- wait for "We sent you an OTP"
- type "000000"
- click "Verify Code"
- wait for url /dashboard
```

**Devices.** Device is a setting of the test, not part of the Markdown. Pick it with the Device buttons (Phone, Tablet, Desktop, Custom size): any Playwright device, or your own size (a desktop window, or a touch phone). A `device: …` line pasted into the Markdown moves into the setting when you save.

**Start signed in.** Most screens need a session. Write the sign-in once as its own test (e.g. "Login with OTP"), then pick it under **Start signed in with** (also a setting, saved with the test). Each run first does that test's steps in the same browser (shown as `[Login with OTP] …` in the results), then this test's steps. Sessions can chain up to 3 tests deep.

`{{email}}` and `{{password}}` come from the app's saved test account. Put credentials there, never in the test text: tests and their run history are visible to everyone with `tests:view`.

**Generate with AI.** Describe the test in plain English and press **Generate steps**, or describe a change and press **Update test with AI**: Groq (`GROQ_API_KEY`, model `GROQ_MODEL`, default `openai/gpt-oss-120b`) gets the current test and settings and returns the edited test. It also sees the app's other tests as examples, so it learns your real labels; values typed into those are blanked. The saved test account's email and password are replaced by `{{email}}` / `{{password}}` before anything is sent, even if you type them into the description. The result goes through the same parser (one automatic retry if a line is invalid) and lands in the editor unsaved.

**Versions.** Every save and every AI edit (plus the state just before it) is kept, newest 30 per test. **Restore** puts a version back in the editor with its device and session; Save keeps it.

The full step list is shown under the editor (`lib/testdsl.ts`). Runs against production apps need the `tests:run-production` permission. Tests can't reach internal addresses (localhost, private networks, cloud metadata) apart from the app's own host.

## Checks

```bash
npm test          # unit checks: test-step parser, internal-host guard
npm run e2e       # end-to-end smoke test; needs dev server + worker running; wipes the LOCAL database first
npm run typecheck && npm run lint
```

## Layout

| Path | What |
| --- | --- |
| `app/(console)/` | Signed-in pages (tests, runs, users, roles, audit log) |
| `app/api/` | Live updates (SSE) and test-run streams |
| `lib/auth.ts` | Session cookie, `requirePermission()`, audit log |
| `lib/runner.ts`, `lib/testdsl.ts` | Playwright test runner and the Markdown step language |
| `lib/devices.ts`, `lib/plan.ts` | Device list and browser profiles; test settings and the run plan (session test steps first) |
| `worker/index.ts` | BullMQ browser-test worker |
