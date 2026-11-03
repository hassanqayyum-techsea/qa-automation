# Odyssey UI completion record: legacy Repo Pulse console

> Historical record from before the product was narrowed to QA Automation. GitHub analytics,
> repository, and webhook screens referenced below are no longer part of the application.

Built 2 Nov 2026 against `@your-job-search-genius/odyssey-ui` 2.4.1 (rules v4.2.0). Rule IDs are grouped where they share the same evidence.
Results: **Pass**, **Fail**, **N/A** (with reason), **Not verified** (with what's missing).

## Evidence available

- `npm run e2e`: Playwright run through owner setup, all 12 console pages, an app + test, a live run, a webhook. Zero browser console errors.
- 320px reflow script: `document.scrollWidth === 320` on all 12 console pages (dashboard, contributors, contributor detail, repositories, webhooks, apps, app, test workbench, run, users, roles, audit).
- Screenshots at 1440px and 390px (dashboard, workbench, run detail) reviewed by eye.
- `tsc --noEmit`, `eslint` and `next build` all pass.
- `validate_jsx` on `org-card.tsx` and `workbench.tsx`: no class, element or nesting errors. The only errors were app-level imports and wrapper components, plus one validator contradiction (see UI issues).
- **No NVDA run, no axe or Lighthouse run, no contrast measurement tool and no zoom walkthrough** were available in this session.

| Rule ID | Applicability / context | Result | Evidence or reason | Remaining action |
| --- | --- | --- | --- | --- |
| FORM-01, FORM-02, FORM-08 | All forms (sign-in, owner, connect org, app, test, user, role) | Pass | Each form asks only for what its action uses; submit labels name the result ("Check and connect", "Create role") | — |
| FORM-03, FORM-06, ACTION-16 | Forms | Pass | Odyssey `Form` (React Aria) wraps fields and the submit button; Cancel is `type="button"` | — |
| FORM-04, FIELD-01, ARIA-04, CHK-B8 | Every input | Pass | Every `Input`/`Select`/`TextArea`/`Checkbox`/`Toggle` has a `label` (or `aria-label` where the visible label is in the row) | — |
| FORM-05, FIELD-10 | Email, password, URL fields | Pass | `type=email/password/url`; `autocomplete` username, current-password, new-password, name, off for others' credentials | — |
| FORM-07, RES-09 | Forms | Pass | Single column in modals | — |
| FORM-09, FORM-10, FORM-12, FIELD-04, FIELD-05 | Validation | Pass | zod on the server for every action; messages say what to fix | — |
| FIELD-03 | Error under each field | Fail (library gap) | Fields get `aria-invalid` and focus, but Odyssey `Input` doesn't render React Aria's validation message; the messages are listed in the error summary above the form instead | Needs an Odyssey fix, see UI issues |
| FIELD-04 | Validation timing | Pass | Server-side on submit only; no keystroke validation | — |
| FIELD-06 | Multi-error submit | Pass | Form-level alert plus field errors; focus moves to the first `aria-invalid` field (`app/ui/action-form.tsx`) | Not checked with a screen reader |
| FORM-11, FIELD-07, STATE-01, STATE-02, ACTION-13 | Submit states | Pass | `isLoading` + `showTextWhileLoading` with a pending label; `aria-busy` on the form | — |
| FIELD-08, STATE-04 | Failures | Pass | GitHub unreachable, bad token and org not visible each get their own message; entered data stays in the form | — |
| FIELD-09 | Required fields | Pass | `isRequired`, so Odyssey shows the indicator and sets the state | — |
| FIELD-11 | Password reveal | Not verified | Odyssey's built-in toggle swaps its label rather than exposing `aria-pressed` | Library issue, see UI issues |
| FIELD-12, FLOW-03, ACTION-15, ISTATE-05 | Remove org, delete app/test/role | Pass | `ConfirmButton`: alert dialog, consequence stated, focus starts on Cancel | — |
| FIELD-13, LOGIN-02 | Sign-in | Pass | Paste allowed, password managers supported, no CAPTCHA | — |
| LOGIN-01..06 | Sign-in | Pass | Email identity; existing password not re-validated for strength; same message for wrong email and wrong password; rate limit has its own message; redirects to the dashboard | — |
| SPACE-01..09, LAY-01..05, CHK-m1 | All pages | Pass | Token spacing only (`gap-*`, `px-4 md:px-8`, `py-8`); screenshots show clear grouping | — |
| LAY-09..12, CHK-B1 | Containers | Pass | No fixed heights; content sizes itself; screenshots show nothing clipped | — |
| LAY-13, LAY-14, TYPE-09, TYPE-10 | Long text | Pass | `wrap-anywhere` on notes, errors and audit details; commit/PR links wrap | — |
| LAY-15, TABLE-12 | Long lists | Pass | Lists are capped server-side (100 contributors, 100 commits/PRs, 100 events, 200 audit entries, 15 runs), each stated in its table description | Add pagination if the caps are too low |
| RES-01..03, RES-06, RES-11 | Layout | Pass | Mobile-first; grids collapse below `xl`/`md` | — |
| RES-04, NAV-02, NAV-15, CHK-M4 | Navigation | Pass | `SidebarLayout` (bottom tab bar below md, verified at 390px) | — |
| RES-05, TABLE-18, RESP-14 | Tables | Pass | Contained `overflow-x-auto`; secondary columns hidden below md/lg | — |
| RES-07, RESP-15 | Modals | Pass | Odyssey `Modal` (full width on phones) | — |
| RES-10, ZOOM-02, CHK-B2, RESP-08 | Reflow at 320px | Pass | Measured `scrollWidth === 320` on all 12 pages | — |
| RES-12, RESP-13 | Images | Pass | Phone screenshots render in `IPhoneMockup` at the device's own shape (393×852 viewport) | — |
| RES-13 | Safe areas | Pass | `viewport-fit=cover` in the root viewport | — |
| RES-14, CHK-M7, ACTION-06 | Touch targets | Not verified | Primary buttons are `md`; a few row actions are `sm`, not measured against 44px | Measure row-action targets |
| ZOOM-01, ZOOM-03..05, CHK-B6, RESP-03, TYPE-13, TYPE-14, CHK-m2 | Zoom and text spacing | Not verified | No fixed px fonts (token typography only), but no 200–400% zoom or text-spacing run | Run the zoom and text-spacing checks |
| KEY-01..05, KEY-11, CHK-B3, CHK-B7, ACTION-02, ACTION-10 | Keyboard | Not verified | Only library components (React Aria), no div buttons, no positive tabindex; no keyboard-only walkthrough was done | Keyboard walkthrough |
| KEY-06, KEY-13, SR-05 | Dialogs | Pass | Odyssey `Modal`/`Dialog` with headings; focus trap and return are built into the library | — |
| KEY-07, KEY-08, CHK-M1, CONTRAST-11 | Focus rings | Pass | Library focus rings left as they are | — |
| KEY-10, NAV-17 | Skip link | Pass | Provided by `SidebarLayout` | — |
| KEY-12, NAV-18 | Focus after route change and deletion | Not verified | Relies on Next's route announcer; delete flows redirect to the parent page | Check focus after delete and navigation |
| ARIA-01..03, ARIA-05, SR-02, SR-08 | Semantics | Pass | No roles on primitives except `role="group"` for the permission checkboxes (no group component) and `role="img"` wrapping the phone mockup with a text label | — |
| ARIA-07, ARIA-08, SR-06, CHK-M5 | Landmarks and headings | Pass | One `main` from `SidebarLayout`; one h1 per page; h2 for sections, h3 for run steps | — |
| ARIA-09..11, SR-04, CHK-M2 | Live regions | Pass | Toasts via `Toaster`; run progress in a `role="status"` region present before updates | — |
| CHK-B4 | Accessible names | Pass | Icon-only controls: none. Toggles in tables have `aria-label` with the row's name | — |
| CHK-B9, SR-01, SR-03, SR-07, SR-09..12, A11Y-05, ARIA-24, ARIA-25 | NVDA | Not verified | No NVDA environment in this session | NVDA + Firefox/Chrome walkthrough |
| COL-01..04, COL-07..09, CONTRAST-01..09, CONTRAST-12..14, CHK-B5, TYPE-12 | Contrast | Not verified | Only semantic tokens (`text-primary`, `text-tertiary`, `text-error-primary`, badges), light and dark; ratios not measured | Measure in both themes |
| COL-05, COL-06, CONTRAST-10, CHK-M8 | Colour alone | Pass | Every status badge has text (Passed, Failed, Hidden, Production…); chart series have a legend and data table | — |
| ISTATE-01, CHK-M6, TABLE-17, API-18 | Empty, loading and error states | Pass | `Empty` with a next step on every list; a loading indicator while the session resolves; error alerts for runs and forms | Route-level `error.tsx` not added |
| ISTATE-02, ISTATE-03 | Loading indicators | Pass | Button spinners for actions; the live run shows status and per-step progress | — |
| ISTATE-04 | Toast timing | Pass | Library defaults (error toasts stay) | — |
| ISTATE-06..08, CHK-m3 | Motion | Pass | Only library motion, which follows reduced-motion | — |
| FLOW-01, FLOW-02, CHK-m4, ACTION-04, ACTION-05 | Button order | Pass | Primary on the right, Cancel to its left; destructive actions are separate buttons behind confirmation | — |
| FLOW-04, FLOW-05, FLOW-07, NAV-01, NAV-03..05, NAV-07 | Placement and navigation | Pass | Title top-left, actions top-right on every page; breadcrumbs on detail pages | — |
| NAV-08, NAV-09 | Direct entry and state | Pass | Time period, sort and run ids live in the URL; every page loads on refresh | — |
| NAV-19 | Role-based destinations | Pass | Nav items hidden per permission; the server returns 403 with an explanation page regardless | — |
| TABLE-01..06, TABLE-09, SR-10, ARIA-20 | Tables | Pass | Odyssey `Table` with `isRowHeader`, `aria-label`, units in headings ("Added / removed") | — |
| TABLE-07 | Zero vs missing | Pass | "Never run", "Not synced yet" and "—" are distinct from 0 | — |
| TABLE-10 | Sorting | Pass | Leaderboard sorts server-side across the whole period (not just the visible page); direction is announced | — |
| TABLE-11, TABLE-13, TABLE-15, TABLE-21 | Search, pagination, bulk, export | N/A | Not part of this build | — |
| TABLE-14 | Row actions | Pass | Links and toggles inside rows are their own controls; rows also open on Enter | — |
| TABLE-16 | Destructive outcomes | Pass | Confirmation plus a success or error toast | — |
| TABLE-19, TABLE-20 | Sticky columns, inline edit | N/A | Not used | — |
| TYPE-01..08, TYPE-15..17, VIS-01..03 | Content | Pass | Plain, specific copy; Geist loaded via `next/font` with fallbacks | — |
| TYPE-11 | Scripts | N/A | English only | — |
| RESP-01, RESP-02, RESP-04..07, RESP-09..12, RESP-16..18 | Responsive behaviour | Pass (partial) | 320/390/1440 checked; keyboard-open and landscape not checked | Check short-height and landscape |
| ACTION-01, ACTION-03, ACTION-07..09, ACTION-11, ACTION-12, ACTION-14, ACTION-17..19, NAV-06, NAV-10..14, NAV-16, NAV-20 | Actions and navigation details | Pass | `Button href` for navigation, buttons for operations; disabled Run explains why ("Fix the test first" / role message) | — |
| STATE-01..12 (state management) | Client state | N/A (deliberate) | No Redux or RTK Query: server data is read in Server Components and changed through Server Actions; client state is local to one component (editor draft, live run). See the deviations below | — |
| RENDER-01..08 | Rendering | Pass | Live frames update only the memoised `PhoneScreen`; tables take stable item arrays | Profile under load |
| CACHE-01..12, API-01..22 | Server data | N/A (deliberate) | No client query cache or Axios; Next Server Components and Server Actions own fetching and mutations; `refresh()` after writes; SSE only signals when to refresh | — |
| CODE-01..07, CHK-m5 | Code | Pass | Tokens only, no inline styles, intent comments, no duplicated library components | — |
| CODE-08, CHK-M9 | Automated audits | Not verified | No axe, Lighthouse or jsx-a11y run | Run axe and Lighthouse |

## Deliberate deviations

- **No Redux Toolkit, RTK Query or Axios** (policy default). This app keeps no shared client state and does no client-side fetching: pages are Server Components, writes are Server Actions, and live updates are SSE signals that re-render the page. Adding a client store would duplicate server data with nothing to manage.

## UI issues found

See the final message of this session; they were not logged to `docs/ui-issues.md` yet (waiting for permission).
