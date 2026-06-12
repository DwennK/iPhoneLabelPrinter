"""Local CSV history for generated and printed labels."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
import csv
import shutil

from utils import IPhoneInfo


HISTORY_FIELDS = [
    "created_at",
    "printed_at",
    "marketing_model",
    "technical_model",
    "storage",
    "color",
    "imei",
    "serial_number",
    "device_name",
    "ios_version",
    "battery_health",
    "printer_name",
    "pdf_path",
    "label_width_mm",
    "label_height_mm",
    "label_orientation",
]


@dataclass
class LabelHistoryEntry:
    created_at: str = ""
    printed_at: str = ""
    marketing_model: str = ""
    technical_model: str = ""
    storage: str = ""
    color: str = ""
    imei: str = ""
    serial_number: str = ""
    device_name: str = ""
    ios_version: str = ""
    battery_health: str = ""
    printer_name: str = ""
    pdf_path: str = ""
    label_width_mm: str = ""
    label_height_mm: str = ""
    label_orientation: str = ""

    @classmethod
    def from_row(cls, row: dict[str, str]) -> "LabelHistoryEntry":
        return cls(**{field: row.get(field, "") for field in HISTORY_FIELDS})


def _timestamp(value: datetime | None = None) -> str:
    return (value or datetime.now()).replace(microsecond=0).isoformat(sep=" ")


def _normalized_path(path: str | Path) -> str:
    return str(Path(path).expanduser().resolve())


def entry_from_info(
    info: IPhoneInfo,
    pdf_path: str | Path,
    *,
    label_width_mm: float | None = None,
    label_height_mm: float | None = None,
    label_orientation: str = "",
    created_at: datetime | None = None,
) -> LabelHistoryEntry:
    """Create a history row from the current form/device info."""

    return LabelHistoryEntry(
        created_at=_timestamp(created_at),
        marketing_model=info.marketing_model,
        technical_model=info.technical_model,
        storage=info.storage,
        color=info.color,
        imei=info.imei,
        serial_number=info.serial_number,
        device_name=info.device_name,
        ios_version=info.ios_version,
        battery_health=info.battery_health,
        pdf_path=_normalized_path(pdf_path),
        label_width_mm=f"{label_width_mm:g}" if label_width_mm else "",
        label_height_mm=f"{label_height_mm:g}" if label_height_mm else "",
        label_orientation=label_orientation,
    )


def read_history(history_path: str | Path) -> list[LabelHistoryEntry]:
    """Read history rows, tolerating missing files and older schemas."""

    path = Path(history_path)
    if not path.exists():
        return []
    with path.open("r", newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        return [LabelHistoryEntry.from_row(row) for row in reader]


def write_history(history_path: str | Path, entries: list[LabelHistoryEntry]) -> None:
    """Persist history rows with a stable header order."""

    path = Path(history_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=HISTORY_FIELDS)
        writer.writeheader()
        for entry in entries:
            writer.writerow(asdict(entry))


def append_generated_entry(
    history_path: str | Path,
    info: IPhoneInfo,
    pdf_path: str | Path,
    *,
    label_width_mm: float | None = None,
    label_height_mm: float | None = None,
    label_orientation: str = "",
    created_at: datetime | None = None,
) -> LabelHistoryEntry:
    """Append a generated label row and return it."""

    entries = read_history(history_path)
    entry = entry_from_info(
        info,
        pdf_path,
        label_width_mm=label_width_mm,
        label_height_mm=label_height_mm,
        label_orientation=label_orientation,
        created_at=created_at,
    )
    entries.append(entry)
    write_history(history_path, entries)
    return entry


def mark_label_printed(
    history_path: str | Path,
    pdf_path: str | Path,
    printer_name: str,
    *,
    printed_at: datetime | None = None,
) -> LabelHistoryEntry | None:
    """Mark the newest matching generated label row as printed."""

    entries = read_history(history_path)
    normalized_pdf_path = _normalized_path(pdf_path)
    for entry in reversed(entries):
        if _normalized_path(entry.pdf_path) == normalized_pdf_path:
            entry.printed_at = _timestamp(printed_at)
            entry.printer_name = printer_name
            write_history(history_path, entries)
            return entry
    return None


def export_history(history_path: str | Path, destination_path: str | Path) -> Path:
    """Copy the current history CSV to a user-selected destination."""

    destination = Path(destination_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    source = Path(history_path)
    if not source.exists():
        write_history(source, [])
    shutil.copyfile(source, destination)
    return destination
