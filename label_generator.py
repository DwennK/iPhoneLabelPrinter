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


def _draw_fit_text(
    pdf: canvas.Canvas,
    text: str,
    x: float,
    y: float,
    max_width: float,
    font_name: str,
    font_size: int,
    min_size: int = 6,
) -> None:
    """Draw text, shrinking only when necessary for narrow thermal labels."""

    text = text.strip()
    if not text:
        return
    size = font_size
    while size > min_size and pdf.stringWidth(text, font_name, size) > max_width:
        size -= 1
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
    label_width_mm: int = LABEL_WIDTH_MM,
    label_height_mm: int = LABEL_HEIGHT_MM,
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
    qr_data = imei or info.serial_number or info.marketing_model or "Unknown iPhone"
    qr_path = _make_qr_png(qr_data)
    barcode_path = _make_barcode_png(imei) if INCLUDE_BARCODE and imei else None

    pdf = canvas.Canvas(str(pdf_path), pagesize=(width, height))
    pdf.setTitle("iPhoneLabelPrinter label")
    pdf.setFillColorRGB(0, 0, 0)

    title = info.marketing_model or "Unknown model"
    detail_parts = [part for part in [info.storage, info.color] if part.strip()]
    detail_line = " - ".join(detail_parts)

    qr_size = 17 * mm
    qr_x = width - margin - qr_size
    qr_y = height - margin - qr_size
    text_max_width = usable_width - qr_size - 3 * mm

    y = height - margin - 6 * mm
    _draw_fit_text(pdf, title, margin, y, text_max_width, "Helvetica-Bold", 12)
    y -= 6 * mm
    _draw_fit_text(pdf, detail_line, margin, y, text_max_width, "Helvetica", 8)
    y -= 6 * mm
    _draw_fit_text(pdf, f"IMEI: {imei or 'Manual entry needed'}", margin, y, usable_width, "Helvetica", 7)
    y -= 5 * mm
    _draw_fit_text(pdf, f"S/N: {info.serial_number or '-'}", margin, y, usable_width, "Helvetica", 7)
    if info.battery_health:
        battery_line = f"Battery: {info.battery_health}"
        if info.battery_cycle_count:
            battery_line += f" - {info.battery_cycle_count} cycles"
        y -= 5 * mm
        _draw_fit_text(pdf, battery_line, margin, y, usable_width, "Helvetica", 7)

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
    pdf.drawString(margin, margin, created_at.strftime("%Y-%m-%d %H:%M"))
    if info.technical_model:
        pdf.drawRightString(width - margin, margin, info.technical_model)

    pdf.showPage()
    pdf.save()

    qr_path.unlink(missing_ok=True)
    if barcode_path:
        barcode_path.unlink(missing_ok=True)

    return pdf_path


def generate_label_pdf(
    info: IPhoneInfo,
    output_dir: str | Path = "generated_labels",
    label_width_mm: int = LABEL_WIDTH_MM,
    label_height_mm: int = LABEL_HEIGHT_MM,
) -> Path:
    """Generate a 62 mm x 40 mm thermal label PDF and return its path."""

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
