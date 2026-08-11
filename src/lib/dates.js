const DAY_MS = 86_400_000
const BANGKOK_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

export function bangkokDate(now = new Date()) {
  const parts = BANGKOK_FORMATTER.formatToParts(now)
  const part = (type) => parts.find((item) => item.type === type)?.value
  return `${part("year")}-${part("month")}-${part("day")}`
}

export function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function parseSheetDate(raw) {
  if (raw === null || raw === undefined || raw === "") return ""
  if (typeof raw === "number") {
    const date = new Date(Math.round((raw - 25569) * DAY_MS))
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10)
  }
  const value = String(raw).trim()
  if (!value) return ""
  if (validIsoDate(value)) return value
  const dmy = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/)
  if (dmy) {
    const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]
    const iso = `${year}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`
    return validIsoDate(iso) ? iso : ""
  }
  return ""
}

export function daysFrom(date, today = bangkokDate()) {
  if (!validIsoDate(date) || !validIsoDate(today)) return null
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS)
}
