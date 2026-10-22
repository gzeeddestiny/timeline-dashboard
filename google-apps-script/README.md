# Google Apps Script

1. สร้าง standalone Apps Script project แล้ววาง `Code.gs`
2. ตั้ง Script Property `SHARED_SECRET` ให้ตรงกับ `APPS_SCRIPT_SHARED_SECRET` ใน Vercel
3. Deploy เป็น Web app ที่ execute as owner และบันทึก URL เป็น `APPS_SCRIPT_URL`
4. Authorize ทั้ง Google Sheets และ MailApp ด้วยบัญชี Google Workspace ผู้ส่ง แล้ว deploy version ใหม่
5. จำกัดสิทธิ์ Google account เจ้าของ script ให้เข้าถึงเฉพาะ Sheets ที่ระบบใช้

`ensure_task_ids` ใช้ได้ทั้งจาก routine sync และหน้า Admin โดยรับ `targets: [{ spreadsheetId, sheetGids }]` ระบบค้นหาหัวคอลัมน์ Task ID ตามชื่อ และเพิ่มคอลัมน์ท้ายสุดเมื่อยังไม่มี โดยไม่เขียนทับ GD Timeline หรือข้อมูลอื่น ส่วน `set_completion` ตรวจ schema และเขียนเมื่อพบ Task ID เพียงแถวเดียว รองรับหัวตารางสองแถวแบบ Description/Responsibility/Due Date อยู่แถวบน และ Actual Submit/GD Timeline อยู่แถวถัดมา

`email_health` คืน sender identity และ quota คงเหลือ ส่วน `send_email_batch` ส่งหนึ่ง message ต่อหนึ่ง recipient ผ่าน `MailApp` พร้อม sender name/Reply-To และจำ delivery ID ของวันนั้นเพื่อกันส่งซ้ำ หลัง deploy ให้เปิด Admin Settings > Notifications แล้วส่ง Test email ก่อนเปิด Daily Digest หรือ No Activity

## เปิดการติดตาม Action

1. ทดสอบด้วยสำเนา Sheet และฐานข้อมูล staging ก่อน โดยลงทะเบียนเฉพาะสำเนาในตาราง `sheets` ของ staging และ provision Task ID ตามปกติ
2. ใช้ migration `supabase/migrations/20260907100000_action_history.sql` หลัง migrations เดิมครบแล้ว สำรองฐานข้อมูลก่อนเปลี่ยนระบบจริง; migration ตั้ง baseline ใหม่สำหรับเวลาที่ไม่มีหลักฐาน และนำเข้าเฉพาะการเปลี่ยน Workflow ที่ยืนยันจาก audit เดิมได้
3. ตั้ง `SHEET_ACTIVITY_SECRET` เป็น secret สุ่มอย่างน้อย 32 ตัวอักษรฝั่ง server และตั้ง `APP_URL` เป็น HTTPS origin ของ deployment นั้น ใช้คนละ secret กับ `APPS_SCRIPT_SHARED_SECRET` และอย่าตั้งชื่อด้วย `VITE_`
4. อัปเดต `Code.gs` ใน Apps Script, อนุญาตสิทธิ์ Spreadsheet/UrlFetch/การจัดการ trigger ด้วยบัญชีเจ้าของที่เข้าถึง Sheets ที่ลงทะเบียน แล้ว deploy Web app version ใหม่ เก็บ URL ไว้ใน `APPS_SCRIPT_URL` ตามเดิม
5. Deploy API และหน้าเว็บ เปิด Follow-up ด้วยบัญชี Admin แล้วกด **เปิด / ตรวจการติดตาม Sheet** ระบบส่ง callback URL และ secret ผ่าน Web app ที่ยืนยันด้วย shared secret อยู่แล้ว จากนั้นสร้าง edit trigger ต่อ spreadsheet และ timer ส่งคิวทุก 1 นาที
6. ตรวจผลติดตั้งว่าทุก Sheet สำเร็จและไม่มีแท็บตกหล่น หากเพิ่ม Sheet/แท็บในภายหลัง ให้กดปุ่มเดิมอีกครั้ง ปุ่มนี้ไม่สร้าง trigger ซ้ำ
7. ทดสอบติ๊กเข้า–ออกเร็ว ๆ, เปลี่ยน Due Date/Actual Submit/GD Timeline, วางหลายแถว, เปลี่ยน Workflow/Note/Priority/Next Action, assign และเปลี่ยนรูป ตรวจประวัติก่อน–หลัง AE ผู้รับผิดชอบ ผู้แก้ และ No Activity ในทั้งสามหน้าที่เกี่ยวข้อง
8. ทำขั้นตอนเดียวกันใน production หลัง staging ผ่าน และตรวจสัญญาณการติดตามใน Follow-up อีกครั้ง ระบบจะแจ้งหากไม่ได้รับสัญญาณเกิน 5 นาที มีคิวค้าง หรือมีแท็บยังไม่ได้ติดตั้ง

