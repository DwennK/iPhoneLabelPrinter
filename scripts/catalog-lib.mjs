import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const CATALOG_FILES = Object.freeze({
  marketingNames: "product_type_marketing_names.json",
  colorOptions: "product_color_options.json",
  modelNumberVariants: "model_number_variants.json",
  colorCodeVariants: "color_code_variants.json",
});

const PRODUCT_TYPE_PATTERN = /^(?:iPhone|iPad)\d+,\d+$/;
const MODEL_NUMBER_PATTERN = /^[A-Z0-9]{4,5}$/;
const STORAGE_PATTERN = /^\d+(?:\.\d+)? (?:GB|TB)$/;
const MINIMUM_COUNTS = Object.freeze({
  marketingNames: 100,
  colorOptions: 100,
  modelNumberVariants: 1_000,
});

export function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function normalizeOrderNumber(value) {
  let normalized = String(value ?? "").trim().toUpperCase();
  if (normalized.includes("/")) {
    const beforeSlash = normalized.split("/", 1)[0];
    normalized = beforeSlash.length > 5 ? beforeSlash.slice(0, -2) : beforeSlash;
  }
  return normalizeOrderNumberCharacters(normalized);
}

function normalizeOrderNumberCharacters(value) {
  let result = "";
  for (const character of value) {
    if (!/[A-Z0-9]/.test(character) || result.length === 5) break;
    result += character;
  }
  return result;
}

export function normalizeStorage(value) {
  const normalized = String(value ?? "").trim();
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*(GB|TB|T)$/i);
  if (!match) return normalized;
  return `${match[1]} ${match[2].toUpperCase() === "T" ? "TB" : match[2].toUpperCase()}`;
}

export function buildDeviceCatalog(devices, overrides = {}) {
  assert(Array.isArray(devices), "AppleDB device payload must be an array.");
  const names = new Map();
  const colors = new Map();

  for (const device of devices) {
    if (!isPlainObject(device)) continue;
    const name = trimmedString(device.name);
    if (!name) continue;
    const identifiers = Array.isArray(device.identifier)
      ? device.identifier
      : [device.identifier];
    const colorNames = uniqueStrings(
      Array.isArray(device.colors)
        ? device.colors.map((color) => (isPlainObject(color) ? color.name : ""))
        : [],
    );

    for (const rawIdentifier of identifiers) {
      const identifier = trimmedString(rawIdentifier);
      if (!PRODUCT_TYPE_PATTERN.test(identifier)) continue;
      setWithoutConflict(names, identifier, name, "AppleDB marketing name");
      if (colorNames.length) {
        setWithoutConflict(colors, identifier, colorNames, "AppleDB color list");
      }
    }
  }

  for (const [productType, name] of Object.entries(overrides.marketing_names ?? {})) {
    names.set(productType, name);
  }
  for (const [productType, values] of Object.entries(overrides.product_color_options ?? {})) {
    colors.set(productType, values);
  }

  return {
    marketingNames: sortedObject(names),
    colorOptions: sortedObject(colors),
  };
}

