"""Shared helpers for command execution and iPhone label data."""

from __future__ import annotations

from dataclasses import dataclass
import re
import shutil
import subprocess
from typing import Sequence


class AppError(Exception):
    """Base exception for user-facing application errors."""


class CommandNotFoundError(AppError):
    """Raised when a required CLI command is not installed."""


class CommandExecutionError(AppError):
    """Raised when a CLI command exits unsuccessfully or times out."""


@dataclass
class CommandResult:
    stdout: str
    stderr: str
    returncode: int


@dataclass
class IPhoneInfo:
    udid: str = ""
    marketing_model: str = ""
    technical_model: str = ""
    model_number: str = ""
    storage: str = ""
    color: str = ""
    imei: str = ""
    serial_number: str = ""
    device_name: str = ""
    battery_health: str = ""
    battery_cycle_count: str = ""
    model_is_unknown: bool = False
    color_source_note: str = ""
    variant_source_note: str = ""


COMMON_STORAGE_GB = [64, 128, 256, 512, 1024, 2048]


def run_command(command: Sequence[str], timeout: float = 8.0) -> CommandResult:
    """Run a command safely and return captured output.

    The command is passed as an argument list to avoid shell parsing. Exceptions
    are normalized so callers can show clear GUI messages.
    """

    if not command:
        raise CommandExecutionError("No command was provided.")

    executable = command[0]
    if shutil.which(executable) is None:
        raise CommandNotFoundError(
            f"Required command '{executable}' was not found. Install it and try again."
        )

    try:
        completed = subprocess.run(
            list(command),
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise CommandExecutionError(
            f"Command timed out after {timeout:.0f}s: {' '.join(command)}"
        ) from exc
    except OSError as exc:
        raise CommandExecutionError(f"Could not run command '{executable}': {exc}") from exc

    stdout = completed.stdout or ""
    stderr = completed.stderr or ""
    if completed.returncode != 0:
        details = (stderr or stdout or "No output from command.").strip()
        raise CommandExecutionError(
            f"Command failed ({completed.returncode}): {' '.join(command)}\n{details}"
        )

    return CommandResult(stdout=stdout, stderr=stderr, returncode=completed.returncode)


def parse_key_value_output(output: str) -> dict[str, str]:
    """Parse ideviceinfo-style ``Key: Value`` output without assuming validity."""

    values: dict[str, str] = {}
    for raw_line in output.splitlines():
        line = raw_line.strip()
        if not line or ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        if key:
            values[key] = value.strip()
    return values


def first_non_empty(*values: str | None) -> str:
    """Return the first non-empty stripped string."""

    for value in values:
        if value and value.strip():
            return value.strip()
    return ""


def sanitize_filename_part(value: str, fallback: str = "label") -> str:
    """Create a filesystem-safe filename segment."""

    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "_", value.strip())
    cleaned = cleaned.strip("._")
    return cleaned or fallback


def normalize_imei(value: str) -> str:
    """Keep only digits from an IMEI-like value."""

    return re.sub(r"\D+", "", value)


def round_storage_capacity(total_bytes: int | None) -> str:
    """Round byte capacity to a common commercial iPhone storage size."""

    if not total_bytes or total_bytes <= 0:
        return ""

    decimal_gb = total_bytes / 1_000_000_000
    closest = min(COMMON_STORAGE_GB, key=lambda capacity: abs(capacity - decimal_gb))
    if closest >= 1024:
        tb = closest // 1024
        return f"{tb} TB"
    return f"{closest} GB"


def parse_int(value: str | None) -> int | None:
    """Parse a positive integer from a string, returning None on malformed input."""

    if not value:
        return None
    match = re.search(r"\d+", value.replace(",", ""))
    if not match:
        return None
    try:
        return int(match.group(0))
    except ValueError:
        return None
