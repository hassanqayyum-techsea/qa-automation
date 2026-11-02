# Repo Pulse — complete rebuild plan

> **For the AI agent reading this (Claude, Cursor, or similar):** this document specifies an existing,
> working application exactly. Rebuild it **as specified**: same stack, same data model, same rules, same
> screens and same wording. Do not substitute libraries, rename things, or add features. Build in the
> phase order in §21. Each phase ends with checks; don't start the next phase until they pass.
> Appendix A holds the verbatim source of the core modules (copy those files exactly) and Appendix B the
> verbatim source of the test editor UI. Everything else is specified in prose precisely enough to write.
> When this document and your training data disagree about Next.js, this document wins (see §19).

---

## 1. What the product is

Repo Pulse is an internal web console with two halves, behind one role-based access control (RBAC) system:

1. **GitHub analytics (read-only).** An Owner connects GitHub organizations with a **read-only token**. The
   system syncs repositories, commits on each repo's default branch, and pull requests. People with access
   see, for any time period: commits, pull requests opened/merged, lines added/removed per person, per
   commit and per PR, a **Top performers** leaderboard, and per-person activity. Orgs and repos can be
   turned on/off (synced or not) and **hidden** (kept syncing but left out of dashboards for people without
   the hidden permission).
2. **Webhook hook.** Every `push` and `pull_request` webhook from a connected org runs a placeholder
   function `runHook()` in a background worker (a dummy `console.log` for now), with exactly-once handling
   per delivery and a live events list.
3. **Live browser tests.** An admin adds an **app under test** (a root URL such as
   `https://app.aijobexpert.com`, an environment dev/staging/production, and an optional saved test account).
   People write **tests as Markdown steps** (or generate/edit them with AI from a plain-English prompt), pick a
   **device** (any Playwright phone/tablet/desktop or a custom size), optionally **start signed in** by running
   another test (e.g. a login flow) first, press **Run**, and **watch the real browser live** (streamed
   frames) with step-by-step progress, a Stop button, run history with a screenshot per step, and a version
   history of the test with Restore.

Everything updates live (Server-Sent Events over Redis pub/sub): syncs finishing, webhooks firing, runs
finishing, and test frames.

**Non-goals (do not build):** writing anything to GitHub; creating webhooks automatically (a read-only token
can't); email invites/password-reset emails; multi-tenant orgs; iframes of the app under test (the browser
runs on the server and is streamed instead).

---

## 2. Stack and exact versions

| Concern | Choice |
| --- | --- |
| Runtime | Node 24 (ESM project: `"type": "module"` in package.json; required because Octokit is ESM-only) |
| Web framework | **Next.js 16.4.3** App Router, React 19.3.0, TypeScript 5, Turbopack |
| UI | **Odyssey UI** `@your-job-search-genius/odyssey-ui@^2.4.1` (private package on GitHub Packages) + `react-aria-components@^1.22.1`, Tailwind CSS v4 via `@tailwindcss/turbopack` |
| Database | MongoDB (official `mongodb@^7.8.0` driver, no ODM) |
| Cache / queues / pub-sub | Redis via `ioredis@^6`, queues via `bullmq@^6.5.3` |
| Auth | Own email+password: scrypt hashes, `jose@^6` HS256 JWT in an httpOnly cookie |
| Validation | `zod@^4.6.7` |
| GitHub | `octokit@^5.0.5` (REST + GraphQL), wrapped read-only |
| Browser automation | `playwright@^1.64.1`, Chromium only, CDP screencast |
| AI | Groq OpenAI-compatible chat completions API, model `openai/gpt-oss-120b` (env `GROQ_MODEL` overrides), plain `fetch` (no SDK) |
| Worker runner | `tsx@^4` (dev dependency) |
| Tests | Node's built-in `node --test` with TypeScript type stripping; an end-to-end smoke script using Playwright |

Exact `package.json`, `next.config.ts`, `tsconfig.json`, `.npmrc`, `.env.example` are in Appendix A.

**Odyssey UI access.** The project `.npmrc` contains only the registry line
`@your-job-search-genius:registry=https://npm.pkg.github.com`. The developer's `~/.npmrc` must hold
`//npm.pkg.github.com/:_authToken=<GitHub token with read:packages>`. Never commit a token. If the Odyssey
MCP server ("yjsg-mcp") is available, follow its workflow for every UI change: `get_rules` →
`plan_ui_task` → discover components (`list_components` / `search_components` / `get_component`) → build
→ `validate_jsx` → typecheck → completion record (`docs/ui-completion-record.md`).

---

## 3. Architecture

```
                 ┌──────────────────────────── Browser ────────────────────────────┐
                 │  Console pages (RSC + client islands)   EventSource /api/live      │
                 │  Test editor: EventSource /api/runs/:id/stream (frames + steps)   │
                 └──────────────┬───────────────────────────────▲──────────────────┘
                     HTTP, server actions                     SSE
┌───────────────────────────────▼───────────────────────────────┴──────────────────┐
│  Next.js 16 web process (`next dev` / `next start`)                               │
│  proxy.ts (cookie present?) → pages / server actions → lib/auth requirePermission │
│  /api/webhooks/github  (HMAC verify → insert hookEvent → enqueue)                │
│  /api/live, /api/runs/:id/stream  (Redis subscribe → SSE)                        │
└──────┬─────────────────────────────┬─────────────────────────────▲──────────────┘
       │ read/write                  │ enqueue (BullMQ)            │ subscribe
┌──────▼──────┐               ┌──────▼──────────────────────────────┴──────┐
│  MongoDB    │◄──────────────│  Redis: queues sync/hooks/tests, pub/sub   │
│  (all data) │   read/write  │  channels "live" and "run:<id>", stop keys │
└──────▲──────┘               └──────▲───────────────────────────┬─────────┘
       │                             │ jobs                      │ publish
┌──────┴─────────────────────────────┴───────────────────────────▼─────────┐
│  Worker process (`npm run worker` = tsx worker/index.ts)                  │
│  sync worker (concurrency 1) → GitHub (read-only Octokit, GraphQL)        │
│  hooks worker (concurrency 5) → runHook(event)                            │
│  tests worker (concurrency 2) → Playwright Chromium → CDP screencast      │
│  scheduler: sync all enabled orgs every 15 min                            │
└───────────────────────────────────────────────────────────────────────────┘
```

**Four flows:**

1. **Sync.** "Connect organization" (or the 15-min scheduler, or "Sync now", or re-enabling) enqueues a
   `sync` job → worker `syncOrg()` lists repos (REST), then per enabled repo pulls new commits and updated
   PRs (GraphQL) with bulk upserts → publishes `{type:"sync.done"}` on `live` → open pages refresh.
2. **Webhook.** GitHub POSTs `/api/webhooks/github` → find org by owner id → verify `X-Hub-Signature-256`
   with that org's secret → accept only `push`/`pull_request` → insert `hookEvents` doc (unique
   `deliveryId`, so redeliveries are acknowledged and not re-run) → enqueue `hooks` job (3 attempts,
   exponential backoff 5s) → reply 202 within GitHub's 10s → worker runs `runHook()` → marks done/failed →
   publishes `hook.fired`.
3. **Test run.** Run button → server action saves, validates and builds the run plan, inserts a `testRuns`
   doc (`queued`) and enqueues a `tests` job → worker launches Chromium with the device profile, starts a CDP
   screencast, runs each step, publishes frames/step updates/status on `run:<id>` → the editor's
   EventSource shows them live.
4. **Live refresh.** Every console page mounts `<LiveRefresh/>`, an EventSource on `/api/live`; any event
   triggers a debounced (800 ms) `router.refresh()`. Events carry no data beyond "something changed"; the
   re-render re-checks permissions.

---

## 4. Repository layout

```
.
├── AGENTS.md                      # written by `next dev` (agent docs pointer); commit it, don't edit
├── README.md
├── package.json  next.config.ts  tsconfig.json  eslint.config.mjs  .npmrc  .env.example  .gitignore
├── proxy.ts                       # Next 16 "proxy" (formerly middleware): cookie-present redirect
├── lib/
│   ├── env.ts                     # zod-validated env
│   ├── permissions.ts             # 14 permissions + built-in roles (pure, client-safe)
│   ├── crypto.ts                  # AES-256-GCM, scrypt, GitHub HMAC, random secrets
│   ├── db.ts                      # Mongo client, typed collections, indexes + role seeding (dbReady)
│   ├── redis.ts                   # ioredis client, BullMQ queues, channels, publish/subscribe
│   ├── auth.ts                    # session cookie, getUser, requireUser, requirePermission, can, audit
│   ├── forms.ts                   # ActionResult type, zod → field errors
│   ├── github.ts                  # read-only Octokit, token check, incremental org/repo sync
│   ├── analytics.ts               # ranges, visibility rule, overview, leaderboard, contributor activity
│   ├── sse.ts                     # Redis channel → SSE response (subscribe-then-snapshot)
│   ├── net.ts  net.test.ts        # internal-host guard for test browsers
│   ├── testdsl.ts  testdsl.test.ts# Markdown step language: parser, devices helpers, step executor
│   ├── devices.ts                 # Playwright device list → picker data + browser context options
│   ├── plan.ts                    # test settings (device/session) + run plan with session chaining
│   ├── runner.ts                  # Playwright run loop, screencast, screenshots, stop
│   └── ai.ts                      # Groq generation/editing of tests
├── worker/index.ts                # BullMQ workers, scheduler, runHook placeholder, graceful shutdown
├── app/
│   ├── layout.tsx  providers.tsx  globals.css  forbidden.tsx
│   ├── login/        page.tsx  login-form.tsx  actions.ts
│   ├── ui/           action-form.tsx  dialogs.tsx  empty.tsx  page-header.tsx
│   ├── api/
│   │   ├── live/route.ts
│   │   ├── runs/[id]/stream/route.ts
│   │   └── webhooks/github/route.ts
│   └── (console)/                 # every signed-in page
│       ├── layout.tsx  shell.tsx  live-refresh.tsx  range-control.tsx  charts.tsx  leaderboard-table.tsx
│       ├── page.tsx                               # Dashboard  "/"
│       ├── contributors/page.tsx                  # "/contributors"
│       ├── contributors/[id]/page.tsx  activity-tables.tsx
│       ├── repos/page.tsx  org-card.tsx  actions.ts
│       ├── hooks/page.tsx  hooks-view.tsx
│       ├── apps/page.tsx  app-ui.tsx  actions.ts  device-screen.tsx
│       ├── apps/[appId]/page.tsx  tests-table.tsx
│       ├── apps/[appId]/tests/[testId]/page.tsx  workbench.tsx  run-setup.tsx  test-preview.tsx
│       ├── runs/[runId]/page.tsx  run-view.tsx
│       └── settings/actions.ts  settings-ui.tsx  users/page.tsx  roles/page.tsx  audit/page.tsx  audit/audit-table.tsx
├── e2e/smoke.mjs                  # end-to-end smoke test (wipes the LOCAL db)
└── docs/ui-completion-record.md   # Odyssey rule-by-rule completion record
```

Import aliases (tsconfig `paths`): `@/*` → `./node_modules/@your-job-search-genius/odyssey-ui/*` (Odyssey
ships TS source that imports its own internals through `@/`), and `~/*` → `./*` for the app's own code.
**App code must import Odyssey by its package path** (e.g.
`@your-job-search-genius/odyssey-ui/components/base/buttons/button`), never `@/…`.

---

## 5. Configuration

**Environment (`.env.local`, validated in `lib/env.ts`):**

| Variable | Rule | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | default `mongodb://127.0.0.1:27017/repo-pulse` | database |
| `REDIS_URL` | default `redis://127.0.0.1:6379` | queues, pub/sub, rate limits, stop keys |
| `SESSION_SECRET` | ≥ 32 chars (`openssl rand -base64 48`) | JWT signing key |
| `ENCRYPTION_KEY` | exactly 32 bytes base64 (`openssl rand -base64 32`) | encrypts GitHub tokens, webhook secrets, test-account passwords; never rotate without re-encrypting |
| `APP_URL` | URL, default `http://localhost:3000` | shown as the webhook payload URL |
| `GROQ_API_KEY` | optional, server-only (read from `process.env`, not in the zod schema) | enables "Generate with AI" |
| `GROQ_MODEL` | optional, default `openai/gpt-oss-120b` | AI model |

**Scripts:** `dev` (`next dev`), `build`, `start`, `lint` (`eslint`), `worker`
(`tsx --env-file=.env.local worker/index.ts`), `test` (`node --test lib/*.test.ts`), `typecheck`
(`tsc --noEmit`), `e2e` (`node e2e/smoke.mjs`).

**next.config.ts** (exact file in Appendix A): `experimental.authInterrupts: true` (enables `forbidden()`),
`experimental.optimizePackageImports: ["@your-job-search-genius/odyssey-ui"]` (the icon barrel re-exports
~1,000 icons; without it dev pages load all of them and hang), `experimental.instantInsights:
{ validationLevel: "manual-warning" }`, `experimental.agentFeedback: true`, `cacheComponents: true`,
`partialPrefetching: true`, `transpilePackages: [odyssey]`, and a Turbopack rule running `*.css` through
`@tailwindcss/turbopack`. `app/globals.css` is one line:
`@import "@your-job-search-genius/odyssey-ui/styles/globals.css";`.

**Local run:** `brew services start mongodb-community redis`; `npm install`; `npx playwright install
chromium`; `cp .env.example .env.local` and fill secrets; `npm run dev` (terminal 1); `npm run worker`
(terminal 2). The worker is a separate long-running process; **restart it after changing any file it imports**
(`lib/runner.ts`, `lib/plan.ts`, `lib/testdsl.ts`, `lib/devices.ts`, `lib/github.ts`, `worker/index.ts`) —
tsx does not hot-reload. Make sure only one worker runs.

---

## 6. Security model

### 6.1 Permissions (exact keys and descriptions)

| Key | Description (shown in the role editor) |
| --- | --- |
| `analytics:view` | See dashboards, contributors and the leaderboard for visible repos |
| `hidden:view` | See hidden orgs and repos and include them in totals |
| `scope:manage` | Enable, disable or hide orgs and repos |
| `sync:run` | Start a sync and see sync errors |
| `hooks:view` | See webhook events and webhook secrets |
| `token:manage` | Add, replace or remove GitHub tokens |
| `users:manage` | Create users, reset passwords, assign roles |
| `roles:manage` | Create and edit roles |
| `audit:view` | Read the audit log |
| `apps:manage` | Add and edit apps under test and their test logins |
| `tests:view` | See tests and run results |
| `tests:edit` | Create and edit tests |
| `tests:run` | Run tests against dev and staging apps |
| `tests:run-production` | Run tests against production apps |

**Built-in roles** (seeded and re-synced on every boot by `dbReady()`; cannot be edited or deleted):
**Owner** = all 14; **Admin** = all except `token:manage`, `users:manage`, `roles:manage`; **Viewer** =
`analytics:view`, `tests:view`. Custom roles: any non-empty subset, unique name ≤ 40 chars.

### 6.2 Enforcement rules

- `proxy.ts` only does an optimistic redirect to `/login` when the `session` cookie is missing. Its matcher
  excludes `login`, `api/webhooks`, `_next/`, `favicon.ico`. It is **not** authorization.
- **Every** page, server action and API route calls `requirePermission(p)` (or `getUser()` for the SSE
  routes) on the server. `getUser()` is `React.cache`d per request, calls `await connection()` first (forces
  request-time rendering under Cache Components), verifies the JWT, then **loads the user and role from
  Mongo on every request** — so disabling a user or editing a role takes effect on the next click.
- A missing permission calls `forbidden()` → `app/forbidden.tsx` (403 page). No session → redirect `/login`.
- The sidebar hides destinations the user can't use (hidden, not disabled), purely cosmetic.
- Server Components never pass secrets to the browser: GitHub tokens are never sent; the saved test-account
  password is never sent (the edit form says "Leave empty to keep the saved password"). Webhook secrets are
  shown only on the Webhooks page to `hooks:view`.

### 6.3 Authentication

- Passwords: scrypt (16-byte salt, 64-byte key), stored `base64(salt).base64(hash)`, compared with
  `timingSafeEqual`.
- Session: HS256 JWT `{sub:userId}`, 7-day expiry, cookie `session` (httpOnly, sameSite lax, secure in
  production, path `/`).
- Login rate limit: Redis counter `login:<email>`, max **10 attempts per 15 minutes per email**, cleared on
  success. One generic error for unknown email / wrong password / disabled account:
  "That email and password don't match an active account. Check both and try again."
- **First run:** while the users collection is empty, `/login` shows "Create the owner account" instead of
  sign-in; that form creates the Owner and signs them in.
- **Lockout protection:** an update that would leave no active user with the Owner role is refused
  ("This would leave no active Owner. Make someone else an Owner first."). You can't disable yourself.

### 6.4 Secrets and data protection

- AES-256-GCM, 12-byte IV, output `base64(iv).base64(tag).base64(ciphertext)` for GitHub tokens, webhook
  secrets and test-account passwords.
- **GitHub read-only guarantee:** `github(token)` builds an Octokit whose `hook.before("request")` throws for
  any REST request that isn't `GET`, and any GraphQL request whose query starts with `mutation`. Even a token
  with write scopes cannot write. Classic tokens report `x-oauth-scopes`; if any write scope is present
  (`repo, public_repo, admin:org, write:org, delete_repo, workflow, admin:repo_hook, admin:org_hook,
  write:packages, write:discussion`) the UI shows a warning; fine-grained tokens report none.
- **Webhook HMAC:** `X-Hub-Signature-256` = `sha256=` + hex HMAC-SHA256 of the raw body with the org's
  secret, compared in constant time (length check first).
- **Test-browser network guard (`isBlockedHost`):** every request from the test browser is routed; requests
  to `localhost`, `*.localhost`, `*.internal`, `::1`, `0.0.0.0`, 10/8, 127/8, 0/8, 169.254/16,
  172.16–31, 192.168/16, 100.64/10, and IPv6 `fc`/`fd`/`fe80` are aborted — **except the app under test's own
  host**, which is always allowed. Known ceiling: literal hostnames only (DNS rebinding not covered).
- **AI data handling:** before anything is sent to Groq, the app's saved test-account email and password are
  replaced by `{{email}}` / `{{password}}` in the prompt and in the current test; example tests have literal
  `with "…"` / `to "…"` values blanked to `"…"`. Generated output is scrubbed the same way. If a generated test
  types a literal password into a password field, the user gets a warning.
- Credentials in tests: tests and their run history are visible to everyone with `tests:view`, so credentials
  belong in the app's saved test account and tests use `{{email}}` / `{{password}}`.

### 6.5 Audit log

`auditLog` entries `{actorId, actorEmail, action, target, details?, at}`. Actions written:
`org.connected`, `org.token_replaced`, `org.removed`, `org.enabled.true|false`, `org.hidden.true|false`,
`repo.enabled.true|false`, `repo.hidden.true|false`, `user.created`, `user.updated`, `role.created`,
`role.updated`, `role.deleted`, `app.created`, `app.updated`, `app.deleted`, `test.created`, `test.deleted`,
`test.run` (details `{environment}`).

---

## 7. Data model (MongoDB)

Collection names and TypeScript shapes are exact in `lib/db.ts` (Appendix A). Summary:

