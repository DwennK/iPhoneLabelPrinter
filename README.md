# iPhoneLabelPrinter

Local desktop app for a phone repair shop. Runs on **macOS and Windows**.

The app detects an iPhone connected by USB, reads device metadata through `libimobiledevice`, lets staff confirm or edit missing fields, generates a thermal PDF label, and submits it to the selected printer with the configured label size.

This is an internal shop tool. It is not designed for App Store distribution.

## Current Capabilities

- Detect one or more USB-connected iPhones.
- Read model, technical ProductType, storage, color, IMEI, serial number, device name, battery health, and battery cycle count.
- Resolve marketing model names from a local `ProductType` mapping.
- Resolve color and storage from a local Apple order-number variant database.
- Allow manual correction for fields that Apple/libimobiledevice does not expose reliably.
- Generate thermal PDF labels using the configured size and orientation.
- Print labels through CUPS with a matching custom media size.
- Show operational errors in the GUI instead of only printing them in Terminal.

## Requirements

Shared:

- Python 3.12
- A USB data cable
- A trusted/unlocked iPhone
- A printer installed in the operating system

Per-platform native dependencies:

| Platform | iPhone reader | Printing |
| --- | --- | --- |
| macOS   | Homebrew `libimobiledevice` | CUPS (built-in) |
| Windows | libimobiledevice-win32 (`idevice_id.exe`, `ideviceinfo.exe`, `idevicediagnostics.exe`) | SumatraPDF (silent PDF printer) + pywin32 |
| Linux   | `libimobiledevice-utils` (`apt`, `dnf`, ...) | CUPS |

### macOS Setup

Install the system dependency:

```bash
brew install libimobiledevice
```

Useful sanity checks:

```bash
idevice_id -l
ideviceinfo -k ProductType
idevicediagnostics --help
lpstat -p
```

First-time setup:

```bash
cd /Users/dwenn/Documents/dev/iPhoneLabelPrinter
python3.12 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
python app.py
```

Running `python app.py` opens the PySide6 GUI. You can also double-click `Launch iPhoneLabelPrinter.command` from Finder after setup.

If `python3.12` is missing:

```bash
brew install python@3.12
python3.12 --version
```

### Windows Setup

All Windows-specific native binaries (libimobiledevice + SumatraPDF) are
**already bundled** in `assets\bin\win32\` (see the `NOTICE.md` in that
directory for provenance and licensing). You only need Python and the
printer.

1. **Install Python 3.12** from <https://www.python.org/downloads/windows/> and tick *Add Python to PATH*.

2. **Install the thermal printer** in *Settings > Bluetooth & devices > Printers & scanners*. Configure the custom paper size in the printer driver's preferences (Windows printer drivers expect the media size to be set at the driver level rather than passed per print job — this is the cleanest way for thermal labels).

3. **Create the virtual environment and install Python dependencies:**

   ```bat
   cd C:\path\to\iPhoneLabelPrinter
   py -3.12 -m venv .venv
   .venv\Scripts\activate
   pip install --upgrade pip
   pip install -r requirements.txt
   python app.py
   ```

   `pywin32` is installed automatically from `requirements.txt` on Windows only (`sys_platform == "win32"` marker).

4. **Double-click `Launch iPhoneLabelPrinter.bat`** from Explorer for subsequent launches. It uses `pythonw.exe` so no console window appears.

Sanity check from a `cmd` window (using the bundled binaries):

```bat
assets\bin\win32\idevice_id.exe -l
assets\bin\win32\ideviceinfo.exe -k ProductType
```

To refresh the bundled binaries to a newer version, follow the instructions in `assets\bin\win32\NOTICE.md`.

### Linux Setup (best effort)

```bash
sudo apt install libimobiledevice-utils cups python3.12 python3.12-venv
python3.12 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
python app.py
```

Linux uses the CUPS backend, same as macOS.

## Daily Usage

1. Connect the iPhone by USB.
2. Unlock the iPhone.
3. Tap **Trust This Mac** if prompted.
4. Open the app.
5. Click **Scan iPhone**.
6. Confirm or edit:
   - Model
   - Technical model
   - Storage
   - Color
   - IMEI
   - Serial number
   - Device name
   - Battery health
7. Select the thermal printer.
8. Click **Generate Label**.
9. Click **Print Label**.

Label dimensions and orientation can be changed in the **Settings** tab. The print job uses the effective label size as a CUPS custom media size, for example `Custom.62x40mm`, so the macOS paper-size dialog is not required during normal use.

Generated PDFs are saved in:

```text
generated_labels/
```

## Project Structure

```text
iPhoneLabelPrinter/
├── README.md
├── requirements.txt
├── Launch iPhoneLabelPrinter.command   # macOS double-click launcher
├── Launch iPhoneLabelPrinter.bat       # Windows double-click launcher
├── app.py                              # PySide6 GUI
├── iphone_reader.py                    # libimobiledevice CLI wrapper
├── model_mapping.py                    # ProductType -> marketing name
├── variant_resolver.py                 # ModelNumber -> color/storage
├── variant_data.py                     # Apple order-number database
├── label_generator.py                  # ReportLab PDF generation
├── printer.py                          # cross-platform printer facade
├── _printer_cups.py                    # macOS / Linux backend (CUPS)
├── _printer_win32.py                   # Windows backend (win32print + SumatraPDF)
├── utils.py                            # subprocess + data helpers
├── generated_labels/
└── assets/
    └── bin/
        └── win32/                      # bundled Windows runtime (~38 MB)
            ├── NOTICE.md               # provenance + licenses (GPL-3.0, LGPL-2.1)
            ├── SumatraPDF.exe          # silent PDF printer
            ├── idevice_id.exe          # libimobiledevice CLI tools
            ├── ideviceinfo.exe
            ├── idevicediagnostics.exe
            └── *.dll                   # libimobiledevice shared dependencies
