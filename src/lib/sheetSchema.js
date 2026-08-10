export const TASK_HEADERS = ["done", "topic", "responsibility", "due date", "actual submit"]

export function normalizeHeaders(values = []) {
  return values.slice(0, 6).map((value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " "))
}

export function inspectTaskHeaders(values = []) {
  const headers = normalizeHeaders(values)
  const valid = TASK_HEADERS.every((header, index) => headers[index] === header)
  const taskIdHeader = headers[5] || ""
  return {
    valid,
    taskIdReady: taskIdHeader === "task id",
    taskIdAvailable: taskIdHeader === "" || taskIdHeader === "task id",
  }
}

export function quoteSheetTitle(title) {
  return `'${String(title).replaceAll("'", "''")}'`
}

export function taskRange(title, rows = "A1:F") {
  return `${quoteSheetTitle(title)}!${rows}`
}
