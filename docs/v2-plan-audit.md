> **29 ก.ย. 2026 — ผู้ใช้เปลี่ยนข้อกำหนดเป็น V2 เท่านั้น:** หน้า `/` และ `/v2/` เปิด V2 ทั้งสองโดเมนแล้ว ลบ deployment V1 ที่เคยเปิดใช้งาน (`dpl_2stNx3w2SmfQSHrQjb9LSYMfmzmC`) หลังตรวจเว็บใหม่สำเร็จ; คง API/ข้อมูลที่ V2 ต้องใช้ รายงานด้านล่างเป็นประวัติแผนเดิม ดูสถานะล่าสุดที่ `v2-status.md`

# MAGIC Timeline V2 — ตรวจเทียบแผน 21 ก.ย. 2026

สถานะ: เพิ่มส่วนที่ขาดในโค้ดและทดสอบด้วย fixture แล้ว แต่ **ยังไม่ผ่านการตรวจรับ Production ทั้งหมด** เพราะยังไม่ได้ติดตั้ง schema V2 และตั้งค่า OAuth บน Supabase จริง การทดสอบข้อมูลเขียนทุกครั้งใช้ข้อมูลจำลอง ไม่มีรายการทดสอบในข้อมูลธุรกิจ

## ช่องว่างที่พบและแก้ไข

1. เปิด `/v2/gantt` หรือ `/v2/calendar` โดยตรงใน Vite dev/preview เคยตกไปหน้าเดิม — เพิ่ม middleware ให้ตรงกับ Vercel rewrites และทดสอบ reload
2. Frappe Gantt ใช้ task key ที่มี `:` ใน CSS selector — เปลี่ยนเป็นรหัสแสดงผลที่ปลอดภัย แล้ว map กลับ task_key เดิมเฉพาะจุดเขียนข้อมูล พร้อมถอด document listeners เมื่อ unmount
3. NotificationCenter หลาย instance ใน V2 ใช้ชื่อ realtime channel ซ้ำจนหน้าอาจล่ม — ใช้ compatibility components เฉพาะ V2 กับชื่อ channel แยกต่อ instance; หน้าเดิมไม่ได้แก้
4. Query cache ของมุมมองใหม่ไม่ทราบการแก้ไขจาก compatibility views — เพิ่ม event เฉพาะ V2 เพื่อ invalidate หลังแก้ไข/refresh และให้ปุ่ม Refresh ด้านนอกส่งถึง compatibility view
5. Compatibility views เคย refresh จาก focus/visibility — ปิดสอง trigger นี้ใน V2 เท่านั้น; คง timer เดิมสำหรับ My Work/รายละเอียดและ notifications/activity
6. ความคิดเห็นและ inbox เคยถูกตัดที่จำนวนคงที่ — เพิ่มโหลดต่อ และเรียงความคิดเห็นล่าสุดก่อน; invalidate ประวัติหลัง mutation/conflict
7. Drilldown จาก dashboard เคยทิ้งตัวกรองเดิมและ workload รวม Done — รักษาตัวกรองเดิมและเปิดเฉพาะงานไม่เสร็จ; สัญญาส่ง contract id ถึงรายละเอียด; กราฟมีข้อมูล snapshot ต้นทางให้เปิดด้วยแป้นพิมพ์
8. ตารางเคยตรึงได้เฉพาะชื่องาน — เพิ่มการตรึงหลายคอลัมน์พร้อมเก็บใน saved view
9. V2 cache จากบัญชีก่อนหน้าและสิทธิ์เก่าอาจค้างเมื่อ session เปลี่ยน — ล้างเฉพาะ V2 cache ของบัญชีก่อนและรอตรวจสิทธิ์บัญชีใหม่; ไม่ล้าง cache หน้าเดิม
10. Done ที่ Sheets สำเร็จแต่ snapshot pending เคยเพียงแสดง warning — เรียก Sync recovery เดิมและอ่าน snapshot ใหม่; Sync ล้มเหลวภายหลังไม่ถือว่า Sheets ล้มเหลว
11. Calendar ใช้วันที่ในเขตเวลาที่ตั้งไว้ `Asia/Bangkok`; ใช้ API `eventClass` ของ FullCalendar v7; แยก actual due/milestone ที่ลากไม่ได้จากแผนที่ลากได้
12. แก้ FullCalendar ResizeObserver-loop ด้วย patch ที่ทำซ้ำได้เมื่อ install/CI; แยก Vite cache ของ tests จาก dev server เพื่อไม่ใช้ prebundle เก่า
13. Tests เดิมยังไม่พิสูจน์การลากจริง, saved view/layout persistence, comments/inbox pagination และข้อมูลร่วมสองหน้า — เพิ่ม browser acceptance สำหรับรายการเหล่านี้ รวม JavaScript errors ในมุมมองที่ทดสอบการลาก
14. ความคิดเห็นที่แก้พร้อมกันเคยติด version เก่าจนบันทึกต่อไม่ได้ — แสดง conflict โดยเก็บข้อความร่าง ให้โหลดความคิดเห็นล่าสุดก่อนแก้ต่อ พร้อมล็อกปุ่มขณะบันทึกและล้าง mentions เมื่อยกเลิก; เพิ่ม browser test ที่จำลอง conflict จริงและตรวจ expectedVersion ก่อน/หลัง
15. เพิ่ม Gantt failure/conflict/retry acceptance: ลากล้มเหลวต้องคืนตำแหน่ง, แผนจากอีก session ต้องโหลด version ใหม่ก่อนลากซ้ำ และไม่เปลี่ยนกำหนดส่งจริง

