from __future__ import annotations

import unittest
from unittest.mock import patch

import variant_resolver
from variant_resolver import (
    color_options_for_product_type,
    lookup_color_code_variant,
    lookup_local_model_variant,
    normalize_model_number,
    resolve_variant,
)


class VariantResolverTest(unittest.TestCase):
    def test_normalize_model_number_strips_region_suffix(self) -> None:
        self.assertEqual(normalize_model_number("MG6K4QL/A"), "MG6K4")
        self.assertEqual(normalize_model_number(" mynh3 "), "MYNH3")

    def test_local_override_wins_for_observed_shop_variant(self) -> None:
        variant = lookup_local_model_variant("MYNH3LL/A")
        self.assertEqual(variant.color, "Black Titanium")
        self.assertEqual(variant.storage, "256 GB")

    def test_ipad_model_number_variant_is_available_locally(self) -> None:
        variant = lookup_local_model_variant("MC705LL/A")
        self.assertEqual(variant.color, "Black")
        self.assertEqual(variant.storage, "16 GB")

    def test_product_color_code_lookup_is_scoped_by_product_type(self) -> None:
        self.assertEqual(
            lookup_color_code_variant("iPhone17,1", "1", "1").color,
            "Black Titanium",
        )
        self.assertFalse(lookup_color_code_variant("iPhone16,1", "1", "1"))

    def test_current_ipad_color_options_are_available(self) -> None:
        self.assertEqual(
            color_options_for_product_type("iPad16,3"),
            ("Silver", "Space Black"),
        )

    def test_resolve_variant_skips_remote_lookup_when_local_table_matches(self) -> None:
        with patch.object(variant_resolver, "lookup_reincubate_variant") as remote:
            variant = resolve_variant(
                product_type="iPhone17,1",
                model_number="MYNH3LL/A",
                device_color="",
                enclosure_color="",
            )

        self.assertEqual(variant.color, "Black Titanium")
        remote.assert_not_called()


if __name__ == "__main__":
    unittest.main()
