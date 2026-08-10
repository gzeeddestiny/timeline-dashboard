const TASK_ID_COLUMN = 6;
const TASK_ID_HEADER = "Task ID";

function validTaskId(value) {
  return /^[A-Za-z0-9_-]{1,200}$/.test(String(value || ""));
}

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(event) {
  try {
    const body = JSON.parse(event.postData.contents || "{}");
    const secret = PropertiesService.getScriptProperties().getProperty("SHARED_SECRET");
    if (!secret || body.secret !== secret) return jsonResponse({ success: false, error: "Unauthorized" });
    if (body.action === "ensure_task_ids") return jsonResponse(ensureTaskIds(body.targets || []));
    if (body.action === "set_completion") return jsonResponse(setCompletion(body));
    return jsonResponse({ success: false, error: "Unknown action" });
  } catch (error) {
    return jsonResponse({ success: false, error: error.message || String(error) });
  }
}

function validateTaskSheet(sheet) {
  const expected = ["done", "topic", "responsibility", "due date", "actual submit"];
  const headers = sheet.getRange(1, 1, 1, 5).getDisplayValues()[0].map(function (value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  });
  if (expected.some(function (value, index) { return headers[index] !== value; })) {
    throw new Error('Invalid task headers in "' + sheet.getName() + '". Expected Done, Topic, Responsibility, Due Date, Actual Submit.');
  }
}

function ensureTaskIds(targets) {
  if (!Array.isArray(targets) || targets.length < 1 || targets.length > 20) throw new Error("Invalid provisioning targets");
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    let updated = 0;
    targets.forEach(function (target) {
      if (!target || !target.spreadsheetId || !Array.isArray(target.sheetGids) || target.sheetGids.length < 1 || target.sheetGids.length > 100) {
        throw new Error("Invalid provisioning target");
      }
      const spreadsheet = SpreadsheetApp.openById(target.spreadsheetId);
      const allowed = {};
      target.sheetGids.forEach(function (gid) { allowed[String(gid)] = true; });
      const selected = spreadsheet.getSheets().filter(function (sheet) { return allowed[String(sheet.getSheetId())]; });
      if (selected.length !== target.sheetGids.length) throw new Error("One or more selected tabs were not found");
      selected.forEach(function (sheet) {
        validateTaskSheet(sheet);
        const lastRow = sheet.getLastRow();
        if (lastRow < 1) return;
        const taskIdHeader = String(sheet.getRange(1, TASK_ID_COLUMN).getDisplayValue() || "").trim();
        if (taskIdHeader && taskIdHeader !== TASK_ID_HEADER) throw new Error('Column F is already used in "' + sheet.getName() + '"');
        if (!taskIdHeader) sheet.getRange(1, TASK_ID_COLUMN).setValue(TASK_ID_HEADER);
        if (lastRow === 1) return;
        const topics = sheet.getRange(2, 2, lastRow - 1, 1).getDisplayValues();
        const ids = sheet.getRange(2, TASK_ID_COLUMN, lastRow - 1, 1).getDisplayValues();
        const seen = {};
        ids.forEach(function (row, index) {
          if (!String(topics[index][0] || "").trim()) return;
          let taskId = String(row[0] || "").trim();
          if (!validTaskId(taskId) || seen[taskId]) {
            taskId = Utilities.getUuid();
            ids[index][0] = taskId;
            updated += 1;
          }
          seen[taskId] = true;
        });
        sheet.getRange(2, TASK_ID_COLUMN, lastRow - 1, 1).setValues(ids);
        if (!sheet.isColumnHiddenByUser(TASK_ID_COLUMN)) sheet.hideColumns(TASK_ID_COLUMN);
      });
    });
    return { success: true, updated: updated };
  } finally {
    lock.releaseLock();
  }
}

function setCompletion(body) {
  if (!body.spreadsheetId || !Number.isInteger(body.sheetGid) || !body.taskId || typeof body.done !== "boolean") {
    throw new Error("Invalid completion payload");
  }
  const spreadsheet = SpreadsheetApp.openById(body.spreadsheetId);
  const sheet = spreadsheet.getSheets().find(function (item) { return item.getSheetId() === body.sheetGid; });
  if (!sheet) throw new Error("Sheet tab not found");
  validateTaskSheet(sheet);
  if (String(sheet.getRange(1, TASK_ID_COLUMN).getDisplayValue() || "").trim() !== TASK_ID_HEADER) throw new Error("Task ID header is missing");
  if (!validTaskId(body.taskId)) throw new Error("Invalid Task ID");
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error("Task not found");
  const ids = sheet.getRange(2, TASK_ID_COLUMN, lastRow - 1, 1).getDisplayValues();
  const matches = [];
  ids.forEach(function (row, index) { if (String(row[0]).trim() === body.taskId) matches.push(index); });
  if (matches.length !== 1) throw new Error(matches.length ? "Duplicate Task ID" : "Task not found");
  const offset = matches[0];
  const row = offset + 2;
  sheet.getRange(row, 1).setValue(body.done);
  sheet.getRange(row, 5).setValue(body.actualSubmit || "");
  return { success: true, rowIndex: row };
}
