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
    if (body.action === "install_activity") return jsonResponse(installActivity(body.spreadsheetIds, body.callbackUrl, body.activitySecret, body.targetSpreadsheetId));
    if (body.action === "set_completion") return jsonResponse(setCompletion(body));
    if (body.action === "email_health") return jsonResponse(emailHealth());
    if (body.action === "send_email_batch") return jsonResponse(sendEmailBatch(body));
    if (body.action === "list_revisions") return jsonResponse(listRevisions(body.spreadsheetIds, body.since));
    return jsonResponse({ success: false, error: "Unknown action" });
  } catch (error) {
    return jsonResponse({ success: false, error: error.message || String(error) });
  }
}

function emailHealth() {
  const senderEmail = Session.getEffectiveUser().getEmail();
  if (!senderEmail) throw new Error("Apps Script sender identity is unavailable");
  return {
    success: true,
    senderEmail: senderEmail,
    quotaRemaining: MailApp.getRemainingDailyQuota(),
  };
}

function sentDeliveryIds() {
  const properties = PropertiesService.getScriptProperties();
  const today = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyyMMdd");
  const oldDay = Utilities.formatDate(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), "Asia/Bangkok", "yyyyMMdd");
  const oldPrefix = "SENT_EMAIL_ID_" + oldDay + "_";
  const all = properties.getProperties();
  Object.keys(all).forEach(function (key) { if (key.indexOf(oldPrefix) === 0) properties.deleteProperty(key); });
  return { properties: properties, prefix: "SENT_EMAIL_ID_" + today + "_" };
}

function rememberDeliveryId(state, deliveryId) {
  state.properties.setProperty(state.prefix + deliveryId, "1");
}

function sendEmailBatch(body) {
  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 100) throw new Error("Invalid email batch");
  const senderName = String(body.senderName || "Timeline Notifications").trim().slice(0, 100);
  const replyTo = body.replyTo ? String(body.replyTo).trim() : "";
  const sent = sentDeliveryIds();
  let quota = MailApp.getRemainingDailyQuota();
  const results = body.messages.map(function (message) {
    const deliveryId = String(message.deliveryId || "");
    const to = String(message.to || "").trim().toLowerCase();
    const subject = String(message.subject || "").slice(0, 200);
    const text = String(message.text || "");
    const html = String(message.html || "");
    if (!deliveryId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || !subject || !text || html.length > 350000) {
      return { deliveryId: deliveryId, status: "failed", error: "Invalid email payload" };
    }
    if (sent.properties.getProperty(sent.prefix + deliveryId)) return { deliveryId: deliveryId, status: "sent", duplicate: true };
    if (quota < 1) return { deliveryId: deliveryId, status: "failed", error: "Workspace MailApp quota is exhausted" };
    try {
      const options = { to: to, subject: subject, body: text, htmlBody: html, name: senderName };
      if (replyTo) options.replyTo = replyTo;
      MailApp.sendEmail(options);
      let warning = "";
      try { rememberDeliveryId(sent, deliveryId); } catch (propertyError) { warning = "Sent, but delivery ID could not be cached"; }
      quota -= 1;
      return { deliveryId: deliveryId, status: "sent", warning: warning };
    } catch (error) {
      return { deliveryId: deliveryId, status: "failed", error: error.message || String(error) };
    }
  });
  return { success: true, quotaRemaining: MailApp.getRemainingDailyQuota(), results: results };
}

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function validateTaskSheet(sheet) {
  const rowCount = Math.min(15, Math.max(1, sheet.getLastRow()));
  const rows = sheet.getRange(1, 1, rowCount, sheet.getLastColumn()).getDisplayValues();
  const index = rows.findIndex(function (row) {
    const headers = row.map(normalizeHeader);
    return (headers.includes('done') || headers.includes('completed') || (!headers[0] && ['topic','description'].includes(headers[1])))
      && (headers.includes('topic') || headers.includes('description'))
      && headers.includes('responsibility') && headers.includes('due date');
  });
  if (index < 0) throw new Error('Task header was not found in rows 1-15 of "' + sheet.getName() + '".');
  return index + 1;
}