```

## Architecture

### `app.py`

PySide6 GUI.

Responsibilities:

- Main window layout
- Scan button flow
- Manual edit fields
- Printer selector
- Label preview
- Generate and print button handlers
- User-facing error dialogs

The GUI is deliberately synchronous for now. The subprocess calls are short and easier to reason about. If scans become slow on some devices, move scanning into a `QThread` or worker object.

### `iphone_reader.py`

Reads device data with `subprocess` through the shared `run_command()` wrapper.

Main functions:

- `detect_devices()`
- `read_iphone_info(udid)`
- `get_battery_info(udid)`

Commands used:

```bash
idevice_id -l
ideviceinfo -u UDID
ideviceinfo -u UDID -k ProductType
ideviceinfo -u UDID -k DeviceName
ideviceinfo -u UDID -k SerialNumber
ideviceinfo -u UDID -k InternationalMobileEquipmentIdentity
ideviceinfo -u UDID -k InternationalMobileEquipmentIdentity2
ideviceinfo -u UDID -k MobileEquipmentIdentifier
ideviceinfo -u UDID -k ModelNumber
ideviceinfo -u UDID -k DeviceColor
ideviceinfo -u UDID -k DeviceEnclosureColor
ideviceinfo -u UDID -q com.apple.disk_usage
idevicediagnostics -u UDID diagnostics GasGauge
idevicediagnostics -u UDID ioregentry AppleSmartBattery
```

### `model_mapping.py`

Maps Apple `ProductType` identifiers to marketing names.

Example:

```python
"iPhone18,3": "iPhone 17"
```

If a new iPhone appears and the app shows **Unknown model**, add the new `ProductType` here.

### `variant_resolver.py`

Resolves color and storage variant data.

Resolution order:

1. Local `ModelNumber` lookup from `variant_data.py`
2. Optional Reincubate DeviceIdentifier API if `RI_DEVID_TOKEN` is set
3. Scoped local `ProductType + DeviceColor + DeviceEnclosureColor` fallback
4. Manual GUI entry

This exists because `DeviceColor` and `DeviceEnclosureColor` often return numeric Apple-internal codes like `1` and `2`. Those codes are not universal across iPhone generations.

### `variant_data.py`

Generated/local Apple order-number data.

Example:

```python
"MG6K4": ("White", "256 GB")
```

The file currently contains thousands of historical iPhone order-number prefixes, plus recent hand-maintained entries needed by this shop workflow.

Important: Apple order numbers often appear with a region suffix, for example:

```text
MG6K4QL/A
```

The resolver normalizes this to:

```text
MG6K4
```

### `label_generator.py`

Generates thermal label PDFs with ReportLab.

Default size:

```python
LABEL_WIDTH_MM = 62
LABEL_HEIGHT_MM = 40
```

Label content:

- Marketing model
- Storage and color
- IMEI
- Serial number
- Battery health and cycle count when available
- QR code containing IMEI
- Optional barcode for IMEI
- Timestamp
- Technical model

### `printer.py` + backends

`printer.py` is a thin **facade** that exposes a single public surface:

- `PrinterError`
- `PrinterInfo`
- `list_printers()`
- `submit_label_print_job(printer_name, pdf_path, width_mm, height_mm, orientation)`

At import time it picks one backend based on `sys.platform`:

- `_printer_cups.py` on macOS and Linux. Wraps `lpstat -p`, `lpstat -d`, and `lp` with a `Custom.<W>x<H>mm` media size so the OS print dialog is skipped.
- `_printer_win32.py` on Windows. Lists printers through `win32print.EnumPrinters` and submits PDFs through SumatraPDF in `-silent` mode (`-print-settings noscale,portrait|landscape`). Custom thermal paper sizes are expected to be configured at the printer-driver level, which is the Windows-native way to handle non-standard media.

Add a third platform by dropping a new `_printer_<name>.py` module that exposes `list_printers()` / `submit_label_print_job()` and extending the `if sys.platform == ...` block in `printer.py`.

### `utils.py`

Shared helpers and dataclasses.

Important pieces:

- `IPhoneInfo`
- `run_command()` — subprocess wrapper. Hides the console window on Windows (`CREATE_NO_WINDOW`) so the GUI does not flash a black box on every iPhone scan.
- `resolve_tool(name)` — looks for a CLI tool in `assets/bin/<sys.platform>/` first, then falls back to `shutil.which`. Lets the app bundle libimobiledevice (or SumatraPDF) without changing call sites.
- subprocess timeout handling
- safe key/value parsing
- storage rounding
- filename sanitization

## Data Flow

```text
Scan iPhone
  -> idevice_id -l
  -> user selects UDID if multiple devices
  -> ideviceinfo reads core metadata
  -> ProductType maps to marketing model
  -> disk usage maps to commercial storage size
  -> ModelNumber resolves color/storage variant
  -> battery diagnostics resolve health/cycles
  -> GUI form is populated
  -> user confirms or edits
  -> ReportLab generates PDF
  -> macOS print dialog prints the generated PDF