| Collection | Key fields | Indexes |
| --- | --- | --- |
| `users` | email (lower-case), name, passwordHash, roleId, disabled?, createdAt | `{email:1}` unique |
| `roles` | name, permissions[], builtIn | `{name:1}` unique |
| `orgs` | ghId, login, token (enc), tokenScopes (string[] or null), webhookSecret (enc), enabled, hidden, lastSyncAt?, syncError? | `{ghId:1}` unique |
| `repos` | ghId, orgId, name, fullName, isPrivate, isArchived, defaultBranch, enabled, hidden, lastCommitAt?, lastPrUpdatedAt?, lastSyncAt?, syncError? | `{ghId:1}` unique, `{orgId:1}` |
| `contributors` | `_id` string: `gh:<databaseId>` when GitHub knows the account, else `email:<lowercased email>`, or `login:<login>` for PR authors without an id; login?, name?, avatarUrl?, emails[] | `{emails:1}` |
| `commits` | repoId, sha, contributorId, committedAt, additions, deletions, **isMerge** (parents > 1), message (headline), url | `{repoId:1,sha:1}` unique, `{repoId:1,committedAt:-1}`, `{contributorId:1,committedAt:-1}` |
| `pullRequests` | repoId, number, title, contributorId, state OPEN/CLOSED/MERGED, createdAt, updatedAt, mergedAt, additions, deletions, commitCount, url | `{repoId:1,number:1}` unique, `{contributorId:1,createdAt:-1}`, `{repoId:1,createdAt:-1}` |
| `hookEvents` | deliveryId, type, action?, orgId, repoId?, summary (≤500), status queued/done/failed, error?, receivedAt, processedAt? | `{deliveryId:1}` unique, `{receivedAt:1}` TTL 90 days |
| `auditLog` | see §6.5 | `{at:-1}` |
| `apps` | name, baseUrl (no trailing slash), environment dev/staging/production, testLogin? `{email, password(enc)}`, createdAt | — |
| `tests` | appId, name, markdown (steps + notes only), **device?** (Playwright name or `WxH` / `WxH mobile`), **sessionTestId?** (ObjectId or null), updatedAt, updatedBy | `{appId:1}` |
| `testRuns` | testId, appId, testName, device, status queued/running/passed/failed/stopped, steps[] `{text, status pending/running/passed/failed/skipped, ms?, note?, screenshot? (base64 JPEG)}`, values (counts), error?, createdAt, startedAt?, finishedAt?, by | `{testId:1,createdAt:-1}` |
| `testVersions` | testId, markdown, device, sessionTestId, source saved/draft/ai, prompt?, at, by | `{testId:1,at:-1}` |

`dbReady()` creates all indexes and upserts the three built-in roles with their current permissions; it is
memoised per process (on `globalThis`) and resets on failure so the next call retries. It's called by
`getUser()`, the login page/actions, the webhook route and the worker at start.

**Legacy rule:** tests saved before device/session became settings have `device` missing and may carry
`device: …` / `session: …` lines in the Markdown. `settingsOf()` (lib/plan.ts) reads those lines in that
case (session resolved by test name, case-insensitive); the next save stores clean Markdown plus the fields.

**Cascades:** deleting an org deletes its repos, commits and PRs (contributors stay). Deleting an app
deletes its runs, tests' versions, tests. Deleting a test deletes its runs and versions and sets
`sessionTestId: null` on any test that signed in with it.

---

## 8. Background worker (`worker/index.ts`)

- Starts with `await dbReady()`, then marks any run still `running` as `failed` with
  "The worker restarted during this run." (a crashed worker would otherwise leave it alive forever).
- **sync** worker, concurrency 1: job data `{orgId}` → sync that org; `{all:true}` → every enabled org.
  Each org's failure is logged and doesn't stop the others; success publishes `sync.done`.
- **hooks** worker, concurrency 5: loads the event, runs `runHook(event)`, sets `status:"done"`,
  `processedAt`, unsets error; on throw sets `status:"failed"` + error and rethrows (BullMQ retries with
  backoff). Publishes `hook.fired`. `runHook` is the placeholder:
  `console.log(\`[hook] ${type}${action ? "."+action : ""}: ${summary}\`)`.
- **tests** worker, concurrency 2 (each run is a full Chromium), `lockDuration: 10 minutes`, runs
  `runTest(runId)`.
- Scheduler: `queues.sync.upsertJobScheduler("sync-all", { every: 15*60_000 }, { name: "all", data: { all: true } })`.
- Queues default job options: `removeOnComplete: 500, removeOnFail: 1000`. "Sync now"/connect/re-enable use
  `deduplication: { id: "org-<orgId>" }` so double clicks add one job.
- Failed jobs log `[<queue>] job <id> failed: <message>`. Ready line:
  "Worker ready: sync every 15 min, hooks, tests (2 at a time)."
- **Graceful shutdown** on SIGINT/SIGTERM: start a 10 s `setTimeout(() => process.exit(1)).unref()`, then
  `await Promise.all([sync.close(), hooks.close(), tests.close()])`, then `process.exit(0)`. Without the
  bounded timeout, `close()` waits forever for an active job and you end up with duplicate workers fighting
  over locks ("could not renew lock").

---

## 9. GitHub sync algorithm (`lib/github.ts`)

1. `checkToken(token, org)`: `GET /orgs/{org}` with the read-only client → `{ghId, login, scopes, writeScopes}`.
   Connect form errors: 401 → field error on token "GitHub rejected this token. It may be expired or
   revoked."; 404 → field error on org "This token can't see that organization. Check the spelling and that
   the token's resource owner is this org."; other → "GitHub couldn't be reached to check the token. Try
   again in a minute." Validation: org `^[A-Za-z0-9-]{1,39}$`; token `^(gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}$`.
   Reconnecting an existing org (same ghId) replaces the token.
2. `syncOrg(orgId)`: skip if org missing or disabled. Paginate `GET /orgs/{org}/repos` (per_page 100,
   type all); upsert repos by ghId (`$setOnInsert: {enabled:true, hidden:false}`). For each **enabled** repo
   run `syncRepo` in a try/catch (store `syncError` per repo, continue). On success set org `lastSyncAt`,
   clear `syncError`; on org-level failure store `syncError` and rethrow. Errors are truncated to 500 chars.
3. `syncRepo`: **commits** (only if `defaultBranch`): GraphQL history of the default branch, 50 per page,
   `since = lastCommitAt − 1 day` (slack for clock skew/late pushes), upsert contributors then commits
   (bulkWrite, unordered, upsert by `{repoId, sha}`), track newest `committedAt` → `lastCommitAt`.
   **PRs**: GraphQL `pullRequests(orderBy: UPDATED_AT DESC)` 50 per page; keep PRs with
   `updatedAt > lastPrUpdatedAt`; upsert contributors and PRs (by `{repoId, number}`); **stop paging at the
   first stale PR** (results are newest-updated first); store newest → `lastPrUpdatedAt`.
4. Contributor identity: commit author with a GitHub user → `gh:<databaseId>` (login, avatar, name, email
   added to `emails` via `$addToSet`); otherwise `email:<lowercased email>` (name = author name or email).
   PR authors: `gh:<databaseId>` when present, else `login:<login>` (or `login:ghost`).

Exact queries and code are in Appendix A.

---

## 10. Analytics definitions (`lib/analytics.ts`)

- **Range** from the URL: `?range=7d|30d|90d|1y` (default 30d, ending now) or `?from=YYYY-MM-DD&to=YYYY-MM-DD`
  (inclusive, UTC; key `custom`). Bucket = `week` when the range is > 120 days, else `day`.
- **Visibility rule (single source of truth): `visibleRepoIds(user)`** = repos that are enabled, in enabled
  orgs, and (unless the user has `hidden:view`) neither the org nor the repo is hidden. Every analytics query
  filters by this list.
- **Lines added/removed exclude merge commits** (`$cond isMerge → 0`), so a change isn't counted twice.
  Commit counts include merges.
- `overview(user, range, contributorId?)`: commits, additions, deletions, distinct contributors (from commits),
  PRs opened (createdAt in range), PRs merged (mergedAt in range), a zero-filled series per day/week
  (weeks start Monday, `$dateTrunc`), and `repoCount`.
- `leaderboard(user, range, sort, limit)`: per contributor commits, additions, deletions, prsOpened,
  prsMerged. Sorts: `lines` (additions+deletions, default), `commits`, `additions`, `deletions`, `prs`
  (`prsMerged*1000 + prsOpened`). Names: contributor name → login → id.
- `contributorActivity(user, id, range)`: newest 100 commits and newest 100 PRs (opened in range) for that
  person in visible repos, plus a repoId → fullName map.

---

## 11. Live updates (`lib/redis.ts`, `lib/sse.ts`)

- Channels: `live` (dashboard events `{type:"sync.done",orgId,org}`, `{type:"hook.fired",event,repo?}`,
  `{type:"run.finished",runId,status}`) and `run:<runId>` (test stream). Stop flag key: `run:<runId>:stop`.
- `subscribe(channel, onMessage)` uses a **duplicated** ioredis connection (a subscribed client can't run
  commands) and exposes `ready` (resolves when Redis confirms) and `close()`.
- `sseFromChannel(req, channel, snapshot?)`: sends `: connected`, subscribes, **holds** messages until the
  subscription is ready, then sends the optional snapshot, then the held messages, then streams live. Pings
  `: ping` every 25 s. Cleans up on abort/cancel. Headers: `text/event-stream`, `no-cache, no-transform`,
  `keep-alive`. This ordering guarantees the client never misses an update between snapshot and live.
- `/api/live`: requires a signed-in user (401 "Sign in first.").
- `/api/runs/[id]/stream`: requires `tests:view` (401 / 403 "Your role can't view test runs." / 404
  "Unknown run."); snapshot = `{t:"snapshot", status, steps (without screenshots), values, error}` or
  `{t:"status", status:"failed", error:"This run was deleted."}`.
- Run messages: `{t:"frame", d:<base64 jpeg>}`, `{t:"step", i, step}` (never includes screenshot),
  `{t:"status", status, error?, values?}`.

---

## 12. Browser tests

### 12.1 The step language (`lib/testdsl.ts`)

A test is Markdown. **List items (`- `, `* `, `1. `) are steps; every other line is a note for people.**
Fenced code blocks are ignored. One step per line. Device and session are **not** in the Markdown (they're
settings, §12.2). Grammar (case-insensitive; `"…"` = double-quoted text; `{{var}}` placeholders allowed in
targets/values/URLs):

| Write | Meaning |
| --- | --- |
| `go to /login` | Path on the app (resolved against the app's root URL) or a full URL; waits for DOMContentLoaded; note = final URL |
| `click "Sign in"` | Button (by role+name), link, label, exact text, or CSS selector (target starting with `#`, `.` or `[`) |
| `tap "Menu"` | Same as click as a finger tap; falls back to click on devices without touch |
| `fill "Email address" with "{{email}}"` / `enter "X" to "Y"` | Field by label, placeholder, CSS selector, or a visible `<label for>` (see below) |
| `type "000000"` | Keyboard typing into whatever is focused, 60 ms per key (one-box-per-digit OTP fields) |
| `press "Enter"` | Keyboard press |
| `wait for "OTP Code"` | Until a field (label/placeholder), button or text is visible, up to 30 s |
| `wait for url /dashboard` | Until the URL contains the fragment; note = URL |
| `wait for text "Welcome"` / `expect text "Welcome"` | Until the text is visible |
| `scroll to bottom` / `scroll to top` | Scroll the document, then wait 600 ms for lazy content |
| `scroll down 800` / `scroll up 800` | Scroll by pixels, then wait 400 ms |
| `count ".job-card" as jobs` | Count CSS matches; saved as a named result shown with the run |
| `expect at least 1 ".job-card"` | Fail unless at least N match |
| `wait 2s` | Fixed wait (max 60 s; decimals allowed) |

`STEP_HELP` (shown under the editor, one example per line, and given to the AI) is exactly the list in the
source. Unknown list items produce:
`Line N: "<text>" isn't a step this runner understands. Write notes as plain text, not list items, and put one step per line.`
An empty test produces "Add at least one step as a list item, e.g. - go to /". `fillVars` replaces
`{{name}}` from the vars map and leaves unknown placeholders visible.

**Field lookup quirk (important for AI Job Expert):** its inputs have an `aria-labelledby` pointing at
themselves, so they have no accessible name. `field()` therefore also reads the `for` attribute of a visible
`<label>` containing the text (2 s timeout) and adds `[id="<for>"]` to the locator.

Other helpers in the same pure module (no runtime imports, so `node --test` can load it):
`DEFAULT_DEVICE = "iPhone 15"`; aliases `phone|mobile → iPhone 15`, `tablet → iPad Pro 11`,
`desktop|laptop → Desktop Chrome`; `customSize("1366x768")` / `"390x844 mobile"` (240–3840 wide, 240–4320
high; `x` or `×`; optional `mobile` = touch phone); `resolveDevice(want, names)` (size → `WxH[ mobile]`,
else alias/name case-insensitive, else null); `frameShape(w,h,mobile)` → `"phone"` when mobile and
2.0 ≤ h/w ≤ 2.3, else `"portrait"`/`"landscape"`; `splitHeader(markdown)` pulls `device:`/`session:` lines out.

### 12.2 Devices and sessions

- **Devices** (`lib/devices.ts`): `DEVICE_LIST` = every Playwright device except `… landscape` duplicates,
  as `{name, kind phone|tablet|desktop, width, height, mobile}`; kind = desktop if not mobile, tablet if the
  short side ≥ 600, else phone; sorted phone, tablet, desktop then by name. Mobile profiles use the
  descriptor's **`screen`** size as the viewport (no browser toolbars, so frames fit the phone mockup);
  desktop uses `viewport`. Custom sizes get `{viewport, isMobile, hasTouch, deviceScaleFactor: mobile ? 3 : 1}`.
  `contextFor(device)` returns the context options + size; `shapeOf(device)` the frame shape.
- **Session ("Start signed in with")**: a test can name another test in the same app (`sessionTestId`). The
  **run plan** (`planRun` in `lib/plan.ts`) prepends that test's steps (and, recursively, its own session's)
  so they run first **in the same browser context** — the cookies/localStorage carry over. Setup steps are
  labelled `[<test name>] <step>` in results. Errors: deleted session test ("The test this one signs in with
  was deleted. Pick another under Start signed in with."), loops, more than 3 deep, or parse errors in the
  session test. The main test's device is used throughout. Each run signs in fresh (no session caching).

### 12.3 The runner (`lib/runner.ts`)

1. Load run (must be `queued`), test and app. Build the plan; on error finish `failed` with the message.
2. Set `running`, `startedAt`, `device`, and the step list (all `pending`); publish status.
3. Vars: `baseUrl`, and `email`/`password` (decrypted) from the saved test account.
4. `chromium.launch()`; `newContext(contextFor(device).options)`; default timeout **15 s**; route every
   request through `isBlockedHost` (abort `blockedbyclient`); new page; CDP session with
   `Page.startScreencast {format:"jpeg", quality:60, maxWidth/maxHeight = viewport}`; every
   `Page.screencastFrame` is published as `{t:"frame"}` and acked.
5. **Stop works mid-step:** a 500 ms interval polls the stop key; when set it closes the browser, which
   makes the in-flight step (e.g. a 30 s wait) throw immediately. `stopAt(i)` marks the interrupted step
   `skipped` with note "Stopped during this step." (a step that already passed stays passed), the rest
   `skipped`, publishes each, and finishes `stopped` with "Stopped by a user.".
6. Per step: check stop; mark `running` and publish; run `runStep`; record `passed` + note or `failed` +
   first line of the error; `ms`; if stopped → `stopAt`; take a **JPEG screenshot (quality 55, scale css)**;
   save the step (`$set steps.i`); publish (without screenshot). On failure: rest `skipped`, finish `failed`
   with `Step N failed: <error>`.
7. Finish: `$set {status, error, values, finishedAt}`, publish status, publish `run.finished` on `live`.
8. Finally: clear the interval, close the browser, delete the stop key.

`startRun` (server action) requires `tests:run`, plus `tests:run-production` for production apps
("Your role can't run tests against production apps. Ask an Owner for the production permission."); builds
the plan ("Fix the test first: …" on error), inserts the run with labelled pending steps, enqueues, audits
`test.run`. `stopRun` requires `tests:run`: a still-`queued` run is set `stopped` ("Stopped before it
started.") directly; otherwise it sets the stop key (`EX 600`). Returns "Stopping the run.".

---

## 13. AI test generation and editing (`lib/ai.ts`, `generateSteps` action)

- Enabled only when `GROQ_API_KEY` is set (`aiEnabled()`); otherwise the AI box is hidden and the action
  returns "AI generation isn't set up. Add GROQ_API_KEY to the server's environment.".
- Request: `POST https://api.groq.com/openai/v1/chat/completions`, bearer key, `{model, messages,
  temperature: 0.2}`, 60 s timeout. Response content has code fences stripped.
- `generateSteps(testId, prompt, draft)` requires `tests:edit`; prompt 10–2,000 chars; validates the draft's
  device/session; scrubs secrets (§6.4); context = app URL, whether a test account is saved, up to 3 other
  tests of the app (newest updated first, values blanked), the names of tests usable as sessions, the
  current device and session, **the current test**, and the request.
- The **system prompt** (exact text in Appendix A) includes the step list and these rules: output only
  Markdown (title, optional `device:`/`session:` lines, steps); edit the current test and return the whole
  thing, keeping what the request doesn't change, replacing the starter template or unrelated content; keep
  the description's order exactly (a wait between two actions goes between those steps); if the description
  says how to sign in, write those steps and don't add a session; only add `session:` when the description
  assumes a signed-in user; keep the current session line if it still applies (omitting it removes it);
  `device:` only when asked; use `{{email}}`/`{{password}}`; use exact visible texts, prefer the examples'
  labels; **never invent page text** for wait/expect/click (use URLs or known labels instead); OTP pattern
  (wait for the code screen heading, `type "<code>"`, click submit); add a wait after page changes.
- The answer goes through `splitHeader` + `parseTest`; if lines are rejected, the errors go back to the model
  once ("The runner rejected these lines: … Rewrite the whole test using only the allowed steps."). Device
  from the answer is resolved (else keep current); session name mapped to a test id (else none + warning).
- Versions: the state before (`source:"draft"`, skipped if identical to the newest version) and the answer
  (`source:"ai"`, with the prompt ≤ 500 chars) are both recorded; `refresh()` updates the versions table.
- Returns `{markdown, device, sessionTestId, warning?}`; nothing is saved to the test itself — the editor
  shows it for review. Success toast: "Test updated. Check it, then Save or Run. The earlier version is under
  Versions." Errors: "The AI returned nothing. Try describing the test differently." / "The AI service didn't
  answer (<msg>). Try again in a minute.".

Verified behaviour to reproduce: the prompt "create a test for login flow and land user of dashboard page /
email / pass / wait for 2s / on otp screen use 000000 / must land on /dashboard and verify" must produce a full
login (go to /login, fill email/password placeholders, tap Sign in, wait for "We sent you an OTP",
type "000000", wait 2s, click "Verify Code", wait for url /dashboard, …) — **not** a two-line test that relies
on a session.

---

## 14. Test versions

`recordVersion(testId, {markdown, device, sessionTestId}, {source, by, prompt?})`: skip when identical to
the newest version (except `ai`), insert, and keep only the newest **30** per test. Recorded on every Save
(`saved`) and every AI edit (`draft` + `ai`). The editor lists them; **Restore** loads markdown + device +
session into the editor (unsaved) with the toast "Version restored in the editor. Save to keep it.". The row
matching the editor shows "In editor" instead of the button.

---

## 15. UI specification

### 15.1 Global conventions

- **Only Odyssey components** for controls. Forbidden raw elements: `input, button, select, textarea, a, img,
  form, table, label, ul, ol, li, iframe, svg`. Allowed primitives: `div, span, p, h1–h6, main, header,
  footer, nav, section, article, aside`. No `style={{}}`, no arbitrary Tailwind values, no hex colours; token
  classes only (`text-primary`, `text-secondary`, `text-tertiary`, `text-error-primary`, `bg-primary`,
  `bg-secondary`, `border-secondary`, …). The one documented deviation is `<img>` in `device-screen.tsx`
  (see §18).
- Root layout: Geist font with CSS variable `--font-geist`; `<html lang="en" className="… antialiased"
  suppressHydrationWarning>`; an inline head script toggles the `dark-mode` class from
  `prefers-color-scheme` before first paint and on change; `<body className="bg-primary">`; viewport
  `viewportFit: "cover"`; metadata title template `%s · Repo Pulse`.
- `Providers`: React Aria `RouterProvider navigate={router.push}` (so Odyssey links use the Next router) and
  `<Toaster/>` mounted **only after hydration** (`useSyncExternalStore(noop, () => true, () => false)`) to
  avoid Odyssey's getServerSnapshot warning.
- Page frame: `div.flex.flex-col.gap-8.px-4.py-8.md:px-8`; `PageHeader` (h1 size 3 + Body1 description left,
  actions right on `lg`, stacked below). Detail pages use `Breadcrumbs items=[…]` and a `<title>` element.
- **Icons and functions can't be passed from Server to Client Components** — `app/ui/empty.tsx` is a client
  `Empty` that takes an icon **name** (`AlertCircle, ClipboardCheck, GitBranch01, SearchLg, Shield01, Users01,
  Zap`). **Compound statics (`DescriptionList.Item`, `Table.Row`, …) are undefined in Server Components**, so
  anything using them lives in a client component.
- Forms: `ActionForm` (useActionState + Odyssey `Form` with `validationErrors`, `validationBehavior="aria"`).
  Form-level error in an error `Alert` whose description lists every field message (Odyssey `Input` doesn't
  render React Aria validation messages); after a failed submit focus moves to the first
  `[aria-invalid="true"]`; success → `toast.success(ok)`. Submit button shows `pendingLabel` while pending.
- `FormModal` (button opens a modal with an ActionForm; closes on success; Cancel button) and `ConfirmButton`
  (alertdialog, focus starts on Cancel, destructive confirm). Use **bound server actions**
  (`action.bind(null, id)`) instead of hidden inputs.
- Tables: Odyssey `TableCard.Root` + `TableCard.Header(title, description, contentTrailing)` + `Table` inside
  `div.overflow-x-auto`; secondary columns hidden below `md`/`lg`. Must not overflow at 320 px width.
- Number formatting `Intl.NumberFormat`; dates `toLocaleString(undefined, {dateStyle:"medium", timeStyle:"short"})`.

### 15.2 Shell (`(console)/layout.tsx`, `shell.tsx`)

`export const instant = false`. Suspense (centered `LoadingIndicator type="line-simple"`) around
`ShellForUser` which calls `requireUser()` and renders `SidebarLayout` with brand "Repo Pulse",
`activeUrl` = path + query, account `{name, email: "<email> · <role>", menu: Log out}`, and nav (each hidden
without its permission; a group with no allowed children disappears):

| Label | Href | Icon | Permission |
| --- | --- | --- | --- |
| Dashboard | `/` | Home02 | analytics:view |
| Contributors | `/contributors` | Users01 | analytics:view |
| Repositories | `/repos` | GitBranch01 | analytics:view |
| Tests | `/apps` (also matches `/runs`) | ClipboardCheck | tests:view |
| Webhooks | `/hooks` | Zap | hooks:view |
| Settings › Users / Roles / Audit log | `/settings/users`, `/settings/roles`, `/settings/audit` | Settings01 | users:manage / roles:manage / audit:view |

`<LiveRefresh/>` is rendered inside the shell.

### 15.3 Pages (route → permission → content)

**`/login`** (public). Suspense → if signed in redirect `/`. First run: h1 "Create the owner account", body
"No one has signed in yet. The first account becomes the Owner and can add everyone else.", fields Your name,
Email, Password (hint "At least 12 characters."), button "Create owner account" / "Creating account…".
Otherwise: h1 "Sign in to Repo Pulse", body "Accounts are created by your Owner. Ask them if you need access
or a password reset.", fields Email (autocomplete username), Password, button "Sign in" / "Signing in…".

**`/` Dashboard** (`analytics:view`). Header "Dashboard", description "<n> visible repository|repositories ·
<from> – <to>", actions = `RangeControl` (ButtonGroup 7 days / 30 days / 90 days / 12 months + DateRangePicker
"Custom date range"; state in the URL). If no visible repos: Empty (GitBranch01) "No repositories to show yet"
with token-manager vs. other wording and a "Connect an organization" button for `token:manage`. Else:
StatTileGroup (3 columns): Commits ("On default branches"), Pull requests opened, Pull requests merged, Lines
added ("Merge commits excluded"), Lines removed ("Merge commits excluded"), Active contributors ("Committed at
least once"); `ActivityCharts` (two LineCharts: "Commits per day|week" area; "Lines changed per day|week",
subtitle "Merge commits excluded", series Added/Removed; x labels "Mon D" or "Week of Mon D", UTC);
`LeaderboardTable` top 5 by lines, title "Top performers", description "Ranked by lines changed in this
period", trailing button "See all contributors", not sortable.

**`/contributors`** (`analytics:view`). Header "Contributors", description "Everyone who committed or opened a
pull request in visible repositories. Select a person to see each commit and pull request.", RangeControl.
Leaderboard top 100, sortable via `?sort=`, title "Leaderboard", description "Top N by <lines changed|pull
requests merged|sort>. Select a column heading to re-rank.". Columns: # , Contributor (AvatarLabelGroup with
link name and `@login` or email), Lines changed, Added (+n, md), Removed (−n, md), Commits, PRs merged /
opened (lg). Row action → `/contributors/<id>?<same query>`. Empty: "No activity in this period".

