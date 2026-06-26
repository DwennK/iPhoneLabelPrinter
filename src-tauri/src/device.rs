use crate::catalog::{
    color_options_for_product_type, marketing_name_for_product_type, normalize_color_value,
    resolve_variant,
};
use crate::command_runner::run_tool;
use crate::error::{AppError, AppResult};
use crate::types::{ConnectedDevice, IPhoneInfo};
use std::collections::HashMap;
use std::time::Duration;

const COLOR_KEYS: &[&str] = &["DeviceColor", "DeviceEnclosureColor", "HardwareModel"];
const IMEI_KEYS: &[&str] = &[
    "InternationalMobileEquipmentIdentity",
    "InternationalMobileEquipmentIdentity2",
    "MobileEquipmentIdentifier",
];

const LOCKED_DEVICE_MESSAGE: &str = "Device locked.\n\nUnlock the iPhone or iPad, keep it on the Home Screen, then click Scan Device again.\nIf a Trust This Mac prompt appears, tap Trust.";
const TRUST_PENDING_MESSAGE: &str = "Trust confirmation pending.\n\nLook at the iPhone or iPad screen and tap Trust This Mac.\nThen enter the device passcode if iOS/iPadOS asks for it, and click Scan Device again.";
const TRUST_DENIED_MESSAGE: &str = "This Mac is not trusted by the device.\n\nUnplug the iPhone or iPad, plug it back in, unlock it, and tap Trust This Mac.\nIf the prompt does not appear, reset Location & Privacy on the device and try again.";
const RECONNECT_DEVICE_MESSAGE: &str = "The device connection was lost or could not be opened.\n\nUnplug the cable, reconnect the iPhone or iPad directly to the Mac, unlock it, and click Scan Device again.\nIf it still fails, try another USB cable or port.";
pub const NO_DEVICE_MESSAGE: &str = "No iPhone or iPad detected.\n\nConnect the device by USB, unlock it, and tap Trust This Mac if prompted.\nIf it is already connected, unplug and reconnect the cable.";

pub fn detect_devices() -> AppResult<Vec<ConnectedDevice>> {
    let udids = list_connected_udids(Duration::from_secs(6))?;
    let mut devices = Vec::new();
    for udid in udids {
        let name = get_value(&udid, "DeviceName", Duration::from_secs(4));
        let display_name = if name.is_empty() {
            udid.clone()
        } else {
            format!("{name} ({udid})")
        };
        devices.push(ConnectedDevice { udid, display_name });
    }
    Ok(devices)
}

pub fn read_device_info(udid: &str) -> AppResult<IPhoneInfo> {
    let all_info = get_all_info(udid)?;
    let product_type = get_cached_or_device_value(&all_info, udid, "ProductType");
    let model_number = get_cached_or_device_value(&all_info, udid, "ModelNumber");
    let marketing_name = marketing_name_for_product_type(&product_type);
    let model_is_unknown = marketing_name.is_none();

    let mut storage_bytes = get_disk_capacity_value(udid);
    let disk_usage = if storage_bytes.is_empty() {
        get_disk_usage(udid)
    } else {
        HashMap::new()
    };
    storage_bytes = first_non_empty([
        storage_bytes.as_str(),
        disk_usage
            .get("TotalDiskCapacity")
            .map(String::as_str)
            .unwrap_or(""),
        disk_usage
            .get("TotalDataCapacity")
            .map(String::as_str)
            .unwrap_or(""),
        all_info
            .get("TotalDiskCapacity")
            .map(String::as_str)
            .unwrap_or(""),
        all_info
            .get("TotalDataCapacity")
            .map(String::as_str)
            .unwrap_or(""),
    ])
    .unwrap_or("")
    .to_string();
    let storage = round_storage_capacity(parse_int(&storage_bytes));

    let imei = IMEI_KEYS
        .iter()
        .map(|key| normalize_imei(&get_cached_or_device_value(&all_info, udid, key)))
        .find(|value| !value.is_empty())
        .unwrap_or_default();

    let raw_device_color = get_cached_or_device_value(&all_info, udid, "DeviceColor");
    let raw_enclosure_color = get_cached_or_device_value(&all_info, udid, "DeviceEnclosureColor");
    let variant = resolve_variant(
        &product_type,
        &model_number,
        &raw_device_color,
        &raw_enclosure_color,
    );

    let mut color_value = variant.color.clone();
    let mut color_key_used = String::new();
    if color_value.is_empty() {
        for key in COLOR_KEYS {
            let raw = get_cached_or_device_value(&all_info, udid, key);
            color_value = normalize_color_value(&raw);
            if !color_value.is_empty() {
                color_key_used = (*key).to_string();
                break;
            }
        }
    }

    let (battery_health, battery_cycle_count) = get_battery_info(udid);
    let variant_source_note = if variant.found() {
        format!("Variant resolved from {}.", variant.source)
    } else {
        String::new()
    };
    let color_source_note = if !variant.color.is_empty() {
        format!("Color resolved from {}.", variant.source)
    } else if !color_key_used.is_empty() {
        format!("Color read from {color_key_used}; verify manually.")
    } else {
        "Color was not available from the device; choose it manually.".to_string()
    };

    Ok(IPhoneInfo {
        udid: udid.to_string(),
        marketing_model: marketing_name.unwrap_or_else(|| "Unknown model".to_string()),
        technical_model: product_type,
        model_number,
        storage: if storage.is_empty() {
            variant.storage
        } else {
            storage
        },
        color: color_value,
        imei,
        serial_number: get_cached_or_device_value(&all_info, udid, "SerialNumber"),
        device_name: get_cached_or_device_value(&all_info, udid, "DeviceName"),
        ios_version: get_cached_or_device_value(&all_info, udid, "ProductVersion"),
        build_version: get_cached_or_device_value(&all_info, udid, "BuildVersion"),
        battery_health,
        battery_cycle_count,
        model_is_unknown,
        color_source_note,
        variant_source_note,
    })
}