```

## Battery Health Notes

Battery health is read from `idevicediagnostics`, not plain `ideviceinfo`.

The app tries:

```bash
idevicediagnostics -u UDID diagnostics GasGauge
idevicediagnostics -u UDID ioregentry AppleSmartBattery
```

On the test iPhone 17 used during development, this returned:

```text
Battery health: 100%
Cycle count: 90
```

Some devices, iOS versions, locked states, or trust states may hide battery diagnostics. In that case the GUI field remains editable.

## Color Detection Notes

Color is not guaranteed by `libimobiledevice`.

The robust route is:

```text
ModelNumber -> variant_data.py -> color/storage
```

Example from a real test device:

```text
ProductType: iPhone18,3
ModelNumber: MG6K4
DeviceColor: 1
DeviceEnclosureColor: 2
Resolved: iPhone 17, 256 GB, White
```

Do not build a global mapping like `DeviceColor 1 = White`. That will be wrong on other models.

## Printer Setup On macOS

1. Open **System Settings**.
2. Go to **Printers & Scanners**.
3. Add the thermal printer.
4. Print a macOS test page if needed.
5. Reopen the app or click **Refresh Printers**.

If the printer does not appear:

```bash
lpstat -p
lpstat -d
```

If `lpstat -p` lists no printers, macOS has not registered the printer yet.

## Manual Testing Checklist

Use this before handing the app to shop staff:

```bash
cd /Users/dwenn/Documents/dev/iPhoneLabelPrinter
source .venv/bin/activate
python -m py_compile app.py iphone_reader.py label_generator.py model_mapping.py printer.py _printer_cups.py utils.py variant_resolver.py variant_data.py
python app.py
```

On Windows, replace the `py_compile` invocation with:

```bat
.venv\Scripts\activate
python -m py_compile app.py iphone_reader.py label_generator.py model_mapping.py printer.py _printer_win32.py utils.py variant_resolver.py variant_data.py
python app.py
```

Then verify:

- GUI opens.
- **Refresh Printers** lists the expected printer.
- With no phone connected, **Scan iPhone** shows a clear error.
- With one trusted iPhone connected, **Scan iPhone** fills the form.
- Model is not `Unknown model` for known ProductTypes.
- Color is filled when `ModelNumber` exists in `variant_data.py`.
- Battery health is filled when diagnostics are available.
- IMEI can be manually entered if missing.
- **Generate Label** creates a PDF in `generated_labels/`.
- The generated PDF opens in Preview.
- **Print Label** opens the macOS print dialog for the generated label.

Useful direct checks:

```bash
idevice_id -l
ideviceinfo -u UDID -k ProductType
ideviceinfo -u UDID -k ModelNumber
idevicediagnostics -u UDID diagnostics GasGauge
lpstat -p
```

## Troubleshooting

### iPhone Not Detected

- Confirm the USB cable supports data, not only charging.
- Unlock the iPhone before scanning.
- Tap **Trust This Mac** on the iPhone.
- Run `idevice_id -l` in Terminal.
- Try another USB port or cable.

### Trust This Mac Prompt Does Not Appear

- Unplug and reconnect the iPhone.
- Unlock the phone before reconnecting.
- Try another cable.
- On the iPhone, reset Location & Privacy if needed.
- Pairing issues are usually outside the app and inside `libimobiledevice`/macOS trust state.

### IMEI Missing

The app tries:

```text
InternationalMobileEquipmentIdentity
InternationalMobileEquipmentIdentity2
MobileEquipmentIdentifier
```

If all are missing, enter IMEI manually. Some devices or iOS states do not expose IMEI reliably.

### Color Missing Or Wrong

- Check the value of `ModelNumber`:

```bash
ideviceinfo -u UDID -k ModelNumber
```

- If the model number is known but missing from `variant_data.py`, add it there.
- If only numeric `DeviceColor` values are available, do not assume they are universal.
- Staff can always choose from the dropdown or type a custom color.

### Battery Health Missing

Run:

```bash
idevicediagnostics -u UDID diagnostics GasGauge
idevicediagnostics -u UDID ioregentry AppleSmartBattery
```

If both commands fail or omit capacity/cycle fields, enter the value manually or leave it blank.

### Printer Not Listed

- Confirm the printer is installed in **System Settings > Printers & Scanners**.
- Run `lpstat -p`.
- Reinstall the printer driver if macOS does not list it.
- Click **Refresh Printers** after changes.

### Print Job Not Working

- Confirm the printer is powered on.
- Confirm labels are loaded correctly.
- Check the macOS print queue.
- Try opening the generated PDF in Preview and printing manually.
- Try:

```bash
lp -d PRINTER_NAME generated_labels/YOUR_LABEL.pdf
```

## Packaging

### macOS App Bundle

Optional packaging with PyInstaller:

```bash
source .venv/bin/activate
pip install pyinstaller
pyinstaller --windowed --name "iPhoneLabelPrinter" app.py
```

The packaged app still depends on:

- Homebrew `libimobiledevice`
- `idevice_id`
- `ideviceinfo`
- `idevicediagnostics`
- macOS CUPS commands like `lp` and `lpstat`

If a packaged app cannot find Homebrew commands, inspect `PATH` inside the app bundle. Homebrew on Apple Silicon is usually `/opt/homebrew/bin`; on Intel Macs, `/usr/local/bin`.

### Windows Executable

```bat
.venv\Scripts\activate
pip install pyinstaller
pyinstaller --windowed --name "iPhoneLabelPrinter" ^
    --add-data "assets;assets" ^
    app.py
