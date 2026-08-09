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
- เพิ่ม `sheets`, `team_members`, `task_workflow`, `assignments`, `brands`, `sync_runs` และ `notifications` เข้า Supabase Realtime publication เพื่อรับการเปลี่ยนแปลงทันที; polling 30 วินาทียังคงเป็น fallback
- RLS บังคับ allowlist และ role ที่ database: active user อ่าน/แก้ workflow และ assignment ได้, เฉพาะ Admin แก้ access, Sheets, ทีม และ brand mapping
- ชื่อ/role/รูปโปรไฟล์ทีมเก็บใน `team_members`; การแก้ทั้งชุดใช้ `replace_team_members` transaction เดียวและจำกัดรูปที่ crop แล้วไม่เกิน 100 KB
- เปิด Supabase Cron และ `pg_net`, สร้าง Vault secrets ชื่อ `timeline_dashboard_url` กับ `timeline_cron_secret` แล้วรัน `supabase/cron.sql`; ระบบจะ sync ทุก 30 นาทีและ queue digest เวลา 09:00 Asia/Bangkok โดยยังไม่มีการส่งอีเมลจริง

## Sync and freshness

`POST /api/sync` ดึง Google Sheets ด้วย user session เมื่อเปิดหน้าและ snapshot เก่ากว่า 5 นาที ส่วน Manual Sync จำกัดอย่างน้อย 60 วินาที `POST /api/cron-sync` ใช้ `X-Cron-Secret` จาก Supabase Vault เพื่อ sync ทุก 30 นาที ทั้งสอง endpoint ใช้ lock และ sync core เดียวกัน ถ้าข้อมูลเกิน 24 ชั่วโมง UI จะแสดง stale warning

ตั้ง scheduled sync หลัง Production URL พร้อม:

```sql
select vault.create_secret('https://timeline-dashboard-rose.vercel.app', 'timeline_dashboard_url');
select vault.create_secret('<same value as CRON_SYNC_SECRET>', 'timeline_cron_secret');
```

จากนั้นรัน `supabase/cron.sql` และตรวจ `cron.job_run_details` คู่กับ `public.sync_runs` การ sync จริงต้องจบภายใน 45 วินาที; ถ้าเกินให้กลับ Maintenance และไม่เพิ่ม timeout เพื่อกลบปัญหา

การเปลี่ยน Done เรียก `/api/completion` เพื่อเขียน Apps Script ก่อนอัปเดต snapshot; ถ้าล้มเหลว frontend rollback ค่าทันที Workflow/note/priority และ assignment ใช้ database RPC แก้เฉพาะ field/role ที่ส่งมา จึงไม่เขียนทับกันเมื่อ save พร้อมกัน รายการที่ save ไม่สำเร็จเก็บเป็น retry outbox เฉพาะ browser session ทุก shared mutation เก็บ audit event ผ่าน database trigger หน้า Management แสดง Recent Activity พร้อมผู้แก้และเวลา (ประวัติเก่าก่อนเพิ่ม `actor_email` จะแสดงเป็น System)

ถ้า sync process หยุดกลางทาง ระบบจะถือ lock ที่เก่ากว่า 10 นาทีเป็น failed แล้วเริ่มรอบใหม่ได้อัตโนมัติ เพื่อไม่ให้ Manual Sync ค้างถาวร

## One-time Gist migration

Gist ไม่มี runtime/fallback ใน production แล้ว ใช้ token ชั่วคราวได้เฉพาะสคริปต์ migration นี้:

1. ตั้ง `GIST_ID` และ `GITHUB_TOKEN` เฉพาะ server
2. เพิ่ม Sheets/ทีม/แบรนด์/assignment ด้วย `npm run migrate:gist`
3. Deploy Apps Script แล้วทำ initial sync เพื่อ backfill Task ID และสร้าง `tasks_current`
4. รัน `npm run migrate:gist` ซ้ำเพื่อย้าย note/priority ผ่าน task alias; script idempotent และข้อมูล Supabase ที่มีอยู่แล้วจะไม่ถูกเขียนทับ
5. ตรวจจำนวนข้อมูลครบ ลบ variables และ revoke migration token ทันที

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
4. Deploy Apps Script จาก `google-apps-script/Code.gs`, initial sync แล้ว migrate Gist
5. ตรวจ count ของ sheets/tasks/team/assignments/remarks และทดสอบ Employee/Manager/Admin บน Preview
6. สร้าง Vault secrets, apply `supabase/cron.sql` และยืนยัน cron ที่ไม่มี secret/secret ผิดตอบ `401`
7. ปิด Maintenance, deploy Production, smoke test `/api/sync` และเฝ้าดู `sync_runs`/`cron.job_run_details` 24 ชั่วโมง
8. Revoke temporary Gist migration token และลบ migration variables จาก Vercel

ระบบจะ fail closed ใน production หาก Supabase frontend variables ไม่ครบ ส่วน server APIs จะปฏิเสธ request หาก server secret หรือ Apps Script secret ไม่ครบ

Browser acceptance ต้องทดสอบด้วยบัญชี Employee, Manager และ Admin จริงหลังตั้ง Supabase โดยตรวจ role landing, Access Denied, My Work ownership, RLS, concurrent note, blocked/assignment notifications, sync cooldown/failure และ stale warning

Pull request ต้องผ่าน `.github/workflows/ci.yml` ก่อน merge หาก smoke test ล้มเหลวให้ rollback ไป safe Maintenance deployment เท่านั้น ห้าม rollback ไป production build เก่าที่มี client credential

Production URL: <https://timeline-dashboard-rose.vercel.app/>