pub fn product_color_options(product_type: &str) -> Vec<String> {
    color_options_for_product_type(product_type)
}

fn list_connected_udids(timeout: Duration) -> AppResult<Vec<String>> {
    run_tool("idevice_id", &["-l"], timeout)
        .map(|output| {
            output
                .stdout
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(str::to_string)
                .collect()
        })
        .map_err(|error| connection_error_from_message(&error.message))
}

fn get_value(udid: &str, key: &str, timeout: Duration) -> String {
    run_tool("ideviceinfo", &["-u", udid, "-k", key], timeout)
        .map(|output| output.stdout.trim().to_string())
        .unwrap_or_default()
}

fn get_all_info(udid: &str) -> AppResult<HashMap<String, String>> {
    run_tool("ideviceinfo", &["-u", udid], Duration::from_secs(10))
        .map(|output| parse_key_value_output(&output.stdout))
        .map_err(|error| connection_error_from_message(&error.message))
}

fn get_disk_usage(udid: &str) -> HashMap<String, String> {
    run_tool(
        "ideviceinfo",
        &["-u", udid, "-q", "com.apple.disk_usage"],
        Duration::from_secs(8),
    )
    .map(|output| parse_key_value_output(&output.stdout))
    .unwrap_or_default()
}

fn get_disk_capacity_value(udid: &str) -> String {
    for key in ["TotalDiskCapacity", "TotalDataCapacity"] {
        if let Ok(output) = run_tool(
            "ideviceinfo",
            &["-u", udid, "-q", "com.apple.disk_usage", "-k", key],
            Duration::from_secs(4),
        ) {
            let value = output.stdout.trim();
            if !value.is_empty() {
                return value.to_string();
            }
        }
    }
    String::new()
}

fn get_cached_or_device_value(all_info: &HashMap<String, String>, udid: &str, key: &str) -> String {
    all_info
        .get(key)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| get_value(udid, key, Duration::from_secs(8)))
}

fn get_battery_info(udid: &str) -> (String, String) {
    let gas_gauge_output = run_tool(
        "idevicediagnostics",
        &["-u", udid, "diagnostics", "GasGauge"],
        Duration::from_secs(8),
    )
    .ok();
    let mut cycle_count = gas_gauge_output
        .as_ref()
        .and_then(|output| xml_int_after_key(&output.stdout, "CycleCount"))
        .filter(|value| *value >= 0)
        .map(|value| value.to_string())
        .unwrap_or_default();

    let Ok(ioreg_output) = run_tool(
        "idevicediagnostics",
        &["-u", udid, "ioregentry", "AppleSmartBattery"],
        Duration::from_secs(8),
    ) else {
        return (String::new(), cycle_count);
    };

    let full_charge = first_xml_int_after_keys(
        &ioreg_output.stdout,
        &["AppleRawMaxCapacity", "NominalChargeCapacity"],
    );
    let design = first_xml_int_after_keys(&ioreg_output.stdout, &["DesignCapacity"]);
    let health = health_percent(full_charge, design);
    if cycle_count.is_empty() {
        cycle_count = xml_int_after_key(&ioreg_output.stdout, "CycleCount")
            .filter(|value| *value >= 0)
            .map(|value| value.to_string())
            .unwrap_or_default();
    }
    (health, cycle_count)
}

