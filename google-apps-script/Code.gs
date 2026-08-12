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

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function validateTaskSheet(sheet) {
  const rowCount = Math.min(15, Math.max(1, sheet.getLastRow()));
  const rows = sheet.getRange(1, 1, rowCount, 4).getDisplayValues();
  const index = rows.findIndex(function (row) {
    const headers = row.map(normalizeHeader);
    return (headers[0] === "" || headers[0] === "done")
      && (headers[1] === "topic" || headers[1] === "description")
      && headers[2] === "responsibility"
      && headers[3] === "due date";
  });
  if (index < 0) throw new Error('Task header was not found in rows 1-15 of "' + sheet.getName() + '".');
  return index + 1;
}

function taskIdColumn(sheet, headerRow, create) {
  const maxColumns = sheet.getMaxColumns();
  const headers = sheet.getRange(headerRow, 1, 1, maxColumns).getDisplayValues()[0];
  const existing = headers.findIndex(function (value) { return normalizeHeader(value) === "task id"; });
  if (existing >= 0) return existing + 1;
  if (!create) throw new Error("Task ID header is missing");
  sheet.insertColumnAfter(maxColumns);
  return maxColumns + 1;
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
        const headerRow = validateTaskSheet(sheet);
        const lastRow = sheet.getLastRow();
        const idColumn = taskIdColumn(sheet, headerRow, true);
        sheet.getRange(headerRow, idColumn).setValue(TASK_ID_HEADER);
        if (lastRow <= headerRow) return;
        const rowCount = lastRow - headerRow;
        const taskValues = sheet.getRange(headerRow + 1, 1, rowCount, 5).getDisplayValues();
        const ids = sheet.getRange(headerRow + 1, idColumn, rowCount, 1).getDisplayValues();
        const seen = {};
        ids.forEach(function (row, index) {
          const task = taskValues[index];
          if (!String(task[1] || "").trim()) return;
          if (!String(task[0] || "").trim() && !String(task[2] || "").trim() && !String(task[3] || "").trim() && !String(task[4] || "").trim()) return;
          let taskId = String(row[0] || "").trim();
          if (!validTaskId(taskId) || seen[taskId]) {
            taskId = Utilities.getUuid();
            ids[index][0] = taskId;
            updated += 1;
          }
          seen[taskId] = true;
        });
        sheet.getRange(headerRow + 1, idColumn, rowCount, 1).setValues(ids);
        if (!sheet.isColumnHiddenByUser(idColumn)) sheet.hideColumns(idColumn);
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
  const headerRow = validateTaskSheet(sheet);
  const idColumn = taskIdColumn(sheet, headerRow, false);
  if (!validTaskId(body.taskId)) throw new Error("Invalid Task ID");
  const lastRow = sheet.getLastRow();
  if (lastRow <= headerRow) throw new Error("Task not found");
  const ids = sheet.getRange(headerRow + 1, idColumn, lastRow - headerRow, 1).getDisplayValues();
  const matches = [];
  ids.forEach(function (row, index) { if (String(row[0]).trim() === body.taskId) matches.push(index); });
  if (matches.length !== 1) throw new Error(matches.length ? "Duplicate Task ID" : "Task not found");
  const offset = matches[0];
  const row = offset + headerRow + 1;
  sheet.getRange(row, 1).setValue(body.done);
  sheet.getRange(row, 5).setValue(body.actualSubmit || "");
  return { success: true, rowIndex: row };
}
