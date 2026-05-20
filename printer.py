"""macOS CUPS printer discovery and PDF printing."""

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


def print_pdf(printer_name: str, pdf_path: str | Path) -> str:
    """Send a PDF to a named CUPS printer with ``lp``."""

    if not printer_name.strip():
        raise PrinterError("Select a printer before printing.")

    path = Path(pdf_path)
    if not path.exists():
        raise PrinterError(f"Label PDF was not found: {path}")

    try:
        result = run_command(["lp", "-d", printer_name, str(path)], timeout=12.0)
    except CommandExecutionError as exc:
        raise PrinterError(f"Could not send print job: {exc}") from exc

    return result.stdout.strip() or "Print job submitted."
