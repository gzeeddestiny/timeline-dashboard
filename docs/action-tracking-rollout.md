# Action tracking rollout — 8 September 2026 (Asia/Bangkok)

Production: https://magic-timeline-dashboard.vercel.app

## Verification

- Applied `20260907100000_action_history.sql` after a rollback rehearsal against the existing database. Activity state (3,161 rows) and four replaced functions were backed up in the private schema. Imported 72 historical actions supported by existing workflow audit records. Recorded version `20260907100000` in the migration registry after verifying the deployed tables and ingestion function.
- Tested Google edit triggers on a separate copy of the sample Sheet: checked → unchecked → checked produced two distinct events; pasting six dates across two rows produced separate task events with three changed fields each. Events remained in the durable queue while delivery was unavailable. The test trigger was then stopped.
- Production receiver reports all six registered spreadsheets healthy, with zero pending events and no capture errors. Installed coverage includes 89 tabs; all 2,637 active tasks belong to covered tabs. Heartbeats were observed updating across successive minutes.
- `npm test`: 99 passing tests, including PostgreSQL action lifecycle, retries, late events, assignment snapshots, avatar scope, 120-hour boundary, and Apps Script batch installation. Lint, production build, and secret scan passed.
- Production Follow-up was observed refreshing fetch/history timestamps without reloading. After the server assignment correction deployed, owner names and Data Issues also changed on the open page.
- The complete browser installation loop finished with “เปิดรับเหตุการณ์แล้ว 6 Sheet”. Final production deployment `dpl_6D4gZSKeDjxcwACUspVoGBHb5d6S` is ready and aliased to the production URL.

## Data interpretation

Existing source values without a verified event remain marked as history gaps. Invalid date text and missing Next Action/owner details remain Data Issues until their underlying cause is corrected. A sync timestamp is never substituted for an action timestamp.

The real Google copy test verifies trigger capture and queue persistence; database ingestion and retry cases are covered by local PostgreSQL tests. Production health callbacks verify receiver connectivity for every registered Sheet, without creating artificial actions in production tasks.

Google does not supply the original edit timestamp: Sheet action time is the handler start time. When Google does not disclose the editor, the UI shows an unknown editor. Formula/API writes do not invoke a Google edit trigger and require events from their own writer; unmatched sync changes are reported as gaps.

## Verified history follow-up — 8 September 2026

- Added evidence fields and an idempotent service-only history import in migration `20260908100000_action_history_evidence.sql`. A historical event can replace the discovery baseline only when it is newer, and never writes old values into the current task snapshot.
- Google Sheet version 3128 for Kiss Kitchen on 7 September 2026 at 17:13 Asia/Bangkok identifies Kunlaporn Ketnoi and seven changed Actual Submit cells. Four rows had an independently visible previous value and an exact Task ID, so the dry-run marked four ready and the production import inserted four. Repeating the import returned four duplicates and inserted zero.
- Three highlighted cells in that version did not expose a sufficiently clear previous value during verification and were withheld. Google may merge edits in a named version and the Sheets API does not expose cell edit history, so no intermediate action was inferred from a row number or whole-file version time. The remaining registered Sheets retain their history-gap records where an exact Task ID, before/after value, actor, and version evidence could not all be established.
- History responses now include brand, evidence source, time precision, and actor/AE attribution. Unknown actors use the responsible AE reference for live events; historical gaps use the current AE with the explicit label “AE ปัจจุบัน — ไม่ยืนยันผู้แก้ย้อนหลัง”. Multiple AEs remain one action.
- Metadata and cell reads retry 429, 500, 502, 503, 504, and timeouts up to three attempts, respecting `Retry-After`. A production sync after the recurring 503 completed successfully with 2,637 tasks and cleared the run error while retaining unrelated Data Issues.
- Follow-up orders verified actions newest first, places discovery-only baselines last, and uses Task ID as the stable tie-breaker. Brand-first typography is shared across task tables, mobile cards, Follow-up, My Work, Data Issues, history, task details, dashboard task lists, and the manual notification picker.
- `npm test` passes 101 tests. Lint, production build, source/deployment secret scans, and `git diff --check` pass. Deployment `dpl_6K8LfjWLFV17xtoodjGgJLtzFpp9` is ready on production.
