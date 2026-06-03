"""Read connected iPhone information through libimobiledevice CLI tools."""

from __future__ import annotations

from dataclasses import dataclass
import plistlib
import sys

from model_mapping import marketing_name_for_product_type
from utils import (
    AppError,
    CommandExecutionError,
    IPhoneInfo,
    first_non_empty,
    normalize_imei,
    parse_int,
    parse_key_value_output,
    round_storage_capacity,
    run_command,
)
from variant_resolver import resolve_variant


class IPhoneReaderError(AppError):
    """Raised for iPhone detection and metadata errors."""

    def __init__(self, message: str, title: str = "Scan Failed") -> None:
        super().__init__(message)
        self.title = title


LOCKED_DEVICE_MESSAGE = (
    "iPhone locked.\n\n"
    "Unlock the iPhone, keep it on the Home Screen, then click Scan iPhone again.\n"
    "If a Trust This Mac prompt appears, tap Trust."
)

TRUST_PENDING_MESSAGE = (
    "Trust confirmation pending.\n\n"
    "Look at the iPhone screen and tap Trust This Mac.\n"
    "Then enter the iPhone passcode if iOS asks for it, and click Scan iPhone again."
)

TRUST_DENIED_MESSAGE = (
    "This Mac is not trusted by the iPhone.\n\n"
    "Unplug the iPhone, plug it back in, unlock it, and tap Trust This Mac.\n"
    "If the prompt does not appear, reset Location & Privacy on the iPhone and try again."
)

RECONNECT_DEVICE_MESSAGE = (
    "The iPhone connection was lost or could not be opened.\n\n"
    "Unplug the cable, reconnect the iPhone directly to the Mac, unlock it, and click Scan iPhone again.\n"
    "If it still fails, try another USB cable or port."
)

NO_DEVICE_MESSAGE = (
    "No iPhone detected.\n\n"
    "Connect the iPhone by USB, unlock it, and tap Trust This Mac if prompted.\n"
    "If it is already connected, unplug and reconnect the cable."
)


def libimobiledevice_install_hint() -> str:
    """Return an OS-specific instruction to install libimobiledevice."""

    if sys.platform == "darwin":
        return (
            "Install libimobiledevice with Homebrew:\n"
            "    brew install libimobiledevice"
        )
    if sys.platform == "win32":
        return (
            "Install libimobiledevice for Windows (for example the "
            "libimobiledevice-win32 build) and either add its folder to PATH "
            "or copy the binaries to assets\\bin\\win32\\ next to the app."
        )
    return (
        "Install libimobiledevice using your package manager and ensure "
        "idevice_id is on PATH (Debian/Ubuntu: apt install libimobiledevice-utils)."
    )


@dataclass
class ConnectedDevice:
    udid: str
    display_name: str


COLOR_KEYS = ("DeviceColor", "DeviceEnclosureColor", "HardwareModel")
IMEI_KEYS = (
    "InternationalMobileEquipmentIdentity",
    "InternationalMobileEquipmentIdentity2",
    "MobileEquipmentIdentifier",
)


def connection_error_from_message(message: str) -> IPhoneReaderError:
    """Convert libimobiledevice output into an actionable GUI error."""

    normalized = message.lower()
    if "lockdown_e_password_protected" in normalized or "passwordprotected" in normalized:
        return IPhoneReaderError(LOCKED_DEVICE_MESSAGE, title="iPhone Locked")
    if "lockdown_e_pairing_dialog_response_pending" in normalized:
        return IPhoneReaderError(TRUST_PENDING_MESSAGE, title="Trust This Mac")
    if (
        "lockdown_e_user_denied_pairing" in normalized
        or "lockdown_e_invalid_host_id" in normalized
        or "not trusted" in normalized
    ):
        return IPhoneReaderError(TRUST_DENIED_MESSAGE, title="Trust Required")
    if (
        "no device found" in normalized
        or "no device" in normalized
        or "please connect" in normalized
    ):
        return IPhoneReaderError(NO_DEVICE_MESSAGE, title="No iPhone Detected")
    if (
        "could not connect" in normalized
        or "lockdown_e_mux_error" in normalized
        or "mux" in normalized
        or "connection" in normalized
        or "broken pipe" in normalized
        or "ssl" in normalized
    ):
        return IPhoneReaderError(RECONNECT_DEVICE_MESSAGE, title="Reconnect iPhone")
    return IPhoneReaderError(message)


def normalize_color_value(value: str) -> str:
    """Return only human-readable color values from libimobiledevice output."""

    color = value.strip()
    if not color:
        return ""
    if color.isdigit():
        return ""
    if color.endswith("AP") and len(color) <= 8:
        return ""
    return color


