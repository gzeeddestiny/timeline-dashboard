# V2 architecture and rollout

## Isolation and parity

`/` retains its original React entry, App, AuthGate, shared-state cache, components and API implementations. `/v2` is a second Vite HTML entry. Only build/deployment configuration and dependency manifests are extended. No reset of pre-existing edits was performed.

V2 lazily loads new views. Its isolated compatibility controller in `src/v2/LegacyApp.jsx` preserves the existing business behavior for My Work, Brand/Project/Contract, Follow-up, task details, team/admin, data sources, notifications and Sync/Data Health. It reuses existing components without editing them. Header and notification compatibility copies keep realtime channel names unique inside V2; controller refresh signals and contract navigation are V2-specific. Controller cache and pending-write keys are `magic-v2-*`; existing per-view preference owners get a `v2:` prefix. Authentication intentionally uses the same Supabase session. Future legacy behavior fixes must be explicitly reviewed for applicability to the compatibility controller.

| Existing function | V2 location / preservation |
|---|---|
| Google login, approved access and roles | V2AuthGate; same allowlist and 5-second access checks, V2 OAuth return target |
| My Work and personal activity | My Work, unchanged component/controller behavior |
| Explorer / workflow / notes / Done | New Explorer and task drawer plus original Explorer in tools |
| Actual Submit, completion rollback | Existing completion API; same Bangkok date semantics |
| Note version conflicts | Original API; latest version must be reloaded before resaving |
| Brand / Project / Contract / milestones | Brand & contracts compatibility view |
| Team and assignment / avatars | Original tools and task detail assignment picker |
| Admin users, Sheets, brand mapping | Original tools, same role enforcement |
| Follow-up / manual notifications / snooze | Original Follow-up and My Work components |
| Notifications / preferences / email scheduler | V2 notification compatibility copy and original Settings; no scheduler changes |
| History / No Activity 120-hour definition | Original ActivityHistory and existing database triggers |
| Sync / cooldown / freshness / data health | Original tools; V2 additionally shows stale snapshots |
| Failed session writes | Separate V2 session outbox; explicit Retry |

## Additive data contract

Migration: `supabase/migrations/20260920170000_timeline_v2.sql`.

New tables: `v2_plans`, `v2_dependencies`, `v2_saved_views`, `v2_layouts`, `v2_comments`, `v2_mentions`, `v2_events`. No legacy table/trigger/cron changes. New writes use authenticated `v2_mutate(p_action text, p_payload jsonb)`; no browser can directly modify the tables. All actors come from `auth.uid()` / the approved account.

Actions: `plan`, `dependency`, `remove_dependency`, `view`, `remove_view`, `layout`, `comment`, `remove_comment`, `read_mention`. Plans require `taskKey`, `startDate`, `endDate`, `expectedVersion`; a cleared plan retains an incrementing version. Comments use optimistic versions on editing/deleting. Dependency graph updates are serialized and checked for cycles. A finish-to-start dependency requires the successor to begin after the predecessor's final planned day. The UI warns without moving other tasks. Gantt uses safe display IDs mapped back to the exact task key, and removes its document listeners on unmount.

Views/layouts are private to their owner. Comments may be edited or removed by author/Admin. Mentions resolve explicitly selected members to approved active accounts and create only V2 inbox records; no email sends or legacy No Activity resets. Inbox and open comments refresh every 30 seconds. New-view work snapshots refresh explicitly or after local/compatibility mutations. Compatibility My Work/task-detail views retain their existing 30-second refresh; focus/visibility triggers are disabled in V2.

## Test and inspect

```
npm test
npm run lint
npm run build
npm audit --audit-level=low
npm run security:scan
npx playwright install chromium
npm run test:e2e
```

Local visual fixture: `/v2/?demo=1`, optionally `&count=10000&view=explorer`. Fixture support is development-only, read-only, and removed by the production build. Production never falls back to fictional work data.

Database tests use PGlite and synthetic accounts/tasks. Browser tests use local fixtures/mocks; no test comments, plans or task edits are written to business data.

## Deployment sequence

1. Verify Vercel project association and deploy Preview. Verify login/access-denied and all entry URLs on Preview.
2. Authenticate Supabase CLI (or use SQL Editor), verify the project matches the configured `VITE_SUPABASE_URL`, and apply **only the new V2 migration**. Do not blindly push all existing local migrations: this workspace has earlier uncommitted SQL changes.
3. Add the exact `/v2/` OAuth return URL on production and Preview to the Supabase auth redirect allowlist. Keep the existing `/` return URL. V2 retains the original task/view query in session storage during OAuth.
4. Test approved Employee/Manager/Admin accounts without mutating business data; run mutation acceptance against a staging/fixture environment. Confirm new schema read access and blocked unauthorized access.
5. Deploy production only after the new schema is ready. Verify `/`, `/v2`, `/v2/`, `/v2/explorer`, reload and direct task links. Inspect legacy import graph to confirm it does not load new V2 libraries.
6. If V2 must be disabled, set `VITE_V2_DISABLED=true` and redeploy (V2AuthGate shows maintenance only for V2), or revert only the V2 entry/rewrite. Keep the additive tables and production data; no destructive rollback needed.

An uninstalled migration is an explicit V2 warning, not an empty-success response. The existing system remains usable.

## Pinned calendar compatibility patch

`npm ci` runs `scripts/patch-fullcalendar.mjs` for FullCalendar 7.1.0. It verifies the version and original source SHA-256, then batches its ResizeObserver layout updates into the next animation frame and ignores unmounted elements. This fixes browser layout-loop errors without suppressing errors. Upgrade requires reviewing/removing the patch; unexpected upstream contents fail installation. The library remains V2-only. Playwright uses a separate Vite dependency cache.
