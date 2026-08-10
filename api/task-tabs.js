import { callAppsScript } from "./_appsScript.js"
import { sameOrigin, send, userContext } from "./_supabase.js"
import { inspectTaskHeaders, taskRange } from "../src/lib/sheetSchema.js"

async function inspectTabs(spreadsheetId) {
  const key = process.env.GOOGLE_SHEETS_API_KEY
  if (!key) throw new Error("Google Sheets server API key is not configured")
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`
  const metadata = await fetch(`${base}?fields=sheets.properties&key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(15_000) })
  if (!metadata.ok) throw new Error(`Google Sheets metadata failed (${metadata.status})`)
  const meta = await metadata.json()
  const tabs = (meta.sheets || []).map(({ properties }) => properties).filter((tab) => !tab.hidden)
  const ranges = tabs.map((tab) => `ranges=${encodeURIComponent(taskRange(tab.title, "A1:F1"))}`).join("&")
  const valuesResponse = await fetch(`${base}/values:batchGet?${ranges}&majorDimension=ROWS&key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(15_000) })
  if (!valuesResponse.ok) throw new Error(`Google Sheets headers failed (${valuesResponse.status})`)
  const values = await valuesResponse.json()
  return tabs.map((tab, index) => {
    const inspected = inspectTaskHeaders(values.valueRanges?.[index]?.values?.[0])
    return { sheetGid: tab.sheetId, title: tab.title, ...inspected, reason: inspected.valid ? "" : "Header A:E ไม่ตรงรูปแบบงาน" }
  })
}

export default async function handler(request, response) {
  if (request.method !== "POST") return send(response, 405, { error: "Method not allowed" })
  if (!sameOrigin(request)) return send(response, 403, { error: "Cross-origin request denied" })
  try {
    const context = await userContext(request)
    if (context.error) return send(response, context.status, { error: context.error })
    if (context.access.role !== "admin") return send(response, 403, { error: "Admin access required" })
    const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body
    if (!body?.spreadsheetId || typeof body.spreadsheetId !== "string") return send(response, 400, { error: "Invalid spreadsheet" })
    const registered = await context.admin.from("sheets").select("spreadsheet_id").eq("spreadsheet_id", body.spreadsheetId).eq("active", true).maybeSingle()
    if (registered.error) throw registered.error
    if (!registered.data) return send(response, 404, { error: "Spreadsheet is not registered" })
    const tabs = await inspectTabs(body.spreadsheetId)
    if (body.action === "inspect") return send(response, 200, { tabs })
    if (body.action !== "provision" || !Array.isArray(body.sheetGids) || body.sheetGids.length < 1) return send(response, 400, { error: "Select at least one task tab" })
    const selected = new Set(body.sheetGids.map(Number))
    if ([...selected].some((gid) => !tabs.some((tab) => tab.sheetGid === gid && tab.valid))) return send(response, 400, { error: "One or more selected tabs are invalid" })
    const result = await callAppsScript({ action: "ensure_task_ids", targets: [{ spreadsheetId: body.spreadsheetId, sheetGids: [...selected] }] })
    return send(response, 200, { ...result, tabs: await inspectTabs(body.spreadsheetId) })
  } catch (error) {
    return send(response, 502, { error: error.message || "Task tab provisioning failed" })
  }
}
