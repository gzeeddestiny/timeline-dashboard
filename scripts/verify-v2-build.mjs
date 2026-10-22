import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const baseline = JSON.parse(
  await readFile(
    new URL("../docs/v2-legacy-baseline.json", import.meta.url),
    "utf8",
  ),
);
// These shared readers/cron are intentionally changed by the approved usage reduction.
const optimized = new Set(['src/App.jsx','src/components/AuthGate.jsx','src/components/NotificationCenter.jsx','src/lib/fullSystem.js','src/lib/useLiveResource.js','api/cron-notifications.js','src/lib/supabasePages.js','src/components/ActivityHistory.jsx','src/components/FollowUpView.jsx']);
for (const [file, hash] of Object.entries(baseline))
  if (!optimized.has(file)) assert.equal(
    createHash("sha256")
      .update(await readFile(new URL(`../${file}`, import.meta.url)))
      .digest("hex"),
    hash,
    `Legacy source changed: ${file}`,
  );
const manifest = JSON.parse(
  await readFile(
    new URL("../dist/.vite/manifest.json", import.meta.url),
    "utf8",
  ),
);
const seen = new Set();
async function inspect(key) {
  if (seen.has(key)) return;
  seen.add(key);
  const entry = manifest[key];
  assert.ok(entry, `Missing build entry: ${key}`);

  const code = await readFile(new URL(`../dist/${entry.file}`, import.meta.url), "utf8");
  assert.ok(!code.includes("demoState"), "Production must not contain demo entry");
  for (const dep of [...(entry.imports || []), ...(entry.dynamicImports || [])]) await inspect(dep);
}
for (const path of ["index.html", "v2/index.html"]) {
  const built = await readFile(new URL(`../dist/${path}`, import.meta.url), "utf8");
  const scripts = [...built.matchAll(/<script[^>]+src="\/([^"]+)"/g)].map((m) => m[1]);
  assert.ok(scripts.length, `${path} must have a built application`);
  for (const file of scripts) {
    const key = Object.keys(manifest).find((key) => manifest[key].file === file);
    assert.ok(key, `Missing manifest entry for ${file}`);
    await inspect(key);
  }
  const html = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const expected = path === "index.html" ? "/src/main.jsx" : "/src/v2/main.jsx";
  assert.ok(html.includes(expected), `${path} must boot ${expected}`);
}
console.log(`Shared legacy source preserved: ${Object.keys(baseline).length - optimized.size} files; ${optimized.size} approved usage optimizations. Root boots V1 and /v2 boots V2; production demo exclusion verified.`);

const root = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
const v2 = await readFile(new URL("../dist/v2/index.html", import.meta.url), "utf8");
assert.notEqual(root.match(/<script[^>]+src="([^"]+)"/)[1], v2.match(/<script[^>]+src="([^"]+)"/)[1], "V1 and V2 must use separate entries");
