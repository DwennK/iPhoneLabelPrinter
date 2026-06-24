use serde::de::DeserializeOwned;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::OnceLock;

const MARKETING_NAMES_JSON: &str = include_str!("../data/product_type_marketing_names.json");
const COLOR_OPTIONS_JSON: &str = include_str!("../data/product_color_options.json");
const MODEL_VARIANTS_JSON: &str = include_str!("../data/model_number_variants.json");
const COLOR_CODE_VARIANTS_JSON: &str = include_str!("../data/color_code_variants.json");

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
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

#[derive(Debug, Clone, Deserialize)]
struct ColorCodeVariant {
    product_type: String,
    device_color: String,
    enclosure_color: String,
    color: String,
    storage: String,
    source: String,
}

static MARKETING_NAMES: OnceLock<HashMap<String, String>> = OnceLock::new();
static COLOR_OPTIONS: OnceLock<HashMap<String, Vec<String>>> = OnceLock::new();
static MODEL_VARIANTS: OnceLock<HashMap<String, VariantInfo>> = OnceLock::new();
static COLOR_CODE_VARIANTS: OnceLock<HashMap<(String, String, String), VariantInfo>> =
    OnceLock::new();

pub fn marketing_name_for_product_type(product_type: &str) -> Option<String> {
    let normalized = product_type.trim();
    MARKETING_NAMES
        .get_or_init(|| parse_json(MARKETING_NAMES_JSON, "product_type_marketing_names.json"))
        .get(normalized)
        .cloned()
}

pub fn color_options_for_product_type(product_type: &str) -> Vec<String> {
    let normalized = product_type.trim();
    COLOR_OPTIONS
        .get_or_init(|| parse_json(COLOR_OPTIONS_JSON, "product_color_options.json"))
        .get(normalized)
        .cloned()
        .unwrap_or_default()
}

pub fn resolve_variant(
    product_type: &str,
    model_number: &str,
    device_color: &str,
    enclosure_color: &str,
) -> VariantInfo {
    let normalized_model = normalize_model_number(model_number);
    if let Some(variant) = MODEL_VARIANTS
        .get_or_init(|| parse_json(MODEL_VARIANTS_JSON, "model_number_variants.json"))
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

fn lookup_color_code_variant(
    product_type: &str,
    device_color: &str,
    enclosure_color: &str,
) -> Option<VariantInfo> {
    COLOR_CODE_VARIANTS
        .get_or_init(load_color_code_variants)
        .get(&(
            product_type.trim().to_string(),
            device_color.trim().to_string(),
            enclosure_color.trim().to_string(),
        ))
        .cloned()
}

fn load_color_code_variants() -> HashMap<(String, String, String), VariantInfo> {
    let records: Vec<ColorCodeVariant> =
        parse_json(COLOR_CODE_VARIANTS_JSON, "color_code_variants.json");
    records
        .into_iter()
        .map(|record| {
            (
                (
                    record.product_type,
                    record.device_color,
                    record.enclosure_color,
                ),
                VariantInfo {
                    color: record.color,
                    storage: record.storage,
                    source: record.source,
                },
            )
        })
        .collect()
}

fn parse_json<T: DeserializeOwned>(source: &str, name: &str) -> T {
    serde_json::from_str(source).unwrap_or_else(|error| panic!("failed to parse {name}: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_region_model_numbers() {
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
    fn resolves_variant_from_local_table() {
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
