use crate::command_runner::data_root;
use crate::error::{AppError, AppResult};
use crate::history;
use crate::types::{
    CalibrationLabelRequest, CleanupLabelsRequest, CleanupLabelsResponse, GenerateLabelRequest,
    GenerateLabelResponse, IPhoneInfo,
};
use chrono::{DateTime, Local};
use qrcode::{Color, QrCode};
use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

pub const LABEL_WIDTH_MM: f64 = 62.0;
pub const LABEL_HEIGHT_MM: f64 = 40.0;
const LABEL_MARGIN_MM: f64 = 3.0;
const SECONDS_PER_DAY: u64 = 24 * 60 * 60;
const PT_PER_MM: f64 = 72.0 / 25.4;

pub fn generated_labels_dir() -> PathBuf {
    data_root().join("generated_labels")
}

pub fn generate_label(request: &GenerateLabelRequest) -> AppResult<GenerateLabelResponse> {
    let now = Local::now();
    let output_dir = generated_labels_dir();
    fs::create_dir_all(&output_dir)?;

    let name_source = first_non_empty([
        request.info.imei.as_str(),
        request.info.serial_number.as_str(),
        request.info.marketing_model.as_str(),
    ])
    .unwrap_or("label");
    let filename = format!(
        "{}_{}.pdf",
        now.format("%Y%m%d_%H%M%S"),
        sanitize_filename_part(name_source)
    );
    let pdf_path = output_dir.join(filename);
    let label_width_mm = positive_or_default(request.options.label_width_mm, LABEL_WIDTH_MM);
    let label_height_mm = positive_or_default(request.options.label_height_mm, LABEL_HEIGHT_MM);

    write_label_pdf(
        &request.info,
        &pdf_path,
        label_width_mm,
        label_height_mm,
        now,
    )?;
    history::append_generated_entry(
        &request.info,
        &pdf_path,
        label_width_mm,
        label_height_mm,
        &request.options.label_orientation,
        now,
    )?;

    Ok(GenerateLabelResponse {
        pdf_path: pdf_path.display().to_string(),
    })
}

pub fn generate_calibration_label(
    request: &CalibrationLabelRequest,
) -> AppResult<GenerateLabelResponse> {
    let now = Local::now();
    let output_dir = generated_labels_dir();
    fs::create_dir_all(&output_dir)?;
    let pdf_path = output_dir.join(format!("{}_calibration.pdf", now.format("%Y%m%d_%H%M%S")));
    write_calibration_label_pdf(
        &pdf_path,
        positive_or_default(request.options.label_width_mm, LABEL_WIDTH_MM),
        positive_or_default(request.options.label_height_mm, LABEL_HEIGHT_MM),
        now,
    )?;
    Ok(GenerateLabelResponse {
        pdf_path: pdf_path.display().to_string(),
    })
}

pub fn cleanup_generated_label_pdfs(
    request: &CleanupLabelsRequest,
) -> AppResult<CleanupLabelsResponse> {
    if request.retention_days <= 0 {
        return Ok(CleanupLabelsResponse {
            deleted_paths: Vec::new(),
        });
    }

    let output_dir = generated_labels_dir();
    if !output_dir.is_dir() {
        return Ok(CleanupLabelsResponse {
            deleted_paths: Vec::new(),
        });
    }

    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(
            request.retention_days as u64 * SECONDS_PER_DAY,
        ))
        .unwrap_or(SystemTime::UNIX_EPOCH);
    let mut deleted_paths = Vec::new();

    for entry in fs::read_dir(output_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("pdf") {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let Ok(modified) = metadata.modified() else {
            continue;
        };
        if modified >= cutoff {
            continue;
        }
        if fs::remove_file(&path).is_ok() {
            deleted_paths.push(path.display().to_string());
        }
    }

    Ok(CleanupLabelsResponse { deleted_paths })
}

