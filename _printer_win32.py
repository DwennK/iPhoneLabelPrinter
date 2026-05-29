"""Windows printer backend.

Discovery goes through ``win32print`` (pywin32). Printing goes through
SumatraPDF, which is the most reliable silent PDF printer for Windows and
fits in a single bundled executable.

The label PDF is generated at the exact label dimensions by
``label_generator``, so this backend forwards the document as-is with
``noscale`` and lets the printer driver honour the configured media size
(thermal printers usually have a custom paper size pre-configured for the
roll currently loaded).
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import win32print  # type: ignore[import-not-found]

from printer import PrinterError, PrinterInfo


_BASE_DIR = Path(__file__).resolve().parent
_BUNDLED_SUMATRA = _BASE_DIR / "assets" / "bin" / "win32" / "SumatraPDF.exe"
_KNOWN_SUMATRA_PATHS = (
    r"C:\Program Files\SumatraPDF\SumatraPDF.exe",
    r"C:\Program Files (x86)\SumatraPDF\SumatraPDF.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\SumatraPDF\SumatraPDF.exe"),
)
_WIN_NO_WINDOW = 0x08000000  # subprocess.CREATE_NO_WINDOW
_PRINT_TIMEOUT_SECONDS = 30.0

_SUMATRA_INSTALL_HINT = (
    "SumatraPDF was not found. Install it from "
    "https://www.sumatrapdfreader.org/ and either add SumatraPDF.exe to PATH "
    "or copy it to assets\\bin\\win32\\SumatraPDF.exe next to the app."
)


def _find_sumatra() -> str | None:
    """Locate SumatraPDF.exe in bundle, PATH, then well-known install paths."""

    if _BUNDLED_SUMATRA.is_file():
        return str(_BUNDLED_SUMATRA)

    on_path = shutil.which("SumatraPDF") or shutil.which("SumatraPDF.exe")
    if on_path:
        return on_path

    for candidate in _KNOWN_SUMATRA_PATHS:
        if candidate and os.path.isfile(candidate):
            return candidate
    return None


def _get_default_printer() -> str:
    try:
        return win32print.GetDefaultPrinter() or ""
    except Exception:  # noqa: BLE001 — pywin32 raises bare pywintypes.error
        return ""


def list_printers() -> list[PrinterInfo]:
    """List local and connected network printers via the Windows spooler."""

    try:
        flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
        raw = win32print.EnumPrinters(flags, None, 1)
    except Exception as exc:  # noqa: BLE001 — surface as PrinterError
        raise PrinterError(f"Could not list printers: {exc}") from exc

    default_name = _get_default_printer()
    seen: set[str] = set()
    printers: list[PrinterInfo] = []
    # EnumPrinters level 1 returns tuples: (flags, description, name, comment).
    for entry in raw:
        if len(entry) < 3:
            continue
        name = (entry[2] or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        printers.append(PrinterInfo(name=name, is_default=name == default_name))

    printers.sort(key=lambda item: (not item.is_default, item.name.lower()))
    return printers


def _build_print_settings(orientation: str) -> str:
    parts = ["noscale"]
    parts.append("landscape" if orientation == "landscape" else "portrait")
    return ",".join(parts)


def submit_label_print_job(
    printer_name: str,
    pdf_path: str | Path,
    label_width_mm: float,  # noqa: ARG001 — driver handles media size on Windows
    label_height_mm: float,  # noqa: ARG001
    orientation: str,
) -> str:
    """Send the generated PDF to the selected printer through SumatraPDF."""

    pdf_path = Path(pdf_path)
    if not pdf_path.exists():
        raise PrinterError(f"Label PDF was not found: {pdf_path}")

    sumatra = _find_sumatra()
    if sumatra is None:
        raise PrinterError(_SUMATRA_INSTALL_HINT)

    command = [
        sumatra,
        "-print-to",
        printer_name,
        "-silent",
        "-print-settings",
        _build_print_settings(orientation),
        str(pdf_path),
    ]

    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=_PRINT_TIMEOUT_SECONDS,
            check=False,
            creationflags=_WIN_NO_WINDOW,
        )
    except subprocess.TimeoutExpired as exc:
        raise PrinterError(
            f"Print command timed out after {_PRINT_TIMEOUT_SECONDS:.0f}s."
        ) from exc
    except OSError as exc:
        raise PrinterError(f"Could not run SumatraPDF: {exc}") from exc

    if completed.returncode != 0:
        details = (completed.stderr or completed.stdout or "Unknown error").strip()
        raise PrinterError(f"SumatraPDF failed: {details}")

    return f"Print job sent to {printer_name}."
