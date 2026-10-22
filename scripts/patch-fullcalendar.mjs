import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

// FullCalendar 7.1.0 flushes React sizing changes inside ResizeObserver delivery.
// Batch those changes in the next animation frame instead of mutating the
// observed layout synchronously. Keep native errors visible; don't suppress them.
// https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver#observation_errors
const pkg = new URL("../node_modules/@fullcalendar/react/", import.meta.url);
const { version } = JSON.parse(
  await readFile(new URL("package.json", pkg), "utf8"),
);
assert.equal(
  version,
  "7.1.0",
  "Re-review the FullCalendar resize patch when upgrading",
);
const file = new URL("chunks/8563f14c.js", pkg);
const source = await readFile(file, "utf8");
const marker = "// MAGIC V2: frame-batched ResizeObserver delivery";
if (!source.includes(marker)) {
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    "f43258795c951df726639876c82c6c66e6e62728dc28edbd49ad96d93ea3f734",
    "Unexpected FullCalendar source; refusing a partial patch",
  );
  const head =
    "const globalResizeObserver = typeof ResizeObserver !== 'undefined' && new ResizeObserver((entries) => {";
  const start = source.indexOf(head);
  const end = source.indexOf("\n/*\nPRECONDITION:", start);
  assert.ok(start >= 0 && end > start);
  const block = source.slice(start, end);
  assert.ok(block.endsWith("\n});"));
  const body = block
    .slice(head.length, -4)
    .replace(
      "        const config = configMap.get(el);",
      "        const config = configMap.get(el);\n        if (!config) continue; // Element may have unmounted before the frame.",
    );
  const patched = `${marker}
const pendingResizeEntries = new Map();
let pendingResizeFrame = null;
${head}
    for (const entry of entries) pendingResizeEntries.set(entry.target, entry);
    if (pendingResizeFrame !== null) return;
    pendingResizeFrame = requestAnimationFrame(() => {
        pendingResizeFrame = null;
        const entries = [...pendingResizeEntries.values()];
        pendingResizeEntries.clear();
${body}
    });
});`;
  await writeFile(file, source.slice(0, start) + patched + source.slice(end));
}
console.log("FullCalendar 7.1.0 resize scheduling patch verified.");