def list_connected_udids(timeout: float = 6.0) -> list[str]:
    """Return UDIDs from ``idevice_id -l``."""

    try:
        result = run_command(["idevice_id", "-l"], timeout=timeout)
    except CommandExecutionError as exc:
        raise connection_error_from_message(str(exc)) from exc
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def get_value(udid: str, key: str, timeout: float = 8.0) -> str:
    """Read one key from ideviceinfo.

    Missing keys should not crash the app; libimobiledevice may return a
    non-zero exit code for unavailable values.
    """

    try:
        result = run_command(["ideviceinfo", "-u", udid, "-k", key], timeout=timeout)
    except CommandExecutionError:
        return ""
    return result.stdout.strip()


def get_all_info(udid: str, timeout: float = 10.0) -> dict[str, str]:
    """Read general ideviceinfo output as a key/value dictionary."""

    try:
        result = run_command(["ideviceinfo", "-u", udid], timeout=timeout)
    except CommandExecutionError as exc:
        raise connection_error_from_message(str(exc)) from exc
    return parse_key_value_output(result.stdout)


def get_disk_usage(udid: str, timeout: float = 8.0) -> dict[str, str]:
    """Read disk usage domain, returning an empty dictionary if unavailable."""

    try:
        result = run_command(
            ["ideviceinfo", "-u", udid, "-q", "com.apple.disk_usage"],
            timeout=timeout,
        )
    except CommandExecutionError:
        return {}
    return parse_key_value_output(result.stdout)


def get_disk_capacity_value(udid: str, timeout: float = 4.0) -> str:
    """Read capacity keys directly to avoid the huge NANDInfo disk-usage dump."""

    for key in ("TotalDiskCapacity", "TotalDataCapacity"):
        try:
            result = run_command(
                ["ideviceinfo", "-u", udid, "-q", "com.apple.disk_usage", "-k", key],
                timeout=timeout,
            )
        except CommandExecutionError:
            continue
        value = result.stdout.strip()
        if value:
            return value
    return ""


def _nested_dict(value: object, key: str) -> dict:
    if isinstance(value, dict):
        nested = value.get(key)
        if isinstance(nested, dict):
            return nested
    return {}


def _battery_int(value: object) -> str:
    if isinstance(value, int) and value >= 0:
        return str(value)
    return ""


def _first_int(source: dict, *keys: str) -> int | None:
    """Return the first key in ``source`` that holds an int, searching in order."""

    for key in keys:
        value = source.get(key)
        if isinstance(value, int):
            return value
    return None


def _health_percent(full_charge: int | None, design: int | None) -> str:
    """Battery health = current full-charge capacity / original design capacity.

    This mirrors the iPhone's own "Maximum Capacity" screen and 3uTools.
    """

    if not isinstance(full_charge, int) or not isinstance(design, int):
        return ""
    if full_charge <= 0 or design <= 0:
        return ""
    percent = round(full_charge / design * 100)
    if 0 < percent <= 100:
        return f"{percent}%"
    return ""


# Current full-charge capacity in mAh, preferring the value 3uTools uses
# (AppleRawMaxCapacity) over the slightly more conservative NominalChargeCapacity.
# Only the AppleSmartBattery registry exposes these in real mAh: the GasGauge
# diagnostic reports FullChargeCapacity normalised to 100, which is unusable here.
_FULL_CHARGE_KEYS = ("AppleRawMaxCapacity", "NominalChargeCapacity")
_DESIGN_KEYS = ("DesignCapacity",)


def get_battery_info(udid: str, timeout: float = 8.0) -> tuple[str, str]:
    """Return battery health percentage and cycle count when diagnostics exposes them.

    Health is derived from the raw full-charge capacity relative to the design
    capacity (the same ratio the iPhone's Maximum Capacity screen and 3uTools
    show). ``MaxCapacity`` is normalised to 100 by iOS and cannot be used.
    """

    # GasGauge is a quick, stable source for the cycle count. Its capacity
    # fields are normalised, so they are deliberately not used for health.
    try:
        gas_result = run_command(
            ["idevicediagnostics", "-u", udid, "diagnostics", "GasGauge"],
            timeout=timeout,
        )
    except AppError:
        gas_gauge: dict = {}
    else:
        try:
            payload = plistlib.loads(gas_result.stdout.encode("utf-8"))
        except (plistlib.InvalidFileException, ValueError):
            payload = {}
        gas_gauge = _nested_dict(payload, "GasGauge")

    cycle_count = _battery_int(gas_gauge.get("CycleCount"))

    # AppleSmartBattery carries the raw mAh capacities needed for the health ratio.
    try:
        ioreg_result = run_command(
            ["idevicediagnostics", "-u", udid, "ioregentry", "AppleSmartBattery"],
            timeout=timeout,
        )
    except AppError:
        return "", cycle_count

    try:
        payload = plistlib.loads(ioreg_result.stdout.encode("utf-8"))
    except (plistlib.InvalidFileException, ValueError):
        return "", cycle_count

    registry = _nested_dict(payload, "IORegistry")
    battery_data = _nested_dict(registry, "BatteryData")

    full_charge = _first_int(registry, *_FULL_CHARGE_KEYS)
    if full_charge is None:
        full_charge = _first_int(battery_data, *_FULL_CHARGE_KEYS)
    design = _first_int(registry, *_DESIGN_KEYS)
    if design is None:
        design = _first_int(battery_data, *_DESIGN_KEYS)

    health = _health_percent(full_charge, design)
    cycle_count = cycle_count or _battery_int(registry.get("CycleCount"))
    cycle_count = cycle_count or _battery_int(battery_data.get("CycleCount"))
    return health, cycle_count


