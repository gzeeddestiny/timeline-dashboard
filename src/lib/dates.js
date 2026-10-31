const DAY_MS = 86_400_000
const BANGKOK_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

const THAI_DATE_FORMATTER = new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
  timeZone: "Asia/Bangkok",
  day: "numeric",
  month: "short",
  year: "numeric",
})

const THAI_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
  timeZone: "Asia/Bangkok",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
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

export function formatThaiDate(value, optionsOrFallback = "-") {
  const options = typeof optionsOrFallback === "object" ? optionsOrFallback : null
  const fallback = options ? "-" : optionsOrFallback
  if (!value) return fallback
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? new Date(`${value}T00:00:00+07:00`) : new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  const formatter = options ? new Intl.DateTimeFormat("th-TH-u-ca-gregory", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric", ...options }) : THAI_DATE_FORMATTER
  return formatter.format(date).replace(/\s*พ\.ศ\.\s*/, " ")
}

export function formatThaiDateTime(value, fallback = "-") {
  if (!value) return fallback
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? fallback : THAI_DATE_TIME_FORMATTER.format(date).replace(/\s*พ\.ศ\.\s*/, " ")
}
