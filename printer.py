"""macOS CUPS printer discovery."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re

from utils import AppError, CommandExecutionError, run_command


class PrinterError(AppError):
    """Raised for printer discovery or print submission failures."""


@dataclass
class PrinterInfo:
    name: str
    is_default: bool = False


def _format_custom_media(width_mm: float, height_mm: float) -> str:
    width = f"{width_mm:g}"
    height = f"{height_mm:g}"
    return f"Custom.{width}x{height}mm"


def _format_orientation_request(orientation: str) -> str:
    if orientation == "landscape":
        return "4"
    return "3"


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
