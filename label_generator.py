"""Thermal label PDF generation."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
import tempfile

import barcode
from barcode.writer import ImageWriter
import qrcode
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from utils import IPhoneInfo, normalize_imei, sanitize_filename_part


LABEL_WIDTH_MM = 62
LABEL_HEIGHT_MM = 40
LABEL_MARGIN_MM = 3
INCLUDE_BARCODE = False
SECONDS_PER_DAY = 24 * 60 * 60


def build_label_qr_data(info: IPhoneInfo) -> str:
    """Return a compact, scanner-friendly payload for the label QR code."""

    imei = normalize_imei(info.imei)
    fields = [
        ("IMEI", imei),
        ("SN", info.serial_number.strip()),
        ("MODEL", info.marketing_model.strip()),
        ("TECH", info.technical_model.strip()),
        ("STORAGE", info.storage.strip()),
        ("COLOR", info.color.strip()),
        ("BATTERY", info.battery_health.strip()),
        ("IOS", info.ios_version.strip()),
    ]
    lines = [f"{key}: {value}" for key, value in fields if value]
    if lines:
        return "\n".join(lines)
    return "Unknown iPhone"


def _draw_fit_text(
    pdf: canvas.Canvas,
    text: str,
    x: float,
    y: float,
    max_width: float,
    font_name: str,
    font_size: float,
    min_size: float = 6,
) -> None:
    """Draw text, shrinking only when necessary for narrow thermal labels."""

    text = text.strip()
    if not text:
        return
    size = font_size
    while size > min_size and pdf.stringWidth(text, font_name, size) > max_width:
        size -= 1
    if pdf.stringWidth(text, font_name, size) > max_width:
        ellipsis = "..."
        while text and pdf.stringWidth(f"{text}{ellipsis}", font_name, size) > max_width:
            text = text[:-1].rstrip()
        if not text:
            text = ellipsis if pdf.stringWidth(ellipsis, font_name, size) <= max_width else ""
        else:
            text = f"{text}{ellipsis}"
    if not text:
        return
    pdf.setFont(font_name, size)
    pdf.drawString(x, y, text)


def _make_qr_png(data: str) -> Path:
    qr = qrcode.QRCode(border=1, box_size=4)
    qr.add_data(data)
    qr.make(fit=True)
    image = qr.make_image(fill_color="black", back_color="white")
    temp = tempfile.NamedTemporaryFile(delete=False, suffix=".png")
    temp.close()
    image.save(temp.name)
    return Path(temp.name)


def _make_barcode_png(data: str) -> Path | None:
    if not data:
        return None
    ean_class = barcode.get_barcode_class("code128")
    code = ean_class(data, writer=ImageWriter())
    temp_base = tempfile.NamedTemporaryFile(delete=True).name
    output = code.save(
        temp_base,
        options={
            "module_width": 0.2,
            "module_height": 4.0,
            "quiet_zone": 1.0,
            "font_size": 0,
            "write_text": False,
            "dpi": 300,
        },
    )
    return Path(output)


def write_label_pdf(
    info: IPhoneInfo,
    pdf_path: str | Path,
    label_width_mm: float = LABEL_WIDTH_MM,
    label_height_mm: float = LABEL_HEIGHT_MM,
    created_at: datetime | None = None,
) -> Path:
    """Write one thermal label PDF to an exact path and return it."""

    pdf_path = Path(pdf_path)
    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    created_at = created_at or datetime.now()

    width = label_width_mm * mm
    height = label_height_mm * mm
    margin = LABEL_MARGIN_MM * mm
    usable_width = width - (margin * 2)

    imei = normalize_imei(info.imei)
    qr_data = build_label_qr_data(info)
    qr_path = _make_qr_png(qr_data)
    barcode_path = _make_barcode_png(imei) if INCLUDE_BARCODE and imei else None

    pdf = canvas.Canvas(str(pdf_path), pagesize=(width, height))
    pdf.setTitle("iPhoneLabelPrinter label")
    pdf.setFillColorRGB(0, 0, 0)

    title = info.marketing_model or "Unknown model"
    detail_parts = [part for part in [info.storage, info.color] if part.strip()]
    detail_line = " - ".join(detail_parts)
    ios_line = f"iOS: {info.ios_version.strip()}" if info.ios_version.strip() else ""

    if height > width:
        info_line_count = 2 + (1 if info.battery_health else 0) + (1 if ios_line else 0)
        info_line_gap = 3.55 * mm
        qr_size = min(24 * mm, usable_width * 0.82)

        y = height - margin - 4.2 * mm
        _draw_fit_text(pdf, title, margin, y, usable_width, "Helvetica-Bold", 13, min_size=8)
        y -= 4.0 * mm
        if detail_line:
            _draw_fit_text(pdf, detail_line, margin, y, usable_width, "Helvetica", 9)
            y -= 1.0 * mm
        else:
            y -= 0.4 * mm

        min_qr_y = margin + 7.8 * mm + (info_line_count - 1) * info_line_gap
        qr_size = max(12 * mm, min(qr_size, y - min_qr_y))
        qr_x = (width - qr_size) / 2
        qr_y = y - qr_size
        pdf.drawImage(str(qr_path), qr_x, qr_y, width=qr_size, height=qr_size, mask="auto")

        y = qr_y - 2.4 * mm
        _draw_fit_text(pdf, f"IMEI: {imei or 'Manual entry needed'}", margin, y, usable_width, "Helvetica", 8)
        if info.battery_health:
            battery_line = f"Battery: {info.battery_health}"
            if info.battery_cycle_count:
                battery_line += f" - {info.battery_cycle_count} cycles"
            y -= info_line_gap
            _draw_fit_text(pdf, battery_line, margin, y, usable_width, "Helvetica", 8)
        if ios_line:
            y -= info_line_gap
            _draw_fit_text(pdf, ios_line, margin, y, usable_width, "Helvetica", 8)
        y -= info_line_gap
        _draw_fit_text(pdf, f"S/N: {info.serial_number or '-'}", margin, y, usable_width, "Helvetica", 8)
    else:
        qr_size = 17 * mm
        qr_x = width - margin - qr_size
        qr_y = height - margin - qr_size
        text_max_width = usable_width - qr_size - 3 * mm

        y = height - margin - 6 * mm
        _draw_fit_text(pdf, title, margin, y, text_max_width, "Helvetica-Bold", 12)
        y -= 6 * mm
        _draw_fit_text(pdf, detail_line, margin, y, text_max_width, "Helvetica", 8)
        y -= 6 * mm
        line_width = text_max_width if y >= qr_y - 1 * mm else usable_width
        _draw_fit_text(pdf, f"IMEI: {imei or 'Manual entry needed'}", margin, y, line_width, "Helvetica", 7)
        if info.battery_health:
            battery_line = f"Battery: {info.battery_health}"
            if info.battery_cycle_count:
                battery_line += f" - {info.battery_cycle_count} cycles"
            y -= 5 * mm
            line_width = text_max_width if y >= qr_y - 1 * mm else usable_width
            _draw_fit_text(pdf, battery_line, margin, y, line_width, "Helvetica", 7)
        if ios_line:
            y -= 5 * mm
            line_width = text_max_width if y >= qr_y - 1 * mm else usable_width
            _draw_fit_text(pdf, ios_line, margin, y, line_width, "Helvetica", 7)
        y -= 5 * mm
        line_width = text_max_width if y >= qr_y - 1 * mm else usable_width
        _draw_fit_text(pdf, f"S/N: {info.serial_number or '-'}", margin, y, line_width, "Helvetica", 7)

        pdf.drawImage(str(qr_path), qr_x, qr_y, width=qr_size, height=qr_size, mask="auto")

    if barcode_path:
        barcode_width = 34 * mm
        barcode_height = 6 * mm
        pdf.drawImage(
            str(barcode_path),
            margin,
            margin + 4 * mm,
            width=barcode_width,
            height=barcode_height,
            preserveAspectRatio=True,
            mask="auto",
        )

    pdf.setFont("Helvetica", 5)
    pdf.drawString(margin, margin, created_at.strftime("%d/%m/%Y %H:%M"))
    if info.technical_model:
        pdf.drawRightString(width - margin, margin, info.technical_model)

    pdf.showPage()
    pdf.save()

    qr_path.unlink(missing_ok=True)
    if barcode_path:
        barcode_path.unlink(missing_ok=True)

    return pdf_path


def write_calibration_label_pdf(
    pdf_path: str | Path,
    label_width_mm: float = LABEL_WIDTH_MM,
    label_height_mm: float = LABEL_HEIGHT_MM,
    created_at: datetime | None = None,
) -> Path:
    """Write a printer calibration label with borders and alignment marks."""

    pdf_path = Path(pdf_path)
    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    created_at = created_at or datetime.now()

    width = label_width_mm * mm
    height = label_height_mm * mm
    margin = LABEL_MARGIN_MM * mm
    usable_width = width - (margin * 2)
    usable_height = height - (margin * 2)
    center_x = width / 2
    center_y = height / 2

    pdf = canvas.Canvas(str(pdf_path), pagesize=(width, height))
    pdf.setTitle("iPhoneLabelPrinter calibration label")
    pdf.setFillColorRGB(0, 0, 0)
    pdf.setStrokeColorRGB(0, 0, 0)
    pdf.setLineWidth(0.4)

    pdf.rect(margin, margin, usable_width, usable_height, stroke=True, fill=False)
    pdf.line(center_x, margin, center_x, height - margin)
    pdf.line(margin, center_y, width - margin, center_y)

    tick = 2.5 * mm
    for x, y in (
        (margin, margin),
        (width - margin, margin),
        (margin, height - margin),
        (width - margin, height - margin),
    ):
        pdf.line(x - tick if x > center_x else x, y, x + tick if x < center_x else x, y)
        pdf.line(x, y - tick if y > center_y else y, x, y + tick if y < center_y else y)

    y = height - margin - 5 * mm
    _draw_fit_text(pdf, "iPhoneLabelPrinter TEST", margin + 1 * mm, y, usable_width - 2 * mm, "Helvetica-Bold", 10)
    y -= 5 * mm
    size_line = f"{label_width_mm:g} x {label_height_mm:g} mm"
    _draw_fit_text(pdf, size_line, margin + 1 * mm, y, usable_width - 2 * mm, "Helvetica", 8)
    y = margin + 2 * mm
    _draw_fit_text(
        pdf,
        created_at.strftime("%d/%m/%Y %H:%M"),
        margin + 1 * mm,
        y,
        usable_width - 2 * mm,
        "Helvetica",
        6,
    )

    pdf.showPage()
    pdf.save()
    return pdf_path


def generate_label_pdf(
    info: IPhoneInfo,
    output_dir: str | Path = "generated_labels",
    label_width_mm: float = LABEL_WIDTH_MM,
    label_height_mm: float = LABEL_HEIGHT_MM,
) -> Path:
    """Generate a thermal label PDF and return its path."""

    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    created_at = datetime.now()
    timestamp = created_at.strftime("%Y%m%d_%H%M%S")
    name_part = sanitize_filename_part(info.imei or info.serial_number or info.marketing_model)
    pdf_path = output_path / f"{timestamp}_{name_part}.pdf"

    return write_label_pdf(
        info,
        pdf_path,
        label_width_mm=label_width_mm,
        label_height_mm=label_height_mm,
        created_at=created_at,
    )


def generate_calibration_label_pdf(
    output_dir: str | Path = "generated_labels",
    label_width_mm: float = LABEL_WIDTH_MM,
    label_height_mm: float = LABEL_HEIGHT_MM,
) -> Path:
    """Generate a calibration PDF and return its path."""

    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    created_at = datetime.now()
    timestamp = created_at.strftime("%Y%m%d_%H%M%S")
    pdf_path = output_path / f"{timestamp}_calibration.pdf"
    return write_calibration_label_pdf(
        pdf_path,
        label_width_mm=label_width_mm,
        label_height_mm=label_height_mm,
        created_at=created_at,
    )


def cleanup_generated_label_pdfs(
    output_dir: str | Path = "generated_labels",
    retention_days: int = 30,
    now: datetime | None = None,
) -> list[Path]:
    """Delete generated PDFs older than ``retention_days`` and return deleted paths."""

    if retention_days <= 0:
        return []

    output_path = Path(output_dir)
    if not output_path.is_dir():
        return []

    cutoff = (now or datetime.now()).timestamp() - (retention_days * SECONDS_PER_DAY)
    deleted: list[Path] = []
    for pdf_path in output_path.glob("*.pdf"):
        try:
            if pdf_path.stat().st_mtime >= cutoff:
                continue
            pdf_path.unlink()
        except OSError:
            continue
        deleted.append(pdf_path)
    return deleted
