const base = new URL(process.argv[2] || "")
if (!/^https?:$/.test(base.protocol)) throw new Error("Pass an HTTP(S) deployment URL")

const request = (path, init) => fetch(new URL(path, base), { redirect: "manual", signal: AbortSignal.timeout(10_000), ...init })
const page = await request("/")
const html = await page.text()
const failures = []
if (!page.ok) failures.push(`homepage returned ${page.status}`)
for (const header of ["content-security-policy", "x-content-type-options", "referrer-policy"]) {
  if (!page.headers.get(header)) failures.push(`missing ${header}`)
}

const assets = [...html.matchAll(/(?:src|href)=["']([^"']+\.js)["']/g)].map((match) => new URL(match[1], base))
const tokenPattern = new RegExp("gh" + "[pousr]_[A-Za-z0-9_]{20,}")
const legacyNames = ["GITHUB_TOKEN", "GIST_ID", "APPS_SCRIPT_URL"].map((name) => "VITE_" + name)
const forbiddenUrls = ["api.github.com/" + "gists", "script.google.com/" + "macros/s/"]
for (const asset of assets) {
  if (asset.origin !== base.origin) continue
  const response = await fetch(asset, { signal: AbortSignal.timeout(10_000) })
  const body = await response.text()
  if (!response.ok) failures.push(`${asset.pathname} returned ${response.status}`)
  if (tokenPattern.test(body)) failures.push(`${asset.pathname} contains a GitHub token pattern`)
  for (const value of [...legacyNames, ...forbiddenUrls]) if (body.includes(value)) failures.push(`${asset.pathname} contains ${value}`)
}

const sync = await request("/api/sync")
if (sync.status !== 401) failures.push(`/api/sync expected 401, received ${sync.status}`)
const cron = await request("/api/cron-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
if (cron.status !== 401) failures.push(`/api/cron-sync expected 401, received ${cron.status}`)

if (failures.length) {
  console.error(`Deployment scan failed:\n${failures.join("\n")}`)
  process.exit(1)
}
console.log(`Deployment scan passed: ${base.origin} (${assets.length} JavaScript assets)`)
