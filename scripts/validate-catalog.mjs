import { join } from "node:path";
import { validateCatalogDirectory } from "./catalog-lib.mjs";

try {
  const summary = validateCatalogDirectory(join(process.cwd(), "src-tauri", "data"));
  console.log(
    `Validated Apple catalog: ${summary.marketingNames} names, ${summary.colorOptions} color lists, ${summary.modelNumberVariants} model variants, ${summary.colorCodeVariants} color-code overrides.`,
  );
} catch (error) {
  console.error(`Catalog validation failed: ${error.message}`);
  process.exitCode = 1;
}
