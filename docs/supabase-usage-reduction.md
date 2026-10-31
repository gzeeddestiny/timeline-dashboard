# Supabase usage reduction — 29 September 2026

Approved scope: reduce new reads and resulting traffic/logs, keep writes, Sheets sync cadence, notification queue cadence and No Activity 120-hour rules. No schema migration, deletions, plan upgrade, Spend Cap or global logging changes.

## Real usage baseline (Supabase Studio, before deployment)

Organization `idlloyglqrwztnnhklcl`, billing period **4 September–4 October 2026**. Values displayed by Studio, rounded to GB. Dashboard says usage can lag by one hour.

| Scope | Uncached egress GB | Log ingestion GB |
| --- | ---: | ---: |
| Organization | 6.766 | 1.871 |
| Timeline Dashboard (`micjfmxdpxeswcgciyjt`) | 1.593 | 0.928 |
| ACCOUNTING MAGIC (`rfvcsuwdplvovtljknoi`) | 5.173 | 0.943 |

Timeline accounts for about 23.5% of organization egress and 49.6% of ingestion at this baseline. Optimizing Timeline alone does not address ACCOUNTING MAGIC's traffic. Studio displays an Egress grace period ending **27 October 2026** and marks log ingestion as Upcoming (billing starts after grace at the start of 2027).

Read-only log queries used the **Last 24 hours** filter, returning at most 20 aggregate rows; no raw log export. Counts are snapshots of a moving window, not billing bytes:

| Source | Events |
| --- | ---: |
| edge_logs | 13,421 |
| postgres_logs | 875 |
| auth_logs | 41 |
| auth_audit_logs | 35 |
| postgrest_logs | 35 |
| realtime_logs | 19 |
| pgbouncer_logs | 17 |
| storage_logs | 2 |

Most frequent visible API paths, grouped by HTTP method in a subsequent query:

| Method | Path | Requests |
| --- | --- | ---: |
| POST | /rest/v1/sheet_activity_health | 8,472 |
| GET | /rest/v1/sheets | 1,463 |
| GET | /rest/v1/tasks_current | 429 |
| GET | /rest/v1/access_list | 425 |
| GET | /rest/v1/task_activity_state | 382 |
| GET | /rest/v1/notifications | 314 |
| POST | /rest/v1/sync_stage_tasks | 279 |
| GET | /rest/v1/brand_workstreams | 147 |
| GET | /rest/v1/brands | 145 |

The largest path is health **writes**, so reduced browser polling will not eliminate it. Existing ingestion code upserts Sheet health records individually. This rollout preserves that write interface and the Sync/health schedule; batching that pipeline and auditing ACCOUNTING MAGIC are separate follow-up opportunities, not claimed savings from this change.

## Implementation

- Access checks every 120 seconds, paused when hidden; realtime access subscription retained. Foreground checks access immediately. Server authorization/RLS unchanged. Account transitions clear QueryClient and account session caches.
- Shared 120-second notifications query and reference-counted subscription per account/QueryClient. Compatibility header now uses the shared V2 notification component, eliminating a remaining independent 30-second reader.
- Main and compatibility controllers share an in-flight/cached system snapshot. Only existing live screens poll. Visible stale resources refresh on return; fresh resources and manual screens do not gain polling. Explicit Refresh remains available.
- Missing V2 schema is latched per session until explicit Refresh; permission and HTTP 401/402/403/429 errors suppress automatic retries/refetch. Successful cached data remains available. Read error status is retained across pagination boundaries.
- Notification cron reads four settings columns before deciding whether business data is required. Full data loads only when daily digest or No Activity is due; queue processing/retry continues every tick. Existing schedules and write handlers remain unchanged.
- Dashboard lazily loads 30 latest overall daily metrics; separate plans/dependencies/views/layout queries. Inbox and V2 history are loaded on demand. Comments/events/mentions use 100-row `(created_at,id)` cursors, with only the first page polling and earlier pages retained without rereads.
- Workflow/notes/priority/next-action confirmations read one task; assignment reads the affected record/group. Structural changes avoid tasks/workflow reloads. Successful writes update local state immediately and do not enter the retry outbox if a subsequent confirmation read fails. Done/Actual Submit and conflict recovery retain existing contracts. Sync refreshes the shared snapshot.
- History/Follow-up labels now describe the two-minute refresh interval. CI includes affected shared readers, APIs and tests, plus lint, Node tests and secret scanning.

## Fixture benchmark (not actual billing)

