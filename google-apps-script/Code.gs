const TASK_ID_COLUMN = 6;
const TASK_ID_HEADER = "Task ID";

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(event) {
  try {
    const body = JSON.parse(event.postData.contents || "{}");
    const secret = PropertiesService.getScriptProperties().getProperty("SHARED_SECRET");
    if (!secret || body.secret !== secret) return jsonResponse({ success: false, error: "Unauthorized" });
    if (body.action === "ensure_task_ids") return jsonResponse(ensureTaskIds(body.spreadsheetIds || []));
    if (body.action === "set_completion") return jsonResponse(setCompletion(body));
    return jsonResponse({ success: false, error: "Unknown action" });
  } catch (error) {
    return jsonResponse({ success: false, error: error.message || String(error) });
  }
}

function ensureTaskIds(spreadsheetIds) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    let updated = 0;
    spreadsheetIds.forEach(function (spreadsheetId) {
      const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
      spreadsheet.getSheets().filter(function (sheet) { return !sheet.isSheetHidden(); }).forEach(function (sheet) {
        const lastRow = sheet.getLastRow();
        if (lastRow < 1) return;
        sheet.getRange(1, TASK_ID_COLUMN).setValue(TASK_ID_HEADER);
        if (lastRow === 1) return;
        const topics = sheet.getRange(2, 2, lastRow - 1, 1).getDisplayValues();
        const ids = sheet.getRange(2, TASK_ID_COLUMN, lastRow - 1, 1).getDisplayValues();
        const seen = {};
        ids.forEach(function (row, index) {
          if (!String(topics[index][0] || "").trim()) return;
          let taskId = String(row[0] || "").trim();
          if (!taskId || seen[taskId]) {
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
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error("Task not found");
  const ids = sheet.getRange(2, TASK_ID_COLUMN, lastRow - 1, 1).getDisplayValues();
  const offset = ids.findIndex(function (row) { return String(row[0]).trim() === body.taskId; });
  if (offset < 0) throw new Error("Task not found");
  const row = offset + 2;
  sheet.getRange(row, 1).setValue(body.done);
  sheet.getRange(row, 5).setValue(body.actualSubmit || "");
  return { success: true, rowIndex: row };
}
