from __future__ import annotations

import unittest
from unittest.mock import patch

import model_mapping
from model_mapping import marketing_name_for_product_type


class ModelMappingTest(unittest.TestCase):
    def test_maps_current_ipad_product_types(self) -> None:
        self.assertEqual(
            marketing_name_for_product_type("iPad16,3"),
            "iPad Pro 11-inch (M4) Wi-Fi",
        )
        self.assertEqual(
            marketing_name_for_product_type("iPad15,7"),
            "iPad (A16) Wi-Fi",
        )

    def test_unknown_product_type_stays_unknown(self) -> None:
        with patch.object(model_mapping, "fetch_marketing_name", return_value=""):
            self.assertIsNone(marketing_name_for_product_type("iPad99,99"))


if __name__ == "__main__":
    unittest.main()
