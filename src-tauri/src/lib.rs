mod catalog;
mod command_runner;
mod device;
mod error;
mod history;
mod label;
mod printer;
mod types;

use crate::error::{AppError, AppResult};
use crate::types::{
    CalibrationLabelRequest, CleanupLabelsRequest, CleanupLabelsResponse, ConnectedDevice,
    EnvironmentInfo, ExportHistoryRequest, ExportHistoryResponse, GenerateLabelRequest,
    GenerateLabelResponse, HistoryEntry, IPhoneInfo, PrintRequest, PrinterInfo,
};

async fn blocking<T, F>(work: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| AppError::new("Internal Error", error.to_string()))?
}

#[tauri::command]
async fn scan_devices() -> AppResult<Vec<ConnectedDevice>> {
    blocking(device::detect_devices).await
}

#[tauri::command]
async fn read_device_info(udid: String) -> AppResult<IPhoneInfo> {
    blocking(move || device::read_device_info(&udid)).await
}

#[tauri::command]
fn color_options(product_type: String) -> Vec<String> {
    device::product_color_options(&product_type)
}

#[tauri::command]
async fn list_printers() -> AppResult<Vec<PrinterInfo>> {
    blocking(printer::list_printers).await
}

#[tauri::command]
async fn generate_label(request: GenerateLabelRequest) -> AppResult<GenerateLabelResponse> {
    blocking(move || label::generate_label(&request)).await
}

#[tauri::command]
async fn generate_calibration_label(
    request: CalibrationLabelRequest,
) -> AppResult<GenerateLabelResponse> {
    blocking(move || label::generate_calibration_label(&request)).await
}

#[tauri::command]
async fn cleanup_generated_labels(
    request: CleanupLabelsRequest,
) -> AppResult<CleanupLabelsResponse> {
    blocking(move || label::cleanup_generated_label_pdfs(&request)).await
}

#[tauri::command]
async fn print_label(request: PrintRequest) -> AppResult<String> {
    blocking(move || {
        let message = printer::print_label(&request)?;
        let _ = history::mark_label_printed(
            std::path::Path::new(&request.pdf_path),
            &request.printer_name,
        );
        Ok(message)
    })
    .await
}

#[tauri::command]
async fn read_history() -> AppResult<Vec<HistoryEntry>> {
    blocking(history::read_history).await
}

#[tauri::command]
async fn export_history(request: ExportHistoryRequest) -> AppResult<ExportHistoryResponse> {
    blocking(move || history::export_history(&request)).await
}

#[tauri::command]
fn environment_info() -> EnvironmentInfo {
    EnvironmentInfo {
        project_root: command_runner::project_root().display().to_string(),
        bundled_windows_bin_dir: command_runner::bundled_windows_bin_dir()
            .display()
            .to_string(),
        generated_labels_dir: label::generated_labels_dir().display().to_string(),
        history_path: history::history_path().display().to_string(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            scan_devices,
            read_device_info,
            color_options,
            list_printers,
            generate_label,
            generate_calibration_label,
            cleanup_generated_labels,
            print_label,
            read_history,
            export_history,
            environment_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
