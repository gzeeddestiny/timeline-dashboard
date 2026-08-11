export const TASK_HEADERS = ["done", "topic", "responsibility", "due date", "actual submit"]

export function normalizeHeaders(values = []) {
  return values.slice(0, 6).map((value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " "))
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
  return rows.slice(0, 15).findIndex((row) => inspectTaskHeaders(row).valid)
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
