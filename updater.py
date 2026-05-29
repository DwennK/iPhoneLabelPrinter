"""GitHub Releases auto-updater (Qt-free core logic).

Responsibilities, kept independent of the GUI so they can be unit-tested:

- ``check_for_update()``  : ask the GitHub Releases API whether a newer version
  exists. Always fail-open (returns ``None`` on any network/parse error or when
  no release is published yet) so the app never refuses to start offline.
- ``download_asset()``    : stream a release asset to disk with progress.
- ``apply_update_and_restart()`` : swap the running executable for the freshly
  downloaded one and relaunch (Windows, packaged build only).

The GUI layer (``app.py``) drives these on a worker thread and shows the
notify/confirm dialog.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import json
import os
import subprocess
import sys
import tempfile
from typing import Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from version import GITHUB_REPO, __version__


_API_LATEST_RELEASE = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
_USER_AGENT = "iPhoneLabelPrinter-updater"
_DETACHED_PROCESS = 0x00000008
_CREATE_NO_WINDOW = 0x08000000
_DOWNLOAD_CHUNK = 64 * 1024

ProgressCallback = Callable[[int, int], None]


@dataclass(frozen=True)
class ReleaseInfo:
    """A GitHub release that is newer than the running version."""

    version: str
    tag: str
    asset_name: str
    asset_url: str
    html_url: str
    notes: str


class UpdateError(Exception):
    """Raised when downloading or applying an update fails."""


def is_frozen() -> bool:
    """True when running inside a PyInstaller (or similar) bundle."""

    return bool(getattr(sys, "frozen", False))


def current_executable_path() -> Path:
    """Absolute path of the running executable (only meaningful when frozen)."""

    return Path(sys.executable).resolve()


def parse_version(value: str) -> tuple[int, ...]:
    """Parse ``v1.2.3`` / ``1.2`` into a comparable integer tuple.

    Unparseable segments are treated as 0 so a malformed tag never crashes the
    comparison; it simply sorts low.
    """

    cleaned = value.strip().lstrip("vV")
    parts = cleaned.split(".")
    numbers: list[int] = []
    for part in parts:
        digits = "".join(ch for ch in part if ch.isdigit())
        numbers.append(int(digits) if digits else 0)
    return tuple(numbers) or (0,)


def is_newer(candidate: str, current: str = __version__) -> bool:
    """Return True when ``candidate`` is a strictly newer version than ``current``."""

    return parse_version(candidate) > parse_version(current)


def _request_json(url: str, timeout: float) -> dict:
    request = Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": _USER_AGENT,
        },
    )
    with urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _select_asset(assets: list[dict]) -> tuple[str, str]:
    """Pick the best downloadable asset for the current platform.

    Windows self-update expects a single ``.exe``. Falls back to the first
    ``.zip`` (onedir build) and finally to the first asset of any kind.
    """

    def by_suffix(suffix: str) -> tuple[str, str] | None:
        for asset in assets:
            name = asset.get("name", "")
            url = asset.get("browser_download_url", "")
            if name.lower().endswith(suffix) and url:
                return name, url
        return None

    if sys.platform == "win32":
        match = by_suffix(".exe") or by_suffix(".zip")
    else:
        match = by_suffix(".zip") or by_suffix(".dmg")
    if match:
        return match

    for asset in assets:
        url = asset.get("browser_download_url", "")
        if url:
            return asset.get("name", "download"), url
    return "", ""


def check_for_update(timeout: float = 5.0) -> ReleaseInfo | None:
    """Return a ReleaseInfo if a newer published release exists, else None.

    Fail-open by design: any network error, missing release (HTTP 404), or
    malformed payload returns None so startup is never blocked.
    """

    try:
        payload = _request_json(_API_LATEST_RELEASE, timeout=timeout)
    except HTTPError as exc:
        if exc.code == 404:  # no published (non-draft, non-prerelease) release
            return None
        return None
    except (URLError, TimeoutError, ValueError, OSError):
        return None

    tag = str(payload.get("tag_name") or "").strip()
    if not tag or not is_newer(tag):
        return None

    asset_name, asset_url = _select_asset(payload.get("assets") or [])
    if not asset_url:
        return None

    return ReleaseInfo(
        version=tag.lstrip("vV"),
        tag=tag,
        asset_name=asset_name,
        asset_url=asset_url,
        html_url=str(payload.get("html_url") or ""),
        notes=str(payload.get("body") or "").strip(),
    )


def download_asset(
    release: ReleaseInfo,
    dest_dir: str | Path | None = None,
    progress: ProgressCallback | None = None,
    timeout: float = 30.0,
) -> Path:
    """Download a release asset to disk and return its path.

    ``progress`` (if given) is called as ``progress(bytes_done, bytes_total)``;
    ``bytes_total`` is 0 when the server does not report a length.
    """

    dest_dir = Path(dest_dir) if dest_dir else Path(tempfile.mkdtemp(prefix="iphonelabel_update_"))
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / (release.asset_name or "update.bin")

    request = Request(
        release.asset_url,
        headers={"Accept": "application/octet-stream", "User-Agent": _USER_AGENT},
    )
    try:
        with urlopen(request, timeout=timeout) as response, open(dest_path, "wb") as out:
            total = int(response.headers.get("Content-Length") or 0)
            done = 0
            if progress:
                progress(0, total)
            while True:
                chunk = response.read(_DOWNLOAD_CHUNK)
                if not chunk:
                    break
                out.write(chunk)
                done += len(chunk)
                if progress:
                    progress(done, total)
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        raise UpdateError(f"Download failed: {exc}") from exc

    return dest_path


def _write_windows_restart_script(new_file: Path, target: Path, pid: int) -> Path:
    """Write a .bat that waits for this process to exit, swaps the exe, relaunches."""

    script = (
        "@echo off\r\n"
        ":wait\r\n"
        f'tasklist /fi "PID eq {pid}" 2>nul | find "{pid}" >nul\r\n'
        "if not errorlevel 1 (\r\n"
        "    timeout /t 1 /nobreak >nul\r\n"
        "    goto wait\r\n"
        ")\r\n"
        f'move /y "{new_file}" "{target}" >nul\r\n'
        f'start "" "{target}"\r\n'
        'del "%~f0"\r\n'
    )
    handle = tempfile.NamedTemporaryFile(
        "w", suffix=".bat", prefix="iphonelabel_update_", delete=False, newline=""
    )
    with handle:
        handle.write(script)
    return Path(handle.name)


def apply_update_and_restart(new_file: str | Path) -> None:
    """Replace the running executable with ``new_file`` and relaunch.

    Only supported for a packaged Windows build, because a running ``.exe``
    cannot overwrite itself directly: a detached helper script performs the
    swap once this process exits. The caller is expected to quit the app
    immediately after this returns.
    """

    new_file = Path(new_file)
    if not new_file.exists():
        raise UpdateError(f"Downloaded update was not found: {new_file}")
    if not is_frozen():
        raise UpdateError(
            "Self-update only works in the packaged build. "
            "Update the source checkout with git instead."
        )
    if sys.platform != "win32":
        raise UpdateError("Self-update is currently implemented for Windows only.")

    target = current_executable_path()
    script = _write_windows_restart_script(new_file, target, os.getpid())
    subprocess.Popen(
        ["cmd", "/c", str(script)],
        creationflags=_DETACHED_PROCESS | _CREATE_NO_WINDOW,
        close_fds=True,
    )
