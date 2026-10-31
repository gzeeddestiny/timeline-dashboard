import { adminClient, send } from "./_supabase.js"
import { validCronSecret } from "./cron-sync.js"
import { generateDailyDigest, generateNoActivity, loadNotificationData, processNotificationQueue, scheduledType } from "./_notifications.js"

export const config = { maxDuration: 60 }

export default async function handler(request, response) {
  if (request.method !== "POST") return send(response, 405, { error: "Method not allowed" })
  if (!process.env.CRON_SYNC_SECRET || process.env.CRON_SYNC_SECRET.length < 32) return send(response, 503, { error: "Cron notifications are not configured" })
  if (!validCronSecret(request.headers["x-cron-secret"])) return send(response, 401, { error: "Invalid cron credential" })
  try {
    const admin = adminClient()
    return send(response, 200, await runNotificationTick(admin))
  } catch (error) {
    console.error("[cron-notifications]", error)
    return send(response, 502, { error: error.message || "Notification cron failed" })
  }
}

export async function runNotificationTick(admin, now = new Date(), services = {loadNotificationData,generateDailyDigest,generateNoActivity,processNotificationQueue}) {
    const settings = await admin.from("notification_settings").select("daily_enabled,daily_time,no_activity_enabled,no_activity_time").eq("id", true).single()
    if (settings.error) throw settings.error
    const due = scheduledType(settings.data, now)
    const generated = { daily: 0, noActivity: 0 }
    if (due.daily || due.noActivity) {
      const data = await services.loadNotificationData(admin)
      if (due.daily) generated.daily = (await services.generateDailyDigest(admin, data, now)).filter((item) => item.created).length
      if (due.noActivity) generated.noActivity = (await services.generateNoActivity(admin, data, now)).filter((item) => item.created).length
    }
    const delivery = await services.processNotificationQueue(admin)
    return {success:true,due,generated,delivery};
}
