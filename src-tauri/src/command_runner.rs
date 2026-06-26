use crate::error::{AppError, AppResult};
use std::env;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const APP_DATA_DIR_NAME: &str = "iPhoneLabelPrinter";

#[derive(Debug, Clone)]
pub struct CommandOutput {
    pub stdout: String,
}

pub fn project_root() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or(manifest_dir)
}

pub fn bundled_windows_bin_dir() -> PathBuf {
    project_root().join("assets").join("bin").join("win32")
}

pub fn bundled_macos_bin_dir() -> PathBuf {
    project_root()
        .join("assets")
        .join("bin")
        .join(macos_bin_dir_name())
}

pub fn data_root() -> PathBuf {
    if let Some(override_dir) = env::var_os("IPHONE_LABEL_PRINTER_DATA_DIR") {
        return PathBuf::from(override_dir);
    }
    if cfg!(debug_assertions) {
        return project_root();
    }
    platform_data_root().unwrap_or_else(project_root)
}

pub fn resolve_tool(name: &str) -> Option<PathBuf> {
    let suffix = if cfg!(windows) && !name.to_ascii_lowercase().ends_with(".exe") {
        ".exe"
    } else {
        ""
    };
    let filename = format!("{name}{suffix}");
    for dir in bundled_tool_dirs() {
        let candidate = dir.join(&filename);
        if is_executable_candidate(&candidate) {
            return Some(candidate);
        }
    }

    find_on_path(name)
}

pub fn run_tool(name: &str, args: &[&str], timeout: Duration) -> AppResult<CommandOutput> {
    let executable = resolve_tool(name)
        .ok_or_else(|| AppError::new("Missing Dependency", missing_dependency_message(name)))?;
    run_executable(&executable, args, timeout)
}

pub fn run_executable(
    executable: &Path,
    args: &[&str],
    timeout: Duration,
) -> AppResult<CommandOutput> {
    let mut command = Command::new(executable);
    command.args(args);
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    let mut child = command.spawn().map_err(|error| {
        AppError::new(
            "Command Failed",
            format!("Could not run '{}': {error}", executable.display()),
        )
    })?;

    let start = Instant::now();
    loop {
        if child.try_wait()?.is_some() {
            break;
        }
        if start.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(AppError::new(
                "Command Timed Out",
                format!(
                    "Command timed out after {:.0}s: {} {}",
                    timeout.as_secs_f64(),
                    executable.display(),
                    args.join(" ")
                ),
            ));
        }
        thread::sleep(Duration::from_millis(40));
    }

    let output = child.wait_with_output()?;
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();

    if !output.status.success() {
        let details = first_non_empty([stderr.as_str(), stdout.as_str()])
            .unwrap_or("No output from command.");
        return Err(AppError::new(
            "Command Failed",
            format!(
                "Command failed ({}): {} {}\n{}",
                output.status.code().unwrap_or(-1),
                executable.display(),
                args.join(" "),
                details.trim()
            ),
        ));
    }

    Ok(CommandOutput { stdout })
}

fn bundled_tool_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![bundled_platform_bin_dir()];

    if let Ok(cwd) = env::current_dir() {
        dirs.push(cwd.join("assets").join("bin").join(platform_bin_dir_name()));
    }

    if let Ok(exe) = env::current_exe() {
        if let Some(parent) = exe.parent() {
            dirs.push(
                parent
                    .join("assets")
                    .join("bin")
                    .join(platform_bin_dir_name()),
            );
            dirs.push(
                parent
                    .join("..")
                    .join("Resources")
                    .join("assets")
                    .join("bin")
                    .join(platform_bin_dir_name()),
            );
            dirs.push(
                parent
                    .join("..")
                    .join("Resources")
                    .join("_up_")
                    .join("assets")
                    .join("bin")
                    .join(platform_bin_dir_name()),
            );
            dirs.push(
                parent
                    .join("resources")
                    .join("assets")
                    .join("bin")
                    .join(platform_bin_dir_name()),
            );
            dirs.push(
                parent
                    .join("resources")
                    .join("_up_")
                    .join("assets")
                    .join("bin")
                    .join(platform_bin_dir_name()),
            );
        }
    }

    dirs
}

fn bundled_platform_bin_dir() -> PathBuf {
    project_root()
        .join("assets")
        .join("bin")
        .join(platform_bin_dir_name())
}