function taskIdColumn(sheet, headerRow, create) {
  const maxColumns = sheet.getMaxColumns();
  const headers = activityHeaderValues(sheet,headerRow);
  if (headers.filter(function(value) { return normalizeHeader(value) === 'task id'; }).length > 1) throw new Error('Multiple Task ID headers');
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
        const firstHeaders = sheet.getRange(headerRow,1,1,2).getDisplayValues()[0].map(normalizeHeader);
        if (!firstHeaders[0] && ['topic','description'].includes(firstHeaders[1])) sheet.getRange(headerRow,1).setValue('Done');
        const lastRow = sheet.getLastRow();
        const idColumn = taskIdColumn(sheet, headerRow, true);
        sheet.getRange(headerRow, idColumn).setValue(TASK_ID_HEADER);
        if (lastRow <= headerRow) return;
        const rowCount = lastRow - headerRow;
        const taskValues = sheet.getRange(headerRow + 1, 1, rowCount, sheet.getLastColumn()).getDisplayValues();
        const headers = sheet.getRange(headerRow,1,1,sheet.getLastColumn()).getDisplayValues()[0].map(normalizeHeader);
        const topicCol = headers.findIndex(function(h) { return ['topic','description'].includes(h); });
        const tracked = activityColumns(sheet,headerRow);
        const ids = sheet.getRange(headerRow + 1, idColumn, rowCount, 1).getDisplayValues();
        const seen = {};
        ids.forEach(function (row, index) {
          const task = taskValues[index];
          if (!String(task[topicCol] || "").trim()) return;
          if (!Object.keys(tracked).some(function(col) { return String(task[Number(col)-1] || "").trim(); })) return;
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
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  let occurredAt;
  try {
    const columns = activityColumns(sheet, headerRow);
    const baselines = activityBaselines(); // fail before changing Sheet if tracking is not configured
    const before = activitySnapshot(sheet,row,columns);
    const doneCol = Number(Object.keys(columns).find(function(col) { return columns[col] === 'done'; }));
    const actualCol = Number(Object.keys(columns).find(function(col) { return columns[col] === 'actual_submit'; }));
    if (!doneCol || !actualCol) throw new Error('Completion columns missing');
    const queue = activitySheet('Queue',['ID','Payload','Delivered','Error']);
    const key = body.spreadsheetId+':'+body.sheetGid+':'+body.taskId;
    const desired = {done:body.done,actual_submit:body.actualSubmit || null};
    const changes = {};
    ['done','actual_submit'].forEach(function(field) { if (JSON.stringify(before[field])!==JSON.stringify(desired[field])) changes[field]={before:before[field],after:desired[field]}; });
    occurredAt = new Date().toISOString();
    const event = {id:Utilities.getUuid(),spreadsheetId:body.spreadsheetId,sheetGid:body.sheetGid,taskId:body.taskId,taskKey:key,
      occurredAt:occurredAt,source:'dashboard',actorEmail:body.actorEmail || null,changes:changes};
    let journalRow = null;
    if (Object.keys(changes).length) {
      // Write-ahead record: a crash after changing the Sheet cannot disappear silently.
      queue.appendRow([event.id,JSON.stringify(event),'prepared','']);
      journalRow=queue.getLastRow();
      SpreadsheetApp.flush();
    }
    sheet.getRange(row, doneCol).setValue(body.done);
    sheet.getRange(row, actualCol).setValue(body.actualSubmit || "");
    SpreadsheetApp.flush();
    occurredAt = new Date().toISOString();
    const after = activitySnapshot(sheet,row,columns);
    if (journalRow) {
      event.occurredAt=occurredAt;
      queue.getRange(journalRow,2,1,3).setValues([[JSON.stringify(event),'','']]);
      SpreadsheetApp.flush();
    }
    saveActivityBaseline(baselines,key,after);
  } finally { lock.releaseLock(); }
  // Delivery can retry independently; an outage does not undo the Sheet save.
  try { flushActivityQueue(); } catch (_) { /* queued persistently */ }
  return { success: true, rowIndex: row, occurredAt: occurredAt };
}

// Activity ledger lives in a separate, owner-only spreadsheet. Do not store it in
// shared source sheets: its queue and snapshots contain attribution information.
function activityLedger() {
  const properties = PropertiesService.getScriptProperties();
  const id = properties.getProperty('ACTIVITY_LEDGER_ID');
  if (!id) throw new Error('Run installActivity with ACTIVITY_URL and ACTIVITY_SECRET configured first');
  return SpreadsheetApp.openById(id);
}
function activitySheet(name, headers) {
  const ledger = activityLedger();
  let sheet = ledger.getSheetByName(name);
  if (!sheet) { sheet = ledger.insertSheet(name); sheet.appendRow(headers); }
  return sheet;
}
function activityColumns(sheet, headerRow) {
  const headers = activityHeaderValues(sheet,headerRow).map(normalizeHeader);
  const result = {};
  headers.forEach(function (name, index) {
    let key = { done: 'done', completed: 'done', topic: 'description', description: 'description', responsibility: 'responsibility', 'due date': 'due_date', 'actual submit': 'actual_submit', remark: 'remarks', remarks: 'remarks' }[name];
    if (!key && name && /date|timeline|วันที่/.test(name)) key = 'date:' + name;
    if (key) {
      if (Object.values(result).indexOf(key) >= 0) throw new Error('Duplicate tracked column: ' + name);
      result[index + 1] = key;
    }
  });
  if (!Object.values(result).includes('done') && !headers[0] && ['topic','description'].includes(headers[1])) result[1] = 'done';
  return result;
}
function activityHeaderValues(sheet,headerRow) {
  const rows=sheet.getRange(headerRow,1,Math.min(2,sheet.getLastRow()-headerRow+1),sheet.getLastColumn()).getDisplayValues();
  const primary=rows[0], secondary=rows[1] || [];
  const topic=primary.map(normalizeHeader).findIndex(function(value) { return ['topic','description'].includes(value); });
  if (topic<0 || String(secondary[topic] || '').trim()) return primary;
  return primary.map(function(value,index) {
    if (String(value || '').trim()) return value;
    const candidate=String(secondary[index] || '').trim();
    return /^(actual submit|gd timeline|remarks|task id|done|completed)$|\bdate\b|timeline|วันที่/i.test(candidate) ? candidate : '';
  });
}
function activityValue(value, field, timezone) {
  if (field === 'done') return value === true || value === 1 || String(value).toLowerCase() === 'true';
  if (value === '' || value === null || value === undefined) return null;
  if (field === 'due_date' || field === 'actual_submit' || field.indexOf('date:') === 0) {
    if (value instanceof Date) return Utilities.formatDate(value, timezone, 'yyyy-MM-dd');
    const text = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    if (/^\d+(\.\d+)?$/.test(text)) return new Date(Math.round((Number(text)-25569)*86400000)).toISOString().slice(0,10);
    const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
    if (dmy) return (dmy[3].length === 2 ? '20'+dmy[3] : dmy[3]) + '-' + dmy[2].padStart(2,'0') + '-' + dmy[1].padStart(2,'0');
    // Keep invalid/ambiguous dates in history without casting them into SQL dates.
    return text;
  }
  return String(value).trim();
}
function activitySnapshot(sheet, row, columns) {
  const values = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
  const timezone = sheet.getParent().getSpreadsheetTimeZone();
  const snapshot = {};
  Object.keys(columns).forEach(function (col) { snapshot[columns[col]] = activityValue(values[Number(col)-1], columns[col], timezone); });
  return snapshot;
}
function activityBaselines() {
  const sheet = activitySheet('Baselines', ['Task key','Snapshot']);
  const rows = sheet.getLastRow() > 1 ? sheet.getRange(2,1,sheet.getLastRow()-1,2).getValues() : [];
  const map = {};
  rows.forEach(function (row,index) { map[row[0]] = { row: index+2, value: JSON.parse(row[1]) }; });
  return { sheet: sheet, map: map };
}
// Edit handlers look up one baseline instead of reading the whole ledger while holding the lock.
function activityBaselineStore() {
  return { sheet: activitySheet('Baselines', ['Task key','Snapshot']), map: {} };
}
function loadActivityBaseline(baselines, key) {
  if (baselines.map[key]) return baselines.map[key].value;
  if (baselines.sheet.getLastRow() < 2) return undefined;
  const cell = baselines.sheet.getRange(2,1,baselines.sheet.getLastRow()-1,1).createTextFinder(key).matchEntireCell(true).findNext();
  if (!cell) return undefined;
  baselines.map[key] = { row: cell.getRow(), value: JSON.parse(baselines.sheet.getRange(cell.getRow(),2).getValue()) };
  return baselines.map[key].value;
}
function saveActivityBaseline(baselines, key, value) {
  const text = JSON.stringify(value);
  if (baselines.map[key]) baselines.sheet.getRange(baselines.map[key].row,2).setValue(text);
  else { baselines.sheet.appendRow([key,text]); baselines.map[key] = { row: baselines.sheet.getLastRow() }; }
  baselines.map[key].value = value;
}
function activityActor(e) {
  // Installable triggers often hide e.user for consumer or cross-domain editors; revisions fill the gap later.
  try { const email = e.user && e.user.getEmail(); if (email) return email; } catch (_) {}
  try { return Session.getActiveUser().getEmail() || null; } catch (_) { return null; }
}
function cellActivityValue(value) {
  if (value === '' || value === null || value === undefined) return null;
  return String(value).trim().slice(0, 200) || null;
}
function captureProjectLinkActivity(e, sheet, spreadsheetId, header, occurredAt, actor, where) {
  if (e.range.getRow() >= header || e.range.getLastRow() >= header) return false;
  const single = e.range.getNumRows()===1 && e.range.getNumColumns()===1;
  let linkRow = false;
  for (let row=e.range.getRow(); row<=e.range.getLastRow(); row++) {
    const labels=sheet.getRange(row,1,1,Math.min(10,sheet.getLastColumn())).getDisplayValues()[0];
    const label=labels.map(function(value) { return String(value || '').trim(); }).find(function(value) { return /^link\s+(canva|material)\s*:?$/i.test(value); });
    if (!label) continue;
    linkRow=true;
    for (let col=e.range.getColumn(); col<=e.range.getLastColumn(); col++) {
      if (labels[col-1]===label) continue;
      const before=single ? (e.oldValue == null || e.oldValue==='' ? null : String(e.oldValue).trim()) : null;
      const after=single ? (e.value == null || e.value==='' ? null : String(e.value).trim()) : String(sheet.getRange(row,col).getDisplayValue() || '').trim() || null;
      if (JSON.stringify(before)!==JSON.stringify(after)) {
        const field='project_link:'+label.replace(/\s*:\s*$/,'').toLowerCase();
        const changes={}; changes[field]={before:before,after:after};
        queueActivity({ id:Utilities.getUuid(),spreadsheetId:spreadsheetId,sheetGid:sheet.getSheetId(),scope:'tab',
          occurredAt:occurredAt,source:'google_sheet',actorEmail:actor,changes:changes,sheetName:where.sheetName,range:where.range });
      }
    }
  }
  return linkRow;
}
function queueActivity(event) {
  activitySheet('Queue', ['ID','Payload','Delivered','Error']).appendRow([event.id, JSON.stringify(event), '', '']);
  SpreadsheetApp.flush();
}
function activitySources() { return JSON.parse(PropertiesService.getScriptProperties().getProperty('ACTIVITY_SOURCES') || '{}'); }

function installActivity(spreadsheetIds, callbackUrl, activitySecret, targetSpreadsheetId) {
  const properties = PropertiesService.getScriptProperties();
  if (callbackUrl && activitySecret) {
    if (!/^https:\/\//.test(callbackUrl) || typeof activitySecret !== 'string' || activitySecret.length < 32) throw new Error('Invalid activity configuration');
    properties.setProperties({ ACTIVITY_URL:callbackUrl, ACTIVITY_SECRET:activitySecret });
  }
  if (!properties.getProperty('ACTIVITY_URL') || !properties.getProperty('ACTIVITY_SECRET')) throw new Error('Configure ACTIVITY_URL and ACTIVITY_SECRET');
  if (!Array.isArray(spreadsheetIds) || !spreadsheetIds.length) throw new Error('No registered sources');
  if (targetSpreadsheetId && !spreadsheetIds.includes(targetSpreadsheetId)) throw new Error('Unregistered installation target');
  if (!properties.getProperty('ACTIVITY_LEDGER_ID')) properties.setProperty('ACTIVITY_LEDGER_ID',SpreadsheetApp.create('Timeline Activity Ledger').getId());
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  const installed = [], errors = [];
  let pending = false;
  try {
    const baselines = activityBaselines();
    const sources = activitySources();
    (targetSpreadsheetId ? [targetSpreadsheetId] : spreadsheetIds).forEach(function(id) {
      try {
        const book = SpreadsheetApp.openById(id);
        const tabs = book.getSheets().filter(function(sheet) { return !sheet.isSheetHidden(); });
        const cursorKey = 'ACTIVITY_INSTALL_OFFSET_'+id;
        const offset = targetSpreadsheetId ? Number(properties.getProperty(cursorKey) || 0) : 0;
        const selectedTabs = targetSpreadsheetId ? tabs.slice(offset,offset+3) : tabs;
        const gids = (sources[id] || []).filter(function(gid) { return tabs.some(function(tab) { return tab.getSheetId()===gid; }); });
        selectedTabs.forEach(function(sheet) {
          let header;
          try { header = validateTaskSheet(sheet); } catch (_) { return; }
          try {
          const idCol = taskIdColumn(sheet,header,false);
          const cols = activityColumns(sheet,header);
          const ids = sheet.getRange(header+1,idCol,Math.max(1,sheet.getLastRow()-header),1).getDisplayValues();
          const values = sheet.getRange(header+1,1,Math.max(1,sheet.getLastRow()-header),sheet.getLastColumn()).getValues();
          const timezone = book.getSpreadsheetTimeZone();
          const pendingBaselines = [];
          const seen = {};
          ids.forEach(function(row,index) {
            if (!row[0]) return;
            if (!validTaskId(row[0]) || seen[row[0]]) throw new Error('Invalid or duplicate Task ID in '+sheet.getName());
            seen[row[0]]=true;
            const key = id+':'+sheet.getSheetId()+':'+row[0];
            if (!baselines.map[key]) {
              const snapshot = {};
              Object.keys(cols).forEach(function(col) { snapshot[cols[col]]=activityValue(values[index][Number(col)-1],cols[col],timezone); });
              pendingBaselines.push([key,JSON.stringify(snapshot)]);
            }
          });
          if (pendingBaselines.length) {
            const startRow = baselines.sheet.getLastRow()+1;
            const requiredRows = startRow+pendingBaselines.length-1;
            if (requiredRows>baselines.sheet.getMaxRows()) baselines.sheet.insertRowsAfter(baselines.sheet.getMaxRows(),requiredRows-baselines.sheet.getMaxRows());
            baselines.sheet.getRange(startRow,1,pendingBaselines.length,2).setValues(pendingBaselines);
            pendingBaselines.forEach(function(row,index) { baselines.map[row[0]]={row:startRow+index,value:JSON.parse(row[1])}; });
            SpreadsheetApp.flush();
          }
          if (!gids.includes(sheet.getSheetId())) gids.push(sheet.getSheetId());
          } catch(error) { errors.push({spreadsheetId:id,error:sheet.getName()+': '+error.message}); }
        });
        pending = Boolean(targetSpreadsheetId && offset+selectedTabs.length<tabs.length);
        if (pending) properties.setProperty(cursorKey,String(offset+selectedTabs.length));
        else properties.deleteProperty(cursorKey);
        if (gids.length) {
          const existing = ScriptApp.getProjectTriggers().some(function(t) { return t.getHandlerFunction()==='captureSheetActivity' && t.getTriggerSourceId()===id; });
          if (!existing) ScriptApp.newTrigger('captureSheetActivity').forSpreadsheet(id).onEdit().create();
          sources[id] = gids;
          if (!pending) installed.push(id);
        } else if (!pending) throw new Error('No provisioned task tabs');
      } catch(error) { errors.push({ spreadsheetId:id,error:error.message }); }
    });
    // Remove triggers for sources explicitly removed from the registered set.
    Object.keys(sources).forEach(function(id) {
      if (spreadsheetIds.includes(id)) return;
      ScriptApp.getProjectTriggers().filter(function(t) { return t.getHandlerFunction()==='captureSheetActivity' && t.getTriggerSourceId()===id; }).forEach(function(t) { ScriptApp.deleteTrigger(t); });
      delete sources[id];
    });
    properties.setProperty('ACTIVITY_SOURCES',JSON.stringify(sources));
    if (!ScriptApp.getProjectTriggers().some(function(t) { return t.getHandlerFunction()==='flushActivityQueue'; })) ScriptApp.newTrigger('flushActivityQueue').timeBased().everyMinutes(1).create();
  } finally { lock.releaseLock(); }
  flushActivityQueue();
  return { success:true, installed:installed, errors:errors, pending:pending };
}

function captureSheetActivity(e) {
  // Capture time before waiting for the lock. Google edit events have no timestamp.
  const occurredAt = new Date().toISOString();
  const sheet = e.range.getSheet(), id = sheet.getParent().getId();
  const sources = activitySources();
  if (!sources[id]) return;
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    let header;
    if (!sources[id].includes(sheet.getSheetId())) {
      // Tabs created after installation are tracked as soon as they have a task header.
      try { header = validateTaskSheet(sheet); } catch (_) { return; }
      sources[id].push(sheet.getSheetId());
      PropertiesService.getScriptProperties().setProperty('ACTIVITY_SOURCES', JSON.stringify(sources));
    } else header = validateTaskSheet(sheet);
    const actor = activityActor(e);
    const where = { sheetName: sheet.getName(), range: e.range.getA1Notation() };
    if (!captureProjectLinkActivity(e,sheet,id,header,occurredAt,actor,where) && e.range.getLastRow() > header) {
      const idCol = taskIdColumn(sheet,header,false);
      const columns = activityColumns(sheet,header), headers = activityHeaderValues(sheet,header), baselines = activityBaselineStore();
      const timezone = sheet.getParent().getSpreadsheetTimeZone();
      const single = e.range.getNumRows()===1 && e.range.getNumColumns()===1;
      const allIds = sheet.getRange(header+1,idCol,Math.max(1,sheet.getLastRow()-header),1).getDisplayValues().map(function(r) { return r[0]; });
      const skipped = [];
      for (let row = Math.max(header+1,e.range.getRow()); row <= e.range.getLastRow(); row++) {
      const taskId = allIds[row-header-1];
      // One unidentified row must not discard the other rows of the same paste.
      if (!validTaskId(taskId) || allIds.filter(function(value) { return value===taskId; }).length!==1) {
        if (row <= sheet.getLastRow() && sheet.getRange(row,1,1,sheet.getLastColumn()).getDisplayValues()[0].some(function(value) { return value !== ''; })) skipped.push(row);
        continue;
      }
      const key = id+':'+sheet.getSheetId()+':'+taskId;
      const previous = loadActivityBaseline(baselines,key);
      const current = activitySnapshot(sheet,row,columns);
      const next = Object.assign({},previous || current), changes = {};
      let gap = previous ? null : 'ไม่มี snapshot ก่อนแก้ไข';
      for (let col=e.range.getColumn(); col<=e.range.getLastColumn(); col++) {
        if (col === idCol) continue;
        const field=columns[col];
        if (!field) {
          // Every other cell in a task row is an update too; it is history only, not task state.
          const cellField = 'cell:' + (normalizeHeader(headers[col-1]) || 'column ' + col);
          const cellBefore = single ? cellActivityValue(e.oldValue) : null;
          const cellAfter = single && e.value !== undefined ? cellActivityValue(e.value) : cellActivityValue(sheet.getRange(row,col).getDisplayValue());
          if (!single) gap = gap || 'วางหลายเซลล์: เปรียบเทียบจาก snapshot ไม่สามารถยืนยันค่าระหว่างเหตุการณ์ที่ซ้อนกัน';
          if (JSON.stringify(cellBefore)!==JSON.stringify(cellAfter)) changes[cellField]={ before:cellBefore, after:cellAfter };
          continue;
        }
        let before=previous ? previous[field] : null, after=current[field];
        if (single) {
          before=activityValue(e.oldValue,field,timezone);
          after=activityValue(e.value,field,timezone);
          if (previous && JSON.stringify(previous[field] ?? null)!==JSON.stringify(before)) gap='ค่าก่อนแก้ไม่ตรงกับ snapshot อาจมีเหตุการณ์ที่ขาดหายหรือสลับลำดับ';
        } else gap = gap || 'วางหลายเซลล์: เปรียบเทียบจาก snapshot ไม่สามารถยืนยันค่าระหว่างเหตุการณ์ที่ซ้อนกัน';
        next[field]=after;
        if (JSON.stringify(before ?? null)!==JSON.stringify(after ?? null)) {
          let keyField=field;
          if (['due_date','actual_submit'].includes(field) && [before,after].some(function(v) { return v && !/^\d{4}-\d{2}-\d{2}$/.test(v); })) {
            keyField='date:'+field; gap='รูปแบบวันที่ไม่ชัดเจน เก็บค่าดิบไว้ในประวัติ';
          }
          changes[keyField]={ before:before ?? null, after:after ?? null };
        }
      }
      if (Object.keys(changes).length || gap) queueActivity({ id:Utilities.getUuid(),spreadsheetId:id,sheetGid:sheet.getSheetId(),taskId:taskId,taskKey:key,
        occurredAt:occurredAt,source:'google_sheet',actorEmail:actor,changes:changes,historyGap:gap,sheetName:where.sheetName,range:where.range });
        if (JSON.stringify(next)!==JSON.stringify(previous)) saveActivityBaseline(baselines,key,next);
      }
      if (skipped.length) queueActivity({ id:Utilities.getUuid(),spreadsheetId:id,sheetGid:sheet.getSheetId(),scope:'tab',occurredAt:occurredAt,
        source:'google_sheet',actorEmail:actor,changes:{},sheetName:where.sheetName,range:where.range,
        historyGap:'แก้แถว '+skipped.join(', ')+' ที่ยังไม่มี Task ID หรือ Task ID ซ้ำ ระบบจะผูกกับงานหลัง Sync' });
    }
    PropertiesService.getScriptProperties().deleteProperty('ACTIVITY_ERROR_'+id);
  } catch(error) {
    PropertiesService.getScriptProperties().setProperty('ACTIVITY_ERROR_'+id,new Date().toISOString()+': '+error.message);
    throw error;
  } finally { lock.releaseLock(); }
  flushActivityQueue();
}

function flushActivityQueue() {
  const lock=LockService.getScriptLock(); if (!lock.tryLock(1000)) return;
  try {
    const properties=PropertiesService.getScriptProperties(), sources=activitySources();
    const queue=activitySheet('Queue',['ID','Payload','Delivered','Error']);
    const rows=queue.getLastRow()>1 ? queue.getRange(2,1,queue.getLastRow()-1,4).getValues() : [];
    const pending=rows.map(function(row,index) { return { row:index+2,values:row }; }).filter(function(entry) { return !entry.values[2] || entry.values[2]==='prepared'; });
    const cursor=Number(properties.getProperty('ACTIVITY_QUEUE_CURSOR') || 0) % Math.max(1,pending.length);
    const batch=pending.slice(cursor,cursor+50).concat(pending.slice(0,Math.max(0,cursor+50-pending.length))).slice(0,Math.min(50,pending.length));
    properties.setProperty('ACTIVITY_QUEUE_CURSOR',String(cursor+batch.length));
    batch.forEach(function(entry) {
      if (entry.values[2]!=='prepared') return;
      const uncertain=JSON.parse(entry.values[1]);
      uncertain.historyGap='การเขียน Done/Actual Submit ขัดข้อง ไม่สามารถยืนยันว่าการเปลี่ยนสำเร็จเมื่อใด กรุณาตรวจ Sheet';
      uncertain.changes={};
      // Preserve the attempted values in the ledger; send a gap, not an invented action.
      entry.values[1]=JSON.stringify(uncertain);
    });
    const health=Object.keys(sources).map(function(id) { return { spreadsheetId:id,installedGids:sources[id],
      pendingCount:pending.filter(function(entry) { return JSON.parse(entry.values[1]).spreadsheetId===id; }).length,
      error:properties.getProperty('ACTIVITY_ERROR_'+id) || (pending.find(function(entry) { return JSON.parse(entry.values[1]).spreadsheetId===id && entry.values[3]; }) || {values:[]}).values[3] || null }; });
    const response=UrlFetchApp.fetch(properties.getProperty('ACTIVITY_URL'),{ method:'post',contentType:'application/json',
      headers:{ 'x-activity-secret':properties.getProperty('ACTIVITY_SECRET') },payload:JSON.stringify({events:batch.map(function(entry) { return JSON.parse(entry.values[1]); }),health:health}),muteHttpExceptions:true });
    if (response.getResponseCode()!==200) throw new Error('Activity delivery failed: '+response.getResponseCode());
    const result=JSON.parse(response.getContentText());
    batch.forEach(function(entry) {
      if ((result.accepted || []).includes(entry.values[0])) queue.getRange(entry.row,3,1,2).setValues([[new Date().toISOString(),'']]);
      else { const error=(result.errors || []).find(function(item) { return item.id===entry.values[0]; }); queue.getRange(entry.row,4).setValue(error ? error.error : 'Not acknowledged'); }
    });
  } finally { lock.releaseLock(); }
}

// Drive version history names the editor even when the edit trigger cannot (requires the Drive API v3 advanced service).
function listRevisions(spreadsheetIds, since) {
  if (!Array.isArray(spreadsheetIds) || !spreadsheetIds.length || spreadsheetIds.length > 50) throw new Error('Invalid spreadsheet list');
  const sinceTime = Date.parse(since);
  if (!isFinite(sinceTime)) throw new Error('Invalid revision window');
  const files = spreadsheetIds.map(function(id) {
    try {
      const file = Drive.Files.get(id, { fields: 'name' });
      const revisions = [];
      let pageToken;
      do {
        const page = Drive.Revisions.list(id, { pageSize: 1000, pageToken: pageToken, fields: 'nextPageToken,revisions(id,modifiedTime,lastModifyingUser(displayName,emailAddress))' });
        (page.revisions || []).forEach(function(revision) {
          if (Date.parse(revision.modifiedTime) < sinceTime) return;
          const user = revision.lastModifyingUser || {};
          revisions.push({ id: String(revision.id), modifiedTime: revision.modifiedTime, editorEmail: user.emailAddress || null, editorName: user.displayName || null });
        });
        pageToken = page.nextPageToken;
      } while (pageToken);
      return { spreadsheetId: id, name: file.name || null, revisions: revisions };
    } catch (error) {
      return { spreadsheetId: id, error: error.message || String(error) };
    }
  });
  return { success: true, files: files };
}
