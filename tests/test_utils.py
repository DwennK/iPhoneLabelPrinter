from __future__ import annotations

import unittest

from utils import normalize_imei, round_storage_capacity, sanitize_filename_part


class UtilsTest(unittest.TestCase):
    def test_normalize_imei_keeps_digits_only(self) -> None:
        self.assertEqual(normalize_imei("35 502-642/9560655"), "355026429560655")

    def test_round_storage_capacity_uses_commercial_sizes(self) -> None:
        self.assertEqual(round_storage_capacity(15_900_000_000), "16 GB")
        self.assertEqual(round_storage_capacity(31_900_000_000), "32 GB")
        self.assertEqual(round_storage_capacity(127_900_000_000), "128 GB")
        self.assertEqual(round_storage_capacity(1_000_000_000_000), "1 TB")

    def test_sanitize_filename_part_has_fallback(self) -> None:
        self.assertEqual(sanitize_filename_part(" iPhone 15 / Blue "), "iPhone_15_Blue")
        self.assertEqual(sanitize_filename_part("///"), "label")


if __name__ == "__main__":
    unittest.main()
