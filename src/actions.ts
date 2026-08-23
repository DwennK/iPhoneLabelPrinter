import * as api from "./api";
import {
  DEFAULT_COLORS,
  EMPTY_INFO,
  type AppState,
  type EditableIPhoneField,
  type HistoryEntry,
} from "./types";
import { saveSettings } from "./settings";
import { effectiveLabelOptions, renderLabelPreview, updateAlerts } from "./views";
import {
  formatBatteryHealth,
  mergeColorOptions,
  validateLabelInfo,
} from "./domain/device-info";
import { findHistoryEntry } from "./domain/history";
import { historyLabelOptions } from "./domain/label-options";
import {
  bindButton,
  normalizeError,
  setError,
  withBusy,
  type RenderFn,
} from "./actions/runtime";
import {
  resetSettings,
  savePrinterProfile,
  saveSettingsFromForm,
  updateDefaultSettingFromControl,
  updatePrinterProfileFromControl,
} from "./actions/settings-actions";
import { checkForUpdates, installUpdate, refreshUpdateBadge, relaunchNow } from "./actions/update-actions";

export function attachEvents(app: HTMLElement, state: AppState, render: RenderFn) {
  const bind = (action: string, listener: () => void | Promise<void>) =>
    bindButton(app, action, listener, state, render);

  app.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.tab as AppState["activeTab"];
      render();
    });
  });

  bind("scan", () => scanDevices(state, render));
  bind("read-selected", () => readSelectedDevice(state, render));
  bind("clear", () => clearForm(state, render));
  bind("refresh-printers", () => refreshPrinters(state, render));
  bind("generate", () => generateLabel(state, render));
  bind("print", () => printLabel(state, render));
  bind("print-test-label", () => printCalibrationLabel(state, render));
  bind("open-pdf", () => openGeneratedPdf(state, render));
  bind("refresh-history", () => refreshHistory(state, render));
  bind("open-history-pdf", () => openSelectedHistoryPdf(state, render));
  bind("reprint-history", () => reprintSelectedHistory(state, render));
  bind("export-history", () => exportHistoryCsv(state, render));
  bind("save-settings", () => saveSettingsFromForm(state, render));
  bind("save-printer-profile", () => savePrinterProfile(state, render));
  bind("reset-settings", () => resetSettings(state, render));
  bind("cleanup-labels", () => cleanupGeneratedLabels(state, render));
  bind("open-support-log", () => openSupportLog(state, render));
  bind("check-updates", () => checkForUpdates(state, render));
  bind("install-update", () => installUpdate(state, render));
  bind("relaunch-now", () => relaunchNow(state, render));

  app.querySelectorAll<HTMLButtonElement>("[data-device-card]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedUdid = button.dataset.deviceCard || "";
      render();
    });
  });

  app.querySelector<HTMLSelectElement>("[data-printer]")?.addEventListener("change", (event) => {
    state.selectedPrinter = (event.target as HTMLSelectElement).value;
    state.settings.lastPrinterName = state.selectedPrinter;
    saveSettings(state.settings);
    state.generatedPdfPath = "";
    render();
  });

  app.querySelectorAll<HTMLInputElement>("[data-field]").forEach((input) => {
    input.addEventListener("input", () => {
      const key = input.dataset.field as EditableIPhoneField;
      state.info[key] = input.value;
      state.generatedPdfPath = "";
      updateGeneratedPathText(app, state);
      updateLabelPreview(app, state);
      updatePreviewStatus(app, state);
      updateAlerts(app, state);
    });
  });

  app.querySelector<HTMLInputElement>("[data-history-search]")?.addEventListener("input", (event) => {
    state.historyQuery = (event.target as HTMLInputElement).value;
    state.selectedHistoryId = "";
    render();
  });

  app.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-setting]").forEach((control) => {
    control.addEventListener("change", () => {
      updateDefaultSettingFromControl(state.settings, control);
      state.generatedPdfPath = "";
      updateLabelPreview(app, state);
      updatePreviewStatus(app, state);
    });
  });

  app.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-profile]").forEach((control) => {
    control.addEventListener("change", () => {
      updatePrinterProfileFromControl(state, control);
      state.generatedPdfPath = "";
      render();
    });
  });

  app.querySelectorAll<HTMLTableRowElement>("[data-history-id]").forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedHistoryId = row.dataset.historyId || "";
      render();
    });
  });
}

export async function bootstrap(state: AppState, render: RenderFn) {
  if (!api.isTauriRuntime()) {
    state.status = "Browser preview mode. Device, printer, history, and update services require Tauri.";
    render();
    return;
  }
  await Promise.allSettled([
    loadEnvironment(state, render),
    refreshPrinters(state, render),
    refreshHistory(state, render, false),
    refreshUpdateBadge(state, render),
  ]);
}

