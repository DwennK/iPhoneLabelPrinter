import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CATALOG_FILES,
  buildDeviceCatalog,
  buildModelNumberVariants,
  normalizeOrderNumber,
  normalizeStorage,
  validateCatalog,
  validateCatalogDirectory,
  validateCatalogOverrides,
} from "./catalog-lib.mjs";

test("normalizes Apple order numbers exactly like the Rust lookup", () => {
  assert.equal(normalizeOrderNumber("MG6K4QL/A"), "MG6K4");
  assert.equal(normalizeOrderNumber(" amn932 "), "AMN93");
  assert.equal(normalizeOrderNumber("MG6K4-extra"), "MG6K4");
  assert.equal(normalizeOrderNumber("--"), "");
});

test("normalizes upstream storage spellings", () => {
  assert.equal(normalizeStorage("32GB"), "32 GB");
  assert.equal(normalizeStorage("1 T"), "1 TB");
  assert.equal(normalizeStorage("512 GB"), "512 GB");
});

test("builds a deterministic ProductType catalog and removes duplicate colors", () => {
  const result = buildDeviceCatalog([
    {
      name: "iPhone Test",
      identifier: ["iPhone99,1"],
      colors: [{ name: "Blue" }, { name: "Blue" }, { name: " White " }],
    },
  ]);

  assert.deepEqual(result.marketingNames, { "iPhone99,1": "iPhone Test" });
  assert.deepEqual(result.colorOptions, { "iPhone99,1": ["Blue", "White"] });
});

test("requires an explicit override for conflicting order-number variants", () => {
  const payloads = [
    {
      name: "iphone.json",
      payload: [
        {
          Models: [
            { Color: "Green", Storage: "8 GB", Model: ["MG0V2"] },
            { Color: "Pink", Storage: "8 GB", Model: ["MG0V2"] },
          ],
        },
      ],
    },
  ];

  assert.throws(
    () => buildModelNumberVariants(payloads),
    /Conflicting ios-device-list variants require an override/,
  );
  assert.deepEqual(
    buildModelNumberVariants(payloads, {
      model_number_variants: { MG0V2: { color: "Pink", storage: "8 GB" } },
    }),
    {
      MG0V2: { color: "Pink", source: "catalog override", storage: "8 GB" },
    },
  );
});

test("rejects duplicate colors and cross-catalog color mismatches", () => {
  const base = {
    marketingNames: { "iPhone99,1": "iPhone Test" },
    colorOptions: { "iPhone99,1": ["Blue"] },
    modelNumberVariants: {
      TEST1: { color: "Blue", source: "test", storage: "128 GB" },
    },
    colorCodeVariants: [],
  };

  assert.doesNotThrow(() => validateCatalog(base));
  assert.throws(
    () => validateCatalog({ ...base, colorOptions: { "iPhone99,1": ["Blue", "Blue"] } }),
    /duplicate color/,
  );
  assert.throws(
    () =>
      validateCatalog({
        ...base,
        colorCodeVariants: [
          {
            color: "Red",
            device_color: "1",
            enclosure_color: "2",
            product_type: "iPhone99,1",
            source: "test",
            storage: "",
          },
        ],
      }),
    /missing from product color options/,
  );
});

test("rejects duplicate top-level JSON keys before parsing the catalog", () => {
  const directory = mkdtempSync(join(tmpdir(), "iphone-catalog-test-"));
  try {
    writeFileSync(
      join(directory, CATALOG_FILES.marketingNames),
      '{\n  "iPhone99,1": "First",\n  "iPhone99,1": "Second"\n}\n',
    );
    writeFileSync(join(directory, CATALOG_FILES.colorOptions), "{}\n");
    writeFileSync(join(directory, CATALOG_FILES.modelNumberVariants), "{}\n");
    writeFileSync(join(directory, CATALOG_FILES.colorCodeVariants), "[]\n");
    assert.throws(
      () => validateCatalogDirectory(directory, { enforceCanonical: false }),
      /duplicate top-level key/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects misspelled or incomplete override records", () => {
  assert.throws(
    () =>
      validateCatalogOverrides({
        marketing_names: {},
        product_color_options: {},
        model_number_variants: { TEST1: { color: "Blue", capacity: "128 GB" } },
      }),
    /must contain exactly: color, storage/,
  );
});
