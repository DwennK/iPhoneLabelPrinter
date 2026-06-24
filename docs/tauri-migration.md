# Tauri Migration Notes

The migration is now the active application path. The legacy
Python/PySide/PyInstaller runtime, launch scripts, Python tests, and Python
release workflow were removed after the Rust/Tauri path covered the user
workflow.

## Preserved User Workflow

- Connect an iPhone or iPad by USB.
- Scan devices and choose a connected device when more than one is present.
- Read model, storage, color, IMEI, serial number, device name, iOS version,
  battery health, and battery cycle count where available.
- Manually correct missing or unreliable fields before printing.
- Generate a thermal PDF label.
- Open the generated PDF when needed.
- Select a printer and print the label.
- Review history, reprint a previous label, and export history.
- Generate and print a calibration label.

## Rust Backend

Implemented Tauri commands:

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

Platform behavior:

- Windows resolves vendored tools from `assets/bin/win32` before falling back
  to `PATH`.
- macOS and Linux use system `libimobiledevice` and CUPS commands from `PATH`.
- Windows printing uses the vendored `SumatraPDF.exe`.
- macOS/Linux printing uses `lp` with the configured label size.

Data behavior:

- Marketing model names live in
  `src-tauri/data/product_type_marketing_names.json`.
- Product color choices live in `src-tauri/data/product_color_options.json`.
- Apple order-number color/storage variants live in
  `src-tauri/data/model_number_variants.json`.
- Product/color-code fallbacks live in
  `src-tauri/data/color_code_variants.json`.
- Runtime Python is no longer required.

Storage behavior:

- Dev builds write generated PDFs and `label_history.csv` at the repo root.
- Release builds write generated PDFs and `label_history.csv` in the user's
  application data directory.
- `IPHONE_LABEL_PRINTER_DATA_DIR` can override the data directory for testing
  or shop-specific deployment.

## Frontend

The frontend is a dense utility interface, not a landing page:

- Label workspace for scan, field edits, generation, printer selection, print,
  and PDF opening.
- History workspace for search, refresh, reprint, open PDF, and export.
- Settings workspace for label size, orientation, retention cleanup,
  calibration labels, and system paths.

## Verification

Run:

```bash
npm run build
cd src-tauri && cargo test
cd .. && npm run tauri:build
```

## Remaining Work

- Configure a Tauri updater or a new GitHub release workflow.
- Validate Windows packaging and printing on the target shop machine.
- Validate macOS packaging on a target Mac with a real USB device.
- Add a maintained JSON refresh command if Apple model/variant data needs
  regular updates.
- Add code signing and notarization if distribution expands beyond internal
  usage.