async function loadEnvironment(state: AppState, render: RenderFn) {
  try {
    state.environment = await api.loadEnvironmentInfo();
    render();
  } catch {
    state.environment = null;
  }
}

async function scanDevices(state: AppState, render: RenderFn) {
  await withBusy(state, render, "Scanning for connected iPhones and iPads...", async () => {
    const devices = await api.scanConnectedDevices();
    state.devices = devices;
    if (devices.length === 0) {
      state.status =
        "No iPhone or iPad detected. Connect by USB, unlock it, and trust this computer if prompted.";
      return;
    }
    state.selectedUdid = devices[0].udid;
    if (devices.length === 1) {
      await readDevice(state, devices[0].udid);
    } else {
      state.info = { ...EMPTY_INFO };
      state.generatedPdfPath = "";
      state.status = `${devices.length} devices detected. Select a device card to read.`;
    }
  });
}

async function readSelectedDevice(state: AppState, render: RenderFn) {
  if (!state.selectedUdid) return;
  await withBusy(state, render, `Reading device information from ${state.selectedUdid}...`, async () => {
    await readDevice(state, state.selectedUdid);
  });
}

async function readDevice(state: AppState, udid: string) {
  const info = await api.readIPhoneInfo(udid);
  state.info = { ...info, batteryHealth: formatBatteryHealth(info) };
  state.generatedPdfPath = "";
  await loadColorOptions(state, info.technicalModel, info.color);
  const notes = [
    info.modelIsUnknown ? "Unknown ProductType; verify the model manually." : "",
    info.colorSourceNote,
    info.variantSourceNote && info.variantSourceNote !== info.colorSourceNote
      ? info.variantSourceNote
      : "",
    !info.imei && !info.serialNumber
      ? "IMEI/serial was not available; enter an identifier manually before printing."
      : "",
  ].filter(Boolean);
  state.status = `Connected: ${info.deviceName || udid}${notes.length ? ` ${notes.join(" ")}` : ""}`;
}

async function loadColorOptions(state: AppState, productType: string, selectedColor = "") {
  const options = productType ? await api.loadColorOptions(productType).catch(() => []) : [];
  state.colorOptions = mergeColorOptions(options, DEFAULT_COLORS, selectedColor);
}

async function refreshPrinters(state: AppState, render: RenderFn) {
  await withBusy(state, render, "Refreshing printer list...", async () => {
    state.printers = await api.listPrinters();
    const defaultPrinter = state.printers.find((printer) => printer.isDefault);
    const lastPrinter = state.printers.find(
      (printer) => printer.name === state.settings.lastPrinterName,
    );
    state.selectedPrinter = lastPrinter?.name || defaultPrinter?.name || state.printers[0]?.name || "";
    state.settings.lastPrinterName = state.selectedPrinter;
    saveSettings(state.settings);
    state.status = state.printers.length
      ? "Printer list refreshed."
      : "No printers found. Add the thermal printer in the operating system, then refresh.";
  });
}

async function generateLabel(state: AppState, render: RenderFn) {
  if (!validateLabel(state, render, false)) return;
  const options = effectiveLabelOptions(state);
  await withBusy(state, render, "Generating label PDF...", async () => {
    const response = await api.generateLabelPdf(state.info, options);
    state.generatedPdfPath = response.pdfPath;
    state.status = `Label generated: ${response.pdfPath}`;
    await refreshHistory(state, render, false);
  });
}

async function printLabel(state: AppState, render: RenderFn) {
  if (!state.selectedPrinter) {
    setError(state, render, "No Printer Selected", "No printer is selected. Add or select a printer before printing.");
    return;
  }
  if (!validateLabel(state, render, true)) return;
  if (!state.generatedPdfPath) {
    await generateLabel(state, render);
    if (!state.generatedPdfPath) return;
  }
  const options = effectiveLabelOptions(state);
  await withBusy(state, render, "Submitting print job...", async () => {
    const message = await api.printPdf(state.selectedPrinter, state.generatedPdfPath, options);
    state.status = message || "Print job submitted.";
    await refreshHistory(state, render, false);
  });
}

async function printCalibrationLabel(state: AppState, render: RenderFn) {
  if (!state.selectedPrinter) {
    setError(state, render, "No Printer Selected", "No printer is selected. Add or select a printer before printing a calibration label.");
    return;
  }
  const options = effectiveLabelOptions(state);
  await withBusy(state, render, "Generating calibration label...", async () => {
    const response = await api.generateCalibrationLabelPdf(options);
    state.generatedPdfPath = response.pdfPath;
    const message = await api.printPdf(state.selectedPrinter, response.pdfPath, options);
    state.status = message || "Calibration label submitted.";
  });
}

