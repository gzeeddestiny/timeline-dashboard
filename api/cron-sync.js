import { timingSafeEqual } from "node:crypto"
import { runSync } from "./_syncCore.js"
import { adminClient, send } from "./_supabase.js"

export const config = { maxDuration: 60 }

export function validCronSecret(candidate, expected = process.env.CRON_SYNC_SECRET) {
  if (typeof candidate !== "string" || typeof expected !== "string" || expected.length < 32) return false
  const supplied = Buffer.from(candidate)
  const configured = Buffer.from(expected)
  return supplied.length === configured.length && timingSafeEqual(supplied, configured)
}

export default async function handler(request, response) {
  if (request.method !== "POST") return send(response, 405, { error: "Method not allowed" })
  if (!process.env.CRON_SYNC_SECRET || process.env.CRON_SYNC_SECRET.length < 32) {
    return send(response, 503, { error: "Cron sync is not configured" })
  }
  if (!validCronSecret(request.headers["x-cron-secret"])) return send(response, 401, { error: "Invalid cron credential" })
  try {
    const result = await runSync({ admin: adminClient(), triggerType: "cron" })
    return send(response, result.status, result.body)
  } catch (error) {
    console.error("[cron-sync]", error)
    return send(response, 502, { error: error.message || "Scheduled sync failed" })
  }
}