def detect_devices(timeout: float = 6.0) -> list[ConnectedDevice]:
    """Detect connected iPhones and include a friendly name when possible."""

    udids = list_connected_udids(timeout=timeout)
    devices: list[ConnectedDevice] = []
    for udid in udids:
        name = get_value(udid, "DeviceName", timeout=4.0)
        label = f"{name} ({udid})" if name else udid
        devices.append(ConnectedDevice(udid=udid, display_name=label))
    return devices


def read_iphone_info(udid: str) -> IPhoneInfo:
    """Collect the fields needed for the shop label form."""

    all_info = get_all_info(udid)

    product_type = first_non_empty(
        get_value(udid, "ProductType"),
        all_info.get("ProductType"),
    )
    model_number = first_non_empty(
        get_value(udid, "ModelNumber"),
        all_info.get("ModelNumber"),
    )
    marketing_name = marketing_name_for_product_type(product_type) if product_type else None
    model_is_unknown = not bool(marketing_name)

    storage_bytes = get_disk_capacity_value(udid)
    disk_usage = get_disk_usage(udid) if not storage_bytes else {}
    storage_bytes = first_non_empty(
        storage_bytes,
        disk_usage.get("TotalDiskCapacity"),
        disk_usage.get("TotalDataCapacity"),
        all_info.get("TotalDiskCapacity"),
        all_info.get("TotalDataCapacity"),
    )
    storage = round_storage_capacity(parse_int(storage_bytes))

    imei = ""
    for key in IMEI_KEYS:
        imei = normalize_imei(first_non_empty(get_value(udid, key), all_info.get(key)))
        if imei:
            break

    raw_device_color = first_non_empty(get_value(udid, "DeviceColor"), all_info.get("DeviceColor"))
    raw_enclosure_color = first_non_empty(
        get_value(udid, "DeviceEnclosureColor"),
        all_info.get("DeviceEnclosureColor"),
    )
    variant = resolve_variant(
        product_type=product_type,
        model_number=model_number,
        device_color=raw_device_color,
        enclosure_color=raw_enclosure_color,
    )

    color_value = variant.color
    color_key_used = ""
    if not color_value:
        for key in COLOR_KEYS:
            raw_color_value = first_non_empty(get_value(udid, key), all_info.get(key))
            color_value = normalize_color_value(raw_color_value)
            if color_value:
                color_key_used = key
                break

    battery_health, battery_cycle_count = get_battery_info(udid)

    return IPhoneInfo(
        udid=udid,
        marketing_model=marketing_name or "Unknown model",
        technical_model=product_type,
        model_number=model_number,
        storage=storage or variant.storage,
        color=color_value,
        imei=imei,
        serial_number=first_non_empty(
            get_value(udid, "SerialNumber"),
            all_info.get("SerialNumber"),
        ),
        device_name=first_non_empty(
            get_value(udid, "DeviceName"),
            all_info.get("DeviceName"),
        ),
        ios_version=first_non_empty(
            get_value(udid, "ProductVersion"),
            all_info.get("ProductVersion"),
        ),
        build_version=first_non_empty(
            get_value(udid, "BuildVersion"),
            all_info.get("BuildVersion"),
        ),
        battery_health=battery_health,
        battery_cycle_count=battery_cycle_count,
        model_is_unknown=model_is_unknown,
        color_source_note=(
            f"Color resolved from {variant.source}."
            if variant.color
            else
            f"Color read from {color_key_used}; verify manually."
            if color_key_used
            else "Color was not available from the iPhone; choose it manually."
        ),
        variant_source_note=(
            f"Variant resolved from {variant.source}." if variant.found else ""
        ),
    )