**`/contributors/[id]`** (`analytics:view`). Breadcrumbs Contributors › name; header name, description
`@login` or emails or "Identified by commit email only"; RangeControl; 5 stat tiles; charts; **Commits** table
("Newest first, up to 100 in this period. Lines are per commit.": Commit (external link to GitHub, sha, a gray
"Merge commit, not counted in totals" badge), Repository (md), Date, Added / removed); **Pull requests**
table ("Opened in this period, newest first. Lines are the pull request's full diff.": Pull request
`#n title` link, State badge Open/success Merged/purple Closed/gray, Repository, Opened, Added / removed,
Commits). 404 if the contributor doesn't exist.

**`/repos`** (`analytics:view`). People without `scope:manage` only see enabled (and, without `hidden:view`,
non-hidden) orgs/repos. Header "Repositories" (manage description: "Turn organizations and repositories on to
sync them. Hidden ones keep syncing but stay out of dashboards for people without the hidden permission.";
otherwise "Repositories included in your dashboards."). `token:manage` gets "Connect organization" FormModal
(title "Connect a GitHub organization", the fine-grained token guidance, fields "Organization login"
placeholder acme-inc, "Read-only token" password placeholder github_pat_…, submit "Check and connect" /
"Checking token…"; success "<login> connected. The first sync has started." plus a write-scope warning when
relevant). One `OrgCard` per org: optional warning Alert for write scopes (token managers), TableCard header
"<login>" with "<n> repositories · Last synced <when>|Last sync failed: <err>", trailing Sync / Hidden
toggles (`scope:manage`, optimistic with rollback + toast on error), "Sync now" (`sync:run`, disabled when the
org is off), "Remove" confirm (`token:manage`: "This deletes its token, its repositories and every synced
commit and pull request. Contributors stay. …"). Repo table: Repository (+ Private/Archived/Hidden badges),
Last sync (or "Failed: …" in error colour), Commits synced, Sync toggle (disabled when org is off), Hidden
toggle. Empty: "No organizations connected".

**`/hooks`** (`hooks:view`). Header "Webhooks", description "Every push and pull request from a connected
organization runs the hook function in the worker. This list updates live.". Setup section "Set up the webhook
in GitHub" with instructions, an Accordion per org (turned-off orgs labelled "(turned off, events are
ignored)") showing a DescriptionList: Payload URL (`APP_URL/api/webhooks/github`, CodeBlock with copy),
Content type application/json, Secret (CodeBlock with copy), Events "Pushes, Pull requests". **Recent events**
table (newest 100; "Each one ran the hook function once, even if GitHub delivered it twice."): Event summary
(+ error), Type (md), Hook badge Queued/warning Ran/success Failed/error, Received.

**`/apps` Tests** (`tests:view`). Header "Tests", description "Write tests as Markdown steps, run them in a
phone browser on the server, and watch every step live.". `apps:manage` gets "Add app" (FormModal: Name, Root
URL, Environment select Dev/Staging/Production, Test account email (hint "Optional. Tests use it as
{{email}}. Use a test account, not a real person's."), Test account password (hint), submit "Add app" /
"Adding…"; creating redirects to the app). Table "Apps under test": App link, Environment badge (Dev gray,
Staging warning, Production error), Root URL (md), Tests count, Latest run badge or "Never run" (md).

**`/apps/[appId]`** (`tests:view`). Breadcrumbs Tests › app; header app name + EnvBadge + base URL + " · signs
in as <email>" or " · no test account saved". Actions: Delete app (confirm), Edit app (FormModal, password
blank keeps it; email without password and none saved → field error "Enter the test account's password."),
New test (FormModal "Test name", creates with the TEMPLATE and redirects to the editor). Tests table: Test
link, Steps (or error badge "<n> line(s) to fix"), Device (md), Latest run badge + time, Last edited "<when> by
<email>" (lg). Run badges: Queued gray, Running blue, Passed success, Failed error, Stopped warning.

**`/apps/[appId]/tests/[testId]` — the test editor** (`tests:view`; editing needs `tests:edit`; running needs
`tests:run` / `tests:run-production`). Breadcrumbs Tests › app › test; header test name with EnvBadge and
"Runs against <baseUrl>"; "Delete test" confirm for editors. The `Workbench` client component (full source in
Appendix B) lays out two columns on `xl`:

