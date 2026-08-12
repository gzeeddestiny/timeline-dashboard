export async function callAppsScript(payload) {
  const url = process.env.APPS_SCRIPT_URL
  const secret = process.env.APPS_SCRIPT_SHARED_SECRET
  if (!url || !secret) throw new Error("Apps Script server environment is not configured")
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...payload, secret }),
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`Apps Script failed (${response.status})`)
  const result = await response.json().catch(() => null)
  if (!result || result.success !== true) throw new Error(result?.error || "Apps Script rejected the request")
  return result
}