fn platform_bin_dir_name() -> &'static str {
    if cfg!(windows) {
        "win32"
    } else if cfg!(target_os = "macos") {
        macos_bin_dir_name()
    } else {
        "linux"
    }
}

fn macos_bin_dir_name() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "macos-arm64"
    } else {
        "macos-x64"
    }
}

fn find_on_path(name: &str) -> Option<PathBuf> {
    let has_separator = name.contains(std::path::MAIN_SEPARATOR);
    if has_separator {
        let candidate = PathBuf::from(name);
        return candidate.is_file().then_some(candidate);
    }

    let mut filenames = vec![name.to_string()];
    if cfg!(windows) && !name.to_ascii_lowercase().ends_with(".exe") {
        filenames.push(format!("{name}.exe"));
    }

    for dir in candidate_path_dirs() {
        for filename in &filenames {
            let candidate = dir.join(filename);
            if is_executable_candidate(&candidate) {
                return Some(candidate);
            }
        }
    }

    None
}

fn candidate_path_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = env::var_os("PATH")
        .map(|path| env::split_paths(&path).collect())
        .unwrap_or_default();

    for fallback in platform_fallback_tool_dirs() {
        let fallback_path = PathBuf::from(fallback);
        if !dirs.iter().any(|dir| dir == &fallback_path) {
            dirs.push(fallback_path);
        }
    }

    dirs
}

#[cfg(target_os = "macos")]
fn platform_fallback_tool_dirs() -> &'static [&'static str] {
    &["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]
}

#[cfg(all(unix, not(target_os = "macos")))]
fn platform_fallback_tool_dirs() -> &'static [&'static str] {
    &["/usr/local/bin", "/usr/bin", "/bin"]
}

#[cfg(windows)]
fn platform_fallback_tool_dirs() -> &'static [&'static str] {
    &[]
}

fn missing_dependency_message(name: &str) -> String {
    if matches!(name, "idevice_id" | "ideviceinfo" | "idevicediagnostics") {
        let install_hint = if cfg!(target_os = "macos") {
            "\n\nInstall it with Homebrew:\nbrew install libimobiledevice"
        } else if cfg!(target_os = "linux") {
            "\n\nInstall the libimobiledevice package for this Linux distribution."
        } else {
            ""
        };
        return format!(
            "Required command '{name}' was not found. The app needs libimobiledevice to scan iPhones and iPads.{install_hint}"
        );
    }

    format!("Required command '{name}' was not found. Install it and try again.")
}

fn platform_data_root() -> Option<PathBuf> {
    if cfg!(windows) {
        return env::var_os("APPDATA")
            .map(PathBuf::from)
            .map(|path| path.join(APP_DATA_DIR_NAME));
    }

    if cfg!(target_os = "macos") {
        return env::var_os("HOME").map(PathBuf::from).map(|path| {
            path.join("Library")
                .join("Application Support")
                .join(APP_DATA_DIR_NAME)
        });
    }

    env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            env::var_os("HOME")
                .map(PathBuf::from)
                .map(|path| path.join(".local").join("share"))
        })
        .map(|path| path.join(APP_DATA_DIR_NAME))
}

fn is_executable_candidate(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    if cfg!(windows) {
        return true;
    }

    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

fn first_non_empty<'a>(values: impl IntoIterator<Item = &'a str>) -> Option<&'a str> {
    values.into_iter().find(|value| !value.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_root_points_at_repository_root() {
        assert!(project_root().join("README.md").is_file());
    }

    #[test]
    fn bundled_windows_bin_dir_matches_existing_layout() {
        assert!(bundled_windows_bin_dir()
            .join("idevice_id.exe")
            .to_string_lossy()
            .contains("assets"));
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    #[test]
    fn bundled_macos_bin_dir_matches_existing_layout() {
        let expected = bundled_macos_bin_dir().join("idevice_id");
        assert!(expected.is_file());
        assert_eq!(
            resolve_tool("idevice_id").as_deref(),
            Some(expected.as_path())
        );
    }

    #[test]
    fn libimobiledevice_missing_dependency_message_names_package() {
        let message = missing_dependency_message("idevice_id");
        assert!(message.contains("libimobiledevice"));
        assert!(message.contains("idevice_id"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_fallback_tool_dirs_include_homebrew_bins() {
        let dirs = candidate_path_dirs();
        assert!(dirs.iter().any(|dir| dir == Path::new("/opt/homebrew/bin")));
        assert!(dirs.iter().any(|dir| dir == Path::new("/usr/local/bin")));
    }
}