pub fn build_label_qr_data(info: &IPhoneInfo) -> String {
    let imei = normalize_imei(&info.imei);
    let fields = [
        ("IMEI", imei.as_str()),
        ("SN", info.serial_number.trim()),
        ("MODEL", info.marketing_model.trim()),
        ("TECH", info.technical_model.trim()),
        ("STORAGE", info.storage.trim()),
        ("COLOR", info.color.trim()),
        ("BATTERY", info.battery_health.trim()),
        ("OS", info.ios_version.trim()),
    ];
    let lines: Vec<String> = fields
        .iter()
        .filter(|(_, value)| !value.is_empty())
        .map(|(key, value)| format!("{key}: {value}"))
        .collect();
    if lines.is_empty() {
        "Unknown device".to_string()
    } else {
        lines.join("\n")
    }
}

fn write_label_pdf(
    info: &IPhoneInfo,
    pdf_path: &Path,
    label_width_mm: f64,
    label_height_mm: f64,
    created_at: DateTime<Local>,
) -> AppResult<()> {
    if let Some(parent) = pdf_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let width = mm(label_width_mm);
    let height = mm(label_height_mm);
    let margin = mm(LABEL_MARGIN_MM);
    let usable_width = width - (margin * 2.0);
    let mut content = PdfContent::new();
    content.set_fill_black();

    let title = if info.marketing_model.trim().is_empty() {
        "Unknown model"
    } else {
        info.marketing_model.trim()
    };
    let identifier_line = primary_identifier_line(info);
    let detail_line = [info.storage.trim(), info.color.trim()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" - ");
    let ios_line = if info.ios_version.trim().is_empty() {
        String::new()
    } else {
        format!("OS: {}", info.ios_version.trim())
    };

    if height > width {
        let info_line_count = 2
            + usize::from(!info.battery_health.trim().is_empty())
            + usize::from(!ios_line.is_empty());
        let info_line_gap = mm(3.55);
        let mut qr_size = (mm(24.0)).min(usable_width * 0.82);

        let mut y = height - margin - mm(4.2);
        content.draw_fit_text(title, margin, y, usable_width, FontFace::Bold, 13.0, 8.0);
        y -= mm(4.0);
        if !detail_line.is_empty() {
            content.draw_fit_text(
                &detail_line,
                margin,
                y,
                usable_width,
                FontFace::Regular,
                9.0,
                6.0,
            );
            y -= mm(1.0);
        } else {
            y -= mm(0.4);
        }

        let min_qr_y = margin + mm(7.8) + ((info_line_count - 1) as f64 * info_line_gap);
        qr_size = qr_size.min(y - min_qr_y).max(mm(12.0));
        let qr_x = (width - qr_size) / 2.0;
        let qr_y = y - qr_size;
        content.draw_qr(&build_label_qr_data(info), qr_x, qr_y, qr_size)?;

        y = qr_y - mm(2.4);
        content.draw_fit_text(
            &identifier_line,
            margin,
            y,
            usable_width,
            FontFace::Regular,
            8.0,
            6.0,
        );
        if !info.battery_health.trim().is_empty() {
            let battery_line = battery_line(info);
            y -= info_line_gap;
            content.draw_fit_text(
                &battery_line,
                margin,
                y,
                usable_width,
                FontFace::Regular,
                8.0,
                6.0,
            );
        }
        if !ios_line.is_empty() {
            y -= info_line_gap;
            content.draw_fit_text(
                &ios_line,
                margin,
                y,
                usable_width,
                FontFace::Regular,
                8.0,
                6.0,
            );
        }
        y -= info_line_gap;
        content.draw_fit_text(
            &format!("S/N: {}", empty_as_dash(&info.serial_number)),
            margin,
            y,
            usable_width,
            FontFace::Regular,
            8.0,
            6.0,
        );
    } else {
        let qr_size = mm(17.0);
        let qr_x = width - margin - qr_size;
        let qr_y = height - margin - qr_size;
        let text_max_width = usable_width - qr_size - mm(3.0);

        let mut y = height - margin - mm(6.0);
        content.draw_fit_text(title, margin, y, text_max_width, FontFace::Bold, 12.0, 6.0);
        y -= mm(6.0);
        content.draw_fit_text(
            &detail_line,
            margin,
            y,
            text_max_width,
            FontFace::Regular,
            8.0,
            6.0,
        );
        y -= mm(6.0);
        let line_width = if y >= qr_y - mm(1.0) {
            text_max_width
        } else {
            usable_width
        };
        content.draw_fit_text(
            &identifier_line,
            margin,
            y,
            line_width,
            FontFace::Regular,
            7.0,
            6.0,
        );
        if !info.battery_health.trim().is_empty() {
            let battery_line = battery_line(info);
            y -= mm(5.0);
            let line_width = if y >= qr_y - mm(1.0) {
                text_max_width
            } else {
                usable_width
            };
            content.draw_fit_text(
                &battery_line,
                margin,
                y,
                line_width,
                FontFace::Regular,
                7.0,
                6.0,
            );
        }
        if !ios_line.is_empty() {
            y -= mm(5.0);
            let line_width = if y >= qr_y - mm(1.0) {
                text_max_width
            } else {
                usable_width
            };
            content.draw_fit_text(
                &ios_line,
                margin,
                y,
                line_width,
                FontFace::Regular,
                7.0,
                6.0,
            );
        }
        y -= mm(5.0);
        y = y.max(margin + 8.0);
        let line_width = if y >= qr_y - mm(1.0) {
            text_max_width
        } else {
            usable_width
        };
        content.draw_fit_text(
            &format!("S/N: {}", empty_as_dash(&info.serial_number)),
            margin,
            y,
            line_width,
            FontFace::Regular,
            7.0,
            6.0,
        );

        content.draw_qr(&build_label_qr_data(info), qr_x, qr_y, qr_size)?;
    }

    content.draw_text(
        &created_at.format("%d/%m/%Y %H:%M").to_string(),
        margin,
        margin,
        FontFace::Regular,
        5.0,
    );
    if !info.technical_model.trim().is_empty() {
        content.draw_right_text(
            info.technical_model.trim(),
            width - margin,
            margin,
            FontFace::Regular,
            5.0,
        );
    }

    write_pdf(pdf_path, width, height, &content.finish())
}

