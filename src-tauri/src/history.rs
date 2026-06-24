use crate::command_runner::project_root;
use crate::error::{AppError, AppResult};
use crate::types::HistoryEntry;
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

fn read_history_from_path(path: &Path) -> AppResult<Vec<HistoryEntry>> {
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
    entries.reverse();
    Ok(entries)
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