16. การโหลดความคิดเห็น/ประวัติ/Inbox มากกว่า 1,000 แถวเคยชนเพดาน response ของ Supabase — แบ่งอ่านด้วย range และ sort id เป็นตัวตัดสินเมื่อเวลาเท่ากัน; fixture จำลองเพดาน 1,000 แถวและทดสอบเปิด Inbox 1,005 รายการ
17. ปิด Refresh ขณะบันทึกเพื่อไม่ให้สั่งอ่านซ้อน mutation และกัน callback ของ Gantt instance ที่ถูก dispose แล้วไม่ให้ refresh ทับกราฟใหม่; acceptance การลาก 5 รายการรันซ้ำ 3 รอบผ่านทั้งหมด

## ตารางตรวจรับ

| ข้อในแผน | หลักฐานในโค้ด/การทดสอบ | ผล |
|---|---|---|
| เลือก repo ดาวรวมสูง/กิจกรรมในช่วงกำหนด/license | `v2-repositories.md`, lockfile, `/v2-licenses.txt` | มีเอกสาร shortlist ทั้งหมดที่สำรวจและใช้ 10 libraries โดยตรง |
| `/` เดิมไม่เปลี่ยนและไม่โหลด V2 | `verify-v2-build.mjs`, hash 89 ไฟล์เดิม, Vite manifest | ผ่าน local build; ไม่ reset งานเดิม |
| `/v2` entry, direct links, reload | Vite middleware/Vercel rewrites; `v2-acceptance.spec.js` | ผ่าน browser fixture และ Preview HTTP |
| Login, สิทธิ์ Employee/Manager/Admin, Access Denied | `v2-auth.spec.js`, `v2-parity.spec.js`, DB RLS test | ผ่าน mock; OAuth/provider จริงยังรอ rollout |
| My Work/Explorer/Timeline/Brand/Project/Contract/Team/Admin/Follow-up/Notifications/History/Sync/Data Health | compatibility controller + shared original components; parity matrix ใน rollout doc | มีครบใน V2; controller integration ผ่าน fixture |
| cache/pending writes/preferences แยก | prefix `magic-v2-*`, Query keys ต่อบัญชี, owner RLS | ผ่าน isolation checks |
| Explorer filters/group/sort/columns/CSV/saved views | `Explorer.jsx`, model tests, `v2-collaboration.spec.js` | ผ่าน รวม sort จริงทั้งสองทิศและ reload saved view |
| Kanban 4 workflow + keyboard + Done เดิม | pointer drag/keyboard selector tests, completion contract/rollback tests | ผ่าน API เดิม |
| Gantt วันแผน/dependency/zoom/200 rows/unplanned | `Planning.jsx`, versioned drag test, 10,000-task page test | ผ่าน ไม่สร้างวันเริ่มสมมติ |
| Calendar month/week/list, layers, immutable actual due | `Planning.jsx`, actual pointer-drag test | ผ่านการเขียนแผน; actual due ลากไม่เขียน |
| Workload owner rules/unassigned/overdue/upcoming/overlap | `model.js`, `v2.test.js` | ผ่าน |
| Dashboard layout/chart/risk/drilldown | `Dashboard.jsx`, layout persistence + snapshot tests | ผ่าน fixture |
| comments/mentions/inbox/task links/search | TaskDrawer/Workspace; SQL owner/admin/privacy tests; pagination tests | ผ่าน fixture; ไม่เขียนทับ note |
| shared workflow/note/priority/assignment/completion APIs | `fullSystem.js` เดิม; cross-version note test; completion/assignment picker tests | ใช้ API เดิม; ไม่แก้ backend เดิม |
| Supabase RPC/RLS/version/cycle/invalid dates | additive migration + PGlite tests | ผ่านฐานข้อมูลจำลอง; remote migration ยังไม่ได้ apply |
| วันแผนไม่แตะ Sheets/No Activity | no legacy trigger changes; SQL isolation tests + pointer drag calls | ผ่าน fixture |
| Focus/reconnect ไม่ auto-refetch ใน V2 | Query defaults + compatibility focus cleanup | ตั้งค่าแล้ว; notifications/activity polling ยังอยู่ |
| ไทย/keyboard/mobile/CSV/10,000 rows | `v2.spec.js`, `v2-acceptance.spec.js` | ผ่าน fixture |
| tests/lint/build/security/CI | scripts + workflow V2 acceptance | รัน local; ยังไม่ได้อ้างว่า GitHub CI ที่ remote ผ่าน |
| Preview ก่อน Production/ปิดเฉพาะ V2 | Vercel Preview; VITE_V2_DISABLED | Preview พร้อม; Production ยังไม่ deploy |

