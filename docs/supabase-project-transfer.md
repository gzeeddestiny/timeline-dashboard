# Timeline migration to gzeeddestiny5

Status: **production migrated and source paused**, 29 September 2026, approximately
19:06 Asia/Bangkok. Both existing domains retain their URLs. Users sign in again
with Google because Supabase sessions are project-specific.

| Item | Source (rollback copy) | Destination (production) |
|---|---|---|
| Project | Timeline Dashboard | timeline magic |
| Reference | `micjfmxdpxeswcgciyjt` | `qxlrleabulpqryduntwf` |
| Organization | `idlloyglqrwztnnhklcl` / alphabcap's Org | `kkfbtzszacajnhxkbyee` / gzeeddestiny5's Org |
| Region | Singapore | Tokyo, as created by the user |
| State | Paused; four jobs disabled; application tables write-guarded | Active; four jobs enabled |

Production deployment: `dpl_5eUYh9b8DaHBBWcNL37ucRooUkLY`.
Promoted at approximately 18:59 Asia/Bangkok, after the final data comparison.

- https://magic-timeline-dashboard.vercel.app/
- https://magic-timeline-v2.vercel.app/
- `/` and `/v2/` on both domains serve the new build, `main-BYPi6pdc.js`.
- Preview verification used deployment `dpl_5kJhG49cm955cntVWoYQxXoFnXUD`.

## Method and safeguards

Native transfer was blocked by Supabase's restriction on transfers from an
organization in a quota grace period to a Free organization. The user subsequently
authorized a new project and backup/restore migration. The temporary Developer
invitation to the source owner was removed after the blocked transfer attempt.
No plan upgrade or Spend Cap change was made. ACCOUNTING MAGIC was not changed.

A read-only temporary source database role enabled a logical backup without
resetting the source database password. A user-authorized, project-scoped,
24-hour management token enabled restoration through the official temporary CLI
login role. All three temporary credentials were revoked or deleted after use;
the revoked management token returns HTTP 401. Temporary local password/token
files were removed.

Source application writes and all four cron jobs were stopped before the final
consistent dump. After target restoration, normalized row fingerprints and row
counts matched across all **32 selected tables**: 26 public, two private, one
migration-history, and three Auth tables. Eight team avatar URLs were changed to
the destination Storage URL; that intentional transformation is normalized during
comparison. No trial business records or trial Sheet edits were created.

Auth users and identities retain their IDs. Platform-managed Auth schema and
migrations remain native to the destination. Source sessions and refresh tokens
were not copied. The target's temporary Preview session was cleared during final
restoration; production Google login succeeded afterward.

The source was **paused, not deleted**, after successful cutover. Its data remains
available for rollback. Resume does not automatically enable its jobs or remove
write guards. Pause confirmation stated that it can be resumed for up to one year;
local logical and Storage backups are also retained privately.

## Configuration migrated

- 11 Auth users and identities; Google provider and existing OAuth client retained.
- Added the target Supabase callback to the existing Google OAuth client, preserving
  source and Accounting callbacks. No other Google project was changed.
- Production Site URL and both domain redirect patterns, local redirect and Preview
  redirects configured in target Auth.
- 15 Storage objects (76,695 bytes), matching SHA256 and JPEG content types, bucket
  settings and three custom Storage policies.
- Public/private functions, constraints, privileges, 26 public tables with RLS,
  45 public policies, and 11 Realtime publication tables.
- Two Vault secrets recreated from existing production configuration, rather than
  copying source-encrypted Vault ciphertext into a different encryption context.
- Four cron schedules unchanged: Sync `25,55 * * * *`, notifications `*/15 * * * *`,
  contract alerts `0 2 * * *`, retention `30 19 * * *` (cron timezone unchanged).
- Production and Preview Vercel Supabase URL and key variables updated. Other
  production variables, including the non-exportable Sheet activity secret, were
  preserved. `.env.local` now points to the destination.

## Verification

- All 32 selected tables matched by count and normalized content fingerprint before
  production activation; 3,439 task rows, including 2,880 visible active tasks,
  38 workflow rows, nine members, ten access entries, and six Sheets.
- Actual Google login and reads worked in Preview and on the production domain.
  My Work, Overview, avatar images and Refresh were exercised without modifying
  business data. Refresh still worked after pausing the source.
- Database RLS: Admin, Manager and Employee can read 2,880 active tasks; an unknown
  authenticated account and anonymous role read zero tasks. Zero unvalidated public
  constraints were found after restoration.
- Both domains reject unauthenticated workflow PATCH and cron POST requests (401).
- The first naturally scheduled target notification tick at 19:00 Bangkok succeeded
  with HTTP 200 and `success: true`; source jobs were already disabled.
- Current run: 131 Node tests passed, lint passed, Preview and production builds
  passed. No live Sheet write, trial Done action, or test email was performed.

Evidence: [final table comparison](evidence/manual-migration-final-data.json),
[Storage](evidence/manual-migration-storage.json),
[domains](evidence/manual-migration-domains.json),
[unauthenticated API protection](evidence/manual-migration-api-auth.json),
[credential cleanup](evidence/manual-migration-access-cleanup.json).

**Existing limitation preserved:** the source never had the V2 extension tables
(`v2_saved_views`, `v2_layouts`, plans/comments, etc.). The app therefore still
shows its existing missing-schema warning, and those extension writes remain
unavailable. This migration did not install new business schema. Database write
semantics are covered by existing tests, not by trial writes to production Sheets.

## Private backups and recovery

`.local-migration/` is mode 700, its files are mode 600, and it is excluded from Git
and Vercel deployment. It contains the initial and final pg_dump archives, Storage
file contents, manifests, cron/publication definitions, restoration scripts and
private source environment backups. These contain sensitive business/Auth data;
do not publish them or attach them to a public issue.

The final source archive includes the temporary migration write guard. A fresh
restoration must use the original schema plus final selected data (as done here),
or deliberately remove that guard before enabling writes. Restore users and
identities, not source sessions. Recreate Vault values in the destination.

Rollback after any new target writes requires reconciliation, not just switching
a deployment alias back:

1. Stop target cron and application writes; preserve a fresh target backup.
2. Resume source, retaining its disabled cron and write guard while reconciling
   post-cutover database changes and current Sheets data.
3. Restore source environment values from the private backup and select the prior
   deployment `dpl_EiiZkS5NT8xfPvnk9gusBwEWsVHN` only after reconciliation.
4. Apply [source unfreeze](migrations/20260929-source-unfreeze.sql) to the source,
   then verify Google login, data and the single active set of jobs.

The usage monitor `supabase-48` now checks the destination organization/project,
while keeping historical Timeline and Accounting usage separate in the old org.
A new project's initial usage, a billing reset, and migration/testing traffic must
not be reported as savings. Past source usage is not erased by this migration.
