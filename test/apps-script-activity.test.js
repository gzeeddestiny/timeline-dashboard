import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

class MemorySheet {
  constructor(name, rows = [], id = 1) { this.name=name; this.rows=rows; this.id=id }
  getName() { return this.name }
  getSheetId() { return this.id }
  getParent() { return this.parent }
  getLastRow() { return this.rows.length }
  getLastColumn() { return Math.max(1,...this.rows.map((row)=>row.length)) }
  getMaxColumns() { return this.getLastColumn() }
  getMaxRows() { return this.maxRows || 1000 }
  insertRowsAfter(_row, count) { this.maxRows = this.getMaxRows()+count }
  isSheetHidden() { return false }
  appendRow(row) { this.rows.push([...row]) }
  getRange(row,col,height=1,width=1) {
    const sheet=this
    return {
      getSheet:()=>sheet,getRow:()=>row,getColumn:()=>col,getLastRow:()=>row+height-1,
      getLastColumn:()=>col+width-1,getNumRows:()=>height,getNumColumns:()=>width,
      getValues:()=>Array.from({length:height},(_,r)=>Array.from({length:width},(_,c)=>sheet.rows[row+r-1]?.[col+c-1] ?? '')),
      getDisplayValues() { return this.getValues().map((r)=>r.map(String)) },
      getDisplayValue() { return this.getDisplayValues()[0][0] },
      setValue(value) { return this.setValues([[value]]) },
      setValues(values) { values.forEach((r,i)=>r.forEach((v,j)=>{ sheet.rows[row+i-1] ||= []; sheet.rows[row+i-1][col+j-1]=v })); return this },
    }
  }
}
function book(id, sheets=[]) {
  const result={ getId:()=>id,getSpreadsheetTimeZone:()=> 'Asia/Bangkok',getSheets:()=>sheets,
    getSheetByName:(name)=>sheets.find((s)=>s.name===name),
    insertSheet:(name)=>{ const sheet=new MemorySheet(name); sheet.parent=result; sheets.push(sheet); return sheet },
  }
  sheets.forEach((sheet)=>{sheet.parent=result})
  return result
}

async function harness() {
  const task=new MemorySheet('Tasks',[
    ['Done','Description','Responsibility','Due Date','Actual Submit','GD Timeline','Task ID'],
    [false,'Launch','AE One','2026-09-07','','2026-09-08','task'],
    [false,'Other','AE Two','2026-09-09','','','other'],
  ])
  const source=book('sheet',[task]), ledger=book('ledger')
  const props=new Map([['ACTIVITY_LEDGER_ID','ledger'],['ACTIVITY_SOURCES','{"sheet":[1]}'],['ACTIVITY_URL','https://example.com/ingest'],['ACTIVITY_SECRET','test-secret']])
  const deliveries=[]
  let failure=false, sequence=0
  const triggers=[]
  const context=vm.createContext({
    Date,
    PropertiesService:{getScriptProperties:()=>({getProperty:(k)=>props.get(k),setProperty:(k,v)=>props.set(k,v),deleteProperty:(k)=>props.delete(k)})},
    SpreadsheetApp:{openById:(id)=>id==='ledger'?ledger:source,flush:()=>{}},
    ScriptApp:{getProjectTriggers:()=>triggers,newTrigger:(handler)=>{
      let sourceId=null
      const builder={forSpreadsheet:(id)=>{sourceId=id;return builder},onEdit:()=>builder,timeBased:()=>builder,everyMinutes:()=>builder,
        create:()=>triggers.push({getHandlerFunction:()=>handler,getTriggerSourceId:()=>sourceId})}
      return builder
    }},
    LockService:{getScriptLock:()=>({waitLock:()=>{},tryLock:()=>true,releaseLock:()=>{}})},
    Utilities:{getUuid:()=>`event-${++sequence}`,formatDate:(date)=>date.toISOString().slice(0,10)},
    UrlFetchApp:{fetch:(_url,options)=>{
      const body=JSON.parse(options.payload); deliveries.push(body)
      return {getResponseCode:()=>failure?503:200,getContentText:()=>JSON.stringify({accepted:body.events.map((e)=>e.id),errors:[]})}
    }},
  })
  vm.runInContext(await readFile(new URL('../google-apps-script/Code.gs',import.meta.url),'utf8'),context)
  const columns=context.activityColumns(task,1), baselines=context.activityBaselines()
  for (const [row,id] of [[2,'task'],[3,'other']]) context.saveActivityBaseline(baselines,`sheet:1:${id}`,context.activitySnapshot(task,row,columns))
  return { context, task, source, ledger, deliveries, props, fail:(value)=>{failure=value} }
}