- **Left, "Steps":**
  1. *Generate with AI* box (editors, when AI is enabled): TextArea "Generate with AI" (placeholder "Log in
     with the test account, enter OTP 000000, open Jobs and check at least one job card shows", hint
     "Describe the test, or what to change in the current one. Nothing is saved until you press Save or Run,
     and every AI edit is kept under Versions."), button "Generate steps" when the test has no steps, else
     "Update test with AI"; "Generating…" while pending; disabled under 10 chars.
  2. *RunSetup* (Appendix B): label "Device" + ButtonGroup **Phone | Tablet | Desktop | Custom size**
     (picking a kind selects its default: iPhone 15 / iPad Pro 11 / Desktop Chrome). For a kind, a searchable
     `Select.ComboBox` of that kind's devices with `W×H` supporting text. For Custom size: Width (px), Height
     (px), Checkbox "Touch phone" ("Mobile browser with a touchscreen. Leave off for a desktop window."), a
     live "Uses device: …" line, and "Use this size". Then `Select` "Start signed in with": "No session
     (start signed out)" + every other test of the app, hint "Runs that test first in the same browser, so
     this test starts with its session." (or "Create a sign-in test in this app first, then pick it here.").
  3. `Tabs` (underline, aria-label "Test Markdown") **Write | Preview**. Write: TextArea "Test (Markdown)",
     18 rows, mono, hint "Unsaved changes. Run saves them first." / "Saved.". Preview: `TestPreview` (Appendix
     B) renders headings (#–###), notes (with `` `code` `` and `**bold**`), code fences, and steps as a
     numbered `role="list"` with each invalid line flagged in `text-error-primary`.
  4. Parse status: error Alert "<n> line(s) can't run yet" listing messages, or Body2 "<n> steps on <device>[,
     after signing in with "<session>"]." (the smoke test asserts "7 steps on iPhone 15.").
  5. Buttons: Save (editors; disabled unless dirty), Run test (Play icon; disabled without permission or with
     parse errors; saves first if dirty) / Stop run (Stop icon, secondary-destructive) while live; reason text
     when the role can't run; the step help list under "Steps you can write".
  - Save moves any `device:`/`session:` lines typed into the Markdown into the settings before saving.
- **Right, "Live run":** `aria-live="polite"` sr-only status region announcing each finished step and the
  final result ("Run passed." etc.); `DeviceScreen` showing the latest frame (phone shapes inside Odyssey
  `IPhoneMockup` max-w-xs; tablets/desktops as a bordered rounded image, portrait capped at max-w-md);
  "Press Run test to watch it here, step by step." before any run; error Alert "The run didn't pass";
  counted values as an inline DescriptionList; a "Progress" table (#, Step + note, Result + seconds).
- **Versions** table (§14): When, What (Saved / Before AI edit / AI edit + quoted prompt + "Signs in with
  …"), Device (md), By (lg), Restore / "In editor".
- **Run history** table: newest 15 runs (Started link to the run, Result badge, Steps passed "p / t",
  Duration (md), Run by (md)); row action opens the run.
- The SSE handler: `snapshot` replaces status/steps/values/error; `frame` sets the frame; `step` replaces
  one step; `status` sets status/values/error and, when finished, announces, closes the EventSource and
  `router.refresh()`es (to update history).

**`/runs/[runId]`** (`tests:view`). Breadcrumbs Tests › app › test › Run; header `Run of "<test>"` with
RunBadge and "<started> · <device> · by <email>"; `RunView` (client): Alert "Why it stopped" (warning when
stopped, else error), DescriptionList App / Duration / "Counted: <name>", and a grid of step cards (h3
"N. step", status text with seconds and note, `DeviceScreen size="sm"` labelled "Screen after step N" or "No
screenshot for this step.").

**`/settings/users`** (`users:manage`). "Add user" (Name, Email, Role select, Temporary password ≥ 12);
table Person ("(you)" marker, email), Role, Status badge Active/Disabled, Edit (Name, Role, New password
optional, "Disable this account" checkbox except for yourself). Duplicate email → "Someone already uses this
email.".

**`/settings/roles`** (`roles:manage`). "New role" (Role name, permissions as checkboxes inside a
`role="group"` labelled "Permissions", each with its description as hint — Odyssey has no checkbox group);
table Role (+ Built-in badge), Permissions, Users, Actions (built-in: "Read-only"; custom: Edit, Delete —
refused while users hold it: "<n> user(s) still have this role. Give them another role first.").

**`/settings/audit`** (`audit:view`). Newest 200 entries: Action, On, By (md), When, Details JSON (lg).

**`forbidden.tsx`**: Empty (Shield01, warning) "Your role doesn't include this page" / "Ask an Owner to add the
permission to your role if you need it." with buttons "Go to tests" and "Go to dashboard".

---

## 16. Server actions (all `"use server"`, all re-check permissions)

| File | Action | Permission | Notes |
| --- | --- | --- | --- |
| login/actions | `login`, `createOwner`, `logout` | — | §6.3 |
| repos/actions | `connectOrg(prev, fd)` | token:manage | §9; enqueue sync; audit; `refresh()` |
| | `removeOrg(orgId)` | token:manage | cascade delete |
| | `setOrgFlag(id, "enabled"\|"hidden", v)`, `setRepoFlag(…)` | scope:manage | re-enable enqueues a sync |
| | `syncNow(orgId)` | sync:run | refuses disabled orgs |
| settings/actions | `createUser`, `updateUser(id, …)`, `saveRole(id\|null, …)`, `deleteRole(id)` | users:manage / roles:manage | §6.3, §15.3 |
| apps/actions | `saveApp(id\|null, …)`, `deleteApp(id)` | apps:manage | baseUrl trailing slash removed |
| | `createTest(appId, …)` | tests:edit | TEMPLATE, device iPhone 15, no session |
| | `saveTest(testId, draft)` | tests:edit | ≤ 50,000 chars; device resolvable; session must be another test in the same app; records a `saved` version |
| | `deleteTest(testId)` | tests:edit | cascades, clears sessions pointing at it, redirects |
| | `startRun(testId)`, `stopRun(runId)` | tests:run (+ production) | §12.3 |
| | `generateSteps(testId, prompt, draft)` | tests:edit | §13 |

`ActionResult = { ok?, error?, fieldErrors? } | null`; `fieldErrors(zodError)` takes the first message per
field and adds "Some fields need fixing. Check the message under each one.". Mutations call `refresh()` from
`next/cache` so the current page re-renders.

TEMPLATE for new tests (exact):
```md
# Sign in and look around
Steps are list items. Anything else, like this line, is a note for people.

- go to /login
- fill "Email address" with "{{email}}"
- fill "Password" with "{{password}}"
- tap "Sign in"
- wait for url /dashboard
- scroll to bottom
- count "a" as links
```

---

## 17. API routes

| Route | Auth | Behaviour |
| --- | --- | --- |
| `POST /api/webhooks/github` | HMAC per org | 400 non-JSON; 404 unknown org ("This organization isn't connected to Repo Pulse."); 401 bad signature ("Signature doesn't match. Copy the secret from the Webhooks page again."); `ping` → 200 "pong"; other events → 202 ignored; disabled org/repo → 202 ignored; duplicate delivery → 200 "Already received this delivery."; else insert + enqueue → 202 "Queued.". Summary: push = "<pusher> pushed <n> commit(s) to <branch> in <repo>"; PR = "<sender> <action> PR #<n> "<title>" in <repo>". |
| `GET /api/live` | signed in | SSE of `live` |
| `GET /api/runs/[id]/stream` | tests:view | SSE of `run:<id>` with snapshot first |

Route handlers use `RouteContext<"/api/runs/[id]/stream">`; pages use `PageProps<"/…">` and layouts
`LayoutProps<"/">` (Next 16 global types).

---

## 18. Odyssey UI: gaps and the workarounds used (keep them)

1. **No image component** (`img` is forbidden): phone frames use `IPhoneMockup`; tablet/desktop frames use a
   plain `<img>` in `device-screen.tsx` with a `CODE-09` deviation comment and an eslint-disable for
   `@next/next/no-img-element` (base64 frames).
2. Odyssey `Toaster` returns a fresh array from `getServerSnapshot` → mount it after hydration.
3. Odyssey `Input` doesn't render validation messages → the form error Alert lists them.
4. Password reveal button lacks `aria-pressed` (library a11y gap; not fixed in-app).
5. `validate_jsx` rejects app-level components and `~/` imports (validate snippets with imports included).
6. `validate_jsx` contradictions: `DescriptionList.Item` and `Select.Item` inside `Select.ComboBox` are
   flagged though documented; the code is correct.
7. Compound statics are undefined in Server Components → put them in client components.
8. The icon barrel needs `optimizePackageImports`.
9. Registry entries miss props/examples for Form, Toggle (use its `label` prop, no `<label>`), Accordion
   (`Accordion.Item/Trigger/Panel`), Select (`selectedKey`/`onSelectionChange` work), Tabs.
10. No checkbox-group component → `div role="group" aria-labelledby`.
11. `FeaturedIcon` requires `color`; `Breadcrumbs` takes `items`.
12. Use `Select.ComboBox` for searchable lists (React Aria props pass through).

---

## 19. Next.js 16 specifics (don't "fix" these back to older patterns)

- Read `node_modules/next/dist/docs/` before writing Next code; this version differs from older training data.
- `proxy.ts` replaces `middleware.ts` (default export `proxy`, `config.matcher`).
- `cacheComponents: true`: anything reading cookies/time/DB at request time must be dynamic — `getUser()`
  calls `await connection()`; the console layout sets `export const instant = false` and wraps the user-bound
  shell in `<Suspense>`; `new Date()` during prerender otherwise errors.
- `forbidden()` needs `experimental.authInterrupts`; add `app/forbidden.tsx`.
- `refresh()` from `next/cache` inside server actions re-renders the current route.
- `params`/`searchParams` are Promises (`await params`).
- Global typed helpers `PageProps<route>`, `LayoutProps<route>`, `RouteContext<route>`.
- `next dev` writes `AGENTS.md`; commit it unchanged.

---

## 20. Known limitations (intentional; marked `ponytail:` in code)

- Internal-host guard checks literal hostnames only (DNS rebinding passes) — isolate the worker's network if
  tests come from untrusted people.
- Stop polls Redis every 500 ms per running test — switch to pub/sub if many runs go in parallel.
- `createOwner` uses a count check, not a lock (two simultaneous first-run submits could both pass).
- GitHub sync only covers default-branch commits; PR lines are the PR's full diff.
- No session caching between runs: each run re-runs the sign-in test.
- Never tested against a real GitHub org in development (no token was available) — verify with a real
  fine-grained token before relying on it.

---

## 21. Build phases (in order, each with acceptance checks)

**Phase 0 — scaffold.** `create-next-app` (TS, App Router, ESLint, Tailwind v4), Next 16.4.3, React 19.3.
Copy `package.json` deps/scripts, `next.config.ts`, `tsconfig.json`, `.npmrc`, `.env.example`, `.gitignore`
additions (`!.env.example`, `/e2e/failure.png`), `globals.css`, `eslint.config.mjs` (Appendix A). Delete the
starter page and `public/*.svg`. Install, `npx playwright install chromium`, create `.env.local`.
✔ `npm run typecheck` and `npm run lint` pass; `npm run dev` serves.

**Phase 1 — core libs.** `lib/env.ts, permissions.ts, crypto.ts, db.ts, redis.ts, auth.ts, forms.ts, net.ts,
net.test.ts` (verbatim). ✔ `node --test lib/net.test.ts` passes; a scratch script can encrypt/decrypt and
connect to Mongo/Redis.

**Phase 2 — app shell and auth.** Root layout, providers, forbidden page, `app/ui/*`, login page/form/actions,
`proxy.ts`, console layout + shell + live-refresh, `/api/live`. ✔ First visit shows owner setup; creating the
owner lands on the dashboard; sign out/in works; 11 wrong passwords lock the email for 15 min; a Viewer can't
open Settings (403 page).

**Phase 3 — settings.** Users, roles, audit pages and actions. ✔ Create an Admin and a custom role; the last
Owner can't be demoted/disabled; built-in roles are read-only; every change appears in the audit log.

**Phase 4 — GitHub.** `lib/github.ts`, repos page + org card + actions, `lib/analytics.ts`, dashboard,
contributors pages, charts, range control, leaderboard. Worker skeleton with the sync worker and scheduler.
✔ With seeded data (see the smoke test: 3 non-merge commits of 120/40/15 additions plus a merge commit of 999)
the dashboard shows Lines added **175**; hiding the repo removes it for a Viewer but not for someone with
`hidden:view`; with a real fine-grained token, connect syncs repos/commits/PRs and "Sync now" works.

**Phase 5 — webhooks.** Webhook route, hooks page, hooks worker + `runHook`. ✔ A correctly signed push gets
202 and the event shows "Ran"; a bad signature gets 401; the same delivery id again gets 200 and doesn't run
twice; the hooks page updates live.

**Phase 6 — test runner.** `lib/testdsl.ts` (+ tests), `lib/devices.ts`, `lib/plan.ts`, `lib/runner.ts`,
`/api/runs/[id]/stream`, tests worker, apps pages, app actions, tests table, run page, `device-screen.tsx`,
the workbench without AI. ✔ `npm test` passes; a test against the app's login page streams frames into the
phone mockup and passes; Desktop Chrome shows a plain frame; Stop during `wait for "never"` stops within ~1 s
and records **Stopped**; a test with "Start signed in with" runs the login test's steps first
(`[Login with OTP] …`) and then its own in the same browser.

**Phase 7 — devices, sessions, Markdown editor, versions.** `run-setup.tsx`, `test-preview.tsx`, Tabs,
versions in `saveTest`, versions table, legacy header migration. ✔ Device buttons and custom size work;
Preview flags invalid lines; Save creates a version; Restore restores markdown + device + session.

**Phase 8 — AI.** `lib/ai.ts`, `generateSteps`, the AI box. ✔ The verification prompt in §13 produces the full
OTP login; "Update test with AI" with "scroll to the bottom and back to the top" only adds those steps; the
saved password never appears in the request (log/inspect it) nor in the test; both the before-state and the AI
answer appear under Versions.

**Phase 9 — verification and docs.** `e2e/smoke.mjs`, README, `docs/ui-completion-record.md`.
✔ `npm run typecheck && npm run lint && npm test && npm run build` pass; `npm run e2e` (dev server + one
worker running, **local** DB only — it wipes data) passes with zero browser console errors; no horizontal
scroll at 320 px on every page.

---

## 22. Verification details

**Unit (`node --test lib/*.test.ts`):** host guard (blocked: localhost, 127.0.0.1, 10.1.2.3, 172.20.0.5,
192.168.1.1, 169.254.169.254, metadata.google.internal, [::1], fd00::1, 0.0.0.0; allowed:
app.aijobexpert.com, fonts.googleapis.com, 8.8.8.8, 172.32.0.1; the app's own host even if `localhost`);
parser (every step form, prose/header lines/fences ignored, unknown steps with line numbers, empty test,
`fillVars`); devices (`resolveDevice`, aliases, sizes, `frameShape`); `splitHeader`. Full test files in
Appendix A.

**End-to-end smoke (`e2e/smoke.mjs`):** refuses a non-local Mongo; clears every collection except roles
(including `testVersions`); owner setup; seeds org `acme-inc`, repo `acme-inc/web`, contributors Ana Lima
(`gh:1`) and Bo (`email:bo@acme.test`), the commits/PR above; asserts the dashboard numbers and leaderboard
row; opens every page and checks status 200 + h1; posts webhooks (bad sig 401, good 202, repeat 200) and waits
for the hook to run; creates app "AI Job Expert (dev)" and test "Login screen loads" with
`go to / · wait for url /login · fill "Email address" with "demo.user@example.com" · fill "Password" with
"not-a-real-password" · tap "SHOW" · count "input" as inputs · expect at least 2 "input"`, asserts
"7 steps on iPhone 15.", runs it, waits for "Run passed", checks every step has a screenshot and `inputs ≥ 2`,
opens the run page; asserts no unexpected console errors. Note: the seeded `acme-inc` org has a fake token
and will log a sync failure every 15 min until removed.

**Manual checklist:** keyboard-only pass through every form and dialog (focus lands sensibly, Escape closes
dialogs, focus starts on Cancel in confirms); screen-reader announcements in the live run; dark mode;
200 % zoom; contrast of any text you compose on tinted backgrounds.

---

## Appendix A — core source (copy verbatim)

These files define the behaviour above exactly. Create them with this content.

### `package.json`

````json
{
  "name": "sqa",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "worker": "tsx --env-file=.env.local worker/index.ts",
    "test": "node --test lib/*.test.ts",
    "typecheck": "tsc --noEmit",
    "e2e": "node e2e/smoke.mjs"
  },
  "dependencies": {
    "@your-job-search-genius/odyssey-ui": "^2.4.1",
    "bullmq": "^6.5.3",
    "ioredis": "^6.0.0",
    "jose": "^6.2.15",
    "mongodb": "^7.8.0",
    "next": "16.4.3",
    "octokit": "^5.0.5",
    "playwright": "^1.64.1",
    "react": "19.3.0",
    "react-aria-components": "^1.22.1",
    "react-dom": "19.3.0",
    "server-only": "^0.0.1",
    "zod": "^4.6.7"
  },
  "devDependencies": {
    "@tailwindcss/turbopack": "^4",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9",
    "eslint-config-next": "16.4.3",
    "tailwindcss": "^4",
    "tsx": "^4.23.15",
    "typescript": "^5"
  },
  "type": "module"
}
````

### `next.config.ts`

````ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    agentFeedback: true,
    authInterrupts: true, // enables forbidden() for permission checks
    // The icon barrel re-exports ~1,000 icons; without this, dev pages load all of them.
    optimizePackageImports: ["@your-job-search-genius/odyssey-ui"],
    // Console pages read the session and live data on every request by design (see (console)/layout.tsx),
    // so only validate segments that opt in with `export const instant`.
    instantInsights: { validationLevel: "manual-warning" },
  },
  cacheComponents: true,
  partialPrefetching: true,
  // Odyssey UI ships TypeScript source that resolves its internals through "@/".
  transpilePackages: ["@your-job-search-genius/odyssey-ui"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
````

### `tsconfig.json`

````json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": [
      "dom",
      "dom.iterable",
      "esnext"
    ],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": [
        "./node_modules/@your-job-search-genius/odyssey-ui/*"
      ],
      "~/*": [
        "./*"
      ]
    },
    "allowImportingTsExtensions": true
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts",
    "**/*.mts"
  ],
  "exclude": [
    "node_modules",
    "spikes"
  ]
}
````

### `eslint.config.mjs`

````js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
````

### `.npmrc`

````
@your-job-search-genius:registry=https://npm.pkg.github.com
````

### `.env.example`

````
MONGODB_URI=mongodb://127.0.0.1:27017/repo-pulse
REDIS_URL=redis://127.0.0.1:6379
# openssl rand -base64 48
SESSION_SECRET=
# openssl rand -base64 32  (encrypts GitHub tokens, webhook secrets and test-app passwords; never rotate without re-encrypting)
ENCRYPTION_KEY=
# Public URL GitHub webhooks are sent to
APP_URL=http://localhost:3000

# Groq key for "Generate with AI" in the test editor (optional; server-side only)
GROQ_API_KEY=
# GROQ_MODEL=openai/gpt-oss-120b
````

### `app/globals.css`

````css
@import "@your-job-search-genius/odyssey-ui/styles/globals.css";
````

### `proxy.ts`

````ts
import { NextResponse, type NextRequest } from "next/server";

// Optimistic check only (cookie present). Real authorization happens in lib/auth.ts on every request.
export default function proxy(req: NextRequest) {
  if (!req.cookies.has("session")) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}

export const config = {
  // Public: login, GitHub webhooks (HMAC-verified), Next internals and static files.
  matcher: ["/((?!login|api/webhooks|_next/|favicon.ico).*)"],
};
````

### `lib/env.ts`

````ts
import { z } from "zod";

export const env = z
  .object({
    MONGODB_URI: z.string().default("mongodb://127.0.0.1:27017/repo-pulse"),
    REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
    SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
    ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, "base64").length === 32, "ENCRYPTION_KEY must be 32 bytes, base64-encoded"),
    APP_URL: z.url().default("http://localhost:3000"),
  })
  .parse(process.env);
````

### `lib/permissions.ts`

````ts
// Pure data, safe to import from client components (the shell hides nav items with it).
// Hiding UI is never authorization: every server action and query re-checks via requirePermission().

export const PERMISSIONS = {
  "analytics:view": "See dashboards, contributors and the leaderboard for visible repos",
  "hidden:view": "See hidden orgs and repos and include them in totals",
  "scope:manage": "Enable, disable or hide orgs and repos",
  "sync:run": "Start a sync and see sync errors",
  "hooks:view": "See webhook events and webhook secrets",
  "token:manage": "Add, replace or remove GitHub tokens",
  "users:manage": "Create users, reset passwords, assign roles",
  "roles:manage": "Create and edit roles",
  "audit:view": "Read the audit log",
  "apps:manage": "Add and edit apps under test and their test logins",
  "tests:view": "See tests and run results",
  "tests:edit": "Create and edit tests",
  "tests:run": "Run tests against dev and staging apps",
  "tests:run-production": "Run tests against production apps",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const BUILT_IN_ROLES: { name: string; permissions: Permission[] }[] = [
  { name: "Owner", permissions: ALL_PERMISSIONS },
  {
    name: "Admin",
    permissions: ALL_PERMISSIONS.filter((p) => !["token:manage", "users:manage", "roles:manage"].includes(p)),
  },
  { name: "Viewer", permissions: ["analytics:view", "tests:view"] },
];
````

### `lib/crypto.ts`

````ts
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { env } from "./env";

const key = Buffer.from(env.ENCRYPTION_KEY, "base64");
const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

/** AES-256-GCM. Output: base64(iv).base64(tag).base64(ciphertext). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

export function decrypt(sealed: string): string {
  const [iv, tag, data] = sealed.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(pw, salt, 64);
  return `${salt.toString("base64")}.${hash.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(".").map((p) => Buffer.from(p, "base64"));
  const test = await scryptAsync(pw, salt, 64);
  return timingSafeEqual(test, hash);
}

/** GitHub's X-Hub-Signature-256 check, constant-time. */
export function verifyGithubSignature(secret: string, body: string, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from("sha256=" + createHmac("sha256", secret).update(body).digest("hex"));
  const got = Buffer.from(header);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export const randomSecret = () => randomBytes(32).toString("hex");
````

### `lib/db.ts`

````ts
import { MongoClient, ObjectId } from "mongodb";
import { env } from "./env";
import { BUILT_IN_ROLES, type Permission } from "./permissions";

export { ObjectId };

export interface User {
  _id: ObjectId;
  email: string;
  name: string;
  passwordHash: string;
  roleId: ObjectId;
  disabled?: boolean;
  createdAt: Date;
}
export interface Role {
  _id: ObjectId;
  name: string;
  permissions: Permission[];
  builtIn: boolean;
}
export interface Org {
  _id: ObjectId;
  ghId: number;
  login: string;
  token: string; // encrypted
  tokenScopes: string[] | null; // classic tokens report scopes; fine-grained tokens report none
  webhookSecret: string; // encrypted
  enabled: boolean;
  hidden: boolean;
  lastSyncAt?: Date;
  syncError?: string | null;
  createdAt: Date;
}
export interface Repo {
  _id: ObjectId;
  ghId: number;
  orgId: ObjectId;
  name: string;
  fullName: string;
  isPrivate: boolean;
  isArchived: boolean;
  defaultBranch: string | null;
  enabled: boolean;
  hidden: boolean;
  lastCommitAt?: Date; // newest commit we have; next sync asks GitHub for commits since this
  lastPrUpdatedAt?: Date;
  lastSyncAt?: Date;
  syncError?: string | null;
}
/** _id is "gh:<accountId>" when GitHub knows the author, else "email:<address>". */
export interface Contributor {
  _id: string;
  login?: string;
  name?: string;
  avatarUrl?: string;
  emails: string[];
}
export interface Commit {
  _id: ObjectId;
  repoId: ObjectId;
  sha: string;
  contributorId: string;
  committedAt: Date;
  additions: number;
  deletions: number;
  isMerge: boolean; // excluded from line totals so a change isn't counted twice
  message: string;
  url: string;
}
export interface PullRequest {
  _id: ObjectId;
  repoId: ObjectId;
  number: number;
  title: string;
  contributorId: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  createdAt: Date;
  updatedAt: Date;
  mergedAt: Date | null;
  additions: number;
  deletions: number;
  commitCount: number;
  url: string;
}
export interface HookEvent {
  _id: ObjectId;
  deliveryId: string;
  type: string;
  action?: string;
  orgId: ObjectId;
  repoId?: ObjectId;
  summary: string;
  status: "queued" | "done" | "failed";
  error?: string;
  receivedAt: Date;
  processedAt?: Date;
}
export interface AuditEntry {
  _id: ObjectId;
  actorId: ObjectId;
  actorEmail: string;
  action: string;
  target: string;
  details?: Record<string, unknown>;
  at: Date;
}
export type Environment = "dev" | "staging" | "production";
export interface App {
  _id: ObjectId;
  name: string;
  baseUrl: string;
  environment: Environment;
  testLogin?: { email: string; password: string /* encrypted */ };
  createdAt: Date;
}
export interface Test {
  _id: ObjectId;
  appId: ObjectId;
  name: string;
  markdown: string;
  /** Playwright device name or a size like "1366x768". Missing on tests saved before it became a setting. */
  device?: string;
  /** Another test in the same app that runs first, so this one starts signed in. */
  sessionTestId?: ObjectId | null;
  updatedAt: Date;
  updatedBy: string;
}
/** A snapshot of a test, taken on every save and every AI generation, so any earlier state can be restored. */
export interface TestVersion {
  _id: ObjectId;
  testId: ObjectId;
  markdown: string;
  device: string;
  sessionTestId: ObjectId | null;
  source: "saved" | "draft" | "ai";
  prompt?: string;
  at: Date;
  by: string;
}
export type RunStatus = "queued" | "running" | "passed" | "failed" | "stopped";
export interface StepResult {
  text: string;
  status: "pending" | "running" | "passed" | "failed" | "skipped";
  ms?: number;
  note?: string;
  screenshot?: string; // base64 jpeg of the screen after the step
}
export interface TestRun {
  _id: ObjectId;
  testId: ObjectId;
  appId: ObjectId;
  testName: string;
  device: string;
  status: RunStatus;
  steps: StepResult[];
  values: Record<string, number>;
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  by: string;
}

const g = globalThis as unknown as { _mongo?: MongoClient; _dbReady?: Promise<void> };
const client = (g._mongo ??= new MongoClient(env.MONGODB_URI));
const db = client.db();

export const col = {
  users: db.collection<User>("users"),
  roles: db.collection<Role>("roles"),
  orgs: db.collection<Org>("orgs"),
  repos: db.collection<Repo>("repos"),
  contributors: db.collection<Contributor>("contributors"),
  commits: db.collection<Commit>("commits"),
  pulls: db.collection<PullRequest>("pullRequests"),
  hookEvents: db.collection<HookEvent>("hookEvents"),
  audit: db.collection<AuditEntry>("auditLog"),
  apps: db.collection<App>("apps"),
  tests: db.collection<Test>("tests"),
  runs: db.collection<TestRun>("testRuns"),
  versions: db.collection<TestVersion>("testVersions"),
};

/** Indexes + built-in roles. Idempotent; memoised per process. */
export function dbReady(): Promise<void> {
  return (g._dbReady ??= (async () => {
    await Promise.all([
      col.users.createIndex({ email: 1 }, { unique: true }),
      col.roles.createIndex({ name: 1 }, { unique: true }),
      col.orgs.createIndex({ ghId: 1 }, { unique: true }),
      col.repos.createIndex({ ghId: 1 }, { unique: true }),
      col.repos.createIndex({ orgId: 1 }),
      col.contributors.createIndex({ emails: 1 }),
      col.commits.createIndex({ repoId: 1, sha: 1 }, { unique: true }),
      col.commits.createIndex({ repoId: 1, committedAt: -1 }),
      col.commits.createIndex({ contributorId: 1, committedAt: -1 }),
      col.pulls.createIndex({ repoId: 1, number: 1 }, { unique: true }),
      col.pulls.createIndex({ contributorId: 1, createdAt: -1 }),
      col.pulls.createIndex({ repoId: 1, createdAt: -1 }),
      col.hookEvents.createIndex({ deliveryId: 1 }, { unique: true }),
      col.hookEvents.createIndex({ receivedAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 }),
      col.audit.createIndex({ at: -1 }),
      col.tests.createIndex({ appId: 1 }),
      col.runs.createIndex({ testId: 1, createdAt: -1 }),
      col.versions.createIndex({ testId: 1, at: -1 }),
    ]);
    for (const r of BUILT_IN_ROLES) {
      // Built-in roles keep their permissions in sync with code on every boot.
      await col.roles.updateOne(
        { name: r.name },
        { $set: { permissions: r.permissions, builtIn: true } },
        { upsert: true },
      );
    }
  })().catch((e) => {
    g._dbReady = undefined; // let the next call retry instead of caching a failed boot
    throw e;
  }));
}

export const oid = (id: string) => (ObjectId.isValid(id) ? new ObjectId(id) : null);
````

### `lib/redis.ts`

````ts
import IORedis from "ioredis";
import { Queue } from "bullmq";
import { env } from "./env";

const g = globalThis as unknown as { _redis?: IORedis; _queues?: ReturnType<typeof makeQueues> };

// maxRetriesPerRequest: null is required by BullMQ for blocking connections.
export const redis = (g._redis ??= new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null }));