fn write_calibration_label_pdf(
    pdf_path: &Path,
    label_width_mm: f64,
    label_height_mm: f64,
    created_at: DateTime<Local>,
) -> AppResult<()> {
    if let Some(parent) = pdf_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let width = mm(label_width_mm);
    let height = mm(label_height_mm);
    let margin = mm(LABEL_MARGIN_MM);
    let usable_width = width - (margin * 2.0);
    let usable_height = height - (margin * 2.0);
    let center_x = width / 2.0;
    let center_y = height / 2.0;
    let tick = mm(2.5);

    let mut content = PdfContent::new();
    content.set_fill_black();
    content.set_stroke_black();
    content.set_line_width(0.4);
    content.rect_stroke(margin, margin, usable_width, usable_height);
    content.line(center_x, margin, center_x, height - margin);
    content.line(margin, center_y, width - margin, center_y);

    for (x, y) in [
        (margin, margin),
        (width - margin, margin),
        (margin, height - margin),
        (width - margin, height - margin),
    ] {
        content.line(
            if x > center_x { x - tick } else { x },
            y,
            if x < center_x { x + tick } else { x },
            y,
        );
        content.line(
            x,
            if y > center_y { y - tick } else { y },
            x,
            if y < center_y { y + tick } else { y },
        );
    }

    let mut y = height - margin - mm(5.0);
    content.draw_fit_text(
        "iPhoneLabelPrinter TEST",
        margin + mm(1.0),
        y,
        usable_width - mm(2.0),
        FontFace::Bold,
        10.0,
        6.0,
    );
    y -= mm(5.0);
    content.draw_fit_text(
        &format!(
            "{} x {} mm",
            format_dimension(label_width_mm),
            format_dimension(label_height_mm)
        ),
        margin + mm(1.0),
        y,
        usable_width - mm(2.0),
        FontFace::Regular,
        8.0,
        6.0,
    );
    content.draw_fit_text(
        &created_at.format("%d/%m/%Y %H:%M").to_string(),
        margin + mm(1.0),
        margin + mm(2.0),
        usable_width - mm(2.0),
        FontFace::Regular,
        6.0,
        5.0,
    );

    write_pdf(pdf_path, width, height, &content.finish())
}