fn connection_error_from_message(message: &str) -> AppError {
    let normalized = message.to_ascii_lowercase();
    if normalized.contains("required command") {
        return AppError::new("Setup Required", message);
    }
    if normalized.contains("lockdown_e_password_protected")
        || normalized.contains("passwordprotected")
    {
        return AppError::new("Device Locked", LOCKED_DEVICE_MESSAGE);
    }
    if normalized.contains("lockdown_e_pairing_dialog_response_pending") {
        return AppError::new("Trust This Mac", TRUST_PENDING_MESSAGE);
    }
    if normalized.contains("lockdown_e_user_denied_pairing")
        || normalized.contains("lockdown_e_invalid_host_id")
        || normalized.contains("not trusted")
    {
        return AppError::new("Trust Required", TRUST_DENIED_MESSAGE);
    }
    if normalized.contains("no device found")
        || normalized.contains("no device")
        || normalized.contains("please connect")
    {
        return AppError::new("No Device Detected", NO_DEVICE_MESSAGE);
    }
    if normalized.contains("could not connect")
        || normalized.contains("lockdown_e_mux_error")
        || normalized.contains("mux")
        || normalized.contains("connection")
        || normalized.contains("broken pipe")
        || normalized.contains("ssl")
    {
        return AppError::new("Reconnect Device", RECONNECT_DEVICE_MESSAGE);
    }
    AppError::new("Scan Failed", message)
}

pub fn parse_key_value_output(output: &str) -> HashMap<String, String> {
    output
        .lines()
        .filter_map(|raw_line| {
            let line = raw_line.trim();
            let (key, value) = line.split_once(':')?;
            let key = key.trim();
            (!key.is_empty()).then(|| (key.to_string(), value.trim().to_string()))
        })
        .collect()
}

fn first_non_empty<'a>(values: impl IntoIterator<Item = &'a str>) -> Option<&'a str> {
    values.into_iter().find(|value| !value.trim().is_empty())
}

fn normalize_imei(value: &str) -> String {
    value.chars().filter(|ch| ch.is_ascii_digit()).collect()
}

pub fn round_storage_capacity(total_bytes: Option<u64>) -> String {
    let Some(total_bytes) = total_bytes.filter(|value| *value > 0) else {
        return String::new();
    };
    let decimal_gb = total_bytes as f64 / 1_000_000_000.0;
    let common = [
        4.0, 8.0, 16.0, 32.0, 64.0, 128.0, 256.0, 512.0, 1024.0, 2048.0,
    ];
    let closest = common
        .iter()
        .min_by(|left, right| {
            ((*left - decimal_gb).abs())
                .partial_cmp(&((*right - decimal_gb).abs()))
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .copied()
        .unwrap_or(0.0);
    if closest >= 1024.0 {
        format!("{} TB", (closest / 1024.0) as u64)
    } else {
        format!("{} GB", closest as u64)
    }
}

fn parse_int(value: &str) -> Option<u64> {
    let digits: String = value
        .chars()
        .skip_while(|ch| !ch.is_ascii_digit())
        .take_while(|ch| ch.is_ascii_digit() || *ch == ',')
        .filter(|ch| ch.is_ascii_digit())
        .collect();
    digits.parse().ok()
}

fn xml_int_after_key(xml: &str, key: &str) -> Option<i64> {
    let key_tag = format!("<key>{key}</key>");
    let start = xml.find(&key_tag)? + key_tag.len();
    let rest = &xml[start..];
    let integer_start = rest.find("<integer>")? + "<integer>".len();
    let rest = &rest[integer_start..];
    let integer_end = rest.find("</integer>")?;
    rest[..integer_end].trim().parse().ok()
}

fn first_xml_int_after_keys(xml: &str, keys: &[&str]) -> Option<i64> {
    keys.iter().find_map(|key| xml_int_after_key(xml, key))
}

fn health_percent(full_charge: Option<i64>, design: Option<i64>) -> String {
    let (Some(full_charge), Some(design)) = (full_charge, design) else {
        return String::new();
    };
    if full_charge <= 0 || design <= 0 {
        return String::new();
    }
    let percent = ((full_charge as f64 / design as f64) * 100.0).round() as i64;
    if (1..=100).contains(&percent) {
        format!("{percent}%")
    } else {
        String::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_key_value_output_like_ideviceinfo() {
        let parsed = parse_key_value_output("ProductType: iPhone18,3\nSerialNumber: ABC123\n");
        assert_eq!(
            parsed.get("ProductType").map(String::as_str),
            Some("iPhone18,3")
        );
        assert_eq!(
            parsed.get("SerialNumber").map(String::as_str),
            Some("ABC123")
        );
    }

    #[test]
    fn rounds_storage_to_commercial_sizes() {
        assert_eq!(round_storage_capacity(Some(127_900_000_000)), "128 GB");
        assert_eq!(round_storage_capacity(Some(1_000_000_000_000)), "1 TB");
    }

    #[test]
    fn parses_battery_xml_integer_values() {
        let xml = "<plist><dict><key>AppleRawMaxCapacity</key><integer>4200</integer><key>DesignCapacity</key><integer>4500</integer></dict></plist>";
        assert_eq!(xml_int_after_key(xml, "AppleRawMaxCapacity"), Some(4200));
        assert_eq!(health_percent(Some(4200), Some(4500)), "93%");
    }
}