test('installation resumes in tab batches without dropping earlier tracked tabs',async()=>{
  const h=await harness()
  for (let i=2;i<=7;i++) {
    const tab=new MemorySheet(`Tasks ${i}`,structuredClone(h.task.rows),i)
    tab.parent=h.source; h.source.getSheets().push(tab)
  }
  for (const [pending,count] of [[true,3],[true,6],[false,7]]) {
    const result=h.context.installActivity(['sheet'],undefined,undefined,'sheet')
    assert.equal(result.pending,pending)
    assert.equal(JSON.parse(h.props.get('ACTIVITY_SOURCES')).sheet.length,count)
    assert.equal(result.errors.length,0)
  }
  assert.equal(h.props.has('ACTIVITY_INSTALL_OFFSET_sheet'),false)
  assert.equal(h.context.ScriptApp.getProjectTriggers().length,2)
})

test('Sheet edit trigger persists A → B → A through delivery failure, retry and no-op',async()=>{
  const h=await harness()
  h.fail(true)
  h.task.rows[1][0]=true
  assert.throws(()=>h.context.captureSheetActivity({range:h.task.getRange(2,1),oldValue:'FALSE',value:'TRUE'}),/delivery failed/)
  h.task.rows[1][0]=false
  assert.throws(()=>h.context.captureSheetActivity({range:h.task.getRange(2,1),oldValue:'TRUE',value:'FALSE'}),/delivery failed/)
  const queue=h.ledger.getSheetByName('Queue')
  assert.equal(queue.rows.length,3)
  const first=JSON.parse(queue.rows[1][1]), second=JSON.parse(queue.rows[2][1])
  assert.deepEqual(first.changes,{done:{before:false,after:true}})
  assert.deepEqual(second.changes,{done:{before:true,after:false}})
  assert.equal(first.actorEmail,null)
  h.fail(false)
  h.context.flushActivityQueue()
  assert.ok(queue.rows[1][2])
  assert.ok(queue.rows[2][2])
  h.context.captureSheetActivity({range:h.task.getRange(2,1),oldValue:'FALSE',value:'FALSE'})
  assert.equal(queue.rows.length,3)
  assert.deepEqual(h.deliveries.at(-1).events,[])
})

test('installation batches thousands of baselines, extends the ledger and is repeatable',async()=>{
  const h=await harness()
  for(let i=0;i<1100;i++) h.task.rows.push([false,`Task ${i}`,'AE One','2026-09-07','','2026-09-08',`bulk-${i}`])
  const result=h.context.installActivity(['sheet'])
  assert.equal(result.errors.length,0)
  assert.equal(h.ledger.getSheetByName('Baselines').getLastRow(),1103)
  assert.ok(h.ledger.getSheetByName('Baselines').getMaxRows()>=1103)
  h.context.installActivity(['sheet'])
  assert.equal(h.ledger.getSheetByName('Baselines').getLastRow(),1103)
  assert.equal(h.context.ScriptApp.getProjectTriggers().length,2)
  h.props.set('ACTIVITY_SOURCES', '{"sheet":[1],"other-sheet":[2]}')
  h.context.installActivity(['sheet','other-sheet'],undefined,undefined,'sheet')
  assert.deepEqual(JSON.parse(h.props.get('ACTIVITY_SOURCES')),{'sheet':[1],'other-sheet':[2]})
  assert.throws(()=>h.context.installActivity(['sheet'],undefined,undefined,'unknown'),/Unregistered installation target/)
})

