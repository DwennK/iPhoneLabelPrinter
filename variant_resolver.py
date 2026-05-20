"""Resolve iPhone color and storage variants.

libimobiledevice often exposes ``DeviceColor`` and ``DeviceEnclosureColor`` as
small numeric codes. Those codes are not globally meaningful; the reliable key
for color/capacity is Apple's order model number, exposed by ideviceinfo as
``ModelNumber`` and usually shown by iOS Settings as values like ``MG6K4QL/A``.

This module keeps local lookups deterministic and private. An optional
Reincubate DeviceIdentifier API lookup is supported only when the user provides
``RI_DEVID_TOKEN``; anonymous calls usually do not return specification data for
new devices and should not be part of the normal shop workflow.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
import os
import re
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from variant_data import MODEL_NUMBER_TO_VARIANT


@dataclass(frozen=True)
class VariantInfo:
    color: str = ""
    storage: str = ""
    source: str = ""

    @property
    def found(self) -> bool:
        return bool(self.color or self.storage)


MODEL_NUMBER_RE = re.compile(r"^[A-Z0-9]{4,5}")


def normalize_model_number(value: str | None) -> str:
    """Return the Apple order-number prefix used for variant matching.

    Examples:
    - ``MG6K4QL/A`` -> ``MG6K4``
    - ``MG6K4`` -> ``MG6K4``
    """

    if not value:
        return ""
    upper = value.strip().upper()
    if "/" in upper:
        before_slash = upper.split("/", 1)[0]
        if len(before_slash) > 5:
            upper = before_slash[:-2]
        else:
            upper = before_slash
    match = MODEL_NUMBER_RE.match(upper)
    return match.group(0) if match else ""


def _variant(color: str, storage: str, source: str = "local model-number table") -> VariantInfo:
    return VariantInfo(color=color, storage=storage, source=source)


def _build_local_model_variants() -> dict[str, VariantInfo]:
    """Build exact order-number mappings from the generated local data table."""

    return {
        normalize_model_number(model_number): _variant(color, storage)
        for model_number, (color, storage) in MODEL_NUMBER_TO_VARIANT.items()
    }


LOCAL_MODEL_NUMBER_VARIANTS = _build_local_model_variants()


# Fallback for numeric DeviceColor/DeviceEnclosureColor pairs observed on real
# hardware. These are deliberately scoped by ProductType because the same code
# can mean different colors on different iPhone generations.
PRODUCT_COLOR_CODE_VARIANTS: dict[tuple[str, str, str], VariantInfo] = {
    ("iPhone18,3", "1", "2"): _variant("White", "", "local color-code table"),
}


PRODUCT_COLOR_OPTIONS: dict[str, tuple[str, ...]] = {
    "iPhone1,1": ("Silver",),
    "iPhone1,2": ("Black", "White"),
    "iPhone2,1": ("Black", "White"),
    "iPhone3,1": ("Black", "White"),
    "iPhone3,2": ("Black", "White"),
    "iPhone3,3": ("Black", "White"),
    "iPhone4,1": ("Black", "White"),
    "iPhone5,1": ("Black & Slate", "White & Silver"),
    "iPhone5,2": ("Black & Slate", "White & Silver"),
    "iPhone5,3": ("White", "Pink", "Yellow", "Blue", "Green"),
    "iPhone5,4": ("White", "Pink", "Yellow", "Blue", "Green"),
    "iPhone6,1": ("Space Gray", "Silver", "Gold"),
    "iPhone6,2": ("Space Gray", "Silver", "Gold"),
    "iPhone7,1": ("Space Gray", "Silver", "Gold"),
    "iPhone7,2": ("Space Gray", "Silver", "Gold"),
    "iPhone8,1": ("Space Gray", "Silver", "Gold", "Rose Gold"),
    "iPhone8,2": ("Space Gray", "Silver", "Gold", "Rose Gold"),
    "iPhone8,4": ("Space Gray", "Silver", "Gold", "Rose Gold"),
    "iPhone9,1": ("Black", "Jet Black", "Silver", "Gold", "Rose Gold", "Red"),
    "iPhone9,2": ("Black", "Jet Black", "Silver", "Gold", "Rose Gold", "Red"),
    "iPhone9,3": ("Black", "Jet Black", "Silver", "Gold", "Rose Gold", "Red"),
    "iPhone9,4": ("Black", "Jet Black", "Silver", "Gold", "Rose Gold", "Red"),
    "iPhone10,1": ("Space Gray", "Silver", "Gold", "Red"),
    "iPhone10,2": ("Space Gray", "Silver", "Gold", "Red"),
    "iPhone10,3": ("Space Gray", "Silver"),
    "iPhone10,4": ("Space Gray", "Silver", "Gold", "Red"),
    "iPhone10,5": ("Space Gray", "Silver", "Gold", "Red"),
    "iPhone10,6": ("Space Gray", "Silver"),
    "iPhone11,2": ("Space Gray", "Silver", "Gold"),
    "iPhone11,4": ("Space Gray", "Silver", "Gold"),
    "iPhone11,6": ("Space Gray", "Silver", "Gold"),
    "iPhone11,8": ("Black", "White", "Blue", "Yellow", "Coral", "Red"),
    "iPhone12,1": ("Black", "White", "Green", "Yellow", "Purple", "Red"),
    "iPhone12,3": ("Space Gray", "Silver", "Gold", "Midnight Green"),
    "iPhone12,5": ("Space Gray", "Silver", "Gold", "Midnight Green"),
    "iPhone12,8": ("Black", "White", "Red"),
    "iPhone13,1": ("Black", "White", "Blue", "Green", "Purple", "Red"),
    "iPhone13,2": ("Black", "White", "Blue", "Green", "Purple", "Red"),
    "iPhone13,3": ("Graphite", "Silver", "Gold", "Pacific Blue"),
    "iPhone13,4": ("Graphite", "Silver", "Gold", "Pacific Blue"),
    "iPhone14,2": ("Graphite", "Silver", "Gold", "Sierra Blue", "Alpine Green"),
    "iPhone14,3": ("Graphite", "Silver", "Gold", "Sierra Blue", "Alpine Green"),
    "iPhone14,4": ("Midnight", "Starlight", "Blue", "Pink", "Green", "Red"),
    "iPhone14,5": ("Midnight", "Starlight", "Blue", "Pink", "Green", "Red"),
    "iPhone14,6": ("Midnight", "Starlight", "Red"),
    "iPhone14,7": ("Midnight", "Starlight", "Blue", "Purple", "Yellow", "Red"),
    "iPhone14,8": ("Midnight", "Starlight", "Blue", "Purple", "Yellow", "Red"),
    "iPhone15,2": ("Space Black", "Silver", "Gold", "Deep Purple"),
    "iPhone15,3": ("Space Black", "Silver", "Gold", "Deep Purple"),
    "iPhone15,4": ("Black", "Blue", "Green", "Yellow", "Pink"),
    "iPhone15,5": ("Black", "Blue", "Green", "Yellow", "Pink"),
    "iPhone16,1": ("Black Titanium", "White Titanium", "Blue Titanium", "Natural Titanium"),
    "iPhone16,2": ("Black Titanium", "White Titanium", "Blue Titanium", "Natural Titanium"),
    "iPhone17,1": ("Black Titanium", "White Titanium", "Natural Titanium", "Desert Titanium"),
    "iPhone17,2": ("Black Titanium", "White Titanium", "Natural Titanium", "Desert Titanium"),
    "iPhone17,3": ("Black", "White", "Pink", "Teal", "Ultramarine"),
    "iPhone17,4": ("Black", "White", "Pink", "Teal", "Ultramarine"),
    "iPhone17,5": ("Black", "White"),
    "iPhone18,1": ("Cosmic Orange", "Deep Blue", "Silver"),
    "iPhone18,2": ("Cosmic Orange", "Deep Blue", "Silver"),
    "iPhone18,3": ("Black", "White", "Mist Blue", "Sage", "Lavender"),
    "iPhone18,4": ("Space Black", "Cloud White", "Light Gold", "Sky Blue"),
    "iPhone18,5": ("Black", "White", "Soft Pink"),
}


def color_options_for_product_type(product_type: str) -> tuple[str, ...]:
    return PRODUCT_COLOR_OPTIONS.get(product_type.strip(), ())


def lookup_local_model_variant(model_number: str) -> VariantInfo:
    return LOCAL_MODEL_NUMBER_VARIANTS.get(normalize_model_number(model_number), VariantInfo())


def lookup_color_code_variant(
    product_type: str,
    device_color: str,
    enclosure_color: str,
) -> VariantInfo:
    key = (product_type.strip(), device_color.strip(), enclosure_color.strip())
    return PRODUCT_COLOR_CODE_VARIANTS.get(key, VariantInfo())


def lookup_reincubate_variant(model_number: str, timeout: float = 3.0) -> VariantInfo:
    """Optionally resolve an Apple model number through Reincubate.

    This is disabled unless RI_DEVID_TOKEN is present. It keeps the app local by
    default while allowing a shop to plug in a commercial dataset later.
    """

    token = os.environ.get("RI_DEVID_TOKEN", "").strip()
    normalized = normalize_model_number(model_number)
    if not token or not normalized:
        return VariantInfo()

    url = f"https://di-api.reincubate.com/v1/apple-models/{quote(normalized)}/"
    request = Request(
        url,
        headers={
            "Authorization": f"Token {token}",
            "User-Agent": "iPhoneLabelPrinter/1.0",
        },
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, OSError):
        return VariantInfo()

    specification = payload.get("specification") or {}
    color = (specification.get("colour") or specification.get("color") or "").strip()
    storage = (specification.get("storage") or "").strip()
    return VariantInfo(color=color, storage=storage, source="Reincubate DeviceIdentifier")


def resolve_variant(
    *,
    product_type: str,
    model_number: str,
    device_color: str,
    enclosure_color: str,
) -> VariantInfo:
    """Resolve the best available color/storage metadata for a device."""

    for lookup in (
        lookup_local_model_variant(model_number),
        lookup_reincubate_variant(model_number),
        lookup_color_code_variant(product_type, device_color, enclosure_color),
    ):
        if lookup.found:
            return lookup
    return VariantInfo()
