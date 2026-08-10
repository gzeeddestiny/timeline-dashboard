// ─── Google Sheets API v4 Utility ─────────────────────────────────────────────
//
// Column order in Google Sheet (per tab):
//   A = Status     (TRUE = done ✓ / FALSE = not done ✗)
//   B = Topic      (Content / Topic)
//   C = Responsibility
//   D = Due Date   (date cell)
//   E = Actual Submit
//   F = Task ID    (hidden, stable UUID)
//
// Each tab name  = Client Name   (e.g. "Nike TH", "PTT Exploration")
// Spreadsheet title → Month label (parsed from the sheet name itself):
//   "Magic_Project Timeline Feb 26" → "FEB 26"
//   "MAGIC_Timeline Internal"       → "Internal"
// ─────────────────────────────────────────────────────────────────────────────

import { bangkokDate, daysFrom, parseSheetDate } from "./dates.js"
import { inspectTaskHeaders, taskRange } from "./sheetSchema.js"

const BASE_URL = "https://sheets.googleapis.com/v4/spreadsheets"

// ── File Color Palette ─────────────────────────────────────────────────────
// Soft pastel backgrounds for each Google Sheet file. Designed to be
// visually distinct yet harmonious.  Index = order of file appearance.

const FILE_COLORS = [
  { bg: "bg-violet-100/70",  sub: "bg-violet-50/60",  stripe: "border-l-violet-400",  tag: "bg-violet-100 text-violet-700",   label: "violet"  },
  { bg: "bg-sky-100/70",     sub: "bg-sky-50/60",     stripe: "border-l-sky-400",     tag: "bg-sky-100 text-sky-700",          label: "sky"     },
  { bg: "bg-amber-100/70",   sub: "bg-amber-50/60",   stripe: "border-l-amber-400",   tag: "bg-amber-100 text-amber-700",     label: "amber"   },
  { bg: "bg-emerald-100/70", sub: "bg-emerald-50/60", stripe: "border-l-emerald-400", tag: "bg-emerald-100 text-emerald-700",  label: "emerald" },
  { bg: "bg-rose-100/70",    sub: "bg-rose-50/60",    stripe: "border-l-rose-400",    tag: "bg-rose-100 text-rose-700",        label: "rose"    },
  { bg: "bg-cyan-100/70",    sub: "bg-cyan-50/60",    stripe: "border-l-cyan-400",    tag: "bg-cyan-100 text-cyan-700",        label: "cyan"    },
  { bg: "bg-fuchsia-100/70", sub: "bg-fuchsia-50/60", stripe: "border-l-fuchsia-400", tag: "bg-fuchsia-100 text-fuchsia-700",  label: "fuchsia" },
  { bg: "bg-lime-100/70",    sub: "bg-lime-50/60",    stripe: "border-l-lime-400",    tag: "bg-lime-100 text-lime-700",        label: "lime"    },
]

/**
 * Build a map: spreadsheetId → FILE_COLORS entry.
 * Call this once with the full task list.
 */
export function buildFileColorMap(tasks) {
  const map = {}
  let idx = 0
  for (const t of tasks) {
    const key = t.spreadsheetId || t.month || "unknown"
    if (!map[key]) {
      map[key] = FILE_COLORS[idx % FILE_COLORS.length]
      idx++
    }
  }
  return map
}

// ── Brand Name Extraction ─────────────────────────────────────────────────────
// Tab names in Google Sheets are messy, e.g.:
//   "(Pleng+Toey) Influ Dr.choice Mar 26 - Apr 26"  → "Dr.choice"
//   "(point+pang)Skyline Pool Villa VDO แก่งกระจาน"   → "Skyline Pool Villa"
//   "(Point+RK)One box main 3 clips Jan 26"          → "One box"
//
// Strategy: auto-clean; shared per-tab overrides live in Supabase.

// Noise words to strip (case-insensitive) — common project descriptors
const NOISE_WORDS = [
  "influ", "vdo", "video", "clip", "clips", "main", "photo", "reels", "reel",
  "tiktok", "ig", "fb", "post", "posts", "story", "stories", "kol",
  "campaign", "content", "ads", "ad",
]

// Month patterns
const MONTH_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s*\d{2,4}(\s*-\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)?\s*\d{2,4})?\b/gi

/**
 * Auto-extract brand name from a tab title.
 */
export function extractBrandName(tabTitle) {
  if (!tabTitle) return tabTitle
  let s = tabTitle
  s = s.replace(/^\([^)]*\)\s*/, "")
  s = s.replace(MONTH_RE, "")
  const noiseRe = new RegExp(`\\b(${NOISE_WORDS.join("|")})\\b`, "gi")
  s = s.replace(noiseRe, "")
  s = s.replace(/\s+\d+\s*$/, "")
  s = s.replace(/\s+/g, " ").trim()
  return s || tabTitle.replace(/^\([^)]*\)\s*/, "").trim()
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract spreadsheet ID from any Google Sheets URL */
export function parseSheetId(url) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  return match ? match[1] : null
}

