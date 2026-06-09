from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import sys
import tempfile

from PySide6.QtCore import QObject, QSettings, QThread, QTimer, Qt, Signal
from PySide6.QtGui import QDesktopServices
from PySide6.QtCore import QUrl
from PySide6.QtPdf import QPdfDocument
from PySide6.QtPdfWidgets import QPdfView
from PySide6.QtWidgets import (
    QApplication,
    QComboBox,
    QDoubleSpinBox,
    QFormLayout,
    QGridLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QProgressDialog,
    QPushButton,
    QStatusBar,
    QSpinBox,
    QTabWidget,
    QVBoxLayout,
    QWidget,
    QInputDialog,
)

from iphone_reader import (
    ConnectedDevice,
    IPhoneReaderError,
    NO_DEVICE_MESSAGE,
    detect_devices,
    libimobiledevice_install_hint,
    read_iphone_info,
)
from label_generator import (
    LABEL_HEIGHT_MM,
    LABEL_WIDTH_MM,
    cleanup_generated_label_pdfs,
    generate_calibration_label_pdf,
    generate_label_pdf,
    write_label_pdf,
)
from printer import PrinterInfo, list_printers, submit_label_print_job
from utils import AppError, CommandNotFoundError, IPhoneInfo
from variant_resolver import color_options_for_product_type
from version import __version__
import updater


BASE_DIR = Path(__file__).resolve().parent
GENERATED_LABELS_DIR = BASE_DIR / "generated_labels"
ORGANIZATION_NAME = "iPhoneLabelPrinter"
APPLICATION_NAME = "iPhoneLabelPrinter"
SETTINGS_LABEL_WIDTH_KEY = "label/width_mm"
SETTINGS_LABEL_HEIGHT_KEY = "label/height_mm"
SETTINGS_LABEL_ORIENTATION_KEY = "label/orientation"
SETTINGS_LABEL_RETENTION_DAYS_KEY = "generated_labels/retention_days"
DEFAULT_LABEL_WIDTH_MM = float(LABEL_WIDTH_MM)
DEFAULT_LABEL_HEIGHT_MM = float(LABEL_HEIGHT_MM)
DEFAULT_LABEL_ORIENTATION = (
    "landscape" if DEFAULT_LABEL_WIDTH_MM >= DEFAULT_LABEL_HEIGHT_MM else "portrait"
)
DEFAULT_LABEL_RETENTION_DAYS = 30
MIN_LABEL_WIDTH_MM = 30.0
MIN_LABEL_HEIGHT_MM = 25.0
MAX_LABEL_SIZE_MM = 200.0
MAX_LABEL_RETENTION_DAYS = 365
LABEL_ORIENTATIONS = {
    "portrait": "Portrait",
    "landscape": "Landscape",
}

COLOR_CHOICES = [
    "",
    "Black",
    "White",
    "Blue",
    "Green",
    "Pink",
    "Purple",
    "Red",
    "Yellow",
    "Midnight",
    "Starlight",
    "Space Gray",
    "Silver",
    "Gold",
    "Rose Gold",
    "Graphite",
    "Pacific Blue",
    "Sierra Blue",
    "Alpine Green",
    "Midnight Green",
    "Deep Purple",
    "Space Black",
    "Natural Titanium",
    "Blue Titanium",
    "White Titanium",
    "Black Titanium",
    "Desert Titanium",
    "Ultramarine",
    "Teal",
    "Lavender",
    "Sage",
    "Mist Blue",
    "Cosmic Orange",
    "Deep Blue",
    "Sky Blue",
    "Light Gold",
    "Cloud White",
    "Soft Pink",
    "Coral",
    "Jet Black",
    "Black & Slate",
    "White & Silver",
]


class _UpdateCheckWorker(QObject):
    """Runs the GitHub release check off the UI thread (fail-open)."""

    finished = Signal(object)  # updater.ReleaseInfo | None

    def run(self) -> None:
        try:
            result = updater.check_for_update()
        except Exception:  # noqa: BLE001 — never let a check crash startup
            result = None
        self.finished.emit(result)