Same single-task My Work fixture, warmed for 2 seconds, then simulated 10 minutes in 20 steps. Counts include browser GET responses to the fixture Supabase origin and decoded response-body bytes; exclude initial load, network compression/headers, WebSocket traffic and Vercel-to-Supabase requests. The mock returns fixed records regardless of projected columns, so this does not estimate additional real-world column-projection savings.

| Metric | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Background GET responses | 692 | 75 | 89.2% |
| Decoded fixture response bytes | 28,059 | 2,650 | 90.6% |
| Access checks | 120 | 5 | 95.8% |
| Notification reads | 40 | 5 | 87.5% |
| Task snapshot reads | 40 | 5 | 87.5% |

Evidence: [before](evidence/usage-before.json), [after](evidence/usage-after.json), `e2e/v2-usage.spec.js`. The benchmark enforces at least 70% fewer reads and 60% fewer bytes. Response completion at clock boundaries may vary slightly between runs.

## Acceptance and operational follow-up

Node/browser suites cover role restrictions, revoked access, hidden tabs and stale foreground reads, missing schema latch, quota failure/manual recovery, reconnect, lazy analytics, confirmed writes with failed confirmation reads, cursor pagination beyond 1,000 entries, workflow retry, note conflict, Done rollback and Sheets snapshot recovery. All business writes in tests use fixture HTTP endpoints/PGlite; no trial business records or test emails are sent to production.

Record deployment URLs and final verification in `v2-status.md`. Compare real per-project **daily increases** after 48 hours and 7 days; split comparison at the 4 October billing reset. Do not interpret a reset as savings. No billing percentage is guaranteed. Older open clients need a reload to obtain this build.