การตั้งค่าครั้งแรกจะสร้าง **Timeline Activity Ledger** เป็น spreadsheet แยกภายใต้บัญชีเจ้าของ Script (ไม่แชร์ให้ผู้ใช้ Sheet โดยอัตโนมัติ) และเก็บ ID ไว้ใน Script Property `ACTIVITY_LEDGER_ID` ภายในมี `Baselines` และ `Queue` ประวัติหลักอยู่ในฐานข้อมูล `action_events`; อย่าลบ ledger หรือ reset baseline ระหว่างมีคิวค้าง

`captureSheetActivity` บันทึกเหตุการณ์ลง ledger ก่อนอัปเดต baseline; `flushActivityQueue` ส่งครั้งละไม่เกิน 50 เหตุการณ์และหมุนเวียน retry เพื่อไม่ให้รายการเสียขวางรายการอื่น การตอบรับใช้ event ID จึงส่งซ้ำได้โดยไม่เพิ่มยอด การเขียน Done จาก Dashboard ใช้ journal เดียวกันและมี write-ahead record; ถ้าเขียนขัดข้องกลางทาง ระบบส่งช่องว่างของประวัติแทนการอ้างว่าเกิด action สำเร็จ

เวลา `occurred_at` ของ Sheet คือเวลาที่ edit handler เริ่มทำงาน เนื่องจาก Google ไม่ส่งเวลาแก้เซลล์ใน event; `received_at` คือเวลาที่ API รับเข้าฐานข้อมูล การแก้หลายเซลล์ใช้ baseline และระบุความไม่แน่นอนของค่าระหว่างเหตุการณ์ที่ซ้อนกัน ชื่อผู้แก้ใช้เฉพาะ `e.user` ที่ Google ส่งมา ไม่ใช้บัญชีเจ้าของ trigger แทน

ข้อผิดพลาดการจับเหตุการณ์ถูกเก็บใน `ACTIVITY_ERROR_<spreadsheetId>` และไม่ล้างเมื่อมีการแก้เซลล์ถัดไป หลังตรวจสาเหตุ/แก้ Task ID หรือ schema และบันทึกข้อจำกัดของช่วงที่ขาดหายแล้ว ผู้ดูแลจึงลบ property ข้อผิดพลาดนั้นได้ ประวัติ gap ที่รับเข้าฐานข้อมูลยังคงอยู่ ไม่ถูกลบย้อนหลัง

Installable triggers มีโควตาต่อผู้ใช้/Script; หากติดตั้งไม่ครบ ระบบแสดงข้อผิดพลาดราย Sheet ห้ามถือว่าการ sync ปกติเป็นหลักฐานว่าเก็บทุก action ได้ การเขียนจากสูตรหรือ API ภายนอกไม่เรียก edit trigger ต้องเพิ่มการส่งเหตุการณ์จากผู้เขียนนั้นก่อนใช้งานช่องทางดังกล่าว

## ตรวจในเครื่อง

ก่อนติดตั้งจริง สามารถวาง `StagingTest.gs` ต่อท้าย `Code.gs` ชั่วคราวใน Apps Script แล้วเรียก `prepareActivityCopyTest` ด้วยบัญชีเจ้าของ ฟังก์ชันนี้คัดลอกแท็บตัวอย่างเป็นไฟล์ใหม่และสร้าง ledger ทดสอบแยก ปฏิเสธการทำงานหากมีระบบติดตามติดตั้งอยู่แล้ว แก้เฉพาะไฟล์สำเนาตาม URL ใน execution log แล้วเรียก `inspectActivityCopyTest` เพื่อตรวจเหตุการณ์ การส่งคิวจะล้มเหลวโดยตั้งใจเพราะยังไม่ได้ตั้ง callback เพื่อทดสอบการเก็บคิวถาวร หลังตรวจให้เรียก `finishActivityCopyTest` เพื่อหยุด trigger ทดสอบและคืนการตั้งค่า โดยเก็บไฟล์สำเนาและ ledger ไว้ จากนั้นนำฟังก์ชันทดสอบออกก่อน deploy Web app

- `npm test` ทดสอบฐานข้อมูลด้วย PostgreSQL ใน PGlite และทดสอบ Apps Script กับ Sheet/ledger จำลอง รวมคิวขัดข้องและ A → B → A
- `npm run lint` และ `npm run build`
- `node scripts/preview-activity.mjs` เปิด `http://127.0.0.1:4178/activity-preview` เพื่อทดสอบ UI ด้วยข้อมูลจำลอง กด “จำลอง Action ใหม่” และรอรอบ 30 วินาที โดย Data Issues ที่ยังไม่แก้ต้องยังแสดงอยู่ ไม่มีการเขียนฐานข้อมูลหรือ Sheet จริงจาก fixture นี้