class _UpdateDownloadWorker(QObject):
    """Downloads a release asset off the UI thread, reporting progress."""

    progress = Signal(int, int)  # bytes_done, bytes_total
    finished = Signal(object)  # Path to downloaded file
    failed = Signal(str)

    def __init__(self, release: "updater.ReleaseInfo") -> None:
        super().__init__()
        self._release = release

    def run(self) -> None:
        try:
            path = updater.download_asset(
                self._release,
                progress=lambda done, total: self.progress.emit(done, total),
            )
        except Exception as exc:  # noqa: BLE001 — surfaced via failed signal
            self.failed.emit(str(exc))
            return
        self.finished.emit(path)


@dataclass(frozen=True)
class _ScanResult:
    devices: list[ConnectedDevice]
    selected_udid: str = ""
    info: IPhoneInfo | None = None


class _IPhoneScanWorker(QObject):
    """Runs USB detection and iPhone reads off the UI thread."""

    finished = Signal(object)  # _ScanResult
    failed = Signal(object)  # Exception

    def __init__(self, udid: str | None = None) -> None:
        super().__init__()
        self._udid = udid

    def run(self) -> None:
        try:
            if self._udid:
                info = read_iphone_info(self._udid)
                self.finished.emit(_ScanResult([], selected_udid=self._udid, info=info))
                return

            devices = detect_devices()
            if len(devices) == 1:
                selected = devices[0]
                info = read_iphone_info(selected.udid)
                self.finished.emit(
                    _ScanResult(devices, selected_udid=selected.udid, info=info)
                )
                return

            self.finished.emit(_ScanResult(devices))
        except Exception as exc:  # noqa: BLE001 — surfaced via failed signal
            self.failed.emit(exc)