#[derive(Debug, Clone, Copy)]
enum FontFace {
    Regular,
    Bold,
}

impl FontFace {
    fn resource_name(self) -> &'static str {
        match self {
            FontFace::Regular => "F1",
            FontFace::Bold => "F2",
        }
    }
}

struct PdfContent {
    body: String,
}

impl PdfContent {
    fn new() -> Self {
        Self {
            body: String::new(),
        }
    }

    fn finish(self) -> String {
        self.body
    }

    fn set_fill_black(&mut self) {
        self.body.push_str("0 0 0 rg\n");
    }

    fn set_stroke_black(&mut self) {
        self.body.push_str("0 0 0 RG\n");
    }

    fn set_line_width(&mut self, width: f64) {
        let _ = writeln!(self.body, "{} w", number(width));
    }

    fn rect_fill(&mut self, x: f64, y: f64, width: f64, height: f64) {
        let _ = writeln!(
            self.body,
            "{} {} {} {} re f",
            number(x),
            number(y),
            number(width),
            number(height)
        );
    }

    fn rect_stroke(&mut self, x: f64, y: f64, width: f64, height: f64) {
        let _ = writeln!(
            self.body,
            "{} {} {} {} re S",
            number(x),
            number(y),
            number(width),
            number(height)
        );
    }

    fn line(&mut self, x1: f64, y1: f64, x2: f64, y2: f64) {
        let _ = writeln!(
            self.body,
            "{} {} m {} {} l S",
            number(x1),
            number(y1),
            number(x2),
            number(y2)
        );
    }

    fn draw_text(&mut self, text: &str, x: f64, y: f64, font: FontFace, size: f64) {
        if text.trim().is_empty() {
            return;
        }
        let _ = writeln!(
            self.body,
            "BT /{} {} Tf {} {} Td ({}) Tj ET",
            font.resource_name(),
            number(size),
            number(x),
            number(y),
            escape_pdf_text(text)
        );
    }

    fn draw_right_text(&mut self, text: &str, right_x: f64, y: f64, font: FontFace, size: f64) {
        let width = estimate_text_width(text, size);
        self.draw_text(text, right_x - width, y, font, size);
    }

    fn draw_fit_text(
        &mut self,
        text: &str,
        x: f64,
        y: f64,
        max_width: f64,
        font: FontFace,
        font_size: f64,
        min_size: f64,
    ) {
        let mut text = text.trim().to_string();
        if text.is_empty() {
            return;
        }
        let mut size = font_size;
        while size > min_size && estimate_text_width(&text, size) > max_width {
            size -= 1.0;
        }
        if estimate_text_width(&text, size) > max_width {
            let ellipsis = "...";
            while !text.is_empty()
                && estimate_text_width(&format!("{text}{ellipsis}"), size) > max_width
            {
                text.pop();
                text = text.trim_end().to_string();
            }
            if text.is_empty() {
                if estimate_text_width(ellipsis, size) <= max_width {
                    text = ellipsis.to_string();
                }
            } else {
                text.push_str(ellipsis);
            }
        }
        self.draw_text(&text, x, y, font, size);
    }

