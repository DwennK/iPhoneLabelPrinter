from __future__ import annotations

import unittest

from updater import is_newer, parse_version


class UpdaterTest(unittest.TestCase):
    def test_parse_version_ignores_prefix_and_suffix_text(self) -> None:
        self.assertEqual(parse_version("v1.2.3"), (1, 2, 3))
        self.assertEqual(parse_version("1.2.3-beta"), (1, 2, 3))

    def test_is_newer_compares_numeric_segments(self) -> None:
        self.assertTrue(is_newer("1.0.10", current="1.0.2"))
        self.assertFalse(is_newer("1.0.2", current="1.0.2"))
        self.assertFalse(is_newer("1.0.1", current="1.0.2"))


if __name__ == "__main__":
    unittest.main()
