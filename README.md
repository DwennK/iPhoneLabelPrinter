# iPhoneLabelPrinter

Local desktop app for a phone repair shop. Runs on **macOS and Windows**.

The app detects an iPhone connected by USB, reads device metadata through `libimobiledevice`, lets staff confirm or edit missing fields, generates a thermal PDF label, and submits it to the selected printer with the configured label size.

This is an internal shop tool. It is not designed for App Store distribution.

---

## 🇫🇷 Guide Windows (pour le mainteneur)

> Cette section résume **tout ce qui concerne Windows en français**, pour t'y
> retrouver plus tard. Le reste du README (en anglais) donne le détail
> technique. Ici on reste concret.

### En une phrase

Sur Windows, l'app est **un seul fichier `.exe`** qui contient déjà tout ce
qu'il faut (lecture iPhone + impression). L'utilisateur n'installe **ni
Python, ni libimobiledevice, ni rien d'autre**. Et l'app **se met à jour
toute seule** quand tu publies une nouvelle version sur GitHub.

### Comment ça marche (les 3 briques)

1. **Lecture de l'iPhone** : l'app utilise les outils `libimobiledevice`
   (`idevice_id.exe`, `ideviceinfo.exe`, `idevicediagnostics.exe`). Sur macOS
   ils viennent de Homebrew ; sur Windows ils n'existent pas officiellement,
   donc **je les ai mis directement dans le projet** (`assets\bin\win32\`).
   L'app les trouve toute seule là-dedans avant de chercher ailleurs.
2. **Impression** : Windows n'a pas l'équivalent de l'impression Mac (CUPS).
   On passe donc par **SumatraPDF** (un imprimeur de PDF silencieux et gratuit),
   lui aussi rangé dans `assets\bin\win32\SumatraPDF.exe`. La taille
   d'étiquette se règle **une fois** dans les préférences du pilote
   d'imprimante Windows.
3. **L'interface** est la même qu'on macOS (PySide6). Le code choisit
   automatiquement le bon comportement selon le système (`printer.py`).

### Installer l'app sur un poste de boutique Windows

1. Va sur la page des releases :
   <https://github.com/DwennK/iPhoneLabelPrinter/releases>
2. Télécharge le fichier **`iPhoneLabelPrinter.exe`** de la dernière version.
3. Mets-le dans un dossier **où l'utilisateur peut écrire** : par exemple sur
   le Bureau, ou dans `C:\Users\<nom>\iPhoneLabelPrinter\`.
   ⚠️ **Évite `C:\Program Files\`** : la mise à jour automatique a besoin de
   remplacer le `.exe`, et `Program Files` demanderait les droits
   administrateur à chaque fois (la maj échouerait silencieusement).
4. Ajoute l'imprimante thermique dans *Paramètres > Bluetooth et appareils >
   Imprimantes et scanners*, et règle la taille d'étiquette dans les
   préférences du pilote.
5. Double-clique sur `iPhoneLabelPrinter.exe`. C'est tout.

Au premier lancement, Windows SmartScreen peut afficher un avertissement
(« éditeur inconnu ») parce que l'exe n'est pas signé : *Informations
complémentaires > Exécuter quand même*. C'est normal pour un outil interne.

### La mise à jour automatique, vue côté utilisateur

- À chaque ouverture, l'app regarde discrètement s'il existe une version plus
  récente sur GitHub.
- Si oui → une fenêtre : **« Une nouvelle version est disponible, l'installer
  maintenant ? »**. S'il accepte, l'app télécharge, se remplace et redémarre
  toute seule.
- **S'il n'y a pas internet, l'app s'ouvre quand même normalement.** La
  vérification ne bloque jamais le démarrage.

### Publier une nouvelle version (ce que TU fais)

C'est le point important. Tu **n'as pas besoin d'une machine Windows** : un
serveur Windows gratuit de GitHub fabrique le `.exe` à ta place.

À chaque fois que tu veux livrer une amélioration :

```bash
# 1. Tu modifies le code, puis tu changes le numéro de version dans version.py
#    exemple :  __version__ = "1.0.1"

# 2. Tu enregistres et tu poses une "étiquette" de version (le tag) :
git commit -am "Release 1.0.1"
git tag v1.0.1
git push origin main
git push origin v1.0.1
```

Et c'est fini. Pousser le tag `v1.0.1` déclenche automatiquement :
le serveur GitHub compile le `.exe`, crée la release `v1.0.1`, et y attache
le fichier. Tous les postes proposeront la maj au prochain lancement.

> 💡 Le numéro dans `version.py` (`1.0.1`) **doit** correspondre au tag
> (`v1.0.1`). Si tu te trompes, la compilation s'arrête avec une erreur claire
> plutôt que de publier une version incohérente.

Tu peux suivre la compilation dans l'onglet **Actions** du dépôt GitHub. Elle
prend ~2-3 minutes. Si tu veux juste tester une compilation sans publier de
release, lance le workflow à la main depuis cet onglet (*Run workflow*).

### Où est rangé quoi (côté Windows)

| Quoi | Où | Rôle |
| --- | --- | --- |
| `version.py` | racine du projet | le numéro de version (à changer à chaque release) |
| `.github/workflows/release.yml` | dépôt | la recette qui compile le `.exe` sur GitHub |
| `updater.py` | racine | la logique de mise à jour automatique |
| `assets\bin\win32\` | projet | les binaires Windows embarqués (libimobiledevice + SumatraPDF) |
| `iPhoneLabelPrinter.exe` | release GitHub | ce que les boutiques téléchargent et lancent |

---

## Current Capabilities

- Detect one or more USB-connected iPhones.
- Read model, technical ProductType, storage, color, IMEI, serial number, device name, battery health, and battery cycle count.
- Resolve marketing model names from a local `ProductType` mapping.
- Resolve color and storage from a local Apple order-number variant database.
- Allow manual correction for fields that Apple/libimobiledevice does not expose reliably.
- Generate thermal PDF labels using the configured size and orientation.
- Print labels through CUPS or Windows/SumatraPDF using the configured label size.
- Print a calibration label for driver and paper-size checks.
- Clean up old generated label PDFs using a configurable retention period.
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

The **Settings** tab also includes:

- **Print Test Label** for thermal printer calibration.
- **Keep labels** to delete old PDFs from `generated_labels/` automatically.
- **Clean Now** to apply the cleanup immediately.

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
- Scan button flow using a `QThread` worker
- Manual edit fields
- Printer selector
- Label preview
- Generate and print button handlers
- User-facing error dialogs

Scan and update checks run on worker threads so USB reads and network checks do not freeze the window.

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
python -m unittest discover -s tests
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
- **Print Test Label** produces a bordered calibration label.

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

Build a single self-contained `.exe`. `--onefile` is required for the
auto-updater: a one-file executable can be swapped on disk after the app
exits, while a one-folder build cannot be replaced cleanly while running.

```bat
.venv\Scripts\activate
pip install pyinstaller
pyinstaller --onefile --windowed --name "iPhoneLabelPrinter" ^
    --add-data "assets;assets" ^
    app.py
```

The libimobiledevice binaries (`idevice_id.exe`, `ideviceinfo.exe`, `idevicediagnostics.exe`, plus their `.dll` files) and `SumatraPDF.exe` in `assets\bin\win32\` are embedded automatically; `resolve_tool()` finds them inside the running bundle.

The resulting `dist\iPhoneLabelPrinter.exe` is the file to publish as a GitHub Release asset (see *Versioning and Auto-update* below).

**Install location matters for self-update.** The updater replaces the running
`.exe` in place. Install the app where the logged-in user can write without
elevation — for example a folder on the Desktop or under
`%LOCALAPPDATA%\iPhoneLabelPrinter\`. Avoid `C:\Program Files\`, where
overwriting the exe would require administrator rights and the silent update
would fail.

## Versioning and Auto-update

The app checks GitHub Releases at every launch and offers to update itself.

### Version source

`version.py` holds the single source of truth:

```python
__version__ = "1.0.0"
GITHUB_REPO = "DwennK/iPhoneLabelPrinter"
```

It is shown in the window title (`iPhoneLabelPrinter 1.0.0`) and compared
against the latest release tag. Versions follow SemVer (`MAJOR.MINOR.PATCH`).

### How the update flow works

1. ~0.8 s after the window appears, a background thread queries
   `https://api.github.com/repos/<repo>/releases/latest`.
2. The check is **fail-open**: no internet, no published release (HTTP 404),
   or a malformed response simply means "no update" and the app runs normally.
   It never blocks startup.
3. If the latest release tag is newer than `__version__`, a dialog asks the
   user to install now (release notes shown under *Details*).
4. On confirm, the matching asset (the `.exe`) is downloaded with a progress
   bar, a detached helper script waits for the app to exit, swaps the new exe
   over the old one, and relaunches.
5. From a source/dev run (`python app.py`, not frozen), there is no exe to
   replace, so the dialog opens the release page in the browser instead and
   tells the user to `git pull`.

The relevant code lives in `updater.py` (Qt-free, unit-testable) and the
worker/dialog glue in `app.py`.

### Publishing a new release

Releases are built and published automatically by GitHub Actions
(`.github/workflows/release.yml`) on a Windows runner — no local Windows
machine needed. The full process is:

```bash
# 1. Bump the version in version.py  ->  __version__ = "1.0.1"
git commit -am "Release 1.0.1"

# 2. Tag and push (the tag must match version.py; the CI verifies this)
git tag v1.0.1
git push origin main
git push origin v1.0.1
```

Pushing the `v1.0.1` tag triggers the workflow, which:

1. checks that the tag matches `__version__`,
2. builds `iPhoneLabelPrinter.exe` with PyInstaller `--onefile`,
3. creates the GitHub Release `v1.0.1` with the exe attached and
   auto-generated notes.

Every existing install then offers this version on its next launch. Draft and
pre-release releases are ignored by `releases/latest`, so you can stage one
before it goes live to shops. You can also trigger a build manually (without
releasing) from the repository's **Actions** tab via *Run workflow*.

To build the exe locally on a Windows machine instead, see the
*Windows Executable* section above.

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
- Bump `__version__` in `version.py` for every release and publish a matching `vX.Y.Z` GitHub Release with the Windows `.exe` attached, or installed apps will not see the update.
- Keep the update check fail-open: it must never prevent the app from starting offline.

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
