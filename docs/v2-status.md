# V1 restored at root; V2 retained under /v2 — 30 September 2026

The user requested restoring the original application as the default. `index.html`
now boots `src/main.jsx` (V1), while `v2/index.html` still boots V2. Both use the
current Supabase project `qxlrleabulpqryduntwf`; the old paused project is not resumed.
Vercel `/v2` rewrites retain direct links and reloads. Old V2 OAuth return targets
at `/` are normalized to `/v2/`, preserving task parameters within V2.

V1 access checks and notification/background task polling use 120 seconds; access
checks and notification polling stop while hidden. V1's existing screens and write
APIs remain in place. This is not a claim that every V2 cache optimization has
been ported to V1. The V2 missing-schema limitation remains unchanged.

Validation: 131 Node tests, lint, build, secret scan and dual-entry build verification
passed. Browser suite: 32 tests passed initially; the remaining assertion expected
V2 at root under the superseded rollout. Updated it for V1 controls and reran all
six parity checks successfully, including cross-version Note writes/Refresh,
Done/undo, OAuth return, direct routes and reloads. Browser writes use fixtures.
Preview `dpl_DRFqK29W4eZw3yygyTV9d4ojnwbE` is READY and its root/V2 assets differ.
Production deployment details are recorded in `evidence/restore-v1-production.json`.

The dated sections below are historical deployment records.

---

# Supabase usage reduction — deployed 29 September 2026

Production deployment **dpl_EiiZkS5NT8xfPvnk9gusBwEWsVHN** is READY:
https://magic-timeline-dashboard-ovpbeou7x-gzeeddestiny-7573s-projects.vercel.app

Both public aliases are assigned and verified on the new build:
- https://magic-timeline-dashboard.vercel.app/
- https://magic-timeline-v2.vercel.app/

Final Preview **dpl_DimsVMhCFknS1hKMSqbJoqavjJwA**:
https://magic-timeline-dashboard-q8gw90pz6-gzeeddestiny-7573s-projects.vercel.app/v2/
Preview rendered the Google login page and direct Gantt route returned HTTP 200.
Both production aliases return HTTP 200 for `/`, `/v2/` and `/v2/gantt`, with
`main-5alyq4nT.js` as the shared entry. Deployment security scans pass on both
aliases, including unauthorized API protection and public bundle checks.

Validation: 131 Node tests passed; full 32-test browser suite passed. The final
pagination refinements then passed the 11 relevant browser checks and 5 additional
collaboration reruns (new arrivals at page boundaries and manual refresh of older
pages). Lint, build, secret scan and preservation of 83 shared baseline files pass;
six reader/cron/refresh-label files are explicitly exempted as approved changes.

See [usage evidence and limitations](supabase-usage-reduction.md). The My Work
fixture records 75 reads / 2,650 decoded response bytes in 10 minutes versus
692 / 28,059 before. These are not billing measurements. Real organization usage
was inspected per project and Timeline logs were queried as bounded 24-hour aggregates.
No business test writes, real test emails, migrations, package upgrades, deletion,
Spend Cap changes or Sync/No Activity schedule changes were made in this rollout.

Heartbeat `supabase-48` is ACTIVE for the approximate 48-hour and 7-day checkpoints
(1 and 6 October, Asia/Bangkok). It checks the clock daily, reads no Supabase data
between checkpoints, reports each checkpoint once, and pauses after the final one.
The 7-day comparison must account for the 4 October billing reset. Checkpoints have
been scheduled, not yet observed. Authenticated production writes and real Google
OAuth roundtrips were not performed by this usage-reduction validation; their regression
contracts were exercised with fixtures. V2 schema installation remains outside this rollout.

---

# V2-only rollout — 29 September 2026

The user superseded the original dual-version plan and requested retiring V1.
Both `/` and `/v2/` now boot the V2 application; the link to V1 is removed.
Root task links survive the Google OAuth return. The original application entry
is excluded from the production build. Shared components, APIs and business data
remain intact because V2 uses them for Sheets updates and existing workflows.
Local uncommitted source is retained rather than erased.

Deployment `dpl_HpMDWYpubwcuJAK9U2HfagKqJFT3` is READY (Production).
Both `magic-timeline-dashboard.vercel.app` and `magic-timeline-v2.vercel.app`
serve V2 at `/`, `/v2/` and `/v2/gantt` (public HTTP 200, deployed asset verified).
The former active V1 deployment `dpl_2stNx3w2SmfQSHrQjb9LSYMfmzmC` was removed
only after both domains were verified on V2. No database records were deleted.

Validation: 125 Node tests, 25 browser tests, lint, build and secret scan passed.
V2 schema and real-account OAuth acceptance remain pending management access.

The dated sections below are historical deployment records.

---

# V2 implementation status — 21 September 2026

New domain: https://magic-timeline-v2.vercel.app/v2/

Deployed at the user’s request with Production environment variables using `--prod --skip-domain`, then assigned only the new requested alias. Deployment: `dpl_23CbUPiQ3JwbARZm7voxXi2cV3Bw` (READY). Public `/v2/gantt` returns HTTP 200. Original domain HTML matches the pre-deployment snapshot. Database/OAuth rollout requirements below still apply.

Preview: https://magic-timeline-dashboard-6o6krgerq-gzeeddestiny-7573s-projects.vercel.app/v2/

Vercel deployment `dpl_GLdeSjQeJzPcSVvfSPBb44tnLMU1` is READY (Preview, not Production).

Updated after the plan audit: see [the full requirement/evidence matrix](v2-plan-audit.md).

## Verified locally

- 125 Node tests passed, including real PostgreSQL-compatible PGlite RLS/version/cycle/isolation checks.
- 24 browser acceptance tests cover role-specific legacy screens and settings, cross-version notes, workflow drag/keyboard, Gantt and Calendar pointer drag, failed plan rollback, immutable actual due dates, Done/undo/snapshot recovery, saved views, multiple pinned columns, layout persistence, source snapshots, comments/mentions pagination beyond the Supabase 1,000-row response cap, concurrent comment recovery, Gantt conflict/retry, OAuth return/session isolation, logout, Thai search, CSV, mobile and 10,000 tasks.
- Clean `npm ci` applies the version/hash-checked FullCalendar resize scheduling patch. Calendar drag/mobile tests now assert no window errors; ResizeObserver-loop errors are fixed rather than suppressed.
- ESLint, build, secret scan and npm audit passed; zero vulnerabilities reported.
- Baseline verification: 89 original source/API/SQL files unchanged. Existing uncommitted changes preserved. Original and V2 entries remain separate.
- No fixture writes were sent to business data. Browser HTTP and realtime traffic are mocked locally.

## Remaining rollout requirements

The new migration `supabase/migrations/20260920170000_timeline_v2.sql` has **not** been applied remotely. Supabase CLI still reports that its management access token is missing. Authenticate, apply only this migration, then configure `/v2/` OAuth allowlist and verify real approved accounts.

The requested `timeline-dashboard-rose.vercel.app` currently returns HTTP 404 `DEPLOYMENT_NOT_FOUND`. The connected Vercel account owns `magic-timeline-dashboard.vercel.app`; the intended production target still needs resolution. V2 is now deployed on the new domain above; the original `magic-timeline-dashboard.vercel.app` remains in place.

Full real-account OAuth and remote-schema acceptance remain pending. Local/mock tests are not presented as proof of those external rollout steps.
