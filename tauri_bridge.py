"""Temporary Python bridge for the progressive Tauri migration.

The Rust backend owns Tauri commands and process orchestration. This bridge
keeps the existing ReportLab label rendering and CSV history semantics as the
source of truth until those surfaces are ported fully to Rust.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from history import append_generated_entry, mark_label_printed
from label_generator import LABEL_HEIGHT_MM, LABEL_WIDTH_MM, generate_label_pdf
from utils import IPhoneInfo


BASE_DIR = Path(__file__).resolve().parent
GENERATED_LABELS_DIR = BASE_DIR / "generated_labels"
HISTORY_PATH = BASE_DIR / "label_history.csv"
DEFAULT_LABEL_ORIENTATION = (
    "landscape" if float(LABEL_WIDTH_MM) >= float(LABEL_HEIGHT_MM) else "portrait"
)


def _read_payload() -> dict[str, Any]:
    try:
        raw = sys.stdin.read()
        return json.loads(raw or "{}")
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON bridge payload: {exc}") from exc


def _pick(data: dict[str, Any], snake: str, camel: str | None = None, default: str = "") -> str:
    value = data.get(snake)
    if value is None and camel:
        value = data.get(camel)
    if value is None:
        return default
    return str(value)


def _float_option(data: dict[str, Any], snake: str, camel: str, default: float) -> float:
    value = data.get(snake, data.get(camel, default))
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def _info_from_payload(data: dict[str, Any]) -> IPhoneInfo:
    return IPhoneInfo(
        udid=_pick(data, "udid"),
        marketing_model=_pick(data, "marketing_model", "marketingModel"),
        technical_model=_pick(data, "technical_model", "technicalModel"),
        model_number=_pick(data, "model_number", "modelNumber"),
        storage=_pick(data, "storage"),
        color=_pick(data, "color"),
        imei=_pick(data, "imei"),
        serial_number=_pick(data, "serial_number", "serialNumber"),
        device_name=_pick(data, "device_name", "deviceName"),
        ios_version=_pick(data, "ios_version", "iosVersion"),
        build_version=_pick(data, "build_version", "buildVersion"),
        battery_health=_pick(data, "battery_health", "batteryHealth"),
        battery_cycle_count=_pick(data, "battery_cycle_count", "batteryCycleCount"),
        model_is_unknown=bool(data.get("model_is_unknown", data.get("modelIsUnknown", False))),
        color_source_note=_pick(data, "color_source_note", "colorSourceNote"),
        variant_source_note=_pick(data, "variant_source_note", "variantSourceNote"),
    )


def generate_label(payload: dict[str, Any]) -> dict[str, Any]:
    info = _info_from_payload(payload.get("info") or {})
    options = payload.get("options") or {}
    label_width_mm = _float_option(options, "label_width_mm", "labelWidthMm", float(LABEL_WIDTH_MM))
    label_height_mm = _float_option(options, "label_height_mm", "labelHeightMm", float(LABEL_HEIGHT_MM))
    orientation = _pick(
        options,
        "label_orientation",
        "labelOrientation",
        DEFAULT_LABEL_ORIENTATION,
    )

    pdf_path = generate_label_pdf(
        info,
        GENERATED_LABELS_DIR,
        label_width_mm=label_width_mm,
        label_height_mm=label_height_mm,
    )
    append_generated_entry(
        HISTORY_PATH,
        info,
        pdf_path,
        label_width_mm=label_width_mm,
        label_height_mm=label_height_mm,
        label_orientation=orientation,
    )
    return {"pdfPath": str(pdf_path)}


def mark_printed(payload: dict[str, Any]) -> dict[str, Any]:
    pdf_path = _pick(payload, "pdf_path", "pdfPath")
    printer_name = _pick(payload, "printer_name", "printerName")
    if pdf_path and printer_name:
        mark_label_printed(HISTORY_PATH, pdf_path, printer_name)
    return {"ok": True}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["generate-label", "mark-printed"])
    args = parser.parse_args()
    payload = _read_payload()

    if args.action == "generate-label":
        response = generate_label(payload)
    else:
        response = mark_printed(payload)

    print(json.dumps(response), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
