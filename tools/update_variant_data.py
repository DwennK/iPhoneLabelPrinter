from __future__ import annotations

import json
from pathlib import Path
from urllib.request import Request, urlopen


BASE_DIR = Path(__file__).resolve().parents[1]
OUTPUT_PATH = BASE_DIR / "variant_data.py"
USER_AGENT = "iPhoneLabelPrinter variant updater"
IOS_DEVICE_LIST_BASE = "https://raw.githubusercontent.com/pbakondy/ios-device-list/master"
IOS_DEVICE_LIST_FILES = (
    "iphone.json",
    "ipad.json",
    "ipad_air.json",
    "ipad_mini.json",
    "ipad_pro.json",
)


def _load_json(url: str) -> object:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def _load_existing_variants() -> dict[str, tuple[str, str]]:
    import sys

    sys.path.insert(0, str(BASE_DIR))
    from variant_data import MODEL_NUMBER_TO_VARIANT  # noqa: PLC0415

    return dict(MODEL_NUMBER_TO_VARIANT)


def _model_prefix(model_number: str) -> str:
    return model_number.strip().upper().split("/", 1)[0]


def _load_ios_device_list_variants() -> dict[str, tuple[str, str]]:
    variants: dict[str, tuple[str, str]] = {}
    for filename in IOS_DEVICE_LIST_FILES:
        payload = _load_json(f"{IOS_DEVICE_LIST_BASE}/{filename}")
        if not isinstance(payload, list):
            continue
        for device in payload:
            if not isinstance(device, dict):
                continue
            for model in device.get("Models") or []:
                if not isinstance(model, dict):
                    continue
                color = (model.get("Color") or "").strip()
                storage = (model.get("Storage") or "").strip()
                if not color and not storage:
                    continue
                for model_number in model.get("Model") or []:
                    if not isinstance(model_number, str):
                        continue
                    normalized = _model_prefix(model_number)
                    if normalized:
                        variants[normalized] = (color, storage)
    return variants


def main() -> None:
    variants = _load_ios_device_list_variants()
    variants.update(_load_existing_variants())

    lines = [
        '"""Generated Apple order-number variant data for label lookup.',
        "",
        "Generated from ios-device-list plus hand-maintained recent entries",
        "already present in this project. Keys are Apple order model-number",
        'prefixes without region suffixes.',
        '"""',
        "",
        "from __future__ import annotations",
        "",
        "MODEL_NUMBER_TO_VARIANT: dict[str, tuple[str, str]] = {",
    ]
    for model_number in sorted(variants):
        color, storage = variants[model_number]
        lines.append(f"    {model_number!r}: ({color!r}, {storage!r}),")
    lines.append("}")
    OUTPUT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT_PATH} with {len(variants)} model-number variants.")


if __name__ == "__main__":
    main()
