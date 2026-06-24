use std::collections::HashMap;
use std::sync::OnceLock;

const DEVICE_CATALOG: &str = include_str!("../../device_catalog.py");
const MODEL_MAPPING: &str = include_str!("../../model_mapping.py");
const VARIANT_DATA: &str = include_str!("../../variant_data.py");
const VARIANT_RESOLVER: &str = include_str!("../../variant_resolver.py");

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct VariantInfo {
    pub color: String,
    pub storage: String,
    pub source: String,
}

impl VariantInfo {
    pub fn found(&self) -> bool {
        !self.color.is_empty() || !self.storage.is_empty()
    }
}

static CATALOG_MARKETING: OnceLock<HashMap<String, String>> = OnceLock::new();
static FALLBACK_MARKETING: OnceLock<HashMap<String, String>> = OnceLock::new();
static MODEL_VARIANTS: OnceLock<HashMap<String, VariantInfo>> = OnceLock::new();
static CATALOG_COLOR_OPTIONS: OnceLock<HashMap<String, Vec<String>>> = OnceLock::new();
static FALLBACK_COLOR_OPTIONS: OnceLock<HashMap<String, Vec<String>>> = OnceLock::new();

pub fn marketing_name_for_product_type(product_type: &str) -> Option<String> {
    let normalized = product_type.trim();
    CATALOG_MARKETING
        .get_or_init(|| parse_string_map(DEVICE_CATALOG, "PRODUCT_TYPE_TO_MARKETING_NAME"))
        .get(normalized)
        .cloned()
        .or_else(|| {
            FALLBACK_MARKETING
                .get_or_init(|| parse_string_map(MODEL_MAPPING, "PRODUCT_TYPE_TO_MARKETING_NAME"))
                .get(normalized)
                .cloned()
        })
}

pub fn color_options_for_product_type(product_type: &str) -> Vec<String> {
    let normalized = product_type.trim();
    CATALOG_COLOR_OPTIONS
        .get_or_init(|| parse_list_map(DEVICE_CATALOG, "PRODUCT_COLOR_OPTIONS"))
        .get(normalized)
        .cloned()
        .or_else(|| {
            FALLBACK_COLOR_OPTIONS
                .get_or_init(|| parse_list_map(VARIANT_RESOLVER, "PRODUCT_COLOR_OPTIONS"))
                .get(normalized)
                .cloned()
        })
        .unwrap_or_default()
}

pub fn resolve_variant(
    product_type: &str,
    model_number: &str,
    device_color: &str,
    enclosure_color: &str,
) -> VariantInfo {
    if let Some(override_variant) = lookup_local_override(model_number) {
        return override_variant;
    }

    let normalized_model = normalize_model_number(model_number);
    if let Some(variant) = MODEL_VARIANTS
        .get_or_init(|| parse_variant_map(VARIANT_DATA, "MODEL_NUMBER_TO_VARIANT"))
        .get(&normalized_model)
    {
        return variant.clone();
    }

    lookup_color_code_variant(product_type, device_color, enclosure_color).unwrap_or_default()
}

pub fn normalize_model_number(value: &str) -> String {
    let mut upper = value.trim().to_ascii_uppercase();
    if let Some((before_slash, _)) = upper.split_once('/') {
        upper = if before_slash.len() > 5 {
            before_slash
                .chars()
                .take(before_slash.len().saturating_sub(2))
                .collect()
        } else {
            before_slash.to_string()
        };
    }

    upper
        .chars()
        .take_while(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit())
        .take(5)
        .collect()
}

pub fn normalize_color_value(value: &str) -> String {
    let color = value.trim();
    if color.is_empty() || color.chars().all(|ch| ch.is_ascii_digit()) {
        return String::new();
    }
    if color.ends_with("AP") && color.len() <= 8 {
        return String::new();
    }
    color.to_string()
}

fn lookup_local_override(model_number: &str) -> Option<VariantInfo> {
    match normalize_model_number(model_number).as_str() {
        "MYNH3" => Some(variant(
            "Black Titanium",
            "256 GB",
            "local model-number override",
        )),
        _ => None,
    }
}

