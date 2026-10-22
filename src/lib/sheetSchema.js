export const TASK_HEADERS = ["done", "topic", "responsibility", "due date", "actual submit"]

export function normalizeHeaders(values = []) {
  return values.map((value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " "))
}

export function inspectTaskHeaders(values = []) {
  const headers = normalizeHeaders(values)
  const valid = ["", "done"].includes(headers[0])
    && ["topic", "description"].includes(headers[1])
    && headers[2] === "responsibility"
    && headers[3] === "due date"
  const taskIdHeader = headers[5] || ""
  return {
    valid,
    taskIdReady: taskIdHeader === "task id",
    taskIdAvailable: taskIdHeader === "" || taskIdHeader === "task id",
  }
}

export function findTaskHeaderRow(rows = []) {
  return rows.slice(0, 15).findIndex((row) => taskColumns(row).valid)
}

// Production sheets vertically merge B:D while E:G labels sit one row lower.
// Only merge the following row when its topic cell is blank: task data is never
// promoted into a column heading.
export function taskHeaderValues(rows, headerIndex) {
  const primary = rows[headerIndex] || []
  const topic = normalizeHeaders(primary).findIndex((value) => ['topic', 'description'].includes(value))
  const secondary = rows[headerIndex + 1] || []
  if (topic < 0 || String(secondary[topic] || '').trim()) return primary
  return Array.from({ length: Math.max(primary.length, secondary.length) }, (_, index) => {
    if (String(primary[index] || '').trim()) return primary[index]
    const candidate = String(secondary[index] || '').trim()
    return /^(actual submit|gd timeline|remarks|task id|done|completed)$|\bdate\b|timeline|วันที่/i.test(candidate) ? candidate : ''
  })
}

export function isSecondaryScheduleHeader(values = []) {
  const headers = normalizeHeaders(values)
  return ["topic", "content", "description"].includes(headers[1])
    && headers[2] === "responsibility"
    && headers[3] === "post date"
}

export function columnName(columnNumber) {
  let value = Number(columnNumber)
  if (!Number.isInteger(value) || value < 1) throw new Error("Invalid column number")
  let result = ""
  while (value > 0) {
    value -= 1
    result = String.fromCharCode(65 + (value % 26)) + result
    value = Math.floor(value / 26)
  }
  return result
}

export function quoteSheetTitle(title) {
  return `'${String(title).replaceAll("'", "''")}'`
}

export function taskRange(title, rows = "A1:F") {
  return `${quoteSheetTitle(title)}!${rows}`
}

// Resolve by header, never by the last grid column (columns may be inserted).
export function taskColumns(values = []) {
  const headers = normalizeHeaders(values)
  const find = (...names) => headers.findIndex((name) => names.includes(name))
  const topic = find("topic", "description")
  const responsibility = find("responsibility")
  const dueDate = find("due date")
  let done = find("done", "completed")
  if (done < 0 && topic === 1 && headers[0] === "") done = 0
  const dates = headers.flatMap((name, index) => name && (/date|timeline|วันที่/.test(name) || name === "actual submit") ? [{ name, index }] : [])
  return { topic, responsibility, dueDate, done, actualSubmit: find("actual submit"), taskId: find("task id"), dates,
    valid: topic >= 0 && responsibility >= 0 && dueDate >= 0 && done >= 0 }
}
