use crate::command_runner::{resolve_tool, run_executable, run_tool};
use crate::error::{AppError, AppResult};
use crate::types::{PrintRequest, PrinterInfo};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub fn list_printers() -> AppResult<Vec<PrinterInfo>> {
    if cfg!(windows) {
        list_windows_printers()
    } else {
        list_cups_printers()
    }
}

pub fn print_label(request: &PrintRequest) -> AppResult<String> {
    if request.printer_name.trim().is_empty() {
        return Err(AppError::new(
            "No Printer Selected",
            "No printer is selected. Add or select a printer before printing.",
        ));
    }
    if !Path::new(&request.pdf_path).is_file() {
        return Err(AppError::new(
            "PDF Not Found",
            format!("The label PDF no longer exists:\n{}", request.pdf_path),
        ));
    }

    if cfg!(windows) {
        print_windows(request)
    } else {
        print_cups(request)
    }
}

fn list_cups_printers() -> AppResult<Vec<PrinterInfo>> {
    let printers_output = run_tool("lpstat", &["-p"], Duration::from_secs(6)).map_err(|error| {
        AppError::new(
            "Printer Error",
            format!("Could not list printers: {}", error.message),
        )
    })?;

    let default_name = run_tool("lpstat", &["-d"], Duration::from_secs(4))
        .ok()
        .and_then(|output| {
            output
                .stdout
                .lines()
                .find_map(|line| line.split_once("system default destination:"))
                .map(|(_, name)| name.trim().to_string())
        })
        .unwrap_or_default();

    let mut printers: Vec<PrinterInfo> = printers_output
        .stdout
        .lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            (parts.next()? == "printer").then(|| {
                let name = parts.next()?.to_string();
                Some(PrinterInfo {
                    is_default: name == default_name,
                    name,
                })
            })?
        })
        .collect();
    sort_printers(&mut printers);
    Ok(printers)
}

fn print_cups(request: &PrintRequest) -> AppResult<String> {
    let media = format!(
        "media=Custom.{}x{}mm",
        format_mm(request.label_width_mm),
        format_mm(request.label_height_mm)
    );
    let orientation = if request.orientation == "landscape" {
        "orientation-requested=4"
    } else {
        "orientation-requested=3"
    };
    let scaling = if normalized_scale_mode(&request.print_scale_mode) == "fit" {
        "fit-to-page"
    } else {
        "scaling=100"
    };
    let output = run_tool(
        "lp",
        &[
            "-d",
            &request.printer_name,
            "-o",
            &media,
            "-o",
            orientation,
            "-o",
            scaling,
            &request.pdf_path,
        ],
        Duration::from_secs(12),
    )
    .map_err(|error| {
        AppError::new(
            "Print Failed",
            format!("Could not submit the print job: {}", error.message),
        )
    })?;
    Ok(output.stdout.trim().to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct WindowsPrinter {
    name: String,
    default: bool,
}

fn list_windows_printers() -> AppResult<Vec<PrinterInfo>> {
    let powershell = resolve_tool("powershell")
        .or_else(|| resolve_tool("pwsh"))
        .unwrap_or_else(|| PathBuf::from("powershell"));
    let output = run_executable(
        &powershell,
        &[
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_Printer | Select-Object Name,Default | ConvertTo-Json -Compress",
        ],
        Duration::from_secs(8),
    )
    .map_err(|error| {
        AppError::new(
            "Printer Error",
            format!("Could not list Windows printers: {}", error.message),
        )
    })?;

    let value: serde_json::Value = serde_json::from_str(output.stdout.trim()).map_err(|error| {
        AppError::new(
            "Printer Error",
            format!("Could not parse Windows printer list: {error}"),
        )
    })?;
    let mut printers = Vec::new();
    match value {
        serde_json::Value::Array(items) => {
            for item in items {
                if let Ok(raw) = serde_json::from_value::<WindowsPrinter>(item) {
                    if !raw.name.trim().is_empty() {
                        printers.push(PrinterInfo {
                            name: raw.name,
                            is_default: raw.default,
                        });
                    }
                }
            }
        }
        serde_json::Value::Object(_) => {
            let raw: WindowsPrinter = serde_json::from_value(value).map_err(|error| {
                AppError::new(
                    "Printer Error",
                    format!("Could not parse Windows printer row: {error}"),
                )
            })?;
            if !raw.name.trim().is_empty() {
                printers.push(PrinterInfo {
                    name: raw.name,
                    is_default: raw.default,
                });
            }
        }
        _ => {}
    }
    sort_printers(&mut printers);
    Ok(printers)
}

fn print_windows(request: &PrintRequest) -> AppResult<String> {
    let sumatra = resolve_sumatra().ok_or_else(|| {
        AppError::new(
            "Print Failed",
            "SumatraPDF was not found. Keep assets\\bin\\win32\\SumatraPDF.exe with the app or add SumatraPDF to PATH.",
        )
    })?;
    let orientation = if request.orientation == "landscape" {
        "landscape"
    } else {
        "portrait"
    };
    let paper = format!(
        "paper={}mm x {}mm",
        format_mm(request.label_width_mm),
        format_mm(request.label_height_mm)
    );
    let settings = [
        normalized_scale_mode(&request.print_scale_mode),
        orientation,
        paper.as_str(),
        "ignore-pdf-print-settings",
    ]
    .join(",");
    run_executable(
        &sumatra,
        &[
            "-print-to",
            &request.printer_name,
            "-silent",
            "-print-settings",
            &settings,
            &request.pdf_path,
        ],
        Duration::from_secs(30),
    )
    .map_err(|error| {
        AppError::new(
            "Print Failed",
            format!("SumatraPDF failed: {}", error.message),
        )
    })?;
    Ok(format!("Print job sent to {}.", request.printer_name))
}

fn resolve_sumatra() -> Option<PathBuf> {
    resolve_tool("SumatraPDF").or_else(|| resolve_tool("SumatraPDF.exe"))
}

fn sort_printers(printers: &mut [PrinterInfo]) {
    printers.sort_by(|left, right| {
        right.is_default.cmp(&left.is_default).then_with(|| {
            left.name
                .to_ascii_lowercase()
                .cmp(&right.name.to_ascii_lowercase())
        })
    });
}

fn normalized_scale_mode(value: &str) -> &'static str {
    if value.eq_ignore_ascii_case("fit") {
        "fit"
    } else {
        "noscale"
    }
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
    fn formats_integer_and_decimal_media_sizes() {
        assert_eq!(format_mm(62.0), "62");
        assert_eq!(format_mm(40.5), "40.5");
    }

    #[test]
    fn normalizes_print_scale_modes() {
        assert_eq!(normalized_scale_mode("fit"), "fit");
        assert_eq!(normalized_scale_mode("noscale"), "noscale");
        assert_eq!(normalized_scale_mode("unexpected"), "noscale");
    }
}
