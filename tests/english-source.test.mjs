import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const roots = ["app", "lib", "public"];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", ".css", ".html", ".svg"]);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return sourceExtensions.has(path.extname(entry.name)) ? [target] : [];
  }));
  return files.flat();
}

test("user-facing UI and API source is protected against Cyrillic text", async () => {
  const files = (await Promise.all(roots.map(sourceFiles))).flat();
  assert.ok(files.some((file) => file.endsWith(path.join("app", "workspace", "page.tsx"))));
  assert.ok(files.some((file) => file.includes(`${path.sep}api${path.sep}`)));
  for (const file of files) {
    const content = await readFile(file, "utf8");
    assert.doesNotMatch(content, /[\u0400-\u04ff]/, `${file} contains Cyrillic text`);
  }
});
