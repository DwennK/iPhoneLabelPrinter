use crate::command_runner::{project_root, python_bridge_path};
use crate::error::{AppError, AppResult};
use crate::types::{GenerateLabelRequest, GenerateLabelResponse};
use serde::Deserialize;
use serde_json::json;
use std::env;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

#[derive(Debug, Clone)]
struct PythonCandidate {
    executable: PathBuf,
    args: Vec<String>,
}

pub fn generate_label(request: &GenerateLabelRequest) -> AppResult<GenerateLabelResponse> {
    let payload = serde_json::to_value(request).map_err(|error| {
        AppError::new(
            "Label Generation Failed",
            format!("Could not serialize label request: {error}"),
        )
    })?;
    run_bridge("generate-label", &payload)
}

pub fn mark_label_printed(pdf_path: &str, printer_name: &str) -> AppResult<()> {
    let payload = json!({
        "pdfPath": pdf_path,
        "printerName": printer_name,
    });
    let _: BridgeOk = run_bridge("mark-printed", &payload)?;
    Ok(())
}

fn run_bridge<T: for<'de> Deserialize<'de>>(
    action: &str,
    payload: &serde_json::Value,
) -> AppResult<T> {
    let script = python_bridge_path();
    if !script.is_file() {
        return Err(AppError::new(
            "Python Bridge Missing",
            format!(
                "Could not find the temporary Python bridge at {}",
                script.display()
            ),
        ));
    }

    let input = serde_json::to_vec(payload).map_err(|error| {
        AppError::new(
            "Python Bridge Failed",
            format!("Could not encode bridge request: {error}"),
        )
    })?;

    let mut spawn_errors = Vec::new();
    for candidate in python_candidates() {
        let mut command = Command::new(&candidate.executable);
        command.args(&candidate.args);
        command.arg(&script);
        command.arg(action);
        let bridge_cwd = script
            .parent()
            .map(std::path::Path::to_path_buf)
            .unwrap_or_else(project_root);
        command.current_dir(&bridge_cwd);
        command.stdin(Stdio::piped());
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                spawn_errors.push(format!("{}: {error}", candidate.executable.display()));
                continue;
            }
        };

        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(&input).map_err(|error| {
                AppError::new(
                    "Python Bridge Failed",
                    format!("Could not write bridge request: {error}"),
                )
            })?;
        }

        let output = child.wait_with_output().map_err(|error| {
            AppError::new(
                "Python Bridge Failed",
                format!("Could not read bridge response: {error}"),
            )
        })?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        if !output.status.success() {
            return Err(AppError::new(
                "Python Bridge Failed",
                format!(
                    "The temporary Python bridge failed. Ensure the existing Python environment is installed with requirements.txt.\n\n{}",
                    first_non_empty([stderr.as_ref(), stdout.as_ref()])
                        .unwrap_or("No output from Python.")
                        .trim()
                ),
            ));
        }

        return serde_json::from_slice(&output.stdout).map_err(|error| {
            AppError::new(
                "Python Bridge Failed",
                format!("Could not parse bridge response: {error}\n\n{stdout}"),
            )
        });
    }

    Err(AppError::new(
        "Python Not Found",
        format!(
            "Could not start Python for the temporary label bridge. Set IPHONE_LABEL_PRINTER_PYTHON or create the existing .venv.\n\n{}",
            spawn_errors.join("\n")
        ),
    ))
}

fn python_candidates() -> Vec<PythonCandidate> {
    let root = project_root();
    let mut candidates = Vec::new();

    if let Ok(explicit) = env::var("IPHONE_LABEL_PRINTER_PYTHON") {
        if !explicit.trim().is_empty() {
            candidates.push(PythonCandidate {
                executable: PathBuf::from(explicit),
                args: Vec::new(),
            });
        }
    }

    if cfg!(windows) {
        candidates.push(PythonCandidate {
            executable: root.join(".venv").join("Scripts").join("python.exe"),
            args: Vec::new(),
        });
        candidates.push(PythonCandidate {
            executable: PathBuf::from("py"),
            args: vec!["-3.12".to_string()],
        });
        candidates.push(PythonCandidate {
            executable: PathBuf::from("python"),
            args: Vec::new(),
        });
    } else {
        candidates.push(PythonCandidate {
            executable: root.join(".venv").join("bin").join("python"),
            args: Vec::new(),
        });
        candidates.push(PythonCandidate {
            executable: PathBuf::from("python3"),
            args: Vec::new(),
        });
        candidates.push(PythonCandidate {
            executable: PathBuf::from("python"),
            args: Vec::new(),
        });
    }

    candidates
}

#[derive(Debug, Deserialize)]
struct BridgeOk {
    #[allow(dead_code)]
    ok: bool,
}

fn first_non_empty<'a>(values: impl IntoIterator<Item = &'a str>) -> Option<&'a str> {
    values.into_iter().find(|value| !value.trim().is_empty())
}