export function buildModelNumberVariants(sourcePayloads, overrides = {}) {
  assert(Array.isArray(sourcePayloads), "ios-device-list payloads must be an array.");
  const candidates = new Map();

  for (const { name, payload } of sourcePayloads) {
    assert(Array.isArray(payload), `${name} payload must be an array.`);
    for (const device of payload) {
      if (!isPlainObject(device) || !Array.isArray(device.Models)) continue;
      for (const model of device.Models) {
        if (!isPlainObject(model) || !Array.isArray(model.Model)) continue;
        const variant = {
          color: trimmedString(model.Color),
          storage: normalizeStorage(model.Storage),
        };
        if (!variant.color && !variant.storage) continue;
        for (const rawModelNumber of model.Model) {
          if (typeof rawModelNumber !== "string") continue;
          const modelNumber = normalizeOrderNumber(rawModelNumber);
          if (!modelNumber) continue;
          const variants = candidates.get(modelNumber) ?? new Map();
          variants.set(JSON.stringify(variant), variant);
          candidates.set(modelNumber, variants);
        }
      }
    }
  }

  const manual = overrides.model_number_variants ?? {};
  const unresolvedConflicts = [];
  const variants = new Map();
  for (const [modelNumber, choices] of candidates) {
    if (choices.size > 1 && !Object.hasOwn(manual, modelNumber)) {
      unresolvedConflicts.push(
        `${modelNumber}: ${[...choices.values()].map((choice) => `${choice.color}/${choice.storage}`).join(" vs ")}`,
      );
      continue;
    }
    const [choice] = choices.values();
    variants.set(modelNumber, {
      color: choice.color,
      source: "ios-device-list",
      storage: choice.storage,
    });
  }
  assert(
    unresolvedConflicts.length === 0,
    `Conflicting ios-device-list variants require an override:\n${unresolvedConflicts.join("\n")}`,
  );

  for (const [rawModelNumber, rawVariant] of Object.entries(manual)) {
    const modelNumber = normalizeOrderNumber(rawModelNumber);
    assert(modelNumber === rawModelNumber, `Override model number is not normalized: ${rawModelNumber}`);
    assert(isPlainObject(rawVariant), `Override ${modelNumber} must be an object.`);
    variants.set(modelNumber, {
      color: trimmedString(rawVariant.color),
      source: "catalog override",
      storage: normalizeStorage(rawVariant.storage),
    });
  }

  return sortedObject(variants);
}

export function validateCatalogOverrides(overrides) {
  assertExactKeys(
    overrides,
    ["marketing_names", "model_number_variants", "product_color_options"],
    "Catalog overrides",
  );
  assert(isPlainObject(overrides.marketing_names), "marketing_names overrides must be an object.");
  assert(
    isPlainObject(overrides.product_color_options),
    "product_color_options overrides must be an object.",
  );
  assert(
    isPlainObject(overrides.model_number_variants),
    "model_number_variants overrides must be an object.",
  );
  assertSortedKeys(overrides.marketing_names, "marketing_names overrides");
  assertSortedKeys(overrides.product_color_options, "product_color_options overrides");
  assertSortedKeys(overrides.model_number_variants, "model_number_variants overrides");

  for (const [productType, name] of Object.entries(overrides.marketing_names)) {
    assertProductType(productType, "marketing_names overrides");
    assertTrimmedNonEmptyString(name, `${productType} marketing-name override`);
  }
  for (const [productType, colors] of Object.entries(overrides.product_color_options)) {
    assertProductType(productType, "product_color_options overrides");
    assert(Array.isArray(colors) && colors.length > 0, `${productType} color override must be a non-empty array.`);
    const seen = new Set();
    for (const color of colors) {
      assertTrimmedNonEmptyString(color, `${productType} color override`);
      assert(!seen.has(color), `${productType} override contains duplicate color ${JSON.stringify(color)}.`);
      seen.add(color);
    }
  }
  for (const [modelNumber, variant] of Object.entries(overrides.model_number_variants)) {
    assert(MODEL_NUMBER_PATTERN.test(modelNumber), `Invalid override model number: ${modelNumber}`);
    assertExactKeys(variant, ["color", "storage"], `Override ${modelNumber}`);
    assertTrimmedNonEmptyString(variant.color, `${modelNumber} override color`);
    assertTrimmedNonEmptyString(variant.storage, `${modelNumber} override storage`);
    assert(STORAGE_PATTERN.test(variant.storage), `${modelNumber} override has invalid storage ${variant.storage}.`);
  }
}

export function normalizeColorCodeVariants(records) {
  assert(Array.isArray(records), "color_code_variants.json must contain an array.");
  return records
    .map((record) => ({
      color: trimmedString(record?.color),
      device_color: trimmedString(record?.device_color),
      enclosure_color: trimmedString(record?.enclosure_color),
      product_type: trimmedString(record?.product_type),
      source: trimmedString(record?.source),
      storage: normalizeStorage(record?.storage),
    }))
    .sort((left, right) => colorCodeKey(left).localeCompare(colorCodeKey(right), "en"));
}