/**
 * Parse the month label from the Google Spreadsheet title.
 *
 * Rules (applied to the segment after the last "_"):
 *   - Last token is "internal" (case-insensitive) → "Internal"
 *   - Otherwise take the last two tokens and UPPERCASE them → e.g. "FEB 26"
 *   - If only one token, uppercase it → e.g. "MAR"
 *
 * Examples:
 *   "Magic_Project Timeline Feb 26"  → "FEB 26"
 *   "MAGIC_Timeline Internal"        → "Internal"
 *   "MAGIC_MAR"                      → "MAR"
 */
function monthFromTitle(title) {
  if (!title) return ""

  // Take the part after the last underscore (or the whole title if no underscore)
  const underscoreIdx = title.lastIndexOf("_")
  const suffix = (underscoreIdx >= 0 ? title.slice(underscoreIdx + 1) : title).trim()

  const tokens = suffix.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return ""

  const lastToken = tokens[tokens.length - 1]

  // "Internal" check
  if (lastToken.toLowerCase() === "internal") return "Internal"

  // Two-token month+year pattern (e.g. "Feb 26")
  if (tokens.length >= 2) {
    return tokens.slice(-2).join(" ").toUpperCase()
  }

  // Single token (e.g. "MAR")
  return lastToken.toUpperCase()
}

// ── Main Fetcher ──────────────────────────────────────────────────────────────

/**
 * Fetch all tasks from every connected Google Sheet.
 * @param {Array<{id: number, url: string}>} sheetList
 * @returns {Promise<{tasks: Array, issues: Array}>}
 */
export async function fetchAllSheetsData(sheetList, apiKey) {

  if (!apiKey || apiKey === "your_api_key_here") {
    throw new Error(
      "Missing server-side Google Sheets API key."
    )
  }

  const allTasks = []
  const issues = []
  let nextId = 1
  const seenSpreadsheets = new Set()  // deduplicate same spreadsheet fetched twice
  const seenTaskKeys = new Set()

  for (const sheet of sheetList) {
    const urlSpreadsheetId = parseSheetId(sheet.url || "")
    const spreadsheetId = sheet.spreadsheetId || urlSpreadsheetId
    if (!spreadsheetId || (sheet.url && !urlSpreadsheetId) || (urlSpreadsheetId && urlSpreadsheetId !== spreadsheetId)) {
      throw new Error(`Invalid Google Sheet source: ${sheet.url || spreadsheetId || "unknown"}`)
    }

    // Skip if we already fetched this spreadsheet (e.g. duplicate URL in list)
    if (seenSpreadsheets.has(spreadsheetId)) continue
    seenSpreadsheets.add(spreadsheetId)

    // 1️⃣  Spreadsheet metadata → get title + all tab names
    const metaRes = await fetch(`${BASE_URL}/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties&key=${encodeURIComponent(apiKey)}`, { signal: AbortSignal.timeout(15_000) })
    if (!metaRes.ok) throw new Error(`Google Sheets metadata failed (${metaRes.status})`)
    const meta    = await metaRes.json()

    if (meta.error) {
      throw new Error(
        `Google Sheets API error: ${meta.error.message} (code ${meta.error.code})`
      )
    }

    // Derive the month label once from the spreadsheet title (shared by all tasks in this sheet)
    const spreadsheetTitle = meta.properties?.title ?? ""
    const monthLabel       = monthFromTitle(spreadsheetTitle)

    // 2️⃣  Batch-fetch ALL tabs in one API call (instead of N separate calls)
    //   UNFORMATTED_VALUE → booleans = true/false, dates = serial number
    // Build tab metadata — skip hidden tabs (ghost copies across spreadsheets)
    const tabInfos = meta.sheets
      .filter((t) => !t.properties.hidden)
      .map((t) => ({
        title: t.properties.title,
        gid:   t.properties.sheetId,
      }))
    const tabNames = tabInfos.map((t) => t.title)
    if (tabNames.length === 0) continue

    // gidMap: tab title → gid (exact + trimmed keys for robust lookup)
    const gidMap = new Map()
    for (const info of tabInfos) {
      gidMap.set(info.title, info.gid)
      gidMap.set(info.title.trim(), info.gid)
    }

    const ranges = tabNames.map((title) => `ranges=${encodeURIComponent(taskRange(title))}`).join("&")
    const batchUrl = `${BASE_URL}/${encodeURIComponent(spreadsheetId)}/values:batchGet?${ranges}&key=${encodeURIComponent(apiKey)}&valueRenderOption=UNFORMATTED_VALUE`

    const batchRes = await fetch(batchUrl, { signal: AbortSignal.timeout(15_000) })
    if (!batchRes.ok) throw new Error(`Google Sheets data failed (${batchRes.status})`)
    const batchData = await batchRes.json()

    if (batchData.error) {
      throw new Error(`Google Sheets batchGet failed for "${spreadsheetTitle}": ${batchData.error.message}`)
    }

    for (const valueRange of batchData.valueRanges ?? []) {
      // Parse tab name from the response range string (authoritative source)
      // e.g. "'(Point+RK)One box main 3 clips Jan 26'!A2:E50" → "(Point+RK)One box main 3 clips Jan 26"
      const rangeStr = valueRange.range || ""
      let parsedTab = rangeStr.replace(/!.*$/, "")
      if (parsedTab.startsWith("'") && parsedTab.endsWith("'")) {
        parsedTab = parsedTab.slice(1, -1).replace(/''/g, "'")
      }

      const tabTitle = parsedTab
      // Look up gid from metadata: exact → trimmed → NFC-normalized fallback
      let tabGid = gidMap.get(tabTitle)
      if (tabGid === undefined) tabGid = gidMap.get(tabTitle.trim())
      if (tabGid === undefined) {
        const norm = tabTitle.normalize("NFC").trim()
        const match = tabInfos.find((t) => t.title.normalize("NFC").trim() === norm)
        tabGid = match?.gid ?? 0
      }

      const values = valueRange.values ?? []
      const header = inspectTaskHeaders(values[0])
      if (!header.valid) {
        issues.push({ spreadsheetId, sheetGid: tabGid, rowIndex: 1, clientName: tabTitle, type: "skipped_tab", message: "Header A:E does not match the task schema" })
        continue
      }
      if (!header.taskIdAvailable) {
        issues.push({ spreadsheetId, sheetGid: tabGid, rowIndex: 1, clientName: tabTitle, type: "invalid_task_id_header", message: "Column F is already used" })
        continue
      }

      for (const [rowIdx, row] of values.slice(1).entries()) {
        // A=status(bool)  B=topic  C=responsibility  D=dueDate  E=actualSubmit
        const [statusRaw, topic, responsibility, dueDateRaw, actualSubmitRaw, taskIdRaw] = row

        if (!topic?.toString().trim()) continue   // skip blank rows

        const done =
          statusRaw === true ||
          statusRaw === 1 ||
          String(statusRaw).toLowerCase() === "true"

        const taskId = String(taskIdRaw || "").trim()
        const source = { spreadsheetId, sheetGid: tabGid, rowIndex: rowIdx + 2, clientName: tabTitle }
        if (!taskId) {
          issues.push({ ...source, type: "missing_task_id", message: "Task ID is blank" })
          continue
        }
        if (!/^[A-Za-z0-9_-]{1,200}$/.test(taskId)) {
          issues.push({ ...source, type: "invalid_task_id", message: `Invalid Task ID: ${taskId}` })
          continue
        }
        const stableKey = `${spreadsheetId}:${tabGid}:${taskId}`
        if (seenTaskKeys.has(stableKey)) {
          issues.push({ ...source, type: "duplicate_task_id", message: `Duplicate Task ID: ${taskId}` })
          continue
        }
        seenTaskKeys.add(stableKey)

        const parsedDate = parseSheetDate(dueDateRaw)
        if (dueDateRaw && !parsedDate) issues.push({ ...source, type: "invalid_due_date", message: `Invalid due date: ${dueDateRaw}` })
        const parsedActualSubmit = parseSheetDate(actualSubmitRaw)
        if (actualSubmitRaw && !parsedActualSubmit) issues.push({ ...source, type: "invalid_actual_submit", message: `Invalid actual submit: ${actualSubmitRaw}` })

        allTasks.push({
          id:             nextId++,
          clientName:     tabTitle,
          done,
          month:          monthLabel,
          spreadsheetId,
          topic:          topic.toString().trim(),
          responsibility: (responsibility ?? "").toString().trim(),
          dueDate:        parsedDate,
          rowIndex:       rowIdx + 2,  // +2: range starts at row 2 (row 1 = header)
          sheetGid:       tabGid,
          taskId,
          actualSubmit:   parsedActualSubmit,
        })
      }
    }
  }

  return { tasks: allTasks, issues }
}

