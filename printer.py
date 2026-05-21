"""macOS CUPS printer discovery."""

from __future__ import annotations

from dataclasses import dataclass
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