## สิ่งที่ยังต้องทำกับระบบจริง

- Supabase CLI ยังแจ้ง `Access token not provided` ต้องเข้าสู่ระบบบริหารก่อน จึง apply **เฉพาะ** migration `20260920170000_timeline_v2.sql` โดยไม่ push migrations เดิมที่ยังไม่ได้ commit
- เพิ่ม OAuth allowlist `/v2/` สำหรับโดเมนจริง/Preview และทดสอบ Google login ด้วยบัญชีที่ได้รับสิทธิ์จริง
- โดเมนที่ระบุในแผน `timeline-dashboard-rose.vercel.app` ตอบ HTTP 404 `DEPLOYMENT_NOT_FOUND`; บัญชี Vercel ปัจจุบันมี `magic-timeline-dashboard.vercel.app` ต้องระบุปลายทางก่อนเปิด Production
- ตรวจ schema/RLS และ read access ของ Employee/Manager/Admin ในระบบจริงหลัง apply; mutation acceptance ใช้ staging/fixture ตามข้อห้ามสร้างข้อมูลทดลองในธุรกิจ
- FullCalendar ResizeObserver-loop ถูกแก้ด้วย `scripts/patch-fullcalendar.mjs` ซึ่งรันใน postinstall, ตรวจเวอร์ชันและ SHA-256 ก่อน patch และรวม callbacks ใน animation frame ถัดไป พร้อมข้าม element ที่ unmount แล้ว ไม่มีการปิดซ่อน window error; browser acceptance จับ window errors โดยตรงแล้วตรวจว่าไม่มี error

## แหล่งอ้างอิงในการแก้ integration

- https://vite.dev/guide/api-plugin.html#configureserver — middleware สำหรับ dev/preview
- https://fullcalendar.io/docs/eventDrop — callback และ revert เมื่อล้มเหลว
- https://fullcalendar.io/docs/timeZone — เขตเวลาของ Calendar
- declarations ของ `@fullcalendar/react@7.1.0` — `eventClass` คืน string
- https://github.com/frappe/gantt/blob/v1.2.2/src/index.js — การใช้ task id ใน selectors และ document listener
- https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults — cache/refetch defaults

- https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver#observation_errors — defer layout changes with requestAnimationFrame

## Preview และผลตรวจล่าสุด

- Preview: https://magic-timeline-dashboard-6o6krgerq-gzeeddestiny-7573s-projects.vercel.app/v2/
- Node tests: 125 ผ่าน; browser acceptance: 24 รายการ (fixtures เท่านั้น)
- Clean npm ci, lint, build, legacy isolation, secret scan ผ่าน; npm audit ไม่พบช่องโหว่
- Vercel build รัน FullCalendar postinstall patch สำเร็จ

## ตรวจ Preview ผ่านเบราว์เซอร์จริงเพิ่มเติม

- หน้า Login ของ Preview ล่าสุดแสดงได้ และปุ่ม Google ส่งถึงหน้าเลือกบัญชีของ Google สำเร็จ
- ยังไม่ได้เลือกบัญชี เพราะมีหลายบัญชีและยังรอผู้ใช้ระบุอีเมลทดสอบ จึงไม่อ้างว่า OAuth callback/สิทธิ์บัญชีจริงผ่านแล้ว
- ตรวจ Supabase CLI ซ้ำ ยังไม่มี management access token; ไม่ได้ apply schema จริง

## เปิดโดเมนใหม่ตามคำขอเพิ่มเติม

- https://magic-timeline-v2.vercel.app/v2/ ใช้ deployment `dpl_23CbUPiQ3JwbARZm7voxXi2cV3Bw` ซึ่ง build ด้วย environment Production และ READY
- ใช้ `--prod --skip-domain` ก่อนผูก alias ใหม่; หน้าเดิมบน `magic-timeline-dashboard.vercel.app` เทียบ HTML ก่อน/หลังตรงกัน
- `/v2/gantt` บนโดเมนใหม่ตอบ HTTP 200 แบบไม่ใช้ Vercel bypass
- Supabase migration และ OAuth allowlist ของโดเมนใหม่ยังต้องตั้งค่า; การ deploy เว็บไม่ถือว่าเป็นหลักฐานว่าข้อมูล V2 พร้อมใช้
