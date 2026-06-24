use crate::command_runner::project_root;
use crate::error::{AppError, AppResult};
use crate::types::{ExportHistoryRequest, ExportHistoryResponse, HistoryEntry, IPhoneInfo};
use chrono::{DateTime, Local};
use std::fs;
use std::path::{Path, PathBuf};

const HISTORY_FIELDS: &[&str] = &[
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
];

pub fn history_path() -> PathBuf {
    project_root().join("label_history.csv")
}

pub fn read_history() -> AppResult<Vec<HistoryEntry>> {
    read_history_from_path(&history_path())
}

pub fn append_generated_entry(
    info: &IPhoneInfo,
    pdf_path: &Path,
    label_width_mm: f64,
    label_height_mm: f64,
    label_orientation: &str,
    created_at: DateTime<Local>,
) -> AppResult<HistoryEntry> {
    let mut entries = read_history_chronological(&history_path())?;
    let entry = HistoryEntry {
        created_at: timestamp(created_at),
        marketing_model: info.marketing_model.clone(),
        technical_model: info.technical_model.clone(),
        storage: info.storage.clone(),
        color: info.color.clone(),
        imei: info.imei.clone(),
        serial_number: info.serial_number.clone(),
        device_name: info.device_name.clone(),
        ios_version: info.ios_version.clone(),
        battery_health: info.battery_health.clone(),
        pdf_path: normalized_path(pdf_path),
        label_width_mm: format_mm(label_width_mm),
        label_height_mm: format_mm(label_height_mm),
        label_orientation: label_orientation.to_string(),
        ..HistoryEntry::default()
    };
    entries.push(entry.clone());
    write_history(&history_path(), &entries)?;
    Ok(entry)
}

pub fn mark_label_printed(pdf_path: &Path, printer_name: &str) -> AppResult<Option<HistoryEntry>> {
    let mut entries = read_history_chronological(&history_path())?;
    let normalized_pdf_path = normalized_path(pdf_path);
    for index in (0..entries.len()).rev() {
        if normalized_path(Path::new(&entries[index].pdf_path)) == normalized_pdf_path {
            entries[index].printed_at = timestamp(Local::now());
            entries[index].printer_name = printer_name.to_string();
            let updated = entries[index].clone();
            write_history(&history_path(), &entries)?;
            return Ok(Some(updated));
        }
    }
    Ok(None)
}

pub fn export_history(request: &ExportHistoryRequest) -> AppResult<ExportHistoryResponse> {
    let destination = request
        .destination_path
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| project_root().join("label_history_export.csv"));
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    let source = history_path();
    if !source.exists() {
        write_history(&source, &[])?;
    }
    fs::copy(&source, &destination).map_err(|error| {
        AppError::new(
            "Export Failed",
            format!("Could not export label history:\n{error}"),
        )
    })?;
    Ok(ExportHistoryResponse {
        destination_path: destination.display().to_string(),
    })
}

fn read_history_from_path(path: &Path) -> AppResult<Vec<HistoryEntry>> {
    let mut entries = read_history_chronological(path)?;
    entries.reverse();
    Ok(entries)
}

fn read_history_chronological(path: &Path) -> AppResult<Vec<HistoryEntry>> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let mut reader = csv::Reader::from_path(path).map_err(|error| {
        AppError::new(
            "History Error",
            format!("Could not read label history:\n{error}"),
        )
    })?;

    let mut entries = Vec::new();
    for row in reader.deserialize::<std::collections::HashMap<String, String>>() {
        let row = row.map_err(|error| {
            AppError::new(
                "History Error",
                format!("Could not parse label history:\n{error}"),
            )
        })?;
        entries.push(entry_from_row(&row));
    }
    Ok(entries)
}

fn write_history(path: &Path, entries: &[HistoryEntry]) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut writer = csv::Writer::from_path(path).map_err(|error| {
        AppError::new(
            "History Error",
            format!("Could not write label history:\n{error}"),
        )
    })?;
    writer.write_record(HISTORY_FIELDS).map_err(|error| {
        AppError::new(
            "History Error",
            format!("Could not write label history header:\n{error}"),
        )
    })?;
    for entry in entries {
        writer.write_record(entry_fields(entry)).map_err(|error| {
            AppError::new(
                "History Error",
                format!("Could not write label history row:\n{error}"),
            )
        })?;
    }
    writer.flush().map_err(|error| {
        AppError::new(
            "History Error",
            format!("Could not flush label history:\n{error}"),
        )
    })?;
    Ok(())
}

fn entry_from_row(row: &std::collections::HashMap<String, String>) -> HistoryEntry {
    let get = |field: &str| row.get(field).cloned().unwrap_or_default();
    HistoryEntry {
        created_at: get(HISTORY_FIELDS[0]),
        printed_at: get(HISTORY_FIELDS[1]),
        marketing_model: get(HISTORY_FIELDS[2]),
        technical_model: get(HISTORY_FIELDS[3]),
        storage: get(HISTORY_FIELDS[4]),
        color: get(HISTORY_FIELDS[5]),
        imei: get(HISTORY_FIELDS[6]),
        serial_number: get(HISTORY_FIELDS[7]),
        device_name: get(HISTORY_FIELDS[8]),
        ios_version: get(HISTORY_FIELDS[9]),
        battery_health: get(HISTORY_FIELDS[10]),
        printer_name: get(HISTORY_FIELDS[11]),
        pdf_path: get(HISTORY_FIELDS[12]),
        label_width_mm: get(HISTORY_FIELDS[13]),
        label_height_mm: get(HISTORY_FIELDS[14]),
        label_orientation: get(HISTORY_FIELDS[15]),
    }
}

fn entry_fields(entry: &HistoryEntry) -> [&str; 16] {
    [
        &entry.created_at,
        &entry.printed_at,
        &entry.marketing_model,
        &entry.technical_model,
        &entry.storage,
        &entry.color,
        &entry.imei,
        &entry.serial_number,
        &entry.device_name,
        &entry.ios_version,
        &entry.battery_health,
        &entry.printer_name,
        &entry.pdf_path,
        &entry.label_width_mm,
        &entry.label_height_mm,
        &entry.label_orientation,
    ]
}

fn timestamp(value: DateTime<Local>) -> String {
    value.format("%Y-%m-%d %H:%M:%S").to_string()
}

fn normalized_path(path: &Path) -> String {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| project_root())
            .join(path)
    };
    absolute
        .canonicalize()
        .unwrap_or(absolute)
        .display()
        .to_string()
}

fn format_mm(value: f64) -> String {
    if (value.fract()).abs() < f64::EPSILON {
        format!("{}", value as i64)
    } else {
        format!("{value:.1}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_mm_matches_python_style() {
        assert_eq!(format_mm(62.0), "62");
        assert_eq!(format_mm(40.5), "40.5");
    }
}
