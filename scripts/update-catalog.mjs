import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CATALOG_FILES,
  buildDeviceCatalog,
  buildModelNumberVariants,
  formatJson,
  normalizeColorCodeVariants,
  validateCatalog,
  validateCatalogOverrides,
} from "./catalog-lib.mjs";

const APPLEDB_DEVICES_URL = "https://api.appledb.dev/device/main.json";
const IOS_DEVICE_LIST_BASE = "https://raw.githubusercontent.com/pbakondy/ios-device-list/master";
const IOS_DEVICE_LIST_FILES = [
  "iphone.json",
  "ipad.json",
  "ipad_air.json",
  "ipad_mini.json",
  "ipad_pro.json",
];
const USER_AGENT = "iPhoneLabelPrinter catalog updater";
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDir, "..");
const catalogDir = join(projectRoot, "src-tauri", "data");
const overridesPath = join(scriptDir, "catalog-overrides.json");
const checkOnly = process.argv.includes("--check");

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Could not download ${url}: HTTP ${response.status}`);
  }
  return response.json();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function changedCatalogFiles(catalog) {
  const changed = [];
  for (const [key, filename] of Object.entries(CATALOG_FILES)) {
    const expected = formatJson(catalog[key]);
    const current = readFileSync(join(catalogDir, filename), "utf8");
    if (current !== expected) changed.push({ filename, expected });
  }
  return changed;
}

async function main() {
  const overrides = readJson(overridesPath);
  validateCatalogOverrides(overrides);
  const [devices, ...variantPayloads] = await Promise.all([
    fetchJson(APPLEDB_DEVICES_URL),
    ...IOS_DEVICE_LIST_FILES.map(async (name) => ({
      name,
      payload: await fetchJson(`${IOS_DEVICE_LIST_BASE}/${name}`),
    })),
  ]);

  const deviceCatalog = buildDeviceCatalog(devices, overrides);
  const catalog = {
    ...deviceCatalog,
    modelNumberVariants: buildModelNumberVariants(variantPayloads, overrides),
    colorCodeVariants: normalizeColorCodeVariants(
      readJson(join(catalogDir, CATALOG_FILES.colorCodeVariants)),
    ),
  };
  const summary = validateCatalog(catalog, { enforceMinimums: true });
  const changed = changedCatalogFiles(catalog);

  if (!changed.length) {
    console.log(
      `Apple catalog is current: ${summary.marketingNames} names, ${summary.colorOptions} color lists, ${summary.modelNumberVariants} model variants, ${summary.colorCodeVariants} color-code overrides.`,
    );
    return;
  }

  if (checkOnly) {
    console.error(`Apple catalog refresh required: ${changed.map(({ filename }) => filename).join(", ")}`);
    console.error("Run npm run refresh:catalog and review the generated diff.");
    process.exitCode = 1;
    return;
  }

  for (const { filename, expected } of changed) {
    writeFileSync(join(catalogDir, filename), expected, "utf8");
  }
  console.log(
    `Refreshed ${changed.length} catalog file(s): ${summary.marketingNames} names, ${summary.colorOptions} color lists, ${summary.modelNumberVariants} model variants, ${summary.colorCodeVariants} color-code overrides.`,
  );
}

main().catch((error) => {
  console.error(`Catalog refresh failed: ${error.message}`);
  process.exitCode = 1;
});
