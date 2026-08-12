# Google Apps Script

1. สร้าง standalone Apps Script project แล้ววาง `Code.gs`
2. ตั้ง Script Property `SHARED_SECRET` ให้ตรงกับ `APPS_SCRIPT_SHARED_SECRET` ใน Vercel
3. Deploy เป็น Web app ที่ execute as owner และบันทึก URL เป็น `APPS_SCRIPT_URL`
4. จำกัดสิทธิ์ Google account เจ้าของ script ให้เข้าถึงเฉพาะ Sheets ที่ระบบใช้

`ensure_task_ids` ใช้ได้ทั้งจาก routine sync และหน้า Admin โดยรับ `targets: [{ spreadsheetId, sheetGids }]` ระบบตรวจ header A:E, เติม UUID เฉพาะแถวที่ว่าง/ซ้ำ/ไม่ปลอดภัย และไม่เขียนทับคอลัมน์ F ที่ถูกใช้งานอยู่ ส่วน `set_completion` ตรวจ schema และเขียนเมื่อพบ Task ID เพียงแถวเดียว
