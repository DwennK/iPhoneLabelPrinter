use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedDevice {
    pub udid: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IPhoneInfo {
    pub udid: String,
    pub marketing_model: String,
    pub technical_model: String,
    pub model_number: String,
    pub storage: String,
    pub color: String,
    pub imei: String,
    pub serial_number: String,
    pub device_name: String,
    pub ios_version: String,
    pub build_version: String,
    pub battery_health: String,
    pub battery_cycle_count: String,
    pub model_is_unknown: bool,
    pub color_source_note: String,
    pub variant_source_note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterInfo {
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelOptions {
    pub label_width_mm: f64,
    pub label_height_mm: f64,
    pub label_orientation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateLabelRequest {
    pub info: IPhoneInfo,
    pub options: LabelOptions,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateLabelResponse {
    pub pdf_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationLabelRequest {
    pub options: LabelOptions,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupLabelsRequest {
    pub retention_days: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupLabelsResponse {
    pub deleted_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintRequest {
    pub printer_name: String,
    pub pdf_path: String,
    pub label_width_mm: f64,
    pub label_height_mm: f64,
    pub orientation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub created_at: String,
    pub printed_at: String,
    pub marketing_model: String,
    pub technical_model: String,
    pub storage: String,
    pub color: String,
    pub imei: String,
    pub serial_number: String,
    pub device_name: String,
    pub ios_version: String,
    pub battery_health: String,
    pub printer_name: String,
    pub pdf_path: String,
    pub label_width_mm: String,
    pub label_height_mm: String,
    pub label_orientation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportHistoryRequest {
    pub destination_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportHistoryResponse {
    pub destination_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentInfo {
    pub project_root: String,
    pub bundled_windows_bin_dir: String,
    pub generated_labels_dir: String,
    pub history_path: String,
}