function makeQueues() {
  const opts = { connection: redis, defaultJobOptions: { removeOnComplete: 500, removeOnFail: 1000 } };
  return {
    sync: new Queue<SyncJob>("sync", opts),
    hooks: new Queue<{ eventId: string }>("hooks", opts),
    tests: new Queue<{ runId: string }>("tests", opts),
  };
}
export type SyncJob = { orgId: string } | { all: true };
export const queues = (g._queues ??= makeQueues());

/** Channel names. "live" carries small dashboard events; "run:<id>" carries a test run's frames and steps. */
export const LIVE = "live";
export const runChannel = (runId: string) => `run:${runId}`;
export const runStopKey = (runId: string) => `run:${runId}:stop`;

export type LiveEvent =
  | { type: "sync.done"; orgId: string; org: string }
  | { type: "hook.fired"; event: string; repo?: string }
  | { type: "run.finished"; runId: string; status: string };

export const publish = (channel: string, data: unknown) => redis.publish(channel, JSON.stringify(data));

/**
 * Dedicated subscriber connection (a subscribed client can't run other commands).
 * `ready` resolves once Redis confirms the subscription, so nothing published after it is missed.
 */
export function subscribe(channel: string, onMessage: (data: string) => void) {
  const sub = redis.duplicate();
  const ready = sub.subscribe(channel).catch(() => {});
  sub.on("message", (_c, msg) => onMessage(msg));
  return { ready, close: () => void sub.quit().catch(() => sub.disconnect()) };
}
````

### `lib/auth.ts`

````ts
import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { forbidden, redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { col, dbReady, ObjectId } from "./db";
import { env } from "./env";
import type { Permission } from "./permissions";

const COOKIE = "session";
const TTL_DAYS = 7;
const key = new TextEncoder().encode(env.SESSION_SECRET);

export async function createSession(userId: string) {
  const expires = new Date(Date.now() + TTL_DAYS * 864e5);
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(key);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function deleteSession() {
  (await cookies()).delete(COOKIE);
}

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: Permission[];
};

/**
 * Data Access Layer entry point. The cookie only proves who you are; role and permissions are
 * read from MongoDB on every request, so disabling a user or editing a role applies immediately.
 */
export const getUser = cache(async (): Promise<SessionUser | null> => {
  // Everything behind auth reads live data (and the Mongo driver uses timestamps), so render at request time.
  await connection();
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  let sub: string | undefined;
  try {
    sub = (await jwtVerify(token, key, { algorithms: ["HS256"] })).payload.sub;
  } catch {
    return null;
  }
  if (!sub || !ObjectId.isValid(sub)) return null;
  await dbReady();
  const user = await col.users.findOne({ _id: new ObjectId(sub), disabled: { $ne: true } });
  if (!user) return null;
  const role = await col.roles.findOne({ _id: user.roleId });
  return { id: sub, email: user.email, name: user.name, role: role?.name ?? "No role", permissions: role?.permissions ?? [] };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export async function requirePermission(p: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.permissions.includes(p)) forbidden();
  return user;
}

export const can = (user: SessionUser, p: Permission) => user.permissions.includes(p);

export async function audit(user: SessionUser, action: string, target: string, details?: Record<string, unknown>) {
  await col.audit.insertOne({
    _id: new ObjectId(),
    actorId: new ObjectId(user.id),
    actorEmail: user.email,
    action,
    target,
    details,
    at: new Date(),
  });
}
````

### `lib/forms.ts`

````ts
import type { ZodError } from "zod";

/** What every server action used with <ActionForm> returns. */
export type ActionResult = { ok?: string; error?: string; fieldErrors?: Record<string, string> } | null;

/** zod error → field messages keyed by input `name` (first message per field). */
export function fieldErrors(err: ZodError): ActionResult {
  const out: Record<string, string> = {};
  for (const i of err.issues) out[String(i.path[0] ?? "form")] ??= i.message;
  return { fieldErrors: out, error: "Some fields need fixing. Check the message under each one." };
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
````

### `lib/net.ts`

````ts
// Pure module (no imports) so `node --test lib/net.test.ts` can check it directly.

/**
 * Tests drive a real browser on our server, so keep them away from internal addresses (Redis, Mongo,
 * cloud metadata). The app under test's own host is always allowed, even if it's private.
 * ponytail: checks the literal hostname only; a public name that resolves to a private IP (DNS rebinding)
 * gets through. Run the worker in a network-isolated container if tests come from people you don't trust.
 */
export function isBlockedHost(hostname: string, allowed: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === allowed.toLowerCase()) return false;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h === "::1" || h === "0.0.0.0") return true;
  const ip = h.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (!ip) return /^(fc|fd|fe80)/.test(h) && h.includes(":"); // IPv6 private / link-local
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}
````

### `lib/sse.ts`

````ts
import { subscribe } from "./redis";

/**
 * Streams a Redis channel to the browser as Server-Sent Events until the client disconnects.
 * `snapshot` (optional) is read after the subscription is live and sent first; messages that
 * arrive meanwhile are held and sent right after it, so the client never misses an update.
 */
export function sseFromChannel(req: Request, channel: string, snapshot?: () => Promise<unknown>): Response {
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (s: string) => {
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          cleanup(); // stream already closed
        }
      };
      send(": connected\n\n");
      const held: string[] = [];
      let live = false;
      const sub = subscribe(channel, (msg) => (live ? send(`data: ${msg}\n\n`) : held.push(msg)));
      const ping = setInterval(() => send(": ping\n\n"), 25_000); // keeps proxies from closing idle streams
      cleanup = () => {
        clearInterval(ping);
        sub.close();
        cleanup = () => {};
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
      await sub.ready;
      if (snapshot) send(`data: ${JSON.stringify(await snapshot())}\n\n`);
      for (const msg of held) send(`data: ${msg}\n\n`);
      live = true;
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
````

### `lib/github.ts`

````ts
import { Octokit } from "octokit";
import type { AnyBulkWriteOperation } from "mongodb";
import { col, ObjectId, type Commit, type Contributor, type Org, type PullRequest, type Repo } from "./db";
import { decrypt } from "./crypto";

/** Classic-token scopes that grant write access. Fine-grained tokens don't report scopes at all. */
const WRITE_SCOPES = new Set([
  "repo", "public_repo", "admin:org", "write:org", "delete_repo", "workflow",
  "admin:repo_hook", "admin:org_hook", "write:packages", "write:discussion",
]);

export const writeScopesOf = (scopes: string[] | null) => (scopes ?? []).filter((s) => WRITE_SCOPES.has(s));

/** A GitHub client that physically can't write: only GET requests and GraphQL queries pass. */
export function github(token: string) {
  const o = new Octokit({
    auth: token,
    throttle: {
      onRateLimit: (_after: number, _o: unknown, _k: unknown, retryCount: number) => retryCount < 2,
      onSecondaryRateLimit: (_after: number, _o: unknown, _k: unknown, retryCount: number) => retryCount < 2,
    },
  });
  o.hook.before("request", (options) => {
    const isGraphql = options.url === "/graphql";
    const query = String((options as { query?: unknown }).query ?? "");
    if (isGraphql ? /^\s*mutation\b/.test(query) : options.method !== "GET") {
      throw new Error(`Blocked a non-read GitHub call: ${options.method} ${options.url}`);
    }
  });
  return o;
}

export async function checkToken(token: string, orgLogin: string) {
  const res = await github(token).request("GET /orgs/{org}", { org: orgLogin });
  const header = res.headers["x-oauth-scopes"];
  const scopes = typeof header === "string" ? header.split(",").map((s) => s.trim()).filter(Boolean) : null;
  return {
    ghId: res.data.id,
    login: res.data.login,
    scopes,
    writeScopes: writeScopesOf(scopes),
  };
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

/** Lists the org's repos, then syncs commits and PRs for every enabled repo. */
export async function syncOrg(orgId: ObjectId) {
  const org = await col.orgs.findOne({ _id: orgId });
  if (!org?.enabled) return null;
  const o = github(decrypt(org.token));
  try {
    const repos = await o.paginate("GET /orgs/{org}/repos", { org: org.login, per_page: 100, type: "all" });
    for (const r of repos) {
      await col.repos.updateOne(
        { ghId: r.id },
        {
          $set: {
            orgId,
            name: r.name,
            fullName: r.full_name,
            isPrivate: r.private,
            isArchived: r.archived ?? false,
            defaultBranch: r.default_branch ?? null,
          },
          $setOnInsert: { enabled: true, hidden: false },
        },
        { upsert: true },
      );
    }
    for (const repo of await col.repos.find({ orgId, enabled: true }).toArray()) {
      try {
        await syncRepo(o, org, repo);
        await col.repos.updateOne({ _id: repo._id }, { $set: { lastSyncAt: new Date(), syncError: null } });
      } catch (e) {
        // One broken repo shouldn't stop the rest of the org.
        await col.repos.updateOne({ _id: repo._id }, { $set: { syncError: errorMessage(e) } });
      }
    }
    await col.orgs.updateOne({ _id: orgId }, { $set: { lastSyncAt: new Date(), syncError: null } });
    return org;
  } catch (e) {
    await col.orgs.updateOne({ _id: orgId }, { $set: { syncError: errorMessage(e) } });
    throw e;
  }
}

type GqlAuthor = { email: string | null; name: string | null; user: { databaseId: number; login: string; avatarUrl: string } | null } | null;
type CommitNode = {
  oid: string; url: string; committedDate: string; additions: number; deletions: number;
  messageHeadline: string; parents: { totalCount: number }; author: GqlAuthor;
};
type PrNode = {
  number: number; title: string; url: string; state: PullRequest["state"]; createdAt: string; updatedAt: string;
  mergedAt: string | null; additions: number; deletions: number; commits: { totalCount: number };
  author: { login: string; avatarUrl: string; databaseId?: number; name?: string | null } | null;
};

const COMMITS_QUERY = `query($owner:String!,$name:String!,$since:GitTimestamp,$after:String){
  repository(owner:$owner,name:$name){ defaultBranchRef{ target{ ... on Commit{
    history(first:50, since:$since, after:$after){
      pageInfo{ hasNextPage endCursor }
      nodes{ oid url committedDate additions deletions messageHeadline parents{ totalCount }
        author{ email name user{ databaseId login avatarUrl } } }
    } } } } } }`;

const PRS_QUERY = `query($owner:String!,$name:String!,$after:String){
  repository(owner:$owner,name:$name){
    pullRequests(first:50, after:$after, orderBy:{field:UPDATED_AT, direction:DESC}){
      pageInfo{ hasNextPage endCursor }
      nodes{ number title url state createdAt updatedAt mergedAt additions deletions commits{ totalCount }
        author{ login avatarUrl ... on User{ databaseId name } ... on Bot{ databaseId } } }
    } } }`;

function contributorFromCommit(a: GqlAuthor): Pick<Contributor, "_id" | "login" | "name" | "avatarUrl"> & { email?: string } {
  if (a?.user) return { _id: `gh:${a.user.databaseId}`, login: a.user.login, avatarUrl: a.user.avatarUrl, name: a.name ?? undefined, email: a.email ?? undefined };
  const email = (a?.email ?? "unknown").toLowerCase();
  return { _id: `email:${email}`, name: a?.name ?? email, email };
}

async function upsertContributors(list: ReturnType<typeof contributorFromCommit>[]) {
  if (!list.length) return;
  const ops: AnyBulkWriteOperation<Contributor>[] = list.map(({ _id, email, ...rest }) => {
    const set = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    return {
      updateOne: {
        filter: { _id },
        update: email ? { $set: set, $addToSet: { emails: email } } : { $set: set, $setOnInsert: { emails: [] } },
        upsert: true,
      },
    };
  });
  await col.contributors.bulkWrite(ops, { ordered: false });
}

/** Incremental: commits since the newest one we hold (minus a day of slack), PRs updated since last sync. */
export async function syncRepo(o: Octokit, org: Org, repo: Repo) {
  const owner = org.login;
  const name = repo.name;

  if (repo.defaultBranch) {
    const since = repo.lastCommitAt ? new Date(repo.lastCommitAt.getTime() - 864e5).toISOString() : undefined;
    let after: string | null = null;
    let newest = repo.lastCommitAt ?? new Date(0);
    do {
      const res: { repository: { defaultBranchRef: { target: { history: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: CommitNode[] } } } | null } | null } =
        await o.graphql(COMMITS_QUERY, { owner, name, since, after });
      const history = res.repository?.defaultBranchRef?.target?.history;
      if (!history) break; // empty repository
      const people = history.nodes.map((n) => contributorFromCommit(n.author));
      await upsertContributors(people);
      const ops: AnyBulkWriteOperation<Commit>[] = history.nodes.map((n, i) => {
        const committedAt = new Date(n.committedDate);
        if (committedAt > newest) newest = committedAt;
        return {
          updateOne: {
            filter: { repoId: repo._id, sha: n.oid },
            update: {
              $set: {
                contributorId: people[i]._id,
                committedAt,
                additions: n.additions,
                deletions: n.deletions,
                isMerge: n.parents.totalCount > 1,
                message: n.messageHeadline,
                url: n.url,
              },
            },
            upsert: true,
          },
        };
      });
      if (ops.length) await col.commits.bulkWrite(ops, { ordered: false });
      after = history.pageInfo.hasNextPage ? history.pageInfo.endCursor : null;
    } while (after);
    await col.repos.updateOne({ _id: repo._id }, { $set: { lastCommitAt: newest } });
  }

  const cutoff = repo.lastPrUpdatedAt ?? new Date(0);
  let newestPr = cutoff;
  let after: string | null = null;
  pages: do {
    const res: { repository: { pullRequests: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: PrNode[] } } | null } =
      await o.graphql(PRS_QUERY, { owner, name, after });
    const prs = res.repository?.pullRequests;
    if (!prs) break;
    const fresh = prs.nodes.filter((p) => new Date(p.updatedAt) > cutoff);
    const people = fresh.map((p) =>
      p.author?.databaseId
        ? { _id: `gh:${p.author.databaseId}`, login: p.author.login, avatarUrl: p.author.avatarUrl, name: p.author.name ?? undefined }
        : { _id: `login:${p.author?.login ?? "ghost"}`, login: p.author?.login ?? "ghost", name: p.author?.login ?? "ghost" },
    );
    await upsertContributors(people);
    const ops: AnyBulkWriteOperation<PullRequest>[] = fresh.map((p, i) => {
      const updatedAt = new Date(p.updatedAt);
      if (updatedAt > newestPr) newestPr = updatedAt;
      return {
        updateOne: {
          filter: { repoId: repo._id, number: p.number },
          update: {
            $set: {
              title: p.title,
              url: p.url,
              contributorId: people[i]._id,
              state: p.state,
              createdAt: new Date(p.createdAt),
              updatedAt,
              mergedAt: p.mergedAt ? new Date(p.mergedAt) : null,
              additions: p.additions,
              deletions: p.deletions,
              commitCount: p.commits.totalCount,
            },
          },
          upsert: true,
        },
      };
    });
    if (ops.length) await col.pulls.bulkWrite(ops, { ordered: false });
    // Results are newest-updated first, so the first stale PR means everything after it is stale too.
    if (fresh.length < prs.nodes.length) break pages;
    after = prs.pageInfo.hasNextPage ? prs.pageInfo.endCursor : null;
  } while (after);
  await col.repos.updateOne({ _id: repo._id }, { $set: { lastPrUpdatedAt: newestPr } });
}
````

### `lib/analytics.ts`

````ts
import "server-only";
import { col, type ObjectId } from "./db";
import { can, type SessionUser } from "./auth";

export type Range = { from: Date; to: Date; key: string; bucket: "day" | "week" };
const PRESETS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 };

/** ?range=30d, or ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive). Defaults to the last 30 days. */
export function parseRange(sp: { range?: string; from?: string; to?: string }): Range {
  const day = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null);
  const from = day(sp.from);
  const to = day(sp.to);
  let r: { from: Date; to: Date; key: string };
  if (from && to && from <= to) {
    r = { from, to: new Date(to.getTime() + 864e5), key: "custom" };
  } else {
    const key = sp.range && PRESETS[sp.range] ? sp.range : "30d";
    const end = new Date();
    r = { from: new Date(end.getTime() - PRESETS[key] * 864e5), to: end, key };
  }
  const days = (r.to.getTime() - r.from.getTime()) / 864e5;
  return { ...r, bucket: days > 120 ? "week" : "day" };
}

/**
 * The single place visibility is decided: enabled repos in enabled orgs, minus hidden ones unless
 * the user holds hidden:view. Every analytics query filters by this list.
 */
export async function visibleRepoIds(user: SessionUser): Promise<ObjectId[]> {
  const notHidden = can(user, "hidden:view") ? {} : { hidden: false };
  const orgs = await col.orgs.find({ enabled: true, ...notHidden }, { projection: { _id: 1 } }).toArray();
  const repos = await col.repos
    .find({ orgId: { $in: orgs.map((o) => o._id) }, enabled: true, ...notHidden }, { projection: { _id: 1 } })
    .toArray();
  return repos.map((r) => r._id);
}

const lineSum = (field: "additions" | "deletions") => ({ $sum: { $cond: ["$isMerge", 0, `$${field}`] } });

