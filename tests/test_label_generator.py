from __future__ import annotations

from datetime import datetime
import os
from pathlib import Path
import tempfile
import unittest

from label_generator import (
    cleanup_generated_label_pdfs,
    write_calibration_label_pdf,
    write_label_pdf,
)
from utils import IPhoneInfo


class LabelGeneratorTest(unittest.TestCase):
    def test_write_label_pdf_creates_pdf(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "label.pdf"
            write_label_pdf(
                IPhoneInfo(
                    marketing_model="iPhone 15",
                    storage="128 GB",
                    color="Blue",
                    imei="355026429560655",
                    serial_number="ABC123",
                ),
                path,
                created_at=datetime(2026, 6, 9, 12, 0),
            )

            self.assertTrue(path.exists())
            self.assertEqual(path.read_bytes()[:4], b"%PDF")

    def test_write_calibration_label_pdf_creates_pdf(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "calibration.pdf"
            write_calibration_label_pdf(
                path,
                label_width_mm=62,
                label_height_mm=40,
                created_at=datetime(2026, 6, 9, 12, 0),
            )

            self.assertTrue(path.exists())
            self.assertEqual(path.read_bytes()[:4], b"%PDF")

    def test_cleanup_generated_label_pdfs_deletes_only_old_pdfs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp)
            old_pdf = output_dir / "old.pdf"
            new_pdf = output_dir / "new.pdf"
            old_txt = output_dir / "old.txt"
            old_pdf.write_bytes(b"%PDF old")
            new_pdf.write_bytes(b"%PDF new")
            old_txt.write_text("keep", encoding="utf-8")

            now = datetime(2026, 6, 9, 12, 0)
            old_timestamp = now.timestamp() - (31 * 24 * 60 * 60)
            new_timestamp = now.timestamp()
            os.utime(old_pdf, (old_timestamp, old_timestamp))
            os.utime(new_pdf, (new_timestamp, new_timestamp))
            os.utime(old_txt, (old_timestamp, old_timestamp))

            deleted = cleanup_generated_label_pdfs(output_dir, retention_days=30, now=now)

            self.assertEqual(deleted, [old_pdf])
            self.assertFalse(old_pdf.exists())
            self.assertTrue(new_pdf.exists())
            self.assertTrue(old_txt.exists())


if __name__ == "__main__":
    unittest.main()
