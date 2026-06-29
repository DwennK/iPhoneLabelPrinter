import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const catalogDir = join(process.cwd(), "src-tauri", "data");
const jsonFiles = readdirSync(catalogDir).filter((name) => name.endsWith(".json"));

if (!jsonFiles.length) {
  throw new Error(`No JSON catalog files found in ${catalogDir}`);
}

for (const file of jsonFiles) {
  const path = join(catalogDir, file);
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  const type = Array.isArray(parsed) ? "array" : typeof parsed;
  if (parsed === null || !["array", "object"].includes(type)) {
    throw new Error(`${file} must contain a JSON object or array`);
  }
  if (type === "object" && Object.keys(parsed).length === 0) {
    throw new Error(`${file} must not be empty`);
  }
  if (type === "array" && parsed.length === 0) {
    throw new Error(`${file} must not be empty`);
  }
}

console.log(`Validated ${jsonFiles.length} catalog file(s).`);