export function validateCatalogDirectory(catalogDir, { enforceCanonical = true } = {}) {
  const expectedFiles = Object.values(CATALOG_FILES).sort();
  const actualFiles = readdirSync(catalogDir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  assert(
    JSON.stringify(actualFiles) === JSON.stringify(expectedFiles),
    `Catalog directory must contain exactly: ${expectedFiles.join(", ")}. Found: ${actualFiles.join(", ")}`,
  );

  const catalog = {};
  for (const [key, filename] of Object.entries(CATALOG_FILES)) {
    const path = join(catalogDir, filename);
    const source = readFileSync(path, "utf8");
    assertNoDuplicateTopLevelKeys(source, filename);
    let parsed;
    try {
      parsed = JSON.parse(source);
    } catch (error) {
      throw new Error(`${filename} is not valid JSON: ${error.message}`);
    }
    if (enforceCanonical) {
      assert(
        source === formatJson(parsed),
        `${filename} is not in canonical generated format. Run npm run refresh:catalog.`,
      );
    }
    catalog[key] = parsed;
  }

  return validateCatalog(catalog, { enforceMinimums: true });
}

export function validateCatalog(catalog, { enforceMinimums = false } = {}) {
  const { marketingNames, colorOptions, modelNumberVariants, colorCodeVariants } = catalog;
  validateMarketingNames(marketingNames);
  validateColorOptions(colorOptions, marketingNames);
  validateModelNumberVariants(modelNumberVariants);
  validateColorCodeVariants(colorCodeVariants, marketingNames, colorOptions);

  if (enforceMinimums) {
    assert(
      Object.keys(marketingNames).length >= MINIMUM_COUNTS.marketingNames,
      `Marketing-name catalog unexpectedly contains fewer than ${MINIMUM_COUNTS.marketingNames} records.`,
    );
    assert(
      Object.keys(colorOptions).length >= MINIMUM_COUNTS.colorOptions,
      `Color-option catalog unexpectedly contains fewer than ${MINIMUM_COUNTS.colorOptions} records.`,
    );
    assert(
      Object.keys(modelNumberVariants).length >= MINIMUM_COUNTS.modelNumberVariants,
      `Model-number catalog unexpectedly contains fewer than ${MINIMUM_COUNTS.modelNumberVariants} records.`,
    );
  }

  return {
    marketingNames: Object.keys(marketingNames).length,
    colorOptions: Object.keys(colorOptions).length,
    modelNumberVariants: Object.keys(modelNumberVariants).length,
    colorCodeVariants: colorCodeVariants.length,
  };
}

function validateMarketingNames(values) {
  assert(isPlainObject(values), `${CATALOG_FILES.marketingNames} must contain an object.`);
  assertSortedKeys(values, CATALOG_FILES.marketingNames);
  for (const [productType, name] of Object.entries(values)) {
    assertProductType(productType, CATALOG_FILES.marketingNames);
    assertTrimmedNonEmptyString(name, `${productType} marketing name`);
  }
}

function validateColorOptions(values, marketingNames) {
  assert(isPlainObject(values), `${CATALOG_FILES.colorOptions} must contain an object.`);
  assertSortedKeys(values, CATALOG_FILES.colorOptions);
  for (const [productType, colors] of Object.entries(values)) {
    assertProductType(productType, CATALOG_FILES.colorOptions);
    assert(Object.hasOwn(marketingNames, productType), `${productType} has colors but no marketing name.`);
    assert(Array.isArray(colors) && colors.length > 0, `${productType} must have at least one color.`);
    const seen = new Set();
    for (const color of colors) {
      assertTrimmedNonEmptyString(color, `${productType} color`);
      assert(!seen.has(color), `${productType} contains duplicate color ${JSON.stringify(color)}.`);
      seen.add(color);
    }
  }
}

function validateModelNumberVariants(values) {
  assert(isPlainObject(values), `${CATALOG_FILES.modelNumberVariants} must contain an object.`);
  assertSortedKeys(values, CATALOG_FILES.modelNumberVariants);
  for (const [modelNumber, variant] of Object.entries(values)) {
    assert(MODEL_NUMBER_PATTERN.test(modelNumber), `Invalid normalized model number: ${modelNumber}`);
    assertExactKeys(variant, ["color", "source", "storage"], `Variant ${modelNumber}`);
    assertTrimmedNonEmptyString(variant.color, `${modelNumber} color`);
    assertTrimmedNonEmptyString(variant.source, `${modelNumber} source`);
    assertTrimmedNonEmptyString(variant.storage, `${modelNumber} storage`);
    assert(STORAGE_PATTERN.test(variant.storage), `${modelNumber} has non-normalized storage: ${variant.storage}`);
  }
}

function validateColorCodeVariants(records, marketingNames, colorOptions) {
  assert(Array.isArray(records), `${CATALOG_FILES.colorCodeVariants} must contain an array.`);
  const seen = new Set();
  let previousKey = "";
  for (const [index, record] of records.entries()) {
    assertExactKeys(
      record,
      ["color", "device_color", "enclosure_color", "product_type", "source", "storage"],
      `Color-code record ${index}`,
    );
    assertProductType(record.product_type, `Color-code record ${index}`);
    assert(Object.hasOwn(marketingNames, record.product_type), `${record.product_type} color code has no marketing name.`);
    assertTrimmedNonEmptyString(record.device_color, `Color-code record ${index} device_color`);
    assertTrimmedNonEmptyString(record.enclosure_color, `Color-code record ${index} enclosure_color`);
    assertTrimmedNonEmptyString(record.source, `Color-code record ${index} source`);
    assert(
      Boolean(trimmedString(record.color) || trimmedString(record.storage)),
      `Color-code record ${index} must provide a color or storage value.`,
    );
    if (record.color) {
      assertTrimmedNonEmptyString(record.color, `Color-code record ${index} color`);
      assert(
        colorOptions[record.product_type]?.includes(record.color),
        `${record.product_type} color-code value ${record.color} is missing from product color options.`,
      );
    }
    if (record.storage) {
      assert(STORAGE_PATTERN.test(record.storage), `Color-code record ${index} has invalid storage ${record.storage}.`);
    }
    const key = colorCodeKey(record);
    assert(!seen.has(key), `Duplicate color-code record: ${key}`);
    assert(!previousKey || previousKey.localeCompare(key, "en") <= 0, "Color-code records are not sorted.");
    seen.add(key);
    previousKey = key;
  }
}

function assertNoDuplicateTopLevelKeys(source, filename) {
  const seen = new Set();
  for (const match of source.matchAll(/^  ("(?:\\.|[^"\\])*"):/gm)) {
    const key = JSON.parse(match[1]);
    assert(!seen.has(key), `${filename} contains duplicate top-level key ${JSON.stringify(key)}.`);
    seen.add(key);
  }
}

function assertSortedKeys(value, label) {
  const keys = Object.keys(value);
  const sorted = [...keys].sort();
  assert(JSON.stringify(keys) === JSON.stringify(sorted), `${label} keys are not sorted.`);
}

function assertProductType(value, label) {
  assert(PRODUCT_TYPE_PATTERN.test(value), `${label} contains invalid ProductType ${JSON.stringify(value)}.`);
}

function assertTrimmedNonEmptyString(value, label) {
  assert(typeof value === "string" && value.length > 0 && value === value.trim(), `${label} must be a trimmed non-empty string.`);
}

function assertExactKeys(value, expectedKeys, label) {
  assert(isPlainObject(value), `${label} must be an object.`);
  const actual = Object.keys(value).sort();
  assert(
    JSON.stringify(actual) === JSON.stringify([...expectedKeys].sort()),
    `${label} must contain exactly: ${expectedKeys.join(", ")}.`,
  );
}

function setWithoutConflict(map, key, value, label) {
  if (map.has(key)) {
    assert(JSON.stringify(map.get(key)) === JSON.stringify(value), `${label} conflict for ${key}.`);
    return;
  }
  map.set(key, value);
}

function sortedObject(values) {
  const entries = values instanceof Map ? [...values.entries()] : Object.entries(values);
  entries.sort(([left], [right]) => left.localeCompare(right, "en"));
  return Object.fromEntries(entries);
}

function uniqueStrings(values) {
  const result = [];
  for (const value of values) {
    const normalized = trimmedString(value);
    if (normalized && !result.includes(normalized)) result.push(normalized);
  }
  return result;
}

function trimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function colorCodeKey(record) {
  return [record.product_type, record.device_color, record.enclosure_color].join("\u0000");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