class LabelPreview(QPdfView):
    """PDF-backed preview using the same renderer as printed labels."""

    def __init__(self) -> None:
        super().__init__()
        self._document = QPdfDocument()
        self._temp_dir = tempfile.TemporaryDirectory(prefix="iphone_label_preview_")
        self._preview_path = Path(self._temp_dir.name) / "preview.pdf"
        self.setMinimumSize(360, 230)
        self.setDocument(self._document)
        self.setPageMode(QPdfView.PageMode.SinglePage)
        self.setZoomMode(QPdfView.ZoomMode.FitInView)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        app = QApplication.instance()
        if app is not None:
            app.aboutToQuit.connect(self._document.close)

    def set_info(self, info: IPhoneInfo, label_width_mm: float, label_height_mm: float) -> None:
        write_label_pdf(
            info,
            self._preview_path,
            label_width_mm=label_width_mm,
            label_height_mm=label_height_mm,
        )
        self._document.close()
        self._document.load(str(self._preview_path))


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle(f"iPhoneLabelPrinter {__version__}")
        self.resize(1040, 680)
        self.current_pdf_path: Path | None = None
        self.connected_devices: list[ConnectedDevice] = []
        self.printers: list[PrinterInfo] = []
        self._scan_thread: QThread | None = None
        self._scan_worker: QObject | None = None
        self._update_thread: QThread | None = None
        self._update_worker: QObject | None = None
        self._update_in_progress = False
        self.settings = QSettings(ORGANIZATION_NAME, APPLICATION_NAME)
        self.label_width_mm = self.load_setting_float(
            SETTINGS_LABEL_WIDTH_KEY,
            DEFAULT_LABEL_WIDTH_MM,
        )
        self.label_height_mm = self.load_setting_float(
            SETTINGS_LABEL_HEIGHT_KEY,
            DEFAULT_LABEL_HEIGHT_MM,
        )
        self.label_orientation = self.load_label_orientation()
        self.label_retention_days = self.load_setting_int(
            SETTINGS_LABEL_RETENTION_DAYS_KEY,
            DEFAULT_LABEL_RETENTION_DAYS,
            minimum=0,
            maximum=MAX_LABEL_RETENTION_DAYS,
        )

        self.status_label = QLabel("No iPhone scanned.")
        self.status_label.setWordWrap(True)
        self.scan_button = QPushButton("Scan iPhone")
        self.scan_button.clicked.connect(self.scan_iphone)

        self.model_edit = QLineEdit()
        self.technical_model_edit = QLineEdit()
        self.storage_edit = QLineEdit()
        self.color_combo = QComboBox()
        self.color_combo.setEditable(True)
        self.color_combo.addItems(COLOR_CHOICES)
        self.imei_edit = QLineEdit()
        self.serial_edit = QLineEdit()
        self.device_name_edit = QLineEdit()
        self.ios_version_edit = QLineEdit()
        self.battery_health_edit = QLineEdit()

        for field in [
            self.model_edit,
            self.technical_model_edit,
            self.storage_edit,
            self.imei_edit,
            self.serial_edit,
            self.device_name_edit,
            self.ios_version_edit,
            self.battery_health_edit,
        ]:
            field.textChanged.connect(self.update_preview_from_form)
        self.color_combo.currentTextChanged.connect(self.update_preview_from_form)
        self.color_combo.lineEdit().textChanged.connect(self.update_preview_from_form)

        self.printer_combo = QComboBox()
        self.refresh_printers_button = QPushButton("Refresh Printers")
        self.refresh_printers_button.clicked.connect(self.refresh_printers)

        self.preview = LabelPreview()
        self.generated_path_label = QLabel("No label generated yet.")
        self.generated_path_label.setWordWrap(True)

        self.generate_button = QPushButton("Generate Label")
        self.generate_button.clicked.connect(self.generate_label)
        self.print_button = QPushButton("Print Label")
        self.print_button.clicked.connect(self.print_label)
        self.clear_button = QPushButton("Clear")
        self.clear_button.clicked.connect(self.clear_form)

        self.label_width_spin = QDoubleSpinBox()
        self.label_width_spin.setRange(MIN_LABEL_WIDTH_MM, MAX_LABEL_SIZE_MM)
        self.label_width_spin.setDecimals(1)
        self.label_width_spin.setSingleStep(1.0)
        self.label_width_spin.setSuffix(" mm")
        self.label_width_spin.setValue(self.label_width_mm)

        self.label_height_spin = QDoubleSpinBox()
        self.label_height_spin.setRange(MIN_LABEL_HEIGHT_MM, MAX_LABEL_SIZE_MM)
        self.label_height_spin.setDecimals(1)
        self.label_height_spin.setSingleStep(1.0)
        self.label_height_spin.setSuffix(" mm")
        self.label_height_spin.setValue(self.label_height_mm)

        self.label_orientation_combo = QComboBox()
        for orientation_key, orientation_label in LABEL_ORIENTATIONS.items():
            self.label_orientation_combo.addItem(orientation_label, orientation_key)
        orientation_index = self.label_orientation_combo.findData(self.label_orientation)
        self.label_orientation_combo.setCurrentIndex(max(orientation_index, 0))

        self.save_settings_button = QPushButton("Save Settings")
        self.save_settings_button.clicked.connect(self.save_settings)
        self.reset_label_size_button = QPushButton("Reset Label Size")
        self.reset_label_size_button.clicked.connect(self.reset_label_size_settings)
        self.label_retention_spin = QSpinBox()
        self.label_retention_spin.setRange(0, MAX_LABEL_RETENTION_DAYS)
        self.label_retention_spin.setSuffix(" days")
        self.label_retention_spin.setSpecialValueText("Disabled")
        self.label_retention_spin.setValue(self.label_retention_days)
        self.print_test_label_button = QPushButton("Print Test Label")
        self.print_test_label_button.clicked.connect(self.print_calibration_label)
        self.clean_labels_button = QPushButton("Clean Now")
        self.clean_labels_button.clicked.connect(self.cleanup_generated_labels)

        self._build_layout()
        self.setStatusBar(QStatusBar())
        self.refresh_printers(show_success=False)
        self.cleanup_generated_labels(show_success=False)
        self.update_preview_from_form()

        # Check for updates shortly after the window is shown so startup stays
        # responsive. Fully non-blocking and fail-open (see updater module).
        QTimer.singleShot(800, self.start_update_check)

    def _build_layout(self) -> None:
        root = QWidget()
        root_layout = QVBoxLayout(root)
        root_layout.setContentsMargins(12, 12, 12, 12)

        tabs = QTabWidget()
        tabs.addTab(self.build_label_tab(), "Label")
        tabs.addTab(self.build_settings_tab(), "Settings")
        root_layout.addWidget(tabs)

        self.setCentralWidget(root)

    def build_label_tab(self) -> QWidget:
        tab = QWidget()
        main_layout = QVBoxLayout(tab)
        main_layout.setContentsMargins(6, 12, 6, 6)
        main_layout.setSpacing(14)

        status_box = QGroupBox("Connection")
        status_layout = QHBoxLayout(status_box)
        status_layout.addWidget(self.status_label, 1)
        status_layout.addWidget(self.scan_button)
        main_layout.addWidget(status_box)

        content_layout = QGridLayout()
        content_layout.setColumnStretch(0, 1)
        content_layout.setColumnStretch(1, 1)
        content_layout.setHorizontalSpacing(18)

        form_box = QGroupBox("iPhone Information")
        form_layout = QFormLayout(form_box)
        form_layout.setFieldGrowthPolicy(QFormLayout.FieldGrowthPolicy.ExpandingFieldsGrow)
        form_layout.addRow("Model", self.model_edit)
        form_layout.addRow("Technical model", self.technical_model_edit)
        form_layout.addRow("Storage", self.storage_edit)
        form_layout.addRow("Color", self.color_combo)
        form_layout.addRow("IMEI", self.imei_edit)
        form_layout.addRow("Serial number", self.serial_edit)
        form_layout.addRow("Device name", self.device_name_edit)
        form_layout.addRow("iOS version", self.ios_version_edit)
        form_layout.addRow("Battery health", self.battery_health_edit)
        content_layout.addWidget(form_box, 0, 0)

        right_box = QGroupBox("Label Preview")
        right_layout = QVBoxLayout(right_box)
        right_layout.addWidget(self.preview, 1)
        right_layout.addWidget(self.generated_path_label)
        content_layout.addWidget(right_box, 0, 1)

        main_layout.addLayout(content_layout, 1)

        printer_box = QGroupBox("Printer")
        printer_layout = QHBoxLayout(printer_box)
        printer_layout.addWidget(QLabel("Printer"))
        printer_layout.addWidget(self.printer_combo, 1)
        printer_layout.addWidget(self.refresh_printers_button)
        main_layout.addWidget(printer_box)

        buttons_layout = QHBoxLayout()
        buttons_layout.addStretch(1)
        buttons_layout.addWidget(self.clear_button)
        buttons_layout.addWidget(self.generate_button)
        buttons_layout.addWidget(self.print_button)
        main_layout.addLayout(buttons_layout)

        return tab

    def build_settings_tab(self) -> QWidget:
        tab = QWidget()
        layout = QVBoxLayout(tab)
        layout.setContentsMargins(6, 12, 6, 6)
        layout.setSpacing(14)

        label_size_box = QGroupBox("Label Size")
        label_size_layout = QFormLayout(label_size_box)
        label_size_layout.setFieldGrowthPolicy(QFormLayout.FieldGrowthPolicy.ExpandingFieldsGrow)
        label_size_layout.addRow("Width", self.label_width_spin)
        label_size_layout.addRow("Height", self.label_height_spin)
        label_size_layout.addRow("Orientation", self.label_orientation_combo)
        layout.addWidget(label_size_box)

        generated_box = QGroupBox("Generated PDFs")
        generated_layout = QFormLayout(generated_box)
        generated_layout.setFieldGrowthPolicy(QFormLayout.FieldGrowthPolicy.ExpandingFieldsGrow)
        generated_layout.addRow("Keep labels", self.label_retention_spin)
        layout.addWidget(generated_box)

        buttons_layout = QHBoxLayout()
        buttons_layout.addStretch(1)
        buttons_layout.addWidget(self.clean_labels_button)
        buttons_layout.addWidget(self.print_test_label_button)
        buttons_layout.addWidget(self.reset_label_size_button)
        buttons_layout.addWidget(self.save_settings_button)
        layout.addLayout(buttons_layout)
        layout.addStretch(1)

        return tab

    def load_setting_float(self, key: str, default: float) -> float:
        value = self.settings.value(key, default)
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            return default
        if parsed <= 0:
            return default
        if key == SETTINGS_LABEL_WIDTH_KEY:
            return max(MIN_LABEL_WIDTH_MM, min(parsed, MAX_LABEL_SIZE_MM))
        if key == SETTINGS_LABEL_HEIGHT_KEY:
            return max(MIN_LABEL_HEIGHT_MM, min(parsed, MAX_LABEL_SIZE_MM))
        return parsed

    def load_setting_int(
        self,
        key: str,
        default: int,
        *,
        minimum: int,
        maximum: int,
    ) -> int:
        value = self.settings.value(key, default)
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return default
        return max(minimum, min(parsed, maximum))

    def load_label_orientation(self) -> str:
        value = self.settings.value(SETTINGS_LABEL_ORIENTATION_KEY, DEFAULT_LABEL_ORIENTATION)
        orientation = str(value)
        if orientation in LABEL_ORIENTATIONS:
            return orientation
        return DEFAULT_LABEL_ORIENTATION

    def effective_label_size_mm(self) -> tuple[float, float]:
        short_side = min(self.label_width_mm, self.label_height_mm)
        long_side = max(self.label_width_mm, self.label_height_mm)
        if self.label_orientation == "portrait":
            return short_side, long_side
        return long_side, short_side

    def save_settings(self) -> None:
        self.label_width_mm = self.label_width_spin.value()
        self.label_height_mm = self.label_height_spin.value()
        self.label_orientation = (
            self.label_orientation_combo.currentData() or DEFAULT_LABEL_ORIENTATION
        )
        self.label_retention_days = self.label_retention_spin.value()
        self.settings.setValue(SETTINGS_LABEL_WIDTH_KEY, self.label_width_mm)
        self.settings.setValue(SETTINGS_LABEL_HEIGHT_KEY, self.label_height_mm)
        self.settings.setValue(SETTINGS_LABEL_ORIENTATION_KEY, self.label_orientation)
        self.settings.setValue(SETTINGS_LABEL_RETENTION_DAYS_KEY, self.label_retention_days)
        self.settings.sync()
        self.current_pdf_path = None
        self.generated_path_label.setText("No label generated yet.")
        self.update_preview_from_form()
        self.cleanup_generated_labels(show_success=False)
        self.statusBar().showMessage("Settings saved.", 5000)

    def reset_label_size_settings(self) -> None:
        self.label_width_spin.setValue(DEFAULT_LABEL_WIDTH_MM)
        self.label_height_spin.setValue(DEFAULT_LABEL_HEIGHT_MM)
        orientation_index = self.label_orientation_combo.findData(DEFAULT_LABEL_ORIENTATION)
        self.label_orientation_combo.setCurrentIndex(max(orientation_index, 0))
        self.save_settings()

    def show_error(self, title: str, message: str) -> None:
        self.statusBar().showMessage(message, 10000)
        QMessageBox.critical(self, title, message)

    def show_info(self, title: str, message: str) -> None:
        self.statusBar().showMessage(message, 7000)
        QMessageBox.information(self, title, message)

    def set_color_choices(self, product_type: str = "", selected_color: str = "") -> None:
        current = selected_color.strip() or self.color_combo.currentText().strip()
        choices = ["", *color_options_for_product_type(product_type)]
        for color in COLOR_CHOICES:
            if color not in choices:
                choices.append(color)
        if current and current not in choices:
            choices.insert(1, current)

        self.color_combo.blockSignals(True)
        self.color_combo.clear()
        self.color_combo.addItems(choices)
        self.color_combo.setCurrentText(current)
        self.color_combo.blockSignals(False)

    def set_busy(self, busy: bool) -> None:
        self.scan_button.setEnabled(not busy)
        self.generate_button.setEnabled(not busy)
        self.print_button.setEnabled(not busy)
        self.refresh_printers_button.setEnabled(not busy)
        self.print_test_label_button.setEnabled(not busy)
        self.clean_labels_button.setEnabled(not busy)
        if busy:
            QApplication.setOverrideCursor(Qt.CursorShape.WaitCursor)
        else:
            QApplication.restoreOverrideCursor()

    def scan_iphone(self) -> None:
        self.start_scan_worker()

    def start_scan_worker(self, udid: str | None = None) -> None:
        if self._scan_thread is not None:
            return

        self.set_busy(True)
        if udid:
            self.status_label.setText(f"Reading iPhone information from {udid}...")
        else:
            self.status_label.setText("Scanning for connected iPhones...")

        thread = QThread(self)
        worker = _IPhoneScanWorker(udid)
        worker.moveToThread(thread)
        thread.started.connect(worker.run)
        worker.finished.connect(self._on_scan_finished)
        worker.failed.connect(self._on_scan_failed)
        worker.finished.connect(thread.quit)
        worker.failed.connect(thread.quit)
        worker.finished.connect(worker.deleteLater)
        worker.failed.connect(worker.deleteLater)
        thread.finished.connect(self._clear_scan_thread)
        self._scan_thread = thread
        self._scan_worker = worker
        thread.start()

    def start_scan_worker_when_idle(self, udid: str) -> None:
        if self._scan_thread is None:
            self.start_scan_worker(udid)
            return
        QTimer.singleShot(20, lambda: self.start_scan_worker_when_idle(udid))

    def _clear_scan_thread(self) -> None:
        if self._scan_thread is not None:
            self._scan_thread.deleteLater()
        self._scan_thread = None
        self._scan_worker = None

    def _on_scan_finished(self, result: object) -> None:
        if not isinstance(result, _ScanResult):
            self.set_busy(False)
            self.show_error("Scan Failed", "Unexpected scan result.")
            return

        self.connected_devices = result.devices
        if not result.devices and result.info is None:
            self.set_busy(False)
            message = NO_DEVICE_MESSAGE
            self.status_label.setText(message)
            self.show_error("No iPhone Detected", message)
            return

        if len(result.devices) > 1 and result.info is None:
            self.set_busy(False)
            labels = [device.display_name for device in result.devices]
            choice, ok = QInputDialog.getItem(
                self,
                "Select iPhone",
                "Multiple iPhones were detected:",
                labels,
                0,
                False,
            )
            if not ok:
                self.status_label.setText("Scan cancelled.")
                return
            selected = result.devices[labels.index(choice)]
            self.start_scan_worker_when_idle(selected.udid)
            return

        if result.info is None:
            self.set_busy(False)
            self.status_label.setText("Scan did not return iPhone information.")
            self.show_error("Scan Failed", "Scan did not return iPhone information.")
            return

        info = result.info
        self.populate_form(info)

        notes = []
        if info.model_is_unknown:
            notes.append("Unknown ProductType; verify the model manually.")
        if info.color_source_note:
            notes.append(info.color_source_note)
        if info.variant_source_note and info.variant_source_note != info.color_source_note:
            notes.append(info.variant_source_note)
        if not info.imei:
            notes.append("IMEI was not available; enter it manually before printing.")

        status = f"Connected: {info.device_name or result.selected_udid or info.udid}"
        if notes:
            status += " " + " ".join(notes)
        self.status_label.setText(status)
        self.set_busy(False)

    def _on_scan_failed(self, exc: object) -> None:
        self.set_busy(False)
        if isinstance(exc, CommandNotFoundError):
            self.status_label.setText("libimobiledevice command is missing.")
            self.show_error(
                "Missing Dependency",
                f"{exc}\n\n{libimobiledevice_install_hint()}",
            )
            return
        if isinstance(exc, IPhoneReaderError):
            self.status_label.setText(str(exc))
            self.show_error(exc.title, str(exc))
            return
        if isinstance(exc, AppError):
            self.status_label.setText(str(exc))
            self.show_error("Scan Failed", str(exc))
            return
        self.status_label.setText(str(exc))
        self.show_error("Scan Failed", str(exc))

    def populate_form(self, info: IPhoneInfo) -> None:
        self.model_edit.setText(info.marketing_model)
        self.technical_model_edit.setText(info.technical_model)
        self.storage_edit.setText(info.storage)
        self.set_color_choices(info.technical_model, info.color)
        self.imei_edit.setText(info.imei)
        self.serial_edit.setText(info.serial_number)
        self.device_name_edit.setText(info.device_name)
        self.ios_version_edit.setText(info.ios_version)
        battery_text = info.battery_health
        if info.battery_cycle_count:
            battery_text = f"{battery_text} ({info.battery_cycle_count} cycles)" if battery_text else f"{info.battery_cycle_count} cycles"
        self.battery_health_edit.setText(battery_text)
        self.current_pdf_path = None
        self.generated_path_label.setText("No label generated yet.")
        self.update_preview_from_form()

    def form_info(self) -> IPhoneInfo:
        return IPhoneInfo(
            marketing_model=self.model_edit.text().strip(),
            technical_model=self.technical_model_edit.text().strip(),
            model_number="",
            storage=self.storage_edit.text().strip(),
            color=self.color_combo.currentText().strip(),
            imei=self.imei_edit.text().strip(),
            serial_number=self.serial_edit.text().strip(),
            device_name=self.device_name_edit.text().strip(),
            ios_version=self.ios_version_edit.text().strip(),
            battery_health=self.battery_health_edit.text().strip(),
        )

    def invalidate_generated_label(self) -> None:
        if self.current_pdf_path is None:
            return
        self.current_pdf_path = None
        self.generated_path_label.setText("Label changed; generate it again before printing.")

    def update_preview_from_form(self) -> None:
        self.invalidate_generated_label()
        label_width_mm, label_height_mm = self.effective_label_size_mm()
        self.preview.set_info(self.form_info(), label_width_mm, label_height_mm)

    def refresh_printers(self, show_success: bool = True) -> None:
        try:
            printers = list_printers()
        except CommandNotFoundError as exc:
            self.printer_combo.clear()
            self.show_error("Printer Command Missing", str(exc))
            return
        except AppError as exc:
            self.printer_combo.clear()
            self.show_error("Printer Error", str(exc))
            return

        self.printers = printers
        self.printer_combo.clear()
        if not printers:
            self.printer_combo.addItem("No printers found", "")
            if show_success:
                self.show_error(
                    "No Printers Found",
                    "No printer is installed. Add the thermal printer in the operating "
                    "system's printer settings, then click Refresh Printers.",
                )
            return

        for printer in printers:
            label = f"{printer.name} (default)" if printer.is_default else printer.name
            self.printer_combo.addItem(label, printer.name)

        default_index = next((i for i, printer in enumerate(printers) if printer.is_default), 0)
        self.printer_combo.setCurrentIndex(default_index)
        if show_success:
            self.statusBar().showMessage("Printer list refreshed.", 4000)

    def validate_label_fields(self, require_imei: bool = False) -> bool:
        info = self.form_info()
        if not info.marketing_model:
            self.show_error("Missing Model", "Enter a model before generating a label.")
            return False
        if require_imei and not info.imei:
            self.show_error("Missing IMEI", "Enter the IMEI before printing this label.")
            return False
        if not info.imei:
            proceed = QMessageBox.question(
                self,
                "IMEI Missing",
                "IMEI is missing. Generate the label with a manual-entry warning?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No,
            )
            return proceed == QMessageBox.StandardButton.Yes
        return True

    def generate_label(self) -> None:
        if not self.validate_label_fields(require_imei=False):
            return

        try:
            info = self.form_info()
            label_width_mm, label_height_mm = self.effective_label_size_mm()
            self.current_pdf_path = generate_label_pdf(
                info,
                GENERATED_LABELS_DIR,
                label_width_mm=label_width_mm,
                label_height_mm=label_height_mm,
            )
            self.generated_path_label.setText(f"Generated: {self.current_pdf_path}")
            self.statusBar().showMessage(f"Label generated: {self.current_pdf_path.name}", 7000)
        except Exception as exc:
            self.show_error("Label Generation Failed", str(exc))

    def cleanup_generated_labels(self, show_success: bool = True) -> None:
        self.label_retention_days = self.label_retention_spin.value()
        deleted = cleanup_generated_label_pdfs(
            GENERATED_LABELS_DIR,
            retention_days=self.label_retention_days,
        )
        if show_success:
            self.statusBar().showMessage(f"Deleted {len(deleted)} old label PDF(s).", 5000)

    def print_calibration_label(self) -> None:
        printer_name = self.printer_combo.currentData()
        if not printer_name:
            self.show_error(
                "No Printer Selected",
                "No printer is selected. Add or select a printer before printing.",
            )
            return

        try:
            label_width_mm, label_height_mm = self.effective_label_size_mm()
            pdf_path = generate_calibration_label_pdf(
                GENERATED_LABELS_DIR,
                label_width_mm=label_width_mm,
                label_height_mm=label_height_mm,
            )
            output = submit_label_print_job(
                printer_name,
                pdf_path,
                label_width_mm,
                label_height_mm,
                self.label_orientation,
            )
            self.current_pdf_path = None
            self.generated_path_label.setText(f"Generated test label: {pdf_path}")
            self.statusBar().showMessage(output or "Test label submitted.", 7000)
        except AppError as exc:
            self.show_error("Print Failed", str(exc))
        except Exception as exc:
            self.show_error("Test Label Failed", str(exc))

    def print_label(self) -> None:
        printer_name = self.printer_combo.currentData()
        if not printer_name:
            self.show_error(
                "No Printer Selected",
                "No printer is selected. Add or select a printer before printing.",
            )
            return

        if not self.validate_label_fields(require_imei=True):
            return

        if self.current_pdf_path is None or not self.current_pdf_path.exists():
            self.generate_label()
            if self.current_pdf_path is None:
                return

        try:
            label_width_mm, label_height_mm = self.effective_label_size_mm()
            output = submit_label_print_job(
                printer_name,
                self.current_pdf_path,
                label_width_mm,
                label_height_mm,
                self.label_orientation,
            )
            message = "Print job submitted."
            if output:
                message = output
            self.statusBar().showMessage(message, 7000)
        except AppError as exc:
            self.show_error("Print Failed", str(exc))

    def clear_form(self) -> None:
        self.model_edit.clear()
        self.technical_model_edit.clear()
        self.storage_edit.clear()
        self.set_color_choices("", "")
        self.imei_edit.clear()
        self.serial_edit.clear()
        self.device_name_edit.clear()
        self.ios_version_edit.clear()
        self.battery_health_edit.clear()
        self.current_pdf_path = None
        self.generated_path_label.setText("No label generated yet.")
        self.status_label.setText("No iPhone scanned.")
        self.update_preview_from_form()

    # --- Auto-update -----------------------------------------------------

    def start_update_check(self) -> None:
        if self._update_in_progress or self._update_thread is not None:
            return
        thread = QThread(self)
        worker = _UpdateCheckWorker()
        worker.moveToThread(thread)
        thread.started.connect(worker.run)
        worker.finished.connect(self._on_update_check_finished)
        worker.finished.connect(thread.quit)
        worker.finished.connect(worker.deleteLater)
        thread.finished.connect(self._clear_update_thread)
        self._update_thread = thread
        self._update_worker = worker
        thread.start()

    def _clear_update_thread(self) -> None:
        if self._update_thread is not None:
            self._update_thread.deleteLater()
        self._update_thread = None
        self._update_worker = None

    def _on_update_check_finished(self, release: object) -> None:
        if release is None:
            return
        notes = release.notes.strip()
        if len(notes) > 600:
            notes = notes[:600].rstrip() + "..."
        detail = (
            f"A new version is available.\n\n"
            f"Current version: {__version__}\n"
            f"New version: {release.version}\n\n"
            "Install it now? The app will restart."
        )
        box = QMessageBox(self)
        box.setIcon(QMessageBox.Icon.Information)
        box.setWindowTitle("Update Available")
        box.setText(detail)
        if notes:
            box.setDetailedText(notes)
        box.setStandardButtons(
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
        )
        box.setDefaultButton(QMessageBox.StandardButton.Yes)
        if box.exec() != QMessageBox.StandardButton.Yes:
            self.statusBar().showMessage("Update postponed.", 5000)
            return

        # Self-update only works in the packaged build. From a source/dev run
        # there is no executable to replace, so open the release page instead.
        if not updater.is_frozen():
            if release.html_url:
                QDesktopServices.openUrl(QUrl(release.html_url))
            self.show_info(
                "Update From Source",
                "This is a source build. The release page has been opened in your "
                "browser; update the checkout with git to get the new version.",
            )
            return

        self._download_and_install(release)

    def _download_and_install(self, release: object) -> None:
        self._update_in_progress = True
        progress = QProgressDialog("Downloading update...", "Cancel", 0, 100, self)
        progress.setWindowTitle("Updating")
        progress.setWindowModality(Qt.WindowModality.WindowModal)
        progress.setMinimumDuration(0)
        progress.setAutoClose(False)
        progress.setAutoReset(False)

        thread = QThread(self)
        worker = _UpdateDownloadWorker(release)
        worker.moveToThread(thread)
        thread.started.connect(worker.run)

        def on_progress(done: int, total: int) -> None:
            if total > 0:
                progress.setMaximum(total)
                progress.setValue(done)
            else:
                progress.setMaximum(0)  # busy indicator when length unknown

        def cleanup() -> None:
            thread.quit()
            thread.wait()
            worker.deleteLater()
            thread.deleteLater()
            progress.close()
            self._update_in_progress = False

        def on_finished(path: object) -> None:
            cleanup()
            try:
                updater.apply_update_and_restart(path)
            except updater.UpdateError as exc:
                self.show_error("Update Failed", str(exc))
                return
            QApplication.quit()

        def on_failed(message: str) -> None:
            cleanup()
            self.show_error("Update Failed", f"Could not download the update:\n{message}")

        worker.progress.connect(on_progress)
        worker.finished.connect(on_finished)
        worker.failed.connect(on_failed)
        progress.canceled.connect(cleanup)

        thread.start()
        progress.show()


def main() -> int:
    app = QApplication(sys.argv)
    app.setApplicationName("iPhoneLabelPrinter")
    app.setApplicationVersion(__version__)
    window = MainWindow()
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
