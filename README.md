# Timeline Dashboard

ระบบติดตามงานกลางจากหลาย Google Sheets สำหรับพนักงานและผู้บริหาร มี Google Login, role, My Work, Management Overview, workflow, audit, trend, notification center และ data freshness โดยใช้ Supabase เป็น collaboration source of truth ส่วนรายละเอียด task และ Done ยังอ้างอิง Google Sheets

## Local setup

1. สร้าง Supabase project และเปิด Google provider ใน Authentication
2. เพิ่ม redirect URLs ของ localhost และ production ใน Google/Supabase OAuth settings
3. รัน SQL ใน `supabase/migrations/` ตามลำดับชื่อไฟล์
4. คัดลอก `.env.example` เป็น `.env` แล้วตั้ง Supabase, Google Sheets และ Apps Script variables
5. รัน `npm run bootstrap:admin` เพื่อเพิ่ม `INITIAL_ADMIN_EMAIL`
6. ใช้ `vercel dev` เมื่อต้องการทดสอบทั้ง Vite และ `/api/*`; `npm run dev` รันเฉพาะ frontend

Google OAuth redirect สำหรับ local ปกติคือ `http://127.0.0.1:3000` เมื่อใช้ `vercel dev` และ production คือ `https://timeline-dashboard-rose.vercel.app` ให้ใช้ origin ที่ Vercel แสดงจริงหาก port ต่างออกไป

## Supabase setup

- Browser ใช้เฉพาะ `VITE_SUPABASE_URL` และ `VITE_SUPABASE_PUBLISHABLE_KEY`
- Vercel Functions ใช้ `SUPABASE_URL` และ `SUPABASE_SECRET_KEY`; ห้ามขึ้นต้น secret ด้วย `VITE_`
- หน้าผู้ใช้ดึง snapshot ครั้งแรกตอนเปิดหน้า และดึงใหม่เมื่อกด Refresh เท่านั้น โดยไม่ polling, refresh ตอนกลับเข้าแท็บ หรือ subscribe Realtime สำหรับข้อมูลงาน; access และ notifications ยังตรวจแบบเบาแยกจากข้อมูลงาน
- RLS บังคับ allowlist และ role ที่ database: active user อ่าน/แก้ workflow และ assignment ได้, เฉพาะ Admin แก้ access, Sheets, ทีม และ brand mapping
- ชื่อ/role เก็บใน `team_members`; รูปโปรไฟล์เก็บใน public bucket `team-avatars` ขนาดไม่เกิน 2 MB และฐานข้อมูลเก็บเฉพาะ URL
- เปิด Supabase Cron และ `pg_net`, สร้าง Vault secrets ชื่อ `timeline_dashboard_url` กับ `timeline_cron_secret` แล้วรัน `supabase/cron.sql`; ระบบ sync นาที `:25/:55` และเรียก notification scheduler/queue worker ทุก 15 นาที

## Sync and freshness

`POST /api/sync` ดึงเฉพาะ tab ที่ header A:E ตรง schema งาน เมื่อพบ Task ID ว่าง/ซ้ำ/ไม่ปลอดภัยจะให้ Apps Script ซ่อมแล้วอ่านซ้ำหนึ่งครั้ง ก่อน apply snapshot และ metrics ใน database transaction เดียว Summary/Report tab ถูกข้ามและแสดงใน Data Health ส่วน Manual Sync จำกัดอย่างน้อย 60 วินาที `POST /api/cron-sync` ใช้ `X-Cron-Secret` จาก Supabase Vault เพื่อ sync นาที `:25/:55` ทั้งสอง endpoint ใช้ lock และ sync core เดียวกัน ถ้าข้อมูลเกิน 24 ชั่วโมง UI จะแสดง stale warning

ตั้ง scheduled sync หลัง Production URL พร้อม:

```sql
select vault.create_secret('https://timeline-dashboard-rose.vercel.app', 'timeline_dashboard_url');
select vault.create_secret('<same value as CRON_SYNC_SECRET>', 'timeline_cron_secret');
```

จากนั้นรัน `supabase/cron.sql` และตรวจ `cron.job_run_details` คู่กับ `public.sync_runs` การ sync จริงต้องจบภายใน 45 วินาที; ถ้าเกินให้กลับ Maintenance และไม่เพิ่ม timeout เพื่อกลบปัญหา

## Notifications

ใช้ migration `20260830100000_notification_system.sql`, `APP_URL`, Apps Script deployment เดิม และ `CRON_SYNC_SECRET` เดียวกับ sync โดยไม่ต้องเพิ่มบริการภายนอก Scheduler เรียก `/api/cron-notifications` ทุก 15 นาที; Daily Digest ทำงานวันจันทร์–ศุกร์ตามเวลา Bangkok และ No Activity ทำงานทุกวัน ระบบ queue เรียง Manual > No Activity > Daily, retry known-unsent สูงสุด 3 ครั้ง และหยุดที่ `unknown` เมื่อไม่ทราบผลเพื่อกัน email ซ้ำ

หลัง deploy `google-apps-script/Code.gs` version ใหม่ ให้ authorize MailApp แล้วไป Admin Settings > Notifications เพื่อตรวจ sender/quota, เลือก Owner recipients กับ Primary Owner, Preview และส่ง Test email ก่อนเปิด Auto Send หน้าเดียวกันมี preflight และประวัติ 90 วัน พนักงาน Snooze งานของตนจาก My Work > No Activity ได้ไม่เกิน 30 วัน ส่วน Admin ใช้ Follow-up และ Manual Notification ได้