async function refreshHistory(state: AppState, render: RenderFn, showStatus = true) {
  try {
    state.history = await api.readHistory();
    if (!findHistoryEntry(state.history, state.selectedHistoryId)) {
      state.selectedHistoryId = "";
    }
    if (showStatus) {
      state.status = "History refreshed.";
    }
    render();
  } catch (error) {
    if (showStatus) throw error;
  }
}

async function openGeneratedPdf(state: AppState, render: RenderFn) {
  if (!state.generatedPdfPath) return;
  await withBusy(state, render, "Opening generated label...", async () => {
    await api.openDataFile(state.generatedPdfPath);
    state.status = "Generated label opened.";
  });
}

async function openSelectedHistoryPdf(state: AppState, render: RenderFn) {
  const entry = selectedHistoryEntry(state);
  if (!entry) {
    setError(state, render, "No History Row Selected", "Select a history row first.");
    return;
  }
  if (entry.pdfPath) {
    await withBusy(state, render, "Opening history label...", async () => {
      await api.openDataFile(entry.pdfPath);
      state.status = "History label opened.";
    });
  }
}

async function reprintSelectedHistory(state: AppState, render: RenderFn) {
  const entry = selectedHistoryEntry(state);
  if (!entry) {
    setError(state, render, "No History Row Selected", "Select a history row to reprint.");
    return;
  }
  if (!state.selectedPrinter) {
    setError(state, render, "No Printer Selected", "No printer is selected. Add or select a printer before reprinting.");
    return;
  }
  const fallback = effectiveLabelOptions(state);
  const options = historyLabelOptions(entry, fallback);
  await withBusy(state, render, "Submitting history label...", async () => {
    const message = await api.printPdf(state.selectedPrinter, entry.pdfPath, options);
    state.status = message || "History label reprinted.";
    await refreshHistory(state, render, false);
  });
}

async function exportHistoryCsv(state: AppState, render: RenderFn) {
  await withBusy(state, render, "Exporting history CSV...", async () => {
    const response = await api.exportHistory(null);
    state.status = `History exported: ${response.destinationPath}`;
    await api.openDataFile(response.destinationPath);
  });
}

async function cleanupGeneratedLabels(state: AppState, render: RenderFn) {
  await withBusy(state, render, "Cleaning generated PDFs...", async () => {
    const retentionDays = Math.round(state.settings.labelRetentionDays);
    const [labelResponse, historyResponse] = await Promise.all([
      api.cleanupGeneratedLabels(retentionDays),
      api.cleanupHistory(retentionDays),
    ]);
    state.status = `Deleted ${labelResponse.deletedPaths.length} old label PDF(s) and ${historyResponse.deletedCount} history row(s).`;
    await refreshHistory(state, render, false);
  });
}

async function openSupportLog(state: AppState, render: RenderFn) {
  if (state.environment?.supportLogPath) {
    try {
      await api.openDataFile(state.environment.supportLogPath);
    } catch (error) {
      const appError = normalizeError(error);
      setError(state, render, appError.title, appError.message);
    }
  }
}

function clearForm(state: AppState, render: RenderFn) {
  state.info = { ...EMPTY_INFO };
  state.generatedPdfPath = "";
  state.status = "No device scanned.";
  render();
}

function validateLabel(state: AppState, render: RenderFn, requireIdentifier: boolean): boolean {
  const validation = validateLabelInfo(state.info, requireIdentifier);
  if (validation.error) {
    setError(state, render, validation.error.title, validation.error.message);
    return false;
  }
  if (validation.warning) {
    state.status = validation.warning;
  }
  return true;
}

function selectedHistoryEntry(state: AppState): HistoryEntry | null {
  return findHistoryEntry(state.history, state.selectedHistoryId);
}

function updateGeneratedPathText(app: HTMLElement, state: AppState) {
  const box = app.querySelector(".pdf-box strong");
  if (box) box.textContent = state.generatedPdfPath || "Label changed; generate it again before printing.";
}

function updatePreviewStatus(app: HTMLElement, state: AppState) {
  const badge = app.querySelector(".preview-status");
  if (!badge) return;
  badge.classList.toggle("is-current", Boolean(state.generatedPdfPath));
  badge.classList.toggle("is-stale", !state.generatedPdfPath);
  badge.textContent = state.generatedPdfPath ? "Up to date" : "Changed, regenerate";
}

function updateLabelPreview(app: HTMLElement, state: AppState) {
  const preview = app.querySelector(".label-preview-box");
  if (preview) preview.outerHTML = renderLabelPreview(state);
}
