# Timeline Dashboard — Hardening status

> Updated: 2026-08-10

## Current architecture

- React 19 + Vite 8 + Tailwind CSS 4
- Google Sheets API v4 supplies timeline tasks
- Supabase is the collaboration source of truth; Google Sheets remains the task/Done source
- Gist is read only by the one-time migration script and is absent from production runtime
- Sensitive browser cache uses `sessionStorage`; per-user view/filter preferences use `localStorage`

## Shared records

Stable task identity comes from the hidden Google Sheets Task ID column.

| Resource | Key |
|---|---|
| Sheet | `spreadsheetId` |
| Brand | `spreadsheetId:sheetGid` |
| Assignment | normalized brand name |
| Remark / priority / workflow | `spreadsheetId:sheetGid:taskId` |
| Team members | `all` |

The client uses Supabase Realtime plus 30-second/focus refresh. Sheets, team profiles, brand data, assignments and workflow all converge from Supabase; pending or failed local edits are protected from refresh until saved successfully.

## Views

- Table: overdue, upcoming and completed tasks; its member filter remains independent
- Dashboard: Status, Month and Person filters apply to every widget
- Assignment is brand-level, so all tabs/months mapped to one brand share the same team

## Deployment

Production: <https://timeline-dashboard-rose.vercel.app/>

Required Vercel environment variables are listed in `.env.example`. Never expose the Gist token with a `VITE_` prefix or place credentials in Git remotes/documentation.

Launch Ready code lives on `codex/launch-ready`; Production rollout remains blocked on external credential rotation, Supabase/Google OAuth creation, Apps Script deployment and valid Vercel access. See README for the ordered runbook.

## Acceptance checks

```sh
npm test
npm run lint
npm run build
npm run security:scan
```
# Full System implementation (2026-07-29)

- Added Supabase Google Auth gate, allowlist and employee/manager/admin roles
- Added RLS schema for settings, current tasks, workflow, audit, metrics, notifications and email queue
- Added server sync, completion, workflow and assignment APIs
- Added My Work, Management freshness/aging/risk/trend, Admin access management and notification center
- Added idempotent admin bootstrap and Gist migration scripts
- Added authenticated 30-minute Supabase Cron sync, shared sync core, CI and build-time secret scanning
- Added atomic workflow field patches and transactional team/profile replacement so concurrent saves cannot overwrite unrelated data
- Removed browser-side Google API access and blocked legacy secret-prefixed Vite environments at startup
- Pending final configured Supabase browser acceptance and production environment rollout