การเปลี่ยน Done เรียก `/api/completion` เพื่อเขียน Apps Script ก่อนอัปเดต snapshot+audit ใน transaction; ถ้าล้มเหลว frontend rollback ค่าทันที Active user ทุกคนแก้ workflow/note/priority/Done/assignment ได้ ส่วน Admin เท่านั้นที่แก้ users, Sheets, ทีม และ brand mapping Note ส่ง `expectedNoteVersion` และตอบ `409` พร้อมค่าล่าสุดเมื่อชนกัน รายการที่ save ไม่สำเร็จเก็บเป็น retry outbox เฉพาะ browser session

ถ้า sync process หยุดกลางทาง ระบบจะถือ lock ที่เก่ากว่า 10 นาทีเป็น failed แล้วเริ่มรอบใหม่ได้อัตโนมัติ เพื่อไม่ให้ Manual Sync ค้างถาวร

## One-time Gist migration

Gist ไม่มี runtime/fallback ใน production แล้ว ใช้ token ชั่วคราวได้เฉพาะสคริปต์ migration นี้:

1. ตั้ง `GIST_ID` และ `GITHUB_TOKEN` เฉพาะ server
2. เพิ่ม Sheets/ทีม/แบรนด์/assignment ด้วย `npm run migrate:gist`
3. Deploy Apps Script แล้วทำ initial sync เพื่อ backfill Task ID และสร้าง `tasks_current`
4. รัน `npm run migrate:gist` ซ้ำเพื่อย้าย note/priority ผ่าน task alias; script idempotent และข้อมูล Supabase ที่มีอยู่แล้วจะไม่ถูกเขียนทับ
5. ตรวจทั้งจำนวนและ SHA-256 checksum ราย resource ให้ตรง ลบ variables และ revoke migration tokenทันที

`GITHUB_TOKEN` และ `GIST_ID` เป็น server-only variables ห้ามใช้ชื่อที่ขึ้นต้นด้วย `VITE_` เพราะ Vite จะฝังค่านั้นลง frontend bundle

## Checks

```sh
npm test
npm run lint
npm run build
npm audit
npm run security:scan
npm run security:scan:deployment -- https://your-preview-or-production.example
```

## Production rollout

1. เปิด `VITE_MAINTENANCE_MODE=true` และ deploy ก่อนเริ่มย้ายข้อมูล
2. Revoke GitHub token เดิม, rotate Google API key และสร้าง Apps Script deployment/secret ใหม่
3. Apply migrations, เปิด Google OAuth และรัน `npm run bootstrap:admin`
4. Deploy Apps Script จาก `google-apps-script/Code.gs`, authorize Sheets + MailApp, initial sync แล้ว migrate Gist
5. ตรวจ count ของ sheets/tasks/team/assignments/remarks และทดสอบ Employee/Manager/Admin บน Preview
6. สร้าง Vault secrets, apply `supabase/cron.sql` และยืนยัน cron ที่ไม่มี secret/secret ผิดตอบ `401`
7. ตั้ง Notification Setup, ส่ง Test email, ตรวจ sender/Reply-To/quota และ preflight ก่อนเปิด Auto Send
8. ปิด Maintenance, deploy Production, smoke test `/api/sync`, `/api/cron-notifications` และเฝ้าดู `sync_runs`/`cron.job_run_details` 24 ชั่วโมง
9. Revoke temporary Gist migration token และลบ migration variables จาก Vercel

ระบบจะ fail closed ใน production หาก Supabase frontend variables ไม่ครบ ส่วน server APIs จะปฏิเสธ request หาก server secret หรือ Apps Script secret ไม่ครบ

Browser acceptance ต้องทดสอบด้วยบัญชี Employee, Manager และ Admin จริงหลังตั้ง Supabase โดยตรวจ role landing, Access Denied, My Work ownership, RLS, concurrent note, Hold/assignment notifications, manual Refresh, sync cooldown/failure และ stale warning

Pull request ต้องผ่าน `.github/workflows/ci.yml` ก่อน merge หาก smoke test ล้มเหลวให้ rollback ไป safe Maintenance deployment เท่านั้น ห้าม rollback ไป production build เก่าที่มี client credential

Production URL: <https://timeline-dashboard-rose.vercel.app/>
# Action history และ No Activity

No Activity ใช้เวลา action ของงานล่าสุดครบ 120 ชั่วโมง: Done/เอาติ๊กออก, วันที่งานทุกช่อง, Workflow, Note, Priority, Next Action และการเปลี่ยนทีมโปรเจกต์ (เฉพาะงานที่ยังไม่เสร็จ) การเปลี่ยนรูปอยู่ใน log บุคคลและไม่เริ่มเวลาของงานใหม่ ประวัติเก็บ AE ณ เวลานั้นแยกจากผู้แก้จริง และแสดง “ไม่ทราบผู้แก้” เมื่อ Google ไม่ส่งตัวผู้แก้

หน้า Follow-up, My Work และประวัติในรายละเอียดงานรีเฟรชทุก 30 วินาทีขณะเปิดหน้า พร้อมแสดงเวลา Last Action แยกจากเวลาที่ดึงข้อมูล การ sync อย่างเดียวไม่เพิ่ม action และไม่ล้าง Data Issues

การเปิดใช้ต้องติดตั้ง migration `20260907100000_action_history.sql`, อัปเดต Apps Script และตั้ง `SHEET_ACTIVITY_SECRET` ตาม [คู่มือติดตั้งและทดสอบ](google-apps-script/README.md#เปิดการติดตาม-action) ก่อนกดเปิดการติดตามในหน้า Follow-up