    fn draw_qr(&mut self, data: &str, x: f64, y: f64, size: f64) -> AppResult<()> {
        let code = QrCode::new(data.as_bytes()).map_err(|error| {
            AppError::new(
                "Label Generation Failed",
                format!("Could not create QR code: {error}"),
            )
        })?;
        let module_count = code.width();
        if module_count == 0 {
            return Ok(());
        }
        let module_size = size / module_count as f64;
        for row in 0..module_count {
            for col in 0..module_count {
                if code[(col, row)] == Color::Dark {
                    let module_x = x + (col as f64 * module_size);
                    let module_y = y + size - ((row + 1) as f64 * module_size);
                    self.rect_fill(module_x, module_y, module_size, module_size);
                }
            }
        }
        Ok(())
    }
}

fn write_pdf(path: &Path, width: f64, height: f64, content: &str) -> AppResult<()> {
    let content_bytes = content.as_bytes();
    let objects = vec![
        "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
        format!(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {} {}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>",
            number(width),
            number(height)
        ),
        format!(
            "<< /Length {} >>\nstream\n{}endstream",
            content_bytes.len(),
            content
        ),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string(),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>".to_string(),
    ];

    let mut pdf = Vec::<u8>::new();
    pdf.extend_from_slice(b"%PDF-1.4\n");
    let mut offsets = Vec::with_capacity(objects.len());
    for (idx, object) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", idx + 1, object).as_bytes());
    }

    let xref_offset = pdf.len();
    pdf.extend_from_slice(format!("xref\n0 {}\n", objects.len() + 1).as_bytes());
    pdf.extend_from_slice(b"0000000000 65535 f \n");
    for offset in offsets {
        pdf.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    pdf.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n",
            objects.len() + 1,
            xref_offset
        )
        .as_bytes(),
    );

    fs::write(path, pdf)?;
    Ok(())
}

fn primary_identifier_line(info: &IPhoneInfo) -> String {
    let imei = normalize_imei(&info.imei);
    if !imei.is_empty() {
        return format!("IMEI: {imei}");
    }
    if !info.serial_number.trim().is_empty() {
        return format!("Serial: {}", info.serial_number.trim());
    }
    "ID: Manual entry needed".to_string()
}

fn battery_line(info: &IPhoneInfo) -> String {
    let mut line = format!("Battery: {}", info.battery_health.trim());
    if !info.battery_cycle_count.trim().is_empty()
        && !info.battery_health.to_ascii_lowercase().contains("cycle")
    {
        line.push_str(&format!(" - {} cycles", info.battery_cycle_count.trim()));
    }
    line
}

fn empty_as_dash(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        "-".to_string()
    } else {
        trimmed.to_string()
    }
}

fn mm(value: f64) -> f64 {
    value * PT_PER_MM
}

fn positive_or_default(value: f64, default: f64) -> f64 {
    if value.is_finite() && value > 0.0 {
        value
    } else {
        default
    }
}

fn number(value: f64) -> String {
    let rounded = (value * 1000.0).round() / 1000.0;
    if (rounded.fract()).abs() < f64::EPSILON {
        format!("{}", rounded as i64)
    } else {
        format!("{rounded:.3}")
            .trim_end_matches('0')
            .trim_end_matches('.')
            .to_string()
    }
}

fn format_dimension(value: f64) -> String {
    if (value.fract()).abs() < f64::EPSILON {
        format!("{}", value as i64)
    } else {
        format!("{value:.1}")
    }
}

fn estimate_text_width(text: &str, font_size: f64) -> f64 {
    text.chars()
        .map(|ch| match ch {
            ' ' => 0.28,
            'i' | 'l' | 'I' | '|' | '.' | ',' | ':' | ';' | '!' => 0.25,
            'm' | 'w' | 'M' | 'W' => 0.82,
            'A'..='Z' => 0.62,
            '0'..='9' => 0.55,
            '-' | '/' | '(' | ')' => 0.32,
            _ => 0.52,
        })
        .sum::<f64>()
        * font_size
}