test('multi-row date edits retain task IDs and explicit baseline uncertainty',async()=>{
  const h=await harness()
  // Moving rows preserves identity even though their old row numbers change.
  ;[h.task.rows[1],h.task.rows[2]]=[h.task.rows[2],h.task.rows[1]]
  h.task.rows[1][5]='2026-09-10'; h.task.rows[2][5]='2026-09-11'
  h.context.captureSheetActivity({range:h.task.getRange(2,6,2,1),user:{getEmail:()=> 'actual@example.com'}})
  const events=h.deliveries.at(-1).events
  assert.equal(events.length,2)
  assert.equal(events[0].taskKey,'sheet:1:other')
  assert.equal(events[1].taskKey,'sheet:1:task')
  assert.equal(events[1].changes['date:gd timeline'].before,'2026-09-08')
  assert.equal(events[1].actorEmail,'actual@example.com')
  assert.match(events[1].historyGap,/หลายเซลล์/)
})

test('two-row production headers include Actual Submit and GD Timeline',async()=>{
  const h=await harness()
  h.task.rows=[['','Description','Responsibility','Due Date','','','Task ID'],['','','','','Actual Submit','GD Timeline',''],[false,'Launch','AE One','2026-09-07','','2026-09-08','task']]
  const fields=h.context.activityColumns(h.task,1)
  assert.equal(fields[5],'actual_submit')
  assert.equal(fields[6],'date:gd timeline')
  h.task.rows[2][5]='2026-09-10'
  h.context.captureSheetActivity({range:h.task.getRange(3,6),oldValue:'2026-09-08',value:'2026-09-10'})
  assert.deepEqual(h.deliveries.at(-1).events[0].changes,{'date:gd timeline':{before:'2026-09-08',after:'2026-09-10'}})
})

test('Remarks edits in a task row are recorded as activity',async()=>{
  const h=await harness()
  h.task.rows.forEach((row,index)=>row.splice(6,0,index===0?'Remarks':''))
  h.task.rows[1][6]='ส่งงานรอบใหม่'
  h.context.captureSheetActivity({range:h.task.getRange(2,7),oldValue:'',value:'ส่งงานรอบใหม่',user:{getEmail:()=> 'editor@example.com'}})
  assert.deepEqual(h.deliveries.at(-1).events[0].changes,{remarks:{before:null,after:'ส่งงานรอบใหม่'}})
})

test('Project Link edits above the task table create one tab-scoped activity event',async()=>{
  const h=await harness()
  h.task.rows.unshift(['Link Canva :','https://old.example'])
  h.task.rows[0][1]='https://new.example'
  h.context.captureSheetActivity({range:h.task.getRange(1,2),oldValue:'https://old.example',value:'https://new.example',user:{getEmail:()=> 'editor@example.com'}})
  const event=h.deliveries.at(-1).events[0]
  assert.equal(event.scope,'tab')
  assert.equal(event.taskKey,undefined)
  assert.deepEqual(event.changes,{'project_link:link canva':{before:'https://old.example',after:'https://new.example'}})
})

test('dashboard completion journals once and does not manufacture repeated saves',async()=>{
  const h=await harness()
  const body={spreadsheetId:'sheet',sheetGid:1,taskId:'task',done:true,actualSubmit:'2026-09-07',actorEmail:'dashboard@example.com'}
  h.context.setCompletion(body)
  h.context.setCompletion(body)
  const queue=h.ledger.getSheetByName('Queue')
  assert.equal(queue.rows.length,2)
  const event=JSON.parse(queue.rows[1][1])
  assert.equal(event.source,'dashboard')
  assert.equal(event.actorEmail,'dashboard@example.com')
  assert.deepEqual(event.changes,{done:{before:false,after:true},actual_submit:{before:null,after:'2026-09-07'}})
})

test('interrupted write-ahead records become visible gaps rather than fabricated actions',async()=>{
  const h=await harness()
  const queue=h.context.activitySheet('Queue',['ID','Payload','Delivered','Error'])
  queue.appendRow(['uncertain',JSON.stringify({id:'uncertain',spreadsheetId:'sheet',taskKey:'sheet:1:task',changes:{done:{before:false,after:true}}}),'prepared',''])
  h.context.flushActivityQueue()
  assert.deepEqual(h.deliveries.at(-1).events[0].changes,{})
  assert.match(h.deliveries.at(-1).events[0].historyGap,/ไม่สามารถยืนยัน/)
  assert.equal(JSON.parse(queue.rows[1][1]).changes.done.after,true)
})
