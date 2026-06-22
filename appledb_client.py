"""Small AppleDB lookup helpers used as an online fallback for new devices."""

from __future__ import annotations

from functools import lru_cache
import json
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


APPLEDB_DEVICE_URL = "https://api.appledb.dev/device/{product_type}.json"
USER_AGENT = "iPhoneLabelPrinter/1.0"


@lru_cache(maxsize=128)
def fetch_device(product_type: str, timeout: float = 2.5) -> dict:
    normalized = product_type.strip()
    if not normalized.startswith(("iPhone", "iPad")):
        return {}

    url = APPLEDB_DEVICE_URL.format(product_type=quote(normalized, safe=""))
    request = Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, OSError):
        return {}
    return payload if isinstance(payload, dict) else {}


def marketing_name_for_product_type(product_type: str) -> str:
    device = fetch_device(product_type)
    name = device.get("name")
    return name.strip() if isinstance(name, str) else ""


def color_options_for_product_type(product_type: str) -> tuple[str, ...]:
    device = fetch_device(product_type)
    names: list[str] = []
    for color in device.get("colors") or []:
        if not isinstance(color, dict):
            continue
        name = color.get("name")
        if isinstance(name, str) and name.strip() and name.strip() not in names:
            names.append(name.strip())
    return tuple(names)
