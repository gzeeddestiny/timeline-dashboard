// Optional owner-run acceptance test before production tracking is installed.
// Copies the supplied template tab; never edits the original spreadsheet.
function prepareActivityCopyTest() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('ACTIVITY_LEDGER_ID') || Object.keys(activitySources()).length) {
    throw new Error('Tracking already configured. Use a separate test Apps Script project.');
  }
  const source = SpreadsheetApp.openById('1VJ-eUD9fEUdk4v69uvr_rZTAfccqJRaU6PvoCBfESRI');
  const copy = SpreadsheetApp.create('Timeline Action Acceptance Copy');
  const sheet = source.getSheetById(1823683292).copyTo(copy);
  sheet.setName('Action Test');
  const ledger = SpreadsheetApp.create('Timeline Action Acceptance Ledger');
  props.setProperty('ACTIVITY_LEDGER_ID',ledger.getId());
  props.setProperty('ACTIVITY_COPY_TEST_ID',copy.getId());
  const sources = {}; sources[copy.getId()]=[sheet.getSheetId()];
  props.setProperty('ACTIVITY_SOURCES',JSON.stringify(sources));
  const header = validateTaskSheet(sheet), idCol = taskIdColumn(sheet,header,false);
  const columns = activityColumns(sheet,header), baselines = activityBaselines();
  const values = sheet.getRange(header+1,1,sheet.getLastRow()-header,sheet.getLastColumn()).getValues();
  const rows=[];
  values.forEach(function(values) {
    const id=String(values[idCol-1] || ''); if (!validTaskId(id)) return;
    const snapshot={};
    Object.keys(columns).forEach(function(col) { snapshot[columns[col]]=activityValue(values[Number(col)-1],columns[col],copy.getSpreadsheetTimeZone()); });
    rows.push([copy.getId()+':'+sheet.getSheetId()+':'+id,JSON.stringify(snapshot)]);
  });
  if (rows.length+1>baselines.sheet.getMaxRows()) baselines.sheet.insertRowsAfter(baselines.sheet.getMaxRows(),rows.length+1-baselines.sheet.getMaxRows());
  if (rows.length) baselines.sheet.getRange(2,1,rows.length,2).setValues(rows);
  ScriptApp.newTrigger('captureSheetActivity').forSpreadsheet(copy).onEdit().create();
  console.log(JSON.stringify({copyUrl:copy.getUrl(),gid:sheet.getSheetId(),ledgerUrl:ledger.getUrl(),baselineTasks:rows.length}));
  // No callback is configured: delivery fails intentionally while the durable
  // queue remains available for inspection. Do not install the timer for this test.
}

function inspectActivityCopyTest() {
  const props=PropertiesService.getScriptProperties(), id=props.getProperty('ACTIVITY_COPY_TEST_ID');
  if (!id || !activitySources()[id]) throw new Error('No active copy test');
  const queue=activitySheet('Queue',['ID','Payload','Delivered','Error']);
  const rows=queue.getLastRow()>1 ? queue.getRange(2,1,queue.getLastRow()-1,4).getValues() : [];
  const events=rows.map(function(row) { const e=JSON.parse(row[1]); return {id:e.id,taskId:e.taskId,occurredAt:e.occurredAt,changes:e.changes,historyGap:e.historyGap,editorKnown:!!e.actorEmail}; });
  console.log(JSON.stringify({queuedEvents:events.length,events:events}));
}

function finishActivityCopyTest() {
  const props=PropertiesService.getScriptProperties(), id=props.getProperty('ACTIVITY_COPY_TEST_ID');
  if (!id || Object.keys(activitySources()).some(function(source) { return source!==id; })) throw new Error('Not an isolated copy test');
  ScriptApp.getProjectTriggers().filter(function(trigger) { return trigger.getHandlerFunction()==='captureSheetActivity' && trigger.getTriggerSourceId()===id; }).forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
  props.setProperty('ACTIVITY_COPY_TEST_LEDGER_ARCHIVE',props.getProperty('ACTIVITY_LEDGER_ID'));
  ['ACTIVITY_LEDGER_ID','ACTIVITY_SOURCES','ACTIVITY_QUEUE_CURSOR','ACTIVITY_ERROR_'+id].forEach(function(key) { props.deleteProperty(key); });
  console.log('Copy test stopped. Test spreadsheet and ledger retained for review.');
}
