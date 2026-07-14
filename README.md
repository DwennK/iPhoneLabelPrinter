# iPhoneLabelPrinter

Internal desktop tool for a repair shop. The app detects a USB-connected
iPhone or iPad, reads metadata with `libimobiledevice`, lets staff correct
missing fields, generates a thermal PDF label, prints it, and keeps a CSV
history.

The active app is now the Tauri 2 desktop app with a Rust backend and a
TypeScript frontend. The previous Python/PySide/PyInstaller application has
been removed from this branch.

## Current Scope

- Scan connected iPhone/iPad devices with `idevice_id`.
- Read metadata with `ideviceinfo` and battery diagnostics with
  `idevicediagnostics`.
- Resolve marketing names, color choices, and color/storage variants from local
  JSON data in `src-tauri/data`.
- Edit device fields before printing.
- Generate 62 x 40 mm thermal PDF labels and calibration labels in Rust.
- List printers and print through CUPS on macOS/Linux.
- Print through SumatraPDF on Windows.
- Read, update, search, reprint, and export `label_history.csv`.
- Apply the configured retention window to generated PDFs and history rows.
- Write a support log in the app data folder for command and troubleshooting
  diagnostics.
- Keep vendored Windows binaries in `assets/bin/win32`.

## Requirements

Shared:

- Node.js and npm
- Rust stable
- A USB data cable
- A trusted and unlocked iPhone or iPad
- A printer installed in the operating system

macOS:

- `assets/bin/macos-arm64` is intentionally kept in the repo and bundled by
  Tauri for Apple Silicon Macs. It contains `idevice_id`, `ideviceinfo`,
  `idevicediagnostics`, and the required `.dylib` files.
- Intel Mac release builds are intentionally disabled until a matching
  `assets/bin/macos-x64` bundle is added.
- For local development, Homebrew `libimobiledevice` can still be used as a
  fallback:

  ```bash
  brew install libimobiledevice
  ```
- Intel Mac support requires adding a matching `assets/bin/macos-x64` bundle
  and re-enabling the macOS Intel job in `.github/workflows/release.yml`.

Windows:

- `assets/bin/win32` is intentionally kept in the repo and bundled by Tauri.
  It contains `idevice_id.exe`, `ideviceinfo.exe`, `idevicediagnostics.exe`,
  the required DLLs, and `SumatraPDF.exe`.
- Configure the thermal label size in the Windows printer driver preferences.

Linux:

- Install the distribution package that provides `idevice_id`, `ideviceinfo`,
  `idevicediagnostics`, `lpstat`, and `lp`.
- Linux support is best effort; macOS and Windows are the priority targets.

## Run In Development

```bash
cd /Users/dwenn/Documents/dev/iPhoneLabelPrinter
npm install
npm run tauri:dev
```

Useful dependency checks:

```bash
idevice_id -l
ideviceinfo -k ProductType
idevicediagnostics --help
lpstat -p
```

## Apple Catalog Maintenance

The runtime catalog is generated from two maintained upstream datasets:

- [AppleDB](https://appledb.dev/) for ProductType marketing names and color lists.
- [ios-device-list](https://github.com/pbakondy/ios-device-list) for Apple order-number color and storage variants.

Shop-observed values and upstream conflict resolutions live in
`scripts/catalog-overrides.json`; the refresh command always applies them after
downloading upstream data. Product/color-code fallbacks remain deliberately
hand-maintained in `src-tauri/data/color_code_variants.json` because their
numeric values are device-generation-specific observations.

```bash
# Download upstream data, apply overrides, validate, and update changed JSON.
npm run refresh:catalog

# Check whether a refresh would change committed data without writing files.
npm run check:catalog-refresh

# Validate schemas, normalized values, duplicates, and cross-file consistency.
npm run validate:catalog

# Exercise the catalog transformation and conflict-resolution logic.
npm run test:catalog
```

`.github/workflows/catalog-refresh.yml` runs the refresh every Monday and opens
or updates a pull request only when generated data changes. A refresh fails
closed if an upstream source is unavailable, unexpectedly sparse, malformed,
or introduces a conflicting order-number mapping without an explicit override.

## Build And Verify

```bash
npm run build
npm run validate:catalog
cd src-tauri && cargo test
cd .. && npm run tauri:build
```

The Tauri bundle includes the Windows binaries from `assets/bin/win32` and the
macOS Apple Silicon binaries from `assets/bin/macos-arm64`.

## Release

Signed updater artifacts are built by `.github/workflows/release.yml` when a
`v*` tag is pushed or the workflow is run manually. The workflow creates a draft
GitHub Release with Tauri bundles, signatures, and `latest.json` for the in-app
updater.

Before publishing a draft release, run the hardware checklist in
`docs/release-validation.md`. The updater signing private key is intentionally
not committed; add it to the GitHub secret `TAURI_SIGNING_PRIVATE_KEY`.

## Project Structure

```text
assets/bin/win32/        Windows libimobiledevice tools, DLLs, SumatraPDF
assets/bin/macos-arm64/  macOS arm64 libimobiledevice tools and dylibs
generated_labels/        Dev-mode generated PDFs
src/                     TypeScript frontend
src-tauri/src/           Rust backend
src-tauri/data/          Local Apple model, color, and variant data
docs/release-validation.md Hardware release checklist
docs/tauri-migration.md  Migration status and release notes
```

In dev builds, generated PDFs, `label_history.csv`, and `support.log` are
written at the repo root to keep manual testing simple. In release builds, they
are written to the user application data folder. Set
`IPHONE_LABEL_PRINTER_DATA_DIR` to override that location.

## Remaining Release Work

- Validate each draft release on the shop Windows and macOS machines with real
  devices and the thermal printer.
- Add platform code signing/notarization if the app is distributed beyond
  internal use.
