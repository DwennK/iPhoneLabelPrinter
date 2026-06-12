from __future__ import annotations

from datetime import datetime
from pathlib import Path
import tempfile
import unittest

from history import (
    append_generated_entry,
    export_history,
    mark_label_printed,
    read_history,
)
from utils import IPhoneInfo


class HistoryTest(unittest.TestCase):
    def test_append_generated_entry_persists_label_details(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            history_path = Path(tmp) / "history.csv"
            pdf_path = Path(tmp) / "label.pdf"

            append_generated_entry(
                history_path,
                IPhoneInfo(
                    marketing_model="iPhone 15",
                    technical_model="iPhone15,4",
                    storage="128 GB",
                    color="Blue",
                    imei="355026429560655",
                    serial_number="ABC123",
                    battery_health="86%",
                ),
                pdf_path,
                label_width_mm=62,
                label_height_mm=40,
                label_orientation="landscape",
                created_at=datetime(2026, 6, 12, 10, 30),
            )

            entries = read_history(history_path)

            self.assertEqual(len(entries), 1)
            self.assertEqual(entries[0].created_at, "2026-06-12 10:30:00")
            self.assertEqual(entries[0].marketing_model, "iPhone 15")
            self.assertEqual(entries[0].label_width_mm, "62")
            self.assertEqual(entries[0].label_orientation, "landscape")

    def test_mark_label_printed_updates_matching_entry(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            history_path = Path(tmp) / "history.csv"
            pdf_path = Path(tmp) / "label.pdf"
            append_generated_entry(history_path, IPhoneInfo(marketing_model="iPhone 15"), pdf_path)

            marked = mark_label_printed(
                history_path,
                pdf_path,
                "Thermal Printer",
                printed_at=datetime(2026, 6, 12, 11, 0),
            )

            self.assertIsNotNone(marked)
            entries = read_history(history_path)
            self.assertEqual(entries[0].printed_at, "2026-06-12 11:00:00")
            self.assertEqual(entries[0].printer_name, "Thermal Printer")

    def test_export_history_creates_csv_copy(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            history_path = Path(tmp) / "history.csv"
            export_path = Path(tmp) / "export.csv"
            append_generated_entry(history_path, IPhoneInfo(marketing_model="iPhone 15"), Path(tmp) / "label.pdf")

            export_history(history_path, export_path)

            self.assertTrue(export_path.exists())
            self.assertEqual(export_path.read_text(encoding="utf-8"), history_path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