export async function overview(user: SessionUser, range: Range, contributorId?: string) {
  const repoIds = await visibleRepoIds(user);
  const who = contributorId ? { contributorId } : {};
  const commitMatch = { repoId: { $in: repoIds }, committedAt: { $gte: range.from, $lt: range.to }, ...who };

  const [totals] = await col.commits
    .aggregate<{ commits: number; additions: number; deletions: number; contributors: number }>([
      { $match: commitMatch },
      {
        $group: {
          _id: null,
          commits: { $sum: 1 },
          additions: lineSum("additions"),
          deletions: lineSum("deletions"),
          people: { $addToSet: "$contributorId" },
        },
      },
      { $project: { _id: 0, commits: 1, additions: 1, deletions: 1, contributors: { $size: "$people" } } },
    ])
    .toArray();

  const series = await col.commits
    .aggregate<{ _id: Date; commits: number; additions: number; deletions: number }>([
      { $match: commitMatch },
      {
        $group: {
          _id: { $dateTrunc: { date: "$committedAt", unit: range.bucket, startOfWeek: "monday" } },
          commits: { $sum: 1 },
          additions: lineSum("additions"),
          deletions: lineSum("deletions"),
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray();

  const prBase = { repoId: { $in: repoIds }, ...who };
  const [prsOpened, prsMerged] = await Promise.all([
    col.pulls.countDocuments({ ...prBase, createdAt: { $gte: range.from, $lt: range.to } }),
    col.pulls.countDocuments({ ...prBase, mergedAt: { $gte: range.from, $lt: range.to } }),
  ]);

  return {
    commits: totals?.commits ?? 0,
    additions: totals?.additions ?? 0,
    deletions: totals?.deletions ?? 0,
    contributors: totals?.contributors ?? 0,
    prsOpened,
    prsMerged,
    series: fillSeries(series, range),
    repoCount: repoIds.length,
  };
}

/** Zero-fill empty days/weeks so the chart's x axis is continuous. */
function fillSeries(rows: { _id: Date; commits: number; additions: number; deletions: number }[], range: Range) {
  const byKey = new Map(rows.map((r) => [r._id.toISOString().slice(0, 10), r]));
  const out: { date: string; commits: number; additions: number; deletions: number }[] = [];
  const step = range.bucket === "week" ? 7 : 1;
  const start = new Date(Date.UTC(range.from.getUTCFullYear(), range.from.getUTCMonth(), range.from.getUTCDate()));
  if (range.bucket === "week") start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7)); // back to Monday
  for (let d = start; d < range.to; d = new Date(d.getTime() + step * 864e5)) {
    const key = d.toISOString().slice(0, 10);
    const r = byKey.get(key);
    out.push({ date: key, commits: r?.commits ?? 0, additions: r?.additions ?? 0, deletions: r?.deletions ?? 0 });
  }
  return out;
}

export type LeaderRow = {
  id: string;
  name: string;
  login?: string;
  avatarUrl?: string;
  commits: number;
  additions: number;
  deletions: number;
  prsOpened: number;
  prsMerged: number;
};
export const LEADER_SORTS = ["lines", "commits", "additions", "deletions", "prs"] as const;
export type LeaderSort = (typeof LEADER_SORTS)[number];

export async function leaderboard(user: SessionUser, range: Range, sort: LeaderSort, limit = 100): Promise<LeaderRow[]> {
  const repoIds = await visibleRepoIds(user);
  const window = { $gte: range.from, $lt: range.to };
  const [commitRows, opened, merged] = await Promise.all([
    col.commits
      .aggregate<{ _id: string; commits: number; additions: number; deletions: number }>([
        { $match: { repoId: { $in: repoIds }, committedAt: window } },
        { $group: { _id: "$contributorId", commits: { $sum: 1 }, additions: lineSum("additions"), deletions: lineSum("deletions") } },
      ])
      .toArray(),
    col.pulls.aggregate<{ _id: string; n: number }>([
      { $match: { repoId: { $in: repoIds }, createdAt: window } },
      { $group: { _id: "$contributorId", n: { $sum: 1 } } },
    ]).toArray(),
    col.pulls.aggregate<{ _id: string; n: number }>([
      { $match: { repoId: { $in: repoIds }, mergedAt: window } },
      { $group: { _id: "$contributorId", n: { $sum: 1 } } },
    ]).toArray(),
  ]);

  const rows = new Map<string, Omit<LeaderRow, "name">>();
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) rows.set(id, (r = { id, commits: 0, additions: 0, deletions: 0, prsOpened: 0, prsMerged: 0 }));
    return r;
  };
  for (const c of commitRows) Object.assign(row(c._id), { commits: c.commits, additions: c.additions, deletions: c.deletions });
  for (const p of opened) row(p._id).prsOpened = p.n;
  for (const p of merged) row(p._id).prsMerged = p.n;

  const score: Record<LeaderSort, (r: Omit<LeaderRow, "name">) => number> = {
    lines: (r) => r.additions + r.deletions,
    commits: (r) => r.commits,
    additions: (r) => r.additions,
    deletions: (r) => r.deletions,
    prs: (r) => r.prsMerged * 1000 + r.prsOpened,
  };
  const top = [...rows.values()].sort((a, b) => score[sort](b) - score[sort](a)).slice(0, limit);
  const people = new Map(
    (await col.contributors.find({ _id: { $in: top.map((r) => r.id) } }).toArray()).map((c) => [c._id, c]),
  );
  return top.map((r) => {
    const p = people.get(r.id);
    return { ...r, name: p?.name || p?.login || r.id, login: p?.login, avatarUrl: p?.avatarUrl };
  });
}

export async function contributorActivity(user: SessionUser, id: string, range: Range) {
  const repoIds = await visibleRepoIds(user);
  const [person, commits, pulls, repos] = await Promise.all([
    col.contributors.findOne({ _id: id }),
    col.commits
      .find({ contributorId: id, repoId: { $in: repoIds }, committedAt: { $gte: range.from, $lt: range.to } })
      .sort({ committedAt: -1 })
      .limit(100)
      .toArray(),
    col.pulls
      .find({ contributorId: id, repoId: { $in: repoIds }, createdAt: { $gte: range.from, $lt: range.to } })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray(),
    col.repos.find({ _id: { $in: repoIds } }, { projection: { fullName: 1 } }).toArray(),
  ]);
  const repoName = new Map(repos.map((r) => [r._id.toString(), r.fullName]));
  return { person, commits, pulls, repoName };
}
````

### `lib/testdsl.ts`

````ts
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
````

### `lib/devices.ts`

````ts
// Playwright's device list, shaped for the device picker and the runner. Server only (imports playwright).
import { devices, type BrowserContextOptions } from "playwright";
import { customSize, frameShape } from "./testdsl";

export type DeviceKind = "phone" | "tablet" | "desktop";
export type DeviceInfo = { name: string; kind: DeviceKind; width: number; height: number; mobile: boolean };

// Mobile profiles use the full screen (no browser toolbars) so frames match the phone mockup.
// `screen` exists at runtime on descriptors but isn't in the DeviceDescriptor type.
const sizeOf = (d: (typeof devices)[string]) =>
  (d.isMobile && (d as { screen?: { width: number; height: number } }).screen) || d.viewport;

const KIND_ORDER: DeviceKind[] = ["phone", "tablet", "desktop"];

/** Every Playwright device except the landscape duplicates (a custom size covers those). */
export const DEVICE_LIST: DeviceInfo[] = Object.entries(devices)
  .filter(([name]) => !name.endsWith(" landscape"))
  .map(([name, d]) => {
    const { width, height } = sizeOf(d);
    const kind: DeviceKind = !d.isMobile ? "desktop" : Math.min(width, height) >= 600 ? "tablet" : "phone";
    return { name, kind, width, height, mobile: d.isMobile };
  })
  .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name));

export const DEVICE_NAMES = Object.keys(devices);

/** Browser context options for a parsed `device:` value (a Playwright name or a custom size). */
export function contextFor(device: string): { options: BrowserContextOptions; width: number; height: number; mobile: boolean } {
  const size = customSize(device);
  if (size) {
    const { width, height, mobile } = size;
    return {
      options: { viewport: { width, height }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 1 },
      width,
      height,
      mobile,
    };
  }
  const d = devices[device];
  const { width, height } = sizeOf(d);
  return { options: { ...d, viewport: { width, height } }, width, height, mobile: d.isMobile };
}

export const shapeOf = (device: string) => {
  const c = customSize(device) ?? (devices[device] ? contextFor(device) : null);
  return c ? frameShape(c.width, c.height, c.mobile) : "phone";
};
````

### `lib/plan.ts`

````ts
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
````

### `lib/runner.ts`

````ts
import { chromium } from "playwright";
import { col, ObjectId, type StepResult } from "./db";
import { decrypt } from "./crypto";
import { LIVE, publish, redis, runChannel, runStopKey } from "./redis";
import { runStep } from "./testdsl";
import { contextFor } from "./devices";
import { planRun, stepLabel } from "./plan";
import { isBlockedHost } from "./net";

