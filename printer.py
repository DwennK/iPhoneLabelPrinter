"""Cross-platform printer facade.

Public surface:

- ``PrinterError``       : user-facing failure for discovery or submission.
- ``PrinterInfo``        : lightweight printer description for the GUI.
- ``list_printers()``    : discover printers known to the OS.
- ``submit_label_print_job(...)`` : send a generated PDF to a printer.

The actual implementation lives in a per-platform backend module:

- ``_printer_cups``  for macOS and Linux (CUPS via ``lp`` / ``lpstat``).
- ``_printer_win32`` for Windows (``win32print`` + SumatraPDF).

Backends are imported below ``PrinterError`` / ``PrinterInfo`` so they can
safely import those names from this module at load time.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass

from utils import AppError


class PrinterError(AppError):
    """Raised for printer discovery or print submission failures."""


@dataclass
class PrinterInfo:
    name: str
    is_default: bool = False


if sys.platform == "win32":
    from _printer_win32 import list_printers, submit_label_print_job
else:
    from _printer_cups import list_printers, submit_label_print_job


__all__ = [
    "PrinterError",
    "PrinterInfo",
    "list_printers",
    "submit_label_print_job",
]