```

For a fully self-contained build on Windows, place the libimobiledevice binaries (`idevice_id.exe`, `ideviceinfo.exe`, `idevicediagnostics.exe`, plus their `.dll` files) and `SumatraPDF.exe` in `assets\bin\win32\` before running PyInstaller. `resolve_tool()` will find them inside the bundled app automatically.

## Optional Commercial Variant Enrichment

`variant_resolver.py` supports Reincubate DeviceIdentifier if a token is configured:

```bash
export RI_DEVID_TOKEN="your-token"
python app.py
```

The app is local/private by default and does not call that API unless the token exists.

## Notes For Future Maintainers

- Keep subprocess calls centralized through `utils.run_command()`.
- Do not call shell commands with `shell=True`.
- Keep timeouts on every hardware/printing command.
- Add new ProductType mappings in `model_mapping.py`.
- Add new color/storage order-number mappings in `variant_data.py`.
- Keep color detection conservative. Numeric color codes must be scoped by `ProductType`.
- Keep every field editable in the GUI. Apple does not expose every value consistently.
- Test on a locked phone, untrusted phone, no phone, and trusted phone before shipping changes.
- Test printing with the actual shop thermal printer, not only PDF generation.

## Last Known Real-Device Test

Development test device:

```text
ProductType: iPhone18,3
Marketing model: iPhone 17
ModelNumber: MG6K4
Storage: 256 GB
Color: White
Battery health: 100%
Battery cycle count: 90
```

This verified:

- ProductType mapping
- ModelNumber variant resolution
- Battery diagnostics
- PDF generation
- GUI startup