// ── Categorizer ───────────────────────────────────────────────────────────────

/**
 * Split flat task array into overdue vs upcoming.
 *
 * Rules:
 *  - Tasks with no due date → unscheduled
 *  - Overdue  : not done + due date is in the past
 *  - Upcoming : not done + due date is today or later
 */
export function categorizeTasks(tasks) {
  const today = bangkokDate()

  // Per-client progress stats — count ALL tasks that have a topic
  const clientStats = {}
  tasks.forEach((t) => {
    if (!String(t.topic || "").trim()) return
    const statsKey = `${t.clientName}::${t.spreadsheetId}::${t.sheetGid}`
    if (!clientStats[statsKey]) clientStats[statsKey] = { total: 0, done: 0 }
    clientStats[statsKey].total++
    if (t.done) clientStats[statsKey].done++
  })

  // Keep undated tasks visible; they need scheduling rather than disappearing.
  const withDate = tasks.filter((t) => {
    if (!t.dueDate) return false
    const d = new Date(t.dueDate)
    return !isNaN(d.getTime())
  })

  const overdue = withDate
    .filter((t) => !t.done && daysFrom(t.dueDate, today) < 0)
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)) // oldest (most overdue) first

  const upcoming = withDate
    .filter((t) => !t.done && daysFrom(t.dueDate, today) >= 0)
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)) // soonest (today) first

  const unscheduled = tasks.filter((task) => !task.done && !task.dueDate)
  return { overdue, upcoming, unscheduled, clientStats, allTasks: tasks }
}
