import { execFileSync } from "node:child_process"
import { readdir, readFile, stat } from "node:fs/promises"
import { extname, resolve } from "node:path"

const textExtensions = new Set(["", ".css", ".html", ".js", ".json", ".jsx", ".md", ".mjs", ".sql", ".svg", ".txt", ".yml", ".yaml"])
const clientRoots = new Set(["src", "public", "dist"])
const findings = []

async function filesUnder(path) {
  try {
    const info = await stat(path)
    if (info.isFile()) return [path]
    const entries = await readdir(path, { withFileTypes: true })
    return (await Promise.all(entries.map((entry) => filesUnder(resolve(path, entry.name))))).flat()
  } catch { return [] }
}

const tracked = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).map((file) => resolve(file))
const localEnv = (await readdir(resolve("."), { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /^\.env(?:\.|$)/.test(entry.name))
  .map((entry) => resolve(entry.name))
const localEnvSet = new Set(localEnv)
const dist = await filesUnder(resolve("dist"))
const files = [...new Set([...tracked, ...localEnv, ...dist])].filter((file) => localEnvSet.has(file) || textExtensions.has(extname(file)))
const tokenPattern = new RegExp("gh" + "[pousr]_[A-Za-z0-9_]{20,}")
const legacyNames = ["GITHUB_TOKEN", "GIST_ID", "APPS_SCRIPT_URL", "GOOGLE_SHEETS_API_KEY"].map((name) => "VITE_" + name)
const appsScriptUrl = "https://script.google.com/" + "macros/s/"

for (const file of files) {
  let body
  try { body = await readFile(file, "utf8") }
  catch { continue }
  if (tokenPattern.test(body)) findings.push(`${file}: GitHub token pattern`)
  for (const name of legacyNames) if (body.includes(name)) findings.push(`${file}: legacy client environment ${name}`)
  const relative = file.slice(process.cwd().length + 1)
  if ((clientRoots.has(relative.split("/")[0]) || relative === "index.html") && body.includes(appsScriptUrl)) {
    findings.push(`${file}: client Apps Script URL`)
  }
}

const remotes = execFileSync("git", ["remote", "get-url", "--all", "origin"], { encoding: "utf8" })
if (/https?:\/\/[^/@\s]+@/.test(remotes)) findings.push("origin: credentialed Git remote URL")

if (findings.length) {
  console.error(`Secret scan failed:\n${findings.join("\n")}`)
  process.exit(1)
}
console.log(`Secret scan passed (${files.length} text files checked)`)