const STEP_TIMEOUT_MS = 15_000;


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
      if (stopped) return await stopAt(i);
      steps[i].screenshot = await page
        .screenshot({ type: "jpeg", quality: 55, scale: "css" })
        .then((b) => b.toString("base64"))
        .catch(() => undefined);
      await col.runs.updateOne({ _id }, { $set: { [`steps.${i}`]: steps[i] } });
      await send({ t: "step", i, step: { ...steps[i], screenshot: undefined } });
      if (failed) {
        for (let j = i + 1; j < steps.length; j++) steps[j].status = "skipped";
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
````

### `lib/ai.ts`

````ts
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
````

### `worker/index.ts`

````ts
// Background worker: GitHub sync, webhook hooks, and browser test runs.
// Run: npm run worker   (separate process from `next dev`/`next start`)
import { Worker } from "bullmq";
import { col, dbReady, ObjectId, type HookEvent } from "../lib/db";
import { LIVE, publish, queues, redis, type SyncJob } from "../lib/redis";
import { syncOrg } from "../lib/github";
import { runTest } from "../lib/runner";

/**
 * Runs for every accepted push / pull_request webhook.
 * Placeholder on purpose: replace the body with real behaviour (e.g. trigger a repo sync or a test run).
 */
async function runHook(event: HookEvent) {
  console.log(`[hook] ${event.type}${event.action ? `.${event.action}` : ""}: ${event.summary}`);
}

async function main() {
  await dbReady();

  // A run left "running" by a crashed worker would otherwise look alive forever.
  await col.runs.updateMany(
    { status: { $in: ["running"] } },
    { $set: { status: "failed", error: "The worker restarted during this run.", finishedAt: new Date() } },
  );

  const sync = new Worker<SyncJob>(
    "sync",
    async (job) => {
      const ids = "orgId" in job.data
        ? [new ObjectId(job.data.orgId)]
        : (await col.orgs.find({ enabled: true }, { projection: { _id: 1 } }).toArray()).map((o) => o._id);
      for (const id of ids) {
        const org = await syncOrg(id).catch((e) => {
          console.error(`[sync] org ${id}:`, e instanceof Error ? e.message : e);
          return null;
        });
        if (org) await publish(LIVE, { type: "sync.done", orgId: id.toString(), org: org.login });
      }
    },
    { connection: redis, concurrency: 1 },
  );

  const hooks = new Worker<{ eventId: string }>(
    "hooks",
    async (job) => {
      const event = await col.hookEvents.findOne({ _id: new ObjectId(job.data.eventId) });
      if (!event) return;
      try {
        await runHook(event);
        await col.hookEvents.updateOne({ _id: event._id }, { $set: { status: "done", processedAt: new Date() }, $unset: { error: "" } });
      } catch (e) {
        await col.hookEvents.updateOne({ _id: event._id }, { $set: { status: "failed", error: String(e) } });
        throw e; // let BullMQ retry with backoff
      }
      const repo = event.repoId ? await col.repos.findOne({ _id: event.repoId }) : null;
      await publish(LIVE, { type: "hook.fired", event: event.type, repo: repo?.fullName });
    },
    { connection: redis, concurrency: 5 },
  );

  const tests = new Worker<{ runId: string }>("tests", (job) => runTest(job.data.runId), {
    connection: redis,
    concurrency: 2, // each run is a full Chromium; raise with the machine's memory
    lockDuration: 10 * 60_000,
  });

  await queues.sync.upsertJobScheduler("sync-all", { every: 15 * 60_000 }, { name: "all", data: { all: true } });

  for (const w of [sync, hooks, tests]) w.on("failed", (job, err) => console.error(`[${w.name}] job ${job?.id} failed:`, err.message));
  console.log("Worker ready: sync every 15 min, hooks, tests (2 at a time).");

  const shutdown = async () => {
    // Give running jobs 10s to finish, then exit anyway; BullMQ re-queues a job whose lock lapses.
    setTimeout(() => process.exit(1), 10_000).unref();
    await Promise.all([sync.close(), hooks.close(), tests.close()]);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
````

### `app/api/webhooks/github/route.ts`

````ts
import { col, dbReady, ObjectId } from "~/lib/db";
import { decrypt, verifyGithubSignature } from "~/lib/crypto";
import { queues } from "~/lib/redis";

const HANDLED = new Set(["push", "pull_request"]);
const reply = (status: number, message: string) => Response.json({ message }, { status });

type Payload = {
  action?: string;
  ref?: string;
  commits?: unknown[];
  pusher?: { name?: string };
  sender?: { login?: string };
  organization?: { id: number };
  repository?: { id: number; full_name?: string; owner?: { id: number } };
  pull_request?: { number: number; title: string };
};

/**
 * GitHub → here → Redis queue → worker's runHook(). Answers fast (GitHub gives up after 10s);
 * the work happens in the worker.
 */
export async function POST(req: Request) {
  const body = await req.text();
  const event = req.headers.get("x-github-event") ?? "";
  const deliveryId = req.headers.get("x-github-delivery") ?? "";
  let payload: Payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return reply(400, "Body must be JSON. Set the webhook content type to application/json.");
  }

  await dbReady();
  const ownerId = payload.organization?.id ?? payload.repository?.owner?.id;
  const org = ownerId ? await col.orgs.findOne({ ghId: ownerId }) : null;
  if (!org) return reply(404, "This organization isn't connected to Repo Pulse.");
  if (!verifyGithubSignature(decrypt(org.webhookSecret), body, req.headers.get("x-hub-signature-256"))) {
    return reply(401, "Signature doesn't match. Copy the secret from the Webhooks page again.");
  }
  if (event === "ping") return reply(200, "pong");
  if (!HANDLED.has(event)) return reply(202, `Ignored: ${event} events aren't used.`);
  if (!org.enabled) return reply(202, "Ignored: this organization is turned off.");

  const repo = payload.repository ? await col.repos.findOne({ ghId: payload.repository.id }) : null;
  if (repo && !repo.enabled) return reply(202, "Ignored: this repository is turned off.");

  const summary =
    event === "push"
      ? `${payload.pusher?.name ?? "Someone"} pushed ${payload.commits?.length ?? 0} commit(s) to ${payload.ref?.replace("refs/heads/", "") ?? "?"} in ${payload.repository?.full_name ?? "?"}`
      : `${payload.sender?.login ?? "Someone"} ${payload.action ?? "updated"} PR #${payload.pull_request?.number} "${payload.pull_request?.title ?? ""}" in ${payload.repository?.full_name ?? "?"}`;

  const _id = new ObjectId();
  try {
    // Unique deliveryId index: GitHub redeliveries and retries are stored and run once.
    await col.hookEvents.insertOne({
      _id,
      deliveryId: deliveryId || _id.toString(),
      type: event,
      action: payload.action,
      orgId: org._id,
      repoId: repo?._id,
      summary: summary.slice(0, 500),
      status: "queued",
      receivedAt: new Date(),
    });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return reply(200, "Already received this delivery.");
    throw e;
  }
  await queues.hooks.add("event", { eventId: _id.toString() }, { attempts: 3, backoff: { type: "exponential", delay: 5_000 } });
  return reply(202, "Queued.");
}
````

### `app/api/live/route.ts`

````ts
import { getUser } from "~/lib/auth";
import { LIVE } from "~/lib/redis";
import { sseFromChannel } from "~/lib/sse";

// Events only say "something changed"; the browser re-renders its page, which re-checks permissions.
export async function GET(req: Request) {
  if (!(await getUser())) return new Response("Sign in first.", { status: 401 });
  return sseFromChannel(req, LIVE);
}
````

### `app/api/runs/[id]/stream/route.ts`

````ts
import { getUser } from "~/lib/auth";
import { col, oid } from "~/lib/db";
import { runChannel } from "~/lib/redis";
import { sseFromChannel } from "~/lib/sse";

/** Live frames, step updates and status for one test run. First message is the run as stored. */
export async function GET(req: Request, { params }: RouteContext<"/api/runs/[id]/stream">) {
  const user = await getUser();
  if (!user) return new Response("Sign in first.", { status: 401 });
  if (!user.permissions.includes("tests:view")) return new Response("Your role can't view test runs.", { status: 403 });
  const { id } = await params;
  const _id = oid(id);
  if (!_id) return new Response("Unknown run.", { status: 404 });

  return sseFromChannel(req, runChannel(id), async () => {
    const run = await col.runs.findOne({ _id }, { projection: { "steps.screenshot": 0 } });
    return run
      ? { t: "snapshot", status: run.status, steps: run.steps, values: run.values, error: run.error ?? null }
      : { t: "status", status: "failed", error: "This run was deleted." };
  });
}
````

### `app/layout.tsx`

````tsx
import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

// Odyssey's theme reads --font-geist but doesn't load the font itself.
const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Repo Pulse", template: "%s · Repo Pulse" },
  description: "Read-only GitHub analytics and live browser tests",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

// Applies Odyssey's dark-mode class before first paint and follows OS changes.
const themeScript = `(()=>{const m=matchMedia("(prefers-color-scheme: dark)");const s=()=>document.documentElement.classList.toggle("dark-mode",m.matches);s();m.addEventListener("change",s)})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geist.variable} antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="bg-primary">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
````

### `app/providers.tsx`

````tsx
"use client";

import { useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { RouterProvider } from "react-aria-components";
import { Toaster } from "@your-job-search-genius/odyssey-ui/components/application/alerts/alert";

declare module "react-aria-components" {
  interface RouterConfig {
    routerOptions: NonNullable<Parameters<ReturnType<typeof useRouter>["push"]>[1]>;
  }
}

const noop = () => () => {};

/** Library links (Button href, sidebar items) navigate client-side through Next's router. */
export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  // Odyssey's Toaster returns a fresh array from getServerSnapshot, which React warns about during
  // SSR/hydration. Mounting it after hydration skips that path; toasts only fire after user actions anyway.
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  return (
    <RouterProvider navigate={router.push}>
      {children}
      {mounted && <Toaster />}
    </RouterProvider>
  );
}
````

### `app/ui/action-form.tsx`

````tsx
"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { Form } from "@your-job-search-genius/odyssey-ui/components/base/form/form";
import { Button } from "@your-job-search-genius/odyssey-ui/components/base/buttons/button";
import { Alert, toast } from "@your-job-search-genius/odyssey-ui/components/application/alerts/alert";

import type { ActionResult } from "~/lib/forms";

export type FormAction = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

/**
 * Shared form wiring: server-side validation errors land on fields by `name`, a form-level error shows
 * in an alert above the fields, success shows a toast. The submit button blocks double submits.
 */
export function ActionForm({
  action,
  submitLabel,
  pendingLabel,
  onSuccess,
  secondary,
  children,
}: {
  action: FormAction;
  submitLabel: string;
  pendingLabel?: string;
  onSuccess?: () => void;
  secondary?: ReactNode;
  children: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const handled = useRef<ActionResult>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state || handled.current === state) return;
    handled.current = state;
    if (state.ok) {
      toast.success(state.ok);
      onSuccess?.();
    } else if (state.fieldErrors) {
      // After a failed submit, put the keyboard on the first field that needs fixing.
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
    }
  }, [state, onSuccess]);

  return (
    <Form ref={formRef} action={formAction} validationErrors={state?.fieldErrors} validationBehavior="aria" className="flex flex-col gap-5" aria-busy={pending}>
      {state?.error && (
        // Odyssey's Input shows `hint` but not React Aria's validation message, so the summary carries
        // each field's message; the fields themselves are marked invalid and the first one gets focus.
        <Alert
          color="error"
          title={state.error}
          description={state.fieldErrors ? Object.values(state.fieldErrors).join(" ") : undefined}
          autoFocus={false}
        />
      )}
      {children}
      <div className="flex flex-wrap justify-end gap-3">
        {secondary}
        <Button type="submit" size="md" isLoading={pending} showTextWhileLoading>
          {pending ? (pendingLabel ?? submitLabel) : submitLabel}
        </Button>
      </div>
    </Form>
  );
}
````

### `app/ui/dialogs.tsx`

````tsx
"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Dialog, DialogTrigger, Modal, ModalBody, ModalFooter, ModalHeader, ModalOverlay } from "@your-job-search-genius/odyssey-ui/components/application/modals/modal";
import { Button } from "@your-job-search-genius/odyssey-ui/components/base/buttons/button";
import { toast } from "@your-job-search-genius/odyssey-ui/components/application/alerts/alert";
import type { ActionResult } from "~/lib/forms";
import { ActionForm, type FormAction } from "./action-form";

type ButtonProps = { label: string; color?: "primary" | "secondary" | "tertiary" | "link-gray" | "link-color"; size?: "sm" | "md" };

/** A button that opens a form in a modal; the modal closes when the action succeeds. */
export function FormModal({
  trigger,
  title,
  description,
  action,
  submitLabel,
  pendingLabel,
  children,
}: {
  trigger: ButtonProps;
  title: string;
  description?: ReactNode;
  action: FormAction;
  submitLabel: string;
  pendingLabel?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <Button size={trigger.size ?? "md"} color={trigger.color ?? "primary"}>{trigger.label}</Button>
      <ModalOverlay isDismissable>
        <Modal size="lg">
          <Dialog>
            <ModalHeader title={title} description={description} />
            <ModalBody className="pb-6">
              <ActionForm
                action={action}
                submitLabel={submitLabel}
                pendingLabel={pendingLabel}
                onSuccess={() => setOpen(false)}
                secondary={<Button type="button" color="secondary" size="md" onClick={() => setOpen(false)}>Cancel</Button>}
              >
                {children}
              </ActionForm>
            </ModalBody>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}

/** Destructive action behind an alert dialog. Focus starts on Cancel, the safe choice. */
export function ConfirmButton({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  trigger: ButtonProps & { destructive?: boolean };
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<ActionResult | void>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <Button size={trigger.size ?? "sm"} color={trigger.destructive ? "secondary-destructive" : (trigger.color ?? "secondary")}>
        {trigger.label}
      </Button>
      <ModalOverlay isDismissable={!pending}>
        <Modal size="sm">
          <Dialog role="alertdialog">
            <ModalHeader title={title} description={description} autoFocus={false} />
            <ModalFooter className="flex justify-end gap-3 p-6">
              <Button color="secondary" size="md" autoFocus onClick={() => setOpen(false)} isDisabled={pending}>
                Cancel
              </Button>
              <Button
                color="primary-destructive"
                size="md"
                isLoading={pending}
                showTextWhileLoading
                onClick={() =>
                  start(async () => {
                    const res = await onConfirm();
                    if (res?.error) toast.error(res.error);
                    else {
                      if (res?.ok) toast.success(res.ok);
                      setOpen(false);
                    }
                  })
                }
              >
                {confirmLabel}
              </Button>
            </ModalFooter>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}
````

### `app/ui/empty.tsx`

````tsx
"use client";

import type { ReactNode } from "react";
import { EmptyState } from "@your-job-search-genius/odyssey-ui/components/application/empty-state/empty-state";
import {
  AlertCircle, ClipboardCheck, GitBranch01, SearchLg, Shield01, Users01, Zap,
} from "@your-job-search-genius/odyssey-ui/components/foundations/icons";

// Icons are functions, which Server Components can't pass to client components, so pages pick one by name.
const ICONS = { AlertCircle, ClipboardCheck, GitBranch01, SearchLg, Shield01, Users01, Zap };

export function Empty({
  icon,
  color = "gray",
  title,
  description,
  actions,
  size = "md",
}: {
  icon: keyof typeof ICONS;
  color?: "brand" | "gray" | "success" | "warning" | "error";
  title: string;
  description: ReactNode;
  actions?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <EmptyState size={size}>
      <EmptyState.Header>
        <EmptyState.FeaturedIcon icon={ICONS[icon]} color={color} />
      </EmptyState.Header>
      <EmptyState.Content>
        <EmptyState.Title>{title}</EmptyState.Title>
        <EmptyState.Description>{description}</EmptyState.Description>
      </EmptyState.Content>
      {actions && <EmptyState.Footer>{actions}</EmptyState.Footer>}
    </EmptyState>
  );
}
````

### `lib/net.test.ts`

````ts
// Run: node --test lib/net.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isBlockedHost } from "./net.ts";

test("blocks internal hosts but allows public ones and the app's own host", () => {
  for (const h of ["localhost", "127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.1.1", "169.254.169.254", "metadata.google.internal", "[::1]", "fd00::1", "0.0.0.0"]) {
    assert.equal(isBlockedHost(h, "app.aijobexpert.com"), true, h);
  }
  for (const h of ["app.aijobexpert.com", "fonts.googleapis.com", "8.8.8.8", "172.32.0.1"]) {
    assert.equal(isBlockedHost(h, "app.aijobexpert.com"), false, h);
  }
  assert.equal(isBlockedHost("localhost", "localhost"), false, "a local app under test stays reachable");
});
````

### `lib/testdsl.test.ts`

````ts
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
````

---

## Appendix B — test editor UI and test actions (copy verbatim)

The most intricate client code and the server actions it calls.

### `app/(console)/apps/[appId]/tests/[testId]/workbench.tsx`

````tsx
"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TextArea } from "@your-job-search-genius/odyssey-ui/components/base/textarea/textarea";
import { Button } from "@your-job-search-genius/odyssey-ui/components/base/buttons/button";
import { Alert, toast } from "@your-job-search-genius/odyssey-ui/components/application/alerts/alert";
import { Table, TableCard } from "@your-job-search-genius/odyssey-ui/components/application/table/table";
import { DescriptionList } from "@your-job-search-genius/odyssey-ui/components/base/description-list/description-list";
import { Tabs } from "@your-job-search-genius/odyssey-ui/components/application/tabs/tabs";
import { Heading } from "@your-job-search-genius/odyssey-ui/components/base/typography/heading";
import { Body2 } from "@your-job-search-genius/odyssey-ui/components/base/typography/body-2";
import { Play, Stop } from "@your-job-search-genius/odyssey-ui/components/foundations/icons";
import { customSize, frameShape, parseTest, resolveDevice, splitHeader, STEP_HELP } from "~/lib/testdsl";
import type { DeviceInfo } from "~/lib/devices";
import { DeviceScreen } from "../../../device-screen";
import { RunSetup } from "./run-setup";
import { TestPreview } from "./test-preview";
import type { StepResult } from "~/lib/db";
import { generateSteps, saveTest, startRun, stopRun, type TestDraft } from "../../../actions";
import { RUN, RunBadge, type RunState } from "../../../app-ui";

type Version = TestDraft & { id: string; at: string; by: string; source: "saved" | "draft" | "ai"; prompt: string | null; sessionName: string | null };
type History = { id: string; status: RunState; by: string; createdAt: string; ms: number | null; passed: number; total: number };
type LiveMsg =
  | { t: "snapshot"; status: RunState; steps: StepResult[]; values: Record<string, number>; error: string | null }
  | { t: "frame"; d: string }
  | { t: "step"; i: number; step: StepResult }
  | { t: "status"; status: RunState; error?: string; values?: Record<string, number> };

const STEP_MARK: Record<StepResult["status"], string> = { pending: "Waiting", running: "Running", passed: "Passed", failed: "Failed", skipped: "Skipped" };
const isLive = (s: RunState | null) => s === "queued" || s === "running";
const sameDraft = (a: TestDraft, b: TestDraft) => a.markdown === b.markdown && a.device === b.device && a.sessionTestId === b.sessionTestId;
const SOURCE = { saved: "Saved", draft: "Before AI edit", ai: "AI edit" } as const;

export function Workbench({
  testId,
  initial,
  canEdit,
  canRun,
  runBlockedReason,
  activeRunId,
  history,
  aiEnabled,
  devices,
  tests,
  versions,
}: {
  testId: string;
  initial: TestDraft;
  canEdit: boolean;
  canRun: boolean;
  runBlockedReason: string | null;
  activeRunId: string | null;
  history: History[];
  aiEnabled: boolean;
  devices: DeviceInfo[];
  /** Other tests in this app, which can provide the session. */
  tests: { id: string; name: string }[];
  /** Newest first. */
  versions: Version[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const edit = (patch: Partial<TestDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [saving, startSave] = useTransition();
  const [starting, startStart] = useTransition();
  const [stopping, startStop] = useTransition();
  const deviceNames = useMemo(() => devices.map((d) => d.name), [devices]);
  const parsed = useMemo(() => parseTest(draft.markdown), [draft.markdown]);
  const screen = customSize(draft.device) ?? devices.find((d) => d.name === draft.device);
  const shape = screen ? frameShape(screen.width, screen.height, screen.mobile) : "phone";
  const sessionName = tests.find((t) => t.id === draft.sessionTestId)?.name ?? null;
  const [prompt, setPrompt] = useState("");
  const [generating, startGenerate] = useTransition();

  const generate = () =>
    startGenerate(async () => {
      const res = await generateSteps(testId, prompt, draft);
      if (res.error) return void toast.error(res.error);
      setDraft({ markdown: res.markdown!, device: res.device!, sessionTestId: res.sessionTestId ?? null });
      setTab("write");
      if (res.warning) toast.warning(res.warning);
      else toast.success("Test updated. Check it, then Save or Run. The earlier version is under Versions.");
    });
  const dirty = !sameDraft(draft, saved);

  const [runId, setRunId] = useState<string | null>(activeRunId);
  const [status, setStatus] = useState<RunState | null>(null);
  const [steps, setSteps] = useState<StepResult[]>([]);
  const [values, setValues] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  // Follow the current run over SSE: snapshot first, then frames, step updates and the final status.
  useEffect(() => {
    if (!runId) return;
    const es = new EventSource(`/api/runs/${runId}/stream`);
    es.onmessage = (ev) => {
      const m = JSON.parse(ev.data) as LiveMsg;
      if (m.t === "frame") return setFrame(m.d);
      if (m.t === "snapshot") {
        setStatus(m.status);
        setSteps(m.steps);
        setValues(m.values);
        setError(m.error);
      } else if (m.t === "step") {
        setSteps((prev) => prev.map((s, i) => (i === m.i ? m.step : s)));
        if (m.step.status !== "running") setAnnouncement(`Step ${m.i + 1} ${m.step.status}: ${m.step.text}`);
      } else if (m.t === "status") {
        setStatus(m.status);
        if (m.values) setValues(m.values);
        setError(m.error ?? null);
        if (!isLive(m.status)) {
          setAnnouncement(`Run ${RUN[m.status].label.toLowerCase()}.${m.error ? ` ${m.error}` : ""}`);
          es.close();
          router.refresh(); // pull the finished run into the history table
        }
      }
    };
    return () => es.close();
  }, [runId, router]);

  const save = () =>
    new Promise<boolean>((resolve) =>
      startSave(async () => {
        // `device:` / `session:` lines typed into the Markdown move into the settings on save.
        const h = splitHeader(draft.markdown);
        const next: TestDraft =
          h.device || h.session
            ? {
                markdown: h.body,
                device: (h.device && resolveDevice(h.device, deviceNames)) || draft.device,
                sessionTestId: (h.session && tests.find((t) => t.name.toLowerCase() === h.session!.toLowerCase())?.id) || draft.sessionTestId,
              }
            : draft;
        const res = await saveTest(testId, next);
        if (res?.error) {
          toast.error(res.error);
          return resolve(false);
        }
        setDraft(next);
        setSaved(next);
        resolve(true);
      }),
    );

  const run = () =>
    startStart(async () => {
      if (dirty && !(await save())) return;
      const res = await startRun(testId);
      if (res.error) return void toast.error(res.error);
      setFrame(null);
      setValues({});
      setError(null);
      setSteps(parsed.steps.map((s) => ({ text: s.text, status: "pending" })));
      setStatus("queued");
      setRunId(res.runId!);
    });

  const live = isLive(status);
  const passed = steps.filter((s) => s.status === "passed").length;

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
        <section aria-labelledby="editor-heading" className="flex min-w-0 flex-col gap-4">
          <Heading level={2} size={5} id="editor-heading">Steps</Heading>
          {canEdit && aiEnabled && (
            <div className="flex flex-col gap-3 rounded-xl border border-secondary p-4">
              <TextArea
                label="Generate with AI"
                value={prompt}
                onChange={setPrompt}
                rows={3}
                placeholder="Log in with the test account, enter OTP 000000, open Jobs and check at least one job card shows"
                hint="Describe the test, or what to change in the current one. Nothing is saved until you press Save or Run, and every AI edit is kept under Versions."
              />
              <div className="flex flex-wrap justify-end gap-3">
                <Button color="secondary" size="md" onClick={generate} isLoading={generating} showTextWhileLoading isDisabled={prompt.trim().length < 10}>
                  {generating ? "Generating…" : parsed.steps.length ? "Update test with AI" : "Generate steps"}
                </Button>
              </div>
            </div>
          )}
          <RunSetup
            devices={devices}
            tests={tests}
            device={draft.device}
            session={draft.sessionTestId}
            isDisabled={!canEdit}
            onDevice={(device) => edit({ device })}
            onSession={(sessionTestId) => edit({ sessionTestId })}
          />
          <Tabs selectedKey={tab} onSelectionChange={(k) => setTab(k as "write" | "preview")}>
            <Tabs.List
              type="underline"
              aria-label="Test Markdown"
              items={[
                { id: "write", label: "Write" },
                { id: "preview", label: "Preview" },
              ]}
            />
            <Tabs.Panel id="write" className="pt-4">
              <TextArea
                label="Test (Markdown)"
                value={draft.markdown}
                onChange={(markdown) => edit({ markdown })}
                isReadOnly={!canEdit}
                rows={18}
                textAreaClassName="font-mono text-sm"
                hint={dirty ? "Unsaved changes. Run saves them first." : "Saved."}
              />
            </Tabs.Panel>
            <Tabs.Panel id="preview" className="pt-4">
              {tab === "preview" && <TestPreview markdown={draft.markdown} parsed={parsed} />}
            </Tabs.Panel>
          </Tabs>
          {parsed.errors.length > 0 ? (
            <Alert
              color="error"
              autoFocus={false}
              title={`${parsed.errors.length} line(s) can't run yet`}
              description={parsed.errors.map((e) => e.message).join(" ")}
            />
          ) : (
            <Body2>{`${parsed.steps.length} steps on ${draft.device}${sessionName ? `, after signing in with "${sessionName}"` : ""}.`}</Body2>
          )}
          <div className="flex flex-wrap justify-end gap-3">
            {canEdit && (
              <Button color="secondary" size="md" onClick={() => void save()} isDisabled={!dirty} isLoading={saving} showTextWhileLoading>
                Save
              </Button>
            )}
            {live ? (
              <Button
                color="secondary-destructive"
                size="md"
                iconLeading={Stop}
                isLoading={stopping}
                showTextWhileLoading
                onClick={() =>
                  startStop(async () => {
                    const r = await stopRun(runId!);
                    if (r?.error) toast.error(r.error);
                  })
                }
              >
                Stop run
              </Button>
            ) : (
              <Button
                size="md"
                iconLeading={Play}
                onClick={run}
                isLoading={starting}
                showTextWhileLoading
                isDisabled={!canRun || parsed.errors.length > 0}
              >
                Run test
              </Button>
            )}
          </div>
          {!canRun && runBlockedReason && <Body2>{runBlockedReason}</Body2>}
          <DescriptionList layout="stacked">
            <DescriptionList.Item term="Steps you can write">
              <span className="flex flex-col gap-1 font-mono text-sm">
                {STEP_HELP.map((h) => (
                  <span key={h}>{`- ${h}`}</span>
                ))}
              </span>
            </DescriptionList.Item>
          </DescriptionList>
        </section>

        <section aria-labelledby="live-heading" className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Heading level={2} size={5} id="live-heading">Live run</Heading>
            {status && <RunBadge status={status} />}
          </div>
          {/* Screen-reader progress: step results and the final outcome, politely. */}
          <div role="status" aria-live="polite" className="sr-only">{announcement}</div>
          <DeviceScreen
            jpeg={frame}
            shape={shape}
            label={status ? `Live screen of the test browser, ${RUN[status].label.toLowerCase()}` : "Test browser screen. Press Run test to start."}
          />
          {!status && <Body2 className="text-center">Press Run test to watch it here, step by step.</Body2>}
          {error && <Alert color="error" autoFocus={false} title="The run didn't pass" description={error} />}
          {Object.keys(values).length > 0 && (
            <DescriptionList layout="inline" isDivided>
              {Object.entries(values).map(([k, v]) => (
                <DescriptionList.Item key={k} term={k}>{v.toLocaleString()}</DescriptionList.Item>
              ))}
            </DescriptionList>
          )}
          {steps.length > 0 && (
            <TableCard.Root>
              <TableCard.Header title="Progress" description={`${passed} of ${steps.length} steps passed`} />
              <div className="overflow-x-auto">
                <Table aria-label="Run progress" size="sm">
                  <Table.Header>
                    <Table.Head id="n" label="#" />
                    <Table.Head id="step" label="Step" isRowHeader />
                    <Table.Head id="status" label="Result" />
                  </Table.Header>
                  <Table.Body items={steps.map((s, i) => ({ ...s, id: i }))} dependencies={[steps]}>
                    {(s) => (
                      <Table.Row id={s.id}>
                        <Table.Cell>{s.id + 1}</Table.Cell>
                        <Table.Cell>
                          <span className="flex min-w-0 flex-col gap-1">
                            <span className="font-mono text-sm text-primary">{s.text}</span>
                            {s.note && <span className="text-sm text-tertiary wrap-anywhere">{s.note}</span>}
                          </span>
                        </Table.Cell>
                        <Table.Cell>
                          {STEP_MARK[s.status]}
                          {s.ms !== undefined && <span className="text-sm text-tertiary">{` · ${(s.ms / 1000).toFixed(1)}s`}</span>}
                        </Table.Cell>
                      </Table.Row>
                    )}
                  </Table.Body>
                </Table>
              </div>
            </TableCard.Root>
          )}
        </section>
      </div>

      <TableCard.Root>
        <TableCard.Header title="Versions" description="Every save and AI edit, newest first. Restore puts a version back in the editor; Save keeps it." />
        {versions.length === 0 ? (
          <div className="px-6 pb-6">
            <Body2>No versions yet. One is kept each time you save or use AI.</Body2>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table aria-label="Versions" size="sm">
              <Table.Header>
                <Table.Head id="when" label="When" isRowHeader />
                <Table.Head id="what" label="What" />
                <Table.Head id="device" label="Device" className="hidden md:table-cell" />
                <Table.Head id="by" label="By" className="hidden lg:table-cell" />
                <Table.Head id="restore" label="Restore" />
              </Table.Header>
              <Table.Body items={versions} dependencies={[draft, canEdit]}>
                {(v) => (
                  <Table.Row id={v.id}>
                    <Table.Cell>{new Date(v.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</Table.Cell>
                    <Table.Cell>
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="text-sm text-primary">{SOURCE[v.source]}</span>
                        {v.prompt && <span className="text-sm text-tertiary wrap-anywhere">{`“${v.prompt}”`}</span>}
                        {v.sessionName && <span className="text-sm text-tertiary">{`Signs in with ${v.sessionName}`}</span>}
                      </span>
                    </Table.Cell>
                    <Table.Cell className="hidden md:table-cell">{v.device}</Table.Cell>
                    <Table.Cell className="hidden lg:table-cell">{v.by}</Table.Cell>
                    <Table.Cell>
                      {sameDraft(v, draft) ? (
                        <span className="text-sm text-tertiary">In editor</span>
                      ) : (
                        <Button
                          color="secondary"
                          size="sm"
                          isDisabled={!canEdit}
                          aria-label={`Restore the version from ${new Date(v.at).toLocaleString()}`}
                          onClick={() => {
                            setDraft({ markdown: v.markdown, device: v.device, sessionTestId: v.sessionTestId });
                            setTab("write");
                            toast.success("Version restored in the editor. Save to keep it.");
                          }}
                        >
                          Restore
                        </Button>
                      )}
                    </Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table>
          </div>
        )}
      </TableCard.Root>

      <TableCard.Root>
        <TableCard.Header title="Run history" description="The newest 15 runs. Open one to see a screenshot for every step." />
        {history.length === 0 ? (
          <div className="px-6 pb-6">
            <Body2>No runs yet.</Body2>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table aria-label="Run history" onRowAction={(id) => router.push(`/runs/${id}`)}>
              <Table.Header>
                <Table.Head id="when" label="Started" isRowHeader />
                <Table.Head id="status" label="Result" />
                <Table.Head id="steps" label="Steps passed" />
                <Table.Head id="time" label="Duration" className="hidden md:table-cell" />
                <Table.Head id="by" label="Run by" className="hidden md:table-cell" />
              </Table.Header>
              <Table.Body items={history}>
                {(h) => (
                  <Table.Row id={h.id}>
                    <Table.Cell>
                      <Button color="link-gray" href={`/runs/${h.id}`}>
                        {new Date(h.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                      </Button>
                    </Table.Cell>
                    <Table.Cell><RunBadge status={h.status} /></Table.Cell>
                    <Table.Cell>{`${h.passed} / ${h.total}`}</Table.Cell>
                    <Table.Cell className="hidden md:table-cell">{h.ms === null ? "—" : `${(h.ms / 1000).toFixed(1)}s`}</Table.Cell>
                    <Table.Cell className="hidden md:table-cell">{h.by}</Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table>
          </div>
        )}
      </TableCard.Root>
    </div>
  );
}
````

### `app/(console)/apps/[appId]/tests/[testId]/run-setup.tsx`

````tsx
"use client";

import { useState } from "react";
import { ButtonGroup, ButtonGroupItem } from "@your-job-search-genius/odyssey-ui/components/base/button-group/button-group";
import { Select } from "@your-job-search-genius/odyssey-ui/components/base/select/select";
import { Input } from "@your-job-search-genius/odyssey-ui/components/base/input/input";
import { Checkbox } from "@your-job-search-genius/odyssey-ui/components/base/checkbox/checkbox";
import { Button } from "@your-job-search-genius/odyssey-ui/components/base/buttons/button";
import { customSize } from "~/lib/testdsl";
import type { DeviceInfo, DeviceKind } from "~/lib/devices";

type Kind = DeviceKind | "custom";
const KINDS: { id: Kind; label: string; first: string | null }[] = [
  { id: "phone", label: "Phone", first: "iPhone 15" },
  { id: "tablet", label: "Tablet", first: "iPad Pro 11" },
  { id: "desktop", label: "Desktop", first: "Desktop Chrome" },
  { id: "custom", label: "Custom size", first: null },
];
const NO_SESSION = "__none__";

/** The test's device and the sign-in test that runs before it. Both are settings saved with the test, not Markdown. */
export function RunSetup({
  devices,
  tests,
  device,
  session,
  isDisabled,
  onDevice,
  onSession,
}: {
  devices: DeviceInfo[];
  tests: { id: string; name: string }[];
  device: string;
  /** Id of the test that signs in first, or null. */
  session: string | null;
  isDisabled: boolean;
  onDevice: (device: string) => void;
  onSession: (test: string | null) => void;
}) {
  const size = customSize(device);
  const current = devices.find((d) => d.name === device);
  const [customOpen, setCustomOpen] = useState(false);
  const kind: Kind = customOpen || size ? "custom" : (current?.kind ?? "phone");
  const [width, setWidth] = useState(String(size?.width ?? current?.width ?? 1366));
  const [height, setHeight] = useState(String(size?.height ?? current?.height ?? 768));
  const [mobile, setMobile] = useState(size?.mobile ?? false);
  const typed = customSize(`${width}x${height}${mobile ? " mobile" : ""}`);

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-secondary p-4">
      <div className="flex flex-col gap-2">
        <span id="device-kind" className="text-sm font-medium text-secondary">Device</span>
        <ButtonGroup
          size="sm"
          aria-labelledby="device-kind"
          selectionMode="single"
          disallowEmptySelection
          isDisabled={isDisabled}
          selectedKeys={[kind]}
          onSelectionChange={(keys) => {
            const k = KINDS.find((x) => x.id === [...keys][0]);
            if (!k) return;
            setCustomOpen(k.id === "custom");
            if (k.first) onDevice(k.first);
          }}
        >
          {KINDS.map((k) => (
            <ButtonGroupItem key={k.id} id={k.id}>
              {k.label}
            </ButtonGroupItem>
          ))}
        </ButtonGroup>
      </div>

      {kind === "custom" ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Width (px)" type="number" inputMode="numeric" value={width} onChange={setWidth} isDisabled={isDisabled} />
            <Input label="Height (px)" type="number" inputMode="numeric" value={height} onChange={setHeight} isDisabled={isDisabled} />
          </div>
          <Checkbox label="Touch phone" hint="Mobile browser with a touchscreen. Leave off for a desktop window." isSelected={mobile} onChange={setMobile} isDisabled={isDisabled} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-tertiary">{typed ? `Uses device: ${width}x${height}${mobile ? " mobile" : ""}` : "Width and height must be between 240 and 3840 px."}</span>
            <Button color="secondary" size="sm" isDisabled={isDisabled || !typed} onClick={() => typed && onDevice(`${typed.width}x${typed.height}${typed.mobile ? " mobile" : ""}`)}>
              Use this size
            </Button>
          </div>
        </div>
      ) : (
        <Select.ComboBox
          label={KINDS.find((k) => k.id === kind)!.label}
          placeholder="Search devices"
          items={devices.filter((d) => d.kind === kind).map((d) => ({ id: d.name, label: d.name, supportingText: `${d.width}×${d.height}` }))}
          selectedKey={current ? device : null}
          onSelectionChange={(key) => key && onDevice(String(key))}
          isDisabled={isDisabled}
        >
          {(item) => <Select.Item id={item.id} label={item.label} supportingText={item.supportingText} />}
        </Select.ComboBox>
      )}

      <Select
        label="Start signed in with"
        hint={tests.length ? "Runs that test first in the same browser, so this test starts with its session." : "Create a sign-in test in this app first, then pick it here."}
        items={[{ id: NO_SESSION, label: "No session (start signed out)" }, ...tests.map((t) => ({ id: t.id, label: t.name }))]}
        selectedKey={session ?? NO_SESSION}
        onSelectionChange={(key) => onSession(key === NO_SESSION || key === null ? null : String(key))}
        isDisabled={isDisabled}
      >
        {(item) => <Select.Item id={item.id} label={item.label} />}
      </Select>
    </div>
  );
}
````

### `app/(console)/apps/[appId]/tests/[testId]/test-preview.tsx`

````tsx
"use client";

import type { ReactNode } from "react";
import { Heading } from "@your-job-search-genius/odyssey-ui/components/base/typography/heading";
import { Body2 } from "@your-job-search-genius/odyssey-ui/components/base/typography/body-2";
import { Strong } from "@your-job-search-genius/odyssey-ui/components/base/typography/strong";
import type { ParseResult } from "~/lib/testdsl";

/** `code` and **bold**, the only inline Markdown test notes use. */
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("`") && part.endsWith("`") && part.length > 1 ? (
      <span key={i} className="rounded-sm bg-secondary px-1 font-mono text-sm">{part.slice(1, -1)}</span>
    ) : part.startsWith("**") && part.endsWith("**") && part.length > 3 ? (
      <Strong key={i}>{part.slice(2, -2)}</Strong>
    ) : (
      part
    ),
  );
}

type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "note"; text: string }
  | { kind: "code"; text: string }
  | { kind: "steps"; items: { n: number | null; text: string; error: string | null }[] };

/** Rendered view of the test: headings and notes as text, list items as numbered steps, invalid lines flagged. */
export function TestPreview({ markdown, parsed }: { markdown: string; parsed: ParseResult }) {
  const stepNo = new Map(parsed.steps.map((s, i) => [s.line, i + 1]));
  const errorAt = new Map(parsed.errors.map((e) => [e.line, e.message]));
  const blocks: Block[] = [];
  let fence: string[] | null = null;
  markdown.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const s = raw.trim();
    if (s.startsWith("```")) {
      if (fence) blocks.push({ kind: "code", text: fence.join("\n") });
      fence = fence ? null : [];
      return;
    }
    if (fence) return void fence.push(raw);
    if (!s) return;
    const h = s.match(/^(#{1,3})\s+(.+)$/);
    if (h) return void blocks.push({ kind: "heading", level: h[1].length as 1 | 2 | 3, text: h[2] });
    const item = s.match(/^(?:[-*]|\d+\.)\s+(.+)$/);
    if (item) {
      const entry = { n: stepNo.get(line) ?? null, text: item[1], error: errorAt.get(line) ?? null };
      const prev = blocks.at(-1);
      if (prev?.kind === "steps") prev.items.push(entry);
      else blocks.push({ kind: "steps", items: [entry] });
      return;
    }
    blocks.push({ kind: "note", text: s });
  });

  if (!blocks.length) return <Body2>Nothing to preview yet. Write the test on the Write tab.</Body2>;
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-secondary p-4">
      {blocks.map((b, i) => {
        if (b.kind === "heading") {
          return (
            <Heading key={i} level={(b.level + 2) as 3 | 4 | 5} size={b.level === 1 ? 5 : 6}>
              {inline(b.text)}
            </Heading>
          );
        }
        if (b.kind === "note") return <Body2 key={i}>{inline(b.text)}</Body2>;
        if (b.kind === "code") return <span key={i} className="block whitespace-pre-wrap rounded-md bg-secondary p-3 font-mono text-sm">{b.text}</span>;
        return (
          <div key={i} role="list" aria-label="Steps" className="flex flex-col gap-2">
            {b.items.map((it, j) => (
              <div key={j} role="listitem" className="flex min-w-0 gap-3">
                <span className="w-6 shrink-0 text-right font-mono text-sm text-tertiary">{it.n ?? "!"}</span>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="font-mono text-sm text-primary wrap-anywhere">{it.text}</span>
                  {it.error && <span className="text-sm text-error-primary">{it.error}</span>}
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
````

### `app/(console)/apps/device-screen.tsx`

````tsx
"use client";

import { memo } from "react";
import { IPhoneMockup } from "@your-job-search-genius/odyssey-ui/components/shared-assets/iphone-mockup";
import { cx } from "@your-job-search-genius/odyssey-ui/utils/cx";
import type { FrameShape } from "~/lib/testdsl";

// 1×1 white pixel so the screen isn't empty before the first frame.
const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";

/** A browser screenshot or live frame. Phone shapes sit in the phone mockup; tablets and desktops in a plain frame. */
export const DeviceScreen = memo(function DeviceScreen({
  jpeg,
  shape,
  label,
  size = "lg",
}: {
  jpeg: string | null;
  shape: FrameShape;
  label: string;
  size?: "sm" | "lg";
}) {
  const src = jpeg ? `data:image/jpeg;base64,${jpeg}` : BLANK;
  if (shape === "phone") {
    return (
      <div role="img" aria-label={label} className="flex justify-center">
        <IPhoneMockup image={src} className={cx("w-full", size === "lg" ? "max-w-xs" : "max-w-60")} aria-hidden="true" />
      </div>
    );
  }
  return (
    <div className={cx("flex justify-center", shape === "portrait" && (size === "lg" ? "mx-auto w-full max-w-md" : "mx-auto w-full max-w-60"))}>
      {/* CODE-09 deviation from the forbidden-<img> rule: Odyssey has no image component and IPhoneMockup only fits
          phone-shaped screens, so tablet and desktop frames need a plain image. Tracked as a library gap. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- base64 frames from the runner; next/image can't optimise them */}
      <img src={src} alt={label} className={cx("h-auto w-full rounded-lg border border-secondary bg-primary", !jpeg && "aspect-video")} />
    </div>
  );
});
````

### `app/(console)/apps/[appId]/tests/[testId]/page.tsx`

````tsx
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@your-job-search-genius/odyssey-ui/components/application/breadcrumbs/breadcrumbs";
import { can, requirePermission } from "~/lib/auth";
import { col, oid } from "~/lib/db";
import { PageHeader } from "~/app/ui/page-header";
import { ConfirmButton } from "~/app/ui/dialogs";
import { deleteTest } from "../../../actions";
import { EnvBadge } from "../../../app-ui";
import { Workbench } from "./workbench";
import { aiEnabled } from "~/lib/ai";
import { DEVICE_LIST } from "~/lib/devices";
import { settingsOf } from "~/lib/plan";

export default async function TestPage({ params }: PageProps<"/apps/[appId]/tests/[testId]">) {
  const user = await requirePermission("tests:view");
  const { appId, testId } = await params;
  const test = await col.tests.findOne({ _id: oid(testId) ?? undefined, appId: oid(appId) ?? undefined });
  if (!test) notFound();
  const app = await col.apps.findOne({ _id: test.appId });
  if (!app) notFound();
  const runs = await col.runs
    .find({ testId: test._id }, { projection: { "steps.screenshot": 0 } })
    .sort({ createdAt: -1 })
    .limit(15)
    .toArray();
  const appTests = await col.tests.find({ appId: test.appId }, { projection: { name: 1 } }).sort({ name: 1 }).toArray();
  const settings = settingsOf(test, appTests);
  const versions = await col.versions.find({ testId: test._id }).sort({ at: -1 }).toArray();
  const nameOf = new Map(appTests.map((t) => [t._id.toString(), t.name]));
  const active = runs.find((r) => r.status === "queued" || r.status === "running");
  const runAllowed = can(user, app.environment === "production" ? "tests:run-production" : "tests:run");

  return (
    <div className="flex flex-col gap-8 px-4 py-8 md:px-8">
      <Breadcrumbs
        items={[
          { id: "tests", label: "Tests", href: "/apps" },
          { id: "app", label: app.name, href: `/apps/${appId}` },
          { id: "test", label: test.name },
        ]}
      />
      <title>{`${test.name} · Repo Pulse`}</title>
      <PageHeader
        title={test.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <EnvBadge env={app.environment} />
            {`Runs against ${app.baseUrl}`}
          </span>
        }
        actions={
          can(user, "tests:edit") && (
            <ConfirmButton
              trigger={{ label: "Delete test", destructive: true, size: "md" }}
              title={`Delete "${test.name}"?`}
              description="This deletes the test and all of its runs and screenshots. It can't be undone."
              confirmLabel="Delete test"
              onConfirm={deleteTest.bind(null, test._id.toString())}
            />
          )
        }
      />
      <Workbench
        testId={test._id.toString()}
        initial={{ markdown: settings.body, device: settings.device, sessionTestId: settings.sessionTestId?.toString() ?? null }}
        canEdit={can(user, "tests:edit")}
        canRun={runAllowed}
        runBlockedReason={runAllowed ? null : "Your role can't run tests against this app's environment."}
        activeRunId={active?._id.toString() ?? null}
        aiEnabled={aiEnabled()}
        devices={DEVICE_LIST}
        tests={appTests.filter((t) => !t._id.equals(test._id)).map((t) => ({ id: t._id.toString(), name: t.name }))}
        versions={versions.map((v) => ({
          id: v._id.toString(),
          at: v.at.toISOString(),
          by: v.by,
          source: v.source,
          prompt: v.prompt ?? null,
          markdown: v.markdown,
          device: v.device,
          sessionTestId: v.sessionTestId?.toString() ?? null,
          sessionName: v.sessionTestId ? (nameOf.get(v.sessionTestId.toString()) ?? "a deleted test") : null,
        }))}
        history={runs.map((r) => ({
          id: r._id.toString(),
          status: r.status,
          by: r.by,
          createdAt: r.createdAt.toISOString(),
          ms: r.finishedAt && r.startedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null,
          passed: r.steps.filter((s) => s.status === "passed").length,
          total: r.steps.length,
        }))}
      />
    </div>
  );
}
````

### `app/(console)/runs/[runId]/run-view.tsx`

````tsx
"use client";

import { Alert } from "@your-job-search-genius/odyssey-ui/components/application/alerts/alert";
import { DescriptionList } from "@your-job-search-genius/odyssey-ui/components/base/description-list/description-list";
import { Heading } from "@your-job-search-genius/odyssey-ui/components/base/typography/heading";
import { Body2 } from "@your-job-search-genius/odyssey-ui/components/base/typography/body-2";
import type { StepResult } from "~/lib/db";
import type { FrameShape } from "~/lib/testdsl";
import { DeviceScreen } from "../../apps/device-screen";

const MARK = { pending: "Not run", running: "Interrupted", passed: "Passed", failed: "Failed", skipped: "Skipped" } as const;

// Client component because compound parts like DescriptionList.Item aren't reachable from Server Components.
export function RunView({
  error,
  stopped,
  app,
  duration,
  values,
  steps,
  shape,
}: {
  error: string | null;
  stopped: boolean;
  app: string;
  duration: string;
  values: Record<string, number>;
  steps: StepResult[];
  shape: FrameShape;
}) {
  return (
    <>
      {error && <Alert color={stopped ? "warning" : "error"} autoFocus={false} title="Why it stopped" description={error} />}
      <DescriptionList layout="inline" isDivided columns={2}>
        <DescriptionList.Item term="App">{app}</DescriptionList.Item>
        <DescriptionList.Item term="Duration">{duration}</DescriptionList.Item>
        {Object.entries(values).map(([k, v]) => (
          <DescriptionList.Item key={k} term={`Counted: ${k}`}>{v.toLocaleString()}</DescriptionList.Item>
        ))}
      </DescriptionList>
      <section aria-labelledby="steps-heading" className="flex flex-col gap-6">
        <Heading level={2} size={5} id="steps-heading">Steps</Heading>
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 xl:grid-cols-3">
          {steps.map((s, i) => (
            <article key={i} className="flex min-w-0 flex-col gap-3" aria-labelledby={`step-${i}`}>
              <div className="flex flex-col gap-1">
                <Heading level={3} size={6} id={`step-${i}`} className="font-mono wrap-anywhere">{`${i + 1}. ${s.text}`}</Heading>
                <Body2>{`${MARK[s.status]}${s.ms !== undefined ? ` in ${(s.ms / 1000).toFixed(1)}s` : ""}${s.note ? ` · ${s.note}` : ""}`}</Body2>
              </div>
              {s.screenshot ? (
                <DeviceScreen jpeg={s.screenshot} shape={shape} size="sm" label={`Screen after step ${i + 1}`} />
              ) : (
                <Body2>No screenshot for this step.</Body2>
              )}
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
````

### `app/(console)/apps/actions.ts`

````ts
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
````