Sources: [organization usage](https://supabase.com/dashboard/org/idlloyglqrwztnnhklcl/usage), [Timeline logs](https://supabase.com/dashboard/project/micjfmxdpxeswcgciyjt/logs/explorer), [Supabase egress accounting](https://supabase.com/docs/guides/platform/manage-your-usage/egress).


## Deployment and scheduled checks

Production: `dpl_EiiZkS5NT8xfPvnk9gusBwEWsVHN`; both aliases verified.
See [route evidence](evidence/usage-deployment.json) and [release status](v2-status.md).
Heartbeat `supabase-48` is active, with real usage reads only at the approximate
48-hour and 7-day checkpoints (1 and 6 October 2026); other wakeups exit quietly.
The 48-hour checkpoint was performed on 1 October (initially partial: target session expired). A user-requested supplement later that day verified target per-project and daily usage. Do not repeat it automatically. The 7-day checkpoint was attempted on 6 October but current usage could not be read because the target Chrome profile was inaccessible; see the final checkpoint record below. Automatic usage checks are paused afterward.


## Infrastructure migration — 29 September 2026

At approximately 18:59 Asia/Bangkok, Timeline production moved from
`micjfmxdpxeswcgciyjt` (org `idlloyglqrwztnnhklcl`) to `qxlrleabulpqryduntwf`
(org `kkfbtzszacajnhxkbyee`, gzeeddestiny5). The source is paused and its four
cron jobs disabled. Target cron schedules are unchanged. `supabase-48` now
separates old Timeline/Accounting usage from the new Timeline project. New-project
starting usage and billing resets are not optimization savings. Migration and QA
traffic must also be separated from ordinary usage. See
[supabase-project-transfer.md](supabase-project-transfer.md) for verification.


## 48-hour checkpoint — 1 October 2026, 02:08 Asia/Bangkok

Checkpoint `48h` performed once at the scheduled wake-up
`2026-09-30T19:08:32.517Z`, approximately 48 hours 19 minutes after the reference
deployment time. **Partial result: target organization totals were visible, but
the session redirected to Sign in before per-project/daily inspection.** No
automatic repeat of this checkpoint; the next checkpoint remains 6 October.

| Scope | Egress GB | Log ingestion GB | Increase from pre-deployment baseline GB (egress / logs) |
| --- | ---: | ---: | --- |
| New organization gzeeddestiny5, All projects | 0.050 | 0.052 | Not comparable: different organization/cycle |
| Old organization, All projects | 7.156 | 1.998 | +0.390 / +0.127 |
| Old Timeline Dashboard (project filter selected) | 1.627 | 0.956 | +0.034 / +0.028 |
| ACCOUNTING MAGIC (project filter selected) | 5.529 | 1.041 | +0.356 / +0.098 |

New organization billing period displayed: **29 September–29 October 2026**;
old organization: **4 September–4 October 2026**. New organization summary
displayed 1% of the 5 GB egress allowance and 5% of the 1 GB log-ingestion allowance.
Its per-project filter was not successfully applied, so its totals are recorded
as organization totals, not as a separately verified Timeline-only measure.
The page reported that usage may lag by one hour. Numbers are rounded UI values;
project sums can differ from organization totals by rounding or other projects.

Comparison limits:
- No reliable pre-change daily billing rate was captured, only cumulative totals.
- The target has only about 31 hours of production history at this checkpoint.
- The old Timeline was paused following migration; its small delta is not a
  running-project daily-rate estimate or proof of optimization savings.
- New totals include unseparated migration, restoration, QA and operational usage.
- V1 became the default again on 30 September; it uses 120-second polling, but not
  all V2 cache optimizations. The local fixture reduction applies to V2 fixtures.

Therefore **no daily-rate improvement or savings percentage can be established**
from this partial checkpoint. No log queries/raw exports were performed. No
projects were resumed, and no settings, schema, business data, plans, Spend Caps
or schedules were changed. The Supabase UI also displayed a general technical
issue banner; it did not establish a cause for the session loss.

For the 7-day checkpoint, a signed-in gzeeddestiny5 Supabase session is needed.
Read target daily usage if available and keep both billing cycles and the V1/V2
rollout boundaries separate. Old source usage is still historical; do not resume
the old project. Evidence: [48-hour snapshot](evidence/usage-checkpoint-48h.json).


## User-requested supplement — 1 October 2026, 19:30–19:37 Asia/Bangkok

The user reopened the signed-in Chrome **gzeed5** profile and asked to continue
the incomplete inspection. This is a supplement to the original checkpoint,
not another automatic checkpoint. The original observations above are preserved.

Verified the **timeline magic** project filter and URL project reference
`qxlrleabulpqryduntwf` in organization `kkfbtzszacajnhxkbyee`. Current project
totals are **0.073 GB Egress** and **0.067 GB Log Ingestion**, within the new
organization's 5 GB / 1 GB allowances. Billing period remains 29 September–29
October. The UI reports up to one hour of refresh lag.

Daily values were read from chart tooltips, not estimated from bar heights:

| Date shown in Supabase chart | Egress components as displayed | Log Ingestion |
| --- | --- | ---: |
| 29 September | PostgREST 12.394 MB; Auth 50.377 KB; Storage 104.07 KB; Realtime 25.333 KB; Shared Pooler 122.323 KB | 16.525 MB |
| 30 September | PostgREST 33.572 MB; Auth 123.718 KB; Storage 7.778 KB; Realtime 56.205 KB — approximately 33.76 MB combined | 31.071 MB |
| 1 October, incomplete day | PostgREST 23.337 MB; Auth 79.323 KB; Realtime 48.742 KB | 15.895 MB |

30 September is the only completed chart date fully after production cutover.
PostgREST accounts for **99.5%** of that date's displayed egress, making API
response volume the main observed egress source. This is not evidence of which
endpoint or user caused it. The daily chart explicitly includes cached traffic;
the headline Egress total is uncached, so the chart and headline are not treated
as identical accounting measures. The chart timezone was not displayed or
verified; dates above retain Supabase's labels and are not relabeled as Bangkok
calendar days. Tooltip units are preserved without assuming a byte-unit basis.

The sign-in blocker is now resolved and daily target figures are available.
However, no comparable pre-change daily baseline or isolated migration/QA
measurement exists, so **no savings percentage can yet be established**. The
first date includes startup and migration; the last is incomplete. Do not count
the new project's starting zero or the old organization's 4 October reset as
savings. V1 at `/` and V2 at `/v2` continue to use the target project, with the
V1/V2 optimization differences recorded above.

Only Usage charts were read. No logs were queried/exported, no source project
was resumed, and no business data, schema, package, Spend Cap or schedules were
changed. The next scheduled check remains **6 October 2026, 01:50 Asia/Bangkok**.
Evidence: [checkpoint and supplement](evidence/usage-checkpoint-48h.json).


## 7-day checkpoint — 6 October 2026, 02:28 Asia/Bangkok

Update: historical daily data was recovered in a user-requested continuation on
17 October; see the supplement below. The failed 6 October attempt is retained
as the original observation, not overwritten with later cumulative totals.

Checkpoint `7d` was attempted once at `2026-10-05T19:28:46.515Z`, about seven
days and 39 minutes after the optimization reference time. The clock confirmed
that the checkpoint was due. The three usage, release and transfer documents
were read before attempting browser access.

**Current usage unavailable:** the browser inventory exposed only the Chrome
extension profile `คนที่ 1`, not the target `gzeed5` profile. Native discovery
initially reported a closed computer-use pipe. A retry briefly exposed Chrome,
but its Window menu listed Chat and Apps Script windows only; no target Supabase
window was available. Subsequent native accessibility state and screenshot
became unavailable. The target Supabase login/session state could not be
verified; this is not evidence that the user logged out or that Supabase failed.

No current Egress, Log Ingestion or daily-rate figures were obtained. The last
verified target figures remain the **historical** 1 October user-requested
supplement (0.073 GB Egress / 0.067 GB Log Ingestion), not 6 October usage.
No new savings percentage, extrapolation or forecast is reported.

The target billing cycle is 29 September–29 October. The old organization reset
on 4 October, so its prior 4 September–4 October history cannot be compared with
a newly reset cumulative total. Old Timeline and ACCOUNTING MAGIC remain
separate historical scopes. No organization was opened for fresh usage reads;
the source project was not resumed. No logs were queried or exported, and no
business data, schema, package, Spend Cap or Sync/notification schedules changed.
Fixture measurements are not substituted for production usage.

The checkpoint is recorded as **attempted, blocked by profile access**, not a
completed measurement. `supabase-48` is paused after this final scheduled attempt
and will not automatically repeat it. To finish the missing measurement, the
user must open the signed-in Supabase `gzeed5` Chrome profile and request a manual
continuation. Evidence: [7-day attempt](evidence/usage-checkpoint-7d.json).


## User-requested continuation — 17 October 2026, approximately 16:02–16:05 Asia/Bangkok

The user reopened the signed-in `gzeed5` Chrome profile. The **timeline magic**
project filter and URL reference `qxlrleabulpqryduntwf` were verified in org
`kkfbtzszacajnhxkbyee`. This is a late manual continuation, not an on-time
6 October measurement. The cumulative total as of that original checkpoint
cannot be reconstructed exactly from this later UI read.

| Current project usage | Used GB | Organization allowance GB | Used / allowance |
| --- | ---: | ---: | ---: |
| Egress, uncached headline | 0.471 | 5 | 9.42% |
| Log Ingestion | 0.463 | 1 | 46.3% |

The organization summary and project-filtered totals agreed. The billing cycle
is still **29 September–29 October**; no target reset occurred between the
1 October reading and this reading. Compared with the verified 1 October
supplement, increases are **0.398 GB egress / 0.396 GB logs** over approximately
15.86 days: about **0.02510 / 0.02497 GB per day**. This is the observed aggregate
rate on the new project, not a before/after optimization savings measurement.
UI rounding and up to one hour of reporting lag limit the precision.

Retrospective completed chart dates after migration were read from tooltips:

| Supabase chart date | PostgREST egress MB | Other egress as displayed | Log Ingestion MB |
| --- | ---: | --- | ---: |
| 30 September | 33.572 | Auth 123.718 KB; Storage 7.778 KB; Realtime 56.205 KB | 31.071 |
| 1 October | 32.508 | Auth 79.323 KB; Realtime 60.063 KB | 27.411 |
| 2 October | 37.755 | Auth 88.236 KB; Realtime 30.623 KB | 27.711 |
| 3 October | 19.931 | Auth 10.745 KB | 23.916 |
| 4 October | 18.567 | Auth 2.917 KB | 23.511 |
| 5 October | 31.957 | Auth 80.321 KB; Storage 2.856 KB; Realtime 30.573 KB | 26.353 |
| 16 October, latest completed chart date | 19.909 | Auth 12.68 KB; Realtime 4.383 KB | 21.078 |

The six completed chart dates 30 September–5 October average approximately
**29.1 MB egress / 26.66 MB logs per day**. On 16 October, egress was approximately
**19.93 MB** and logs **21.078 MB**; a single day's difference is not a sustained
savings estimate. Egress averages are approximate sums of rounded mixed-unit
labels. Raw tooltip labels are retained in the evidence. The chart includes
cached egress while the headline is uncached, and its timezone remains
unverified. Startup/migration date 29 September and partial current date
17 October are excluded from these completed-day comparisons.

PostgREST accounts for 99.5–100.0% of egress on the sampled completed dates.
The 1 October completed daily figures supersede that day's earlier partial-day
tooltip only for daily comparison; the earlier snapshot is preserved unchanged.
There is still no comparable pre-optimization daily baseline or independent
separation of migration/QA traffic, so **no optimization savings percentage is
claimed**. The old Timeline project and ACCOUNTING MAGIC historical totals
remain separate; no fresh old-organization totals were read or compared across
its 4 October billing reset. New-project starting zero is not counted as savings.

No raw logs were queried or exported. No source project was resumed, and no
business data, schema, package, Spend Cap or application schedules changed.
The session/profile blocker was resolved. `supabase-48` remains **PAUSED**;
no new recurring check was created. Evidence: [late manual reading](evidence/usage-checkpoint-7d-supplement-20261017.json).
