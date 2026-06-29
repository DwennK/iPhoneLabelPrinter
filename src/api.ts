import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import type {
  CleanupHistoryResponse,
  CleanupLabelsResponse,
  ConnectedDevice,
  EnvironmentInfo,
  ExportHistoryResponse,
  GenerateLabelResponse,
  HistoryEntry,
  IPhoneInfo,
  LabelOptions,
  PrinterInfo,
} from "./types";

export function loadEnvironmentInfo() {
  return invoke<EnvironmentInfo>("environment_info");
}

export function scanConnectedDevices() {
  return invoke<ConnectedDevice[]>("scan_devices");
}

export function readIPhoneInfo(udid: string) {
  return invoke<IPhoneInfo>("read_device_info", { udid });
}

export function loadColorOptions(productType: string) {
  return invoke<string[]>("color_options", { productType });
}

export function listPrinters() {
  return invoke<PrinterInfo[]>("list_printers");
}

export function generateLabelPdf(info: IPhoneInfo, options: LabelOptions) {
  return invoke<GenerateLabelResponse>("generate_label", {
    request: { info, options },
  });
}

export function generateCalibrationLabelPdf(options: LabelOptions) {
  return invoke<GenerateLabelResponse>("generate_calibration_label", {
    request: { options },
  });
}

export function printPdf(
  printerName: string,
  pdfPath: string,
  options: LabelOptions,
) {
  return invoke<string>("print_label", {
    request: {
      printerName,
      pdfPath,
      labelWidthMm: options.labelWidthMm,
      labelHeightMm: options.labelHeightMm,
      orientation: options.labelOrientation,
      printScaleMode: options.printScaleMode,
    },
  });
}

export function readHistory() {
  return invoke<HistoryEntry[]>("read_history");
}

export function exportHistory(destinationPath: string | null) {
  return invoke<ExportHistoryResponse>("export_history", {
    request: { destinationPath },
  });
}

export function cleanupGeneratedLabels(retentionDays: number) {
  return invoke<CleanupLabelsResponse>("cleanup_generated_labels", {
    request: { retentionDays },
  });
}

export function cleanupHistory(retentionDays: number) {
  return invoke<CleanupHistoryResponse>("cleanup_history", {
    request: { retentionDays },
  });
}

export function openDataFile(path: string) {
  return invoke<void>("open_data_file", { path });
}

export { check, relaunch };
