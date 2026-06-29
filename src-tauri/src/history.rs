use crate::command_runner::data_root;
use crate::error::{AppError, AppResult};
use crate::types::{ExportHistoryRequest, ExportHistoryResponse, HistoryEntry, IPhoneInfo};
use chrono::{DateTime, Duration, Local};
use std::fs::{self, File};
use std::path::{Path, PathBuf};

const HISTORY_FIELDS: &[&str] = &[
    "label_id",
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
    "print_scale_mode",
];

pub fn history_path() -> PathBuf {
    data_root().join("label_history.csv")
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
    print_scale_mode: &str,
    created_at: DateTime<Local>,
) -> AppResult<HistoryEntry> {
    let mut entries = read_history_chronological(&history_path())?;
    let entry = HistoryEntry {
        label_id: label_id(created_at),
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
        print_scale_mode: print_scale_mode.to_string(),
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
        .unwrap_or_else(|| data_root().join("label_history_export.csv"));
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

pub fn cleanup_history(retention_days: i64) -> AppResult<usize> {
    cleanup_history_at_path(&history_path(), retention_days)
}

fn cleanup_history_at_path(path: &Path, retention_days: i64) -> AppResult<usize> {
    if retention_days <= 0 {
        return Ok(0);
    }
    let entries = read_history_chronological(path)?;
    let cutoff = timestamp(Local::now() - Duration::days(retention_days));
    let original_count = entries.len();
    let retained: Vec<HistoryEntry> = entries
        .into_iter()
        .filter(|entry| entry.created_at.is_empty() || entry.created_at.as_str() >= cutoff.as_str())
        .collect();
    let deleted_count = original_count.saturating_sub(retained.len());
    if deleted_count > 0 {
        write_history(path, &retained)?;
    }
    Ok(deleted_count)
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
    let temp_path = temp_history_path(path);
    let file = File::create(&temp_path).map_err(|error| {
        AppError::new(
            "History Error",
            format!("Could not write label history:\n{error}"),
        )
    })?;
    let mut writer = csv::Writer::from_writer(file);
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
    let file = writer.into_inner().map_err(|error| {
        AppError::new(
            "History Error",
            format!("Could not finish label history write:\n{error}"),
        )
    })?;
    file.sync_all().map_err(|error| {
        AppError::new(
            "History Error",
            format!("Could not sync label history:\n{error}"),
        )
    })?;
    drop(file);
    replace_history_file(path, &temp_path)?;
    Ok(())
}

fn entry_from_row(row: &std::collections::HashMap<String, String>) -> HistoryEntry {
    let get = |field: &str| row.get(field).cloned().unwrap_or_default();
    let created_at = get("created_at");
    let pdf_path = get("pdf_path");
    let label_id = get("label_id");
    HistoryEntry {
        label_id: if label_id.is_empty() {
            legacy_label_id(&created_at, &pdf_path)
        } else {
            label_id
        },
        created_at,
        printed_at: get("printed_at"),
        marketing_model: get("marketing_model"),
        technical_model: get("technical_model"),
        storage: get("storage"),
        color: get("color"),
        imei: get("imei"),
        serial_number: get("serial_number"),
        device_name: get("device_name"),
        ios_version: get("ios_version"),
        battery_health: get("battery_health"),
        printer_name: get("printer_name"),
        pdf_path,
        label_width_mm: get("label_width_mm"),
        label_height_mm: get("label_height_mm"),
        label_orientation: get("label_orientation"),
        print_scale_mode: get("print_scale_mode"),
    }
}

fn entry_fields(entry: &HistoryEntry) -> [&str; 18] {
    [
        &entry.label_id,
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
        &entry.print_scale_mode,
    ]
}

fn temp_history_path(path: &Path) -> PathBuf {
    path.with_file_name(format!(
        "{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("label_history.csv")
    ))
}

fn backup_history_path(path: &Path) -> PathBuf {
    path.with_file_name(format!(
        "{}.bak",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("label_history.csv")
    ))
}

fn replace_history_file(path: &Path, temp_path: &Path) -> AppResult<()> {
    if path.exists() {
        fs::copy(path, backup_history_path(path)).map_err(|error| {
            AppError::new(
                "History Error",
                format!("Could not back up existing label history:\n{error}"),
            )
        })?;
    }

    #[cfg(windows)]
    if path.exists() {
        fs::remove_file(path).map_err(|error| {
            AppError::new(
                "History Error",
                format!("Could not replace existing label history:\n{error}"),
            )
        })?;
    }

    fs::rename(temp_path, path).map_err(|error| {
        AppError::new(
            "History Error",
            format!("Could not replace label history:\n{error}"),
        )
    })?;
    Ok(())
}

fn timestamp(value: DateTime<Local>) -> String {
    value.format("%Y-%m-%d %H:%M:%S").to_string()
}

fn label_id(value: DateTime<Local>) -> String {
    format!("lbl-{}", value.timestamp_millis())
}

fn legacy_label_id(created_at: &str, pdf_path: &str) -> String {
    let raw = if !pdf_path.trim().is_empty() {
        pdf_path
    } else if !created_at.trim().is_empty() {
        created_at
    } else {
        "unknown"
    };
    format!("legacy-{}", sanitize_history_id(raw))
}

fn sanitize_history_id(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .filter_map(|character| {
            if character.is_ascii_alphanumeric() {
                Some(character.to_ascii_lowercase())
            } else if matches!(character, '-' | '_' | '.') {
                Some(character)
            } else {
                None
            }
        })
        .take(48)
        .collect();
    if sanitized.is_empty() {
        "unknown".to_string()
    } else {
        sanitized
    }
}

fn normalized_path(path: &Path) -> String {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| data_root())
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
    fn format_mm_omits_trailing_decimal_for_whole_numbers() {
        assert_eq!(format_mm(62.0), "62");
        assert_eq!(format_mm(40.5), "40.5");
    }

    #[test]
    fn reads_legacy_history_and_writes_backup() {
        let dir = std::env::temp_dir().join(format!("iphone_history_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("label_history.csv");
        fs::write(
            &path,
            "created_at,printed_at,marketing_model,technical_model,storage,color,imei,serial_number,device_name,ios_version,battery_health,printer_name,pdf_path,label_width_mm,label_height_mm,label_orientation\n2026-01-01 10:00:00,,iPhone 15,\"iPhone15,4\",128 GB,Blue,355026429560655,ABC123,Desk iPhone,18.5,86%,,/tmp/label.pdf,62,40,landscape\n",
        )
        .unwrap();

        let mut entries = read_history_chronological(&path).unwrap();
        assert_eq!(entries.len(), 1);
        assert!(entries[0].label_id.starts_with("legacy-"));
        assert_eq!(entries[0].print_scale_mode, "");
        entries[0].print_scale_mode = "noscale".to_string();
        write_history(&path, &entries).unwrap();

        assert!(backup_history_path(&path).is_file());
        let rewritten = fs::read_to_string(&path).unwrap();
        assert!(rewritten.contains("print_scale_mode"));
        assert!(rewritten.contains("label_id"));
        assert!(rewritten.contains("noscale"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn cleanup_history_removes_old_rows() {
        let dir = std::env::temp_dir().join(format!(
            "iphone_history_cleanup_test_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("label_history.csv");
        let entries = vec![
            HistoryEntry {
                label_id: "old".to_string(),
                created_at: "2020-01-01 10:00:00".to_string(),
                ..HistoryEntry::default()
            },
            HistoryEntry {
                label_id: "new".to_string(),
                created_at: timestamp(Local::now()),
                ..HistoryEntry::default()
            },
        ];
        write_history(&path, &entries).unwrap();
        let deleted = cleanup_history_at_path(&path, 30).unwrap();
        assert_eq!(deleted, 1);
        let retained = read_history_chronological(&path).unwrap();
        assert_eq!(retained.len(), 1);
        assert_eq!(retained[0].label_id, "new");
        let _ = fs::remove_dir_all(dir);
    }
}