fn lookup_color_code_variant(
    product_type: &str,
    device_color: &str,
    enclosure_color: &str,
) -> Option<VariantInfo> {
    match (
        product_type.trim(),
        device_color.trim(),
        enclosure_color.trim(),
    ) {
        ("iPhone17,1", "1", "1") => Some(variant("Black Titanium", "", "local color-code table")),
        ("iPhone18,3", "1", "2") => Some(variant("White", "", "local color-code table")),
        _ => None,
    }
}

fn variant(color: &str, storage: &str, source: &str) -> VariantInfo {
    VariantInfo {
        color: color.to_string(),
        storage: storage.to_string(),
        source: source.to_string(),
    }
}

fn parse_string_map(source: &str, symbol: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for fields in quoted_fields_by_line(source, symbol) {
        if fields.len() >= 2 {
            map.insert(fields[0].clone(), fields[1].clone());
        }
    }
    map
}

fn parse_list_map(source: &str, symbol: &str) -> HashMap<String, Vec<String>> {
    let mut map = HashMap::new();
    for fields in quoted_fields_by_line(source, symbol) {
        if fields.len() >= 2 {
            map.insert(fields[0].clone(), fields[1..].to_vec());
        }
    }
    map
}

fn parse_variant_map(source: &str, symbol: &str) -> HashMap<String, VariantInfo> {
    let mut map = HashMap::new();
    for fields in quoted_fields_by_line(source, symbol) {
        if fields.len() >= 3 {
            map.insert(
                normalize_model_number(&fields[0]),
                variant(&fields[1], &fields[2], "local model-number table"),
            );
        }
    }
    map
}

fn quoted_fields_by_line(source: &str, symbol: &str) -> Vec<Vec<String>> {
    extract_braced_section(source, symbol)
        .lines()
        .map(quoted_fields)
        .filter(|fields| !fields.is_empty())
        .collect()
}

fn extract_braced_section<'a>(source: &'a str, symbol: &str) -> &'a str {
    let Some(symbol_pos) = source.find(symbol) else {
        return "";
    };
    let Some(open_rel) = source[symbol_pos..].find('{') else {
        return "";
    };
    let open = symbol_pos + open_rel;
    let mut depth = 0usize;
    for (idx, ch) in source[open..].char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return &source[open + 1..open + idx];
                }
            }
            _ => {}
        }
    }
    ""
}

fn quoted_fields(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut active_quote = None;
    let mut current = String::new();
    let mut escaped = false;

    for ch in line.chars() {
        if let Some(quote) = active_quote {
            if escaped {
                current.push(ch);
                escaped = false;
                continue;
            }
            if ch == '\\' {
                escaped = true;
                continue;
            }
            if ch == quote {
                fields.push(current.clone());
                current.clear();
                active_quote = None;
                continue;
            }
            current.push(ch);
            continue;
        }

        if ch == '\'' || ch == '"' {
            active_quote = Some(ch);
        }
    }

    fields
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_region_model_numbers_like_python() {
        assert_eq!(normalize_model_number("MG6K4QL/A"), "MG6K4");
        assert_eq!(normalize_model_number("mg6k4"), "MG6K4");
    }

    #[test]
    fn parses_existing_marketing_catalog() {
        assert_eq!(
            marketing_name_for_product_type("iPhone18,3").as_deref(),
            Some("iPhone 17")
        );
    }

    #[test]
    fn resolves_variant_from_existing_python_table() {
        let variant = resolve_variant("iPhone18,3", "MG6K4QL/A", "1", "2");
        assert_eq!(variant.color, "White");
        assert_eq!(variant.storage, "256 GB");
        assert!(variant.found());
    }

    #[test]
    fn filters_machine_color_codes() {
        assert_eq!(normalize_color_value("1"), "");
        assert_eq!(normalize_color_value("N104AP"), "");
        assert_eq!(normalize_color_value("Blue"), "Blue");
    }
}
