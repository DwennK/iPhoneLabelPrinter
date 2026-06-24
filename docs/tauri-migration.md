# Tauri Migration Notes

This migration is additive. The existing Python/PySide app, PyInstaller release
workflow, launch scripts, generated data files, and vendored Windows binaries
remain in place until the Tauri build is validated on the shop Windows/macOS
machines.

## Current Python Surfaces To Preserve

- `app.py`: PySide desktop workflow with Label, History, and Settings tabs. It
  owns scan state, editable fields, printer selection, generated PDF status,
  alerts, settings, history table, and updater dialogs.
- `iphone_reader.py`: libimobiledevice CLI orchestration. It detects UDIDs,
  reads `ideviceinfo`, maps trust/lockdown failures to operator-facing messages,
  resolves storage, IMEI, color, variant, and battery health/cycles.
- `label_generator.py`: ReportLab PDF rendering for 62 x 40 mm thermal labels,
  QR payloads, calibration labels, filename generation, and cleanup.
- `printer.py`, `_printer_cups.py`, `_printer_win32.py`: platform-specific
  printer discovery and print submission. macOS/Linux use CUPS; Windows uses
  SumatraPDF and the OS printer driver paper size.
- `history.py`: stable CSV schema for generated/printed labels.
- `model_mapping.py`, `variant_resolver.py`, `variant_data.py`,
  `device_catalog.py`: local business data for marketing names, color options,
  and model-number-to-color/storage resolution.
- `updater.py`: GitHub Releases self-update for the packaged Python app.

## Added Tauri Structure

- `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`: Vite +
  TypeScript frontend shell.
- `src/`: dense utility UI for scan, editable fields, PDF generation, printer
  selection, print, history, and settings.
- `src-tauri/`: Tauri 2 backend in Rust.

## Rust Backend Status

Implemented:

- Resolves vendored Windows CLI tools from `assets/bin/win32` before PATH.
- Falls back to PATH on macOS/Linux for `idevice_id`, `ideviceinfo`,
  `idevicediagnostics`, `lpstat`, and `lp`.
- Exposes Tauri commands:
  - `scan_devices`
  - `read_device_info`
  - `color_options`
  - `list_printers`
  - `generate_label`
  - `generate_calibration_label`
  - `cleanup_generated_labels`
  - `print_label`
  - `read_history`
  - `export_history`
  - `environment_info`
- Ports the core iPhone read flow to Rust:
  - `idevice_id -l`
  - broad `ideviceinfo`
  - disk capacity lookup
  - IMEI fallback keys
  - battery diagnostics XML integer extraction
  - storage rounding
  - operator-facing connection errors
- Reuses existing Python business data by parsing:
  - `device_catalog.py`
  - `model_mapping.py`
  - `variant_data.py`
  - `variant_resolver.py`
- Lists printers with CUPS on macOS/Linux and PowerShell/CIM on Windows.
- Prints with CUPS on macOS/Linux and SumatraPDF on Windows.
- Generates normal and calibration label PDFs in Rust with vector QR codes and
  the same thermal page size defaults.
- Reads and writes existing `label_history.csv` from Rust, including generated
  rows, printed rows, and CSV export.

## Frontend Status

Implemented:

- Label workspace with scan, multi-device selection, editable fields, alerts,
  generated PDF path, printer selector, generate, print, and open PDF.
- History workspace with search, refresh, selectable rows, reprint selected,
  open selected PDF, and export CSV.
- Settings workspace for width, height, orientation, generated PDF cleanup, and
  calibration label printing.
- Operational layout based on the existing PySide tabs, not a landing page.

Not yet migrated:

- Live PDF preview before generation. The current Tauri UI shows the generated
  path and can open the PDF.
- GitHub Releases auto-update flow.
- Python business data files are still the source for generated Apple model and
  variant tables. Rust parses them as text at compile time; there is no Tauri
  runtime Python bridge.

## Run The Tauri App

Install and run Tauri:

```bash
cd /Users/dwenn/Documents/dev/iPhoneLabelPrinter
npm install
npm run tauri:dev
```

## Verification Commands

```bash
python -m unittest discover -s tests
npm run build
cd src-tauri
cargo test
```

For a full desktop package check:

```bash
npm run tauri:build
```

## Next Migration Steps

1. Add Rust tests around mocked libimobiledevice command output for the full
   `read_device_info` path.
2. Convert generated Python business data files to JSON or Rust generated data
   if the legacy Python app is removed.
3. Decide whether Tauri should replace or coexist with the current GitHub
   Releases/PyInstaller updater.
4. Add Windows CI for `npm run tauri:build` once packaging resources and signing
   expectations are decided.