fn escape_pdf_text(text: &str) -> String {
    text.chars()
        .map(|ch| match ch {
            '(' => "\\(".to_string(),
            ')' => "\\)".to_string(),
            '\\' => "\\\\".to_string(),
            '\r' | '\n' => " ".to_string(),
            ch if ch.is_ascii() => ch.to_string(),
            _ => "?".to_string(),
        })
        .collect()
}

fn normalize_imei(value: &str) -> String {
    value.chars().filter(|ch| ch.is_ascii_digit()).collect()
}

fn sanitize_filename_part(value: &str) -> String {
    let mut cleaned = String::new();
    let mut previous_was_separator = false;
    for ch in value.trim().chars() {
        if ch.is_ascii_alphanumeric() || ch == '.' || ch == '-' {
            cleaned.push(ch);
            previous_was_separator = false;
        } else if !previous_was_separator {
            cleaned.push('_');
            previous_was_separator = true;
        }
    }
    let cleaned = cleaned.trim_matches(['.', '_']);
    if cleaned.is_empty() {
        "label".to_string()
    } else {
        cleaned.to_string()
    }
}

fn first_non_empty<'a>(values: impl IntoIterator<Item = &'a str>) -> Option<&'a str> {
    values.into_iter().find(|value| !value.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qr_payload_matches_existing_field_style() {
        let payload = build_label_qr_data(&IPhoneInfo {
            marketing_model: "iPhone 15".to_string(),
            technical_model: "iPhone15,4".to_string(),
            storage: "128 GB".to_string(),
            color: "Blue".to_string(),
            imei: "35 502642 9560655".to_string(),
            serial_number: "ABC123".to_string(),
            ios_version: "18.5".to_string(),
            battery_health: "86% (412 cycles)".to_string(),
            ..IPhoneInfo::default()
        });
        assert!(payload.contains("IMEI: 355026429560655"));
        assert!(payload.contains("SN: ABC123"));
        assert!(payload.contains("MODEL: iPhone 15"));
        assert!(payload.contains("BATTERY: 86% (412 cycles)"));
    }

    #[test]
    fn filename_sanitizer_has_fallback() {
        assert_eq!(
            sanitize_filename_part(" iPhone 15 / Blue "),
            "iPhone_15_Blue"
        );
        assert_eq!(sanitize_filename_part("///"), "label");
    }

    #[test]
    fn writes_pdf_header_for_label() {
        let dir = std::env::temp_dir().join(format!("iphone_label_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("label.pdf");
        write_label_pdf(
            &IPhoneInfo {
                marketing_model: "iPhone 15".to_string(),
                storage: "128 GB".to_string(),
                color: "Blue".to_string(),
                imei: "355026429560655".to_string(),
                serial_number: "ABC123".to_string(),
                ..IPhoneInfo::default()
            },
            &path,
            LABEL_WIDTH_MM,
            LABEL_HEIGHT_MM,
            Local::now(),
        )
        .unwrap();
        assert_eq!(&fs::read(&path).unwrap()[..4], b"%PDF");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn writes_preview_pdf_when_requested() {
        let Ok(path) = std::env::var("IPHONE_LABEL_PREVIEW_PDF") else {
            return;
        };
        write_label_pdf(
            &IPhoneInfo {
                marketing_model: "iPhone 17".to_string(),
                technical_model: "iPhone18,3".to_string(),
                storage: "256 GB".to_string(),
                color: "White".to_string(),
                imei: "355026429560655".to_string(),
                serial_number: "ABC123456".to_string(),
                ios_version: "18.5".to_string(),
                battery_health: "86% (412 cycles)".to_string(),
                ..IPhoneInfo::default()
            },
            Path::new(&path),
            LABEL_WIDTH_MM,
            LABEL_HEIGHT_MM,
            Local::now(),
        )
        .unwrap();
    }
}
