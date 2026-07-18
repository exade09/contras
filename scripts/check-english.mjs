import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const roots = ["app", "lib", "public"];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", ".css", ".html", ".svg"]);
const cyrillic = /[\u0400-\u04ff]/u;
const violations = [];

async function scan(relativeDirectory) {
  const entries = await readdir(relativeDirectory, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      await scan(relativePath);
      continue;
    }
    if (!sourceExtensions.has(path.extname(entry.name))) continue;
    const content = await readFile(relativePath, "utf8");
    content.split(/\r?\n/u).forEach((line, index) => {
      if (cyrillic.test(line)) violations.push(`${relativePath}:${index + 1}`);
    });
  }
}

for (const root of roots) await scan(root);

if (violations.length) {
  console.error("Cyrillic text is not allowed in user-facing application sources:");
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exitCode = 1;
} else {
  console.log("English-only source check passed.");
}
