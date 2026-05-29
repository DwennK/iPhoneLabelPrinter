"""CUPS printer backend (macOS and Linux)."""

from __future__ import annotations

from pathlib import Path
import re

from printer import PrinterError, PrinterInfo
from utils import CommandExecutionError, run_command


def _format_custom_media(width_mm: float, height_mm: float) -> str:
    return f"Custom.{width_mm:g}x{height_mm:g}mm"


def _format_orientation_request(orientation: str) -> str:
    return "4" if orientation == "landscape" else "3"


def list_printers() -> list[PrinterInfo]:
    """List printers known to CUPS using ``lpstat -p`` and ``lpstat -d``."""

    try:
        printers_result = run_command(["lpstat", "-p"], timeout=6.0)
    except CommandExecutionError as exc:
        raise PrinterError(f"Could not list printers: {exc}") from exc

    default_name = ""
    try:
        default_result = run_command(["lpstat", "-d"], timeout=4.0)
        match = re.search(r"system default destination:\s*(.+)", default_result.stdout)
        if match:
            default_name = match.group(1).strip()
    except CommandExecutionError:
        default_name = ""

    printers: list[PrinterInfo] = []
    for line in printers_result.stdout.splitlines():
        line = line.strip()
        if not line.startswith("printer "):
            continue
        parts = line.split()
        if len(parts) >= 2:
            name = parts[1]
            printers.append(PrinterInfo(name=name, is_default=name == default_name))

    printers.sort(key=lambda item: (not item.is_default, item.name.lower()))
    return printers


def submit_label_print_job(
    printer_name: str,
    pdf_path: str | Path,
    label_width_mm: float,
    label_height_mm: float,
    orientation: str,
) -> str:
    """Submit a PDF label to CUPS using the app's custom media size."""

    pdf_path = Path(pdf_path)
    if not pdf_path.exists():
        raise PrinterError(f"Label PDF was not found: {pdf_path}")

    media = _format_custom_media(label_width_mm, label_height_mm)
    try:
        result = run_command(
            [
                "lp",
                "-d",
                printer_name,
                "-o",
                f"media={media}",
                "-o",
                f"orientation-requested={_format_orientation_request(orientation)}",
                "-o",
                "scaling=100",
                str(pdf_path),
            ],
            timeout=12.0,
        )
    except CommandExecutionError as exc:
        raise PrinterError(f"Could not submit the print job: {exc}") from exc

    return result.stdout.strip()
