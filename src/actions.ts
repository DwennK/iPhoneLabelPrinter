import * as api from "./api";
import {
  DEFAULT_COLORS,
  EMPTY_INFO,
  type AppError,
  type AppSettings,
  type AppState,
  type HistoryEntry,
  type IPhoneInfo,
  type LabelOptions,
  type PrinterProfile,
} from "./types";
import {
  DEFAULT_SETTINGS,
  nonNegativeNumber,
  normalizePrintScaleMode,
  positiveNumber,
  saveSettings,
  upsertPrinterProfile,
} from "./settings";
import {
  effectiveLabelOptions,
  filteredHistory,
  normalizeImei,
  selectedPrinterProfile,
  updateAlerts,
} from "./views";

type RenderFn = () => void;

export function attachEvents(app: HTMLElement, state: AppState, render: RenderFn) {
  app.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.tab as AppState["activeTab"];
      render();
    });
  });

  bindButton(app, "scan", () => scanDevices(state, render));
  bindButton(app, "read-selected", () => readSelectedDevice(state, render));
  bindButton(app, "clear", () => clearForm(state, render));
  bindButton(app, "refresh-printers", () => refreshPrinters(state, render));
  bindButton(app, "generate", () => generateLabel(state, render));
  bindButton(app, "print", () => printLabel(state, render));
  bindButton(app, "print-test-label", () => printCalibrationLabel(state, render));
  bindButton(app, "open-pdf", () => openGeneratedPdf(state));
  bindButton(app, "refresh-history", () => refreshHistory(state, render));
  bindButton(app, "open-history-pdf", () => openSelectedHistoryPdf(app, state, render));
  bindButton(app, "reprint-history", () => reprintSelectedHistory(app, state, render));
  bindButton(app, "export-history", () => exportHistoryCsv(state, render));
  bindButton(app, "save-settings", () => saveSettingsFromForm(state, render));
  bindButton(app, "save-printer-profile", () => savePrinterProfile(state, render));
  bindButton(app, "reset-settings", () => resetSettings(state, render));
  bindButton(app, "cleanup-labels", () => cleanupGeneratedLabels(state, render));
  bindButton(app, "check-updates", () => checkForUpdates(state, render));

  app.querySelector<HTMLSelectElement>("[data-device]")?.addEventListener("change", (event) => {
    state.selectedUdid = (event.target as HTMLSelectElement).value;
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
      const key = input.dataset.field as keyof IPhoneInfo;
      state.info[key] = input.value as never;
      state.generatedPdfPath = "";
      updateGeneratedPathText(app, state);
      updateAlerts(app, state);
    });
  });

  app.querySelector<HTMLInputElement>("[data-history-search]")?.addEventListener("input", (event) => {
    state.historyQuery = (event.target as HTMLInputElement).value;
    render();
  });

  app.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-setting]").forEach((control) => {
    control.addEventListener("change", () => {
      updateDefaultSettingFromControl(state.settings, control);
      state.generatedPdfPath = "";
    });
  });

  app.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-profile]").forEach((control) => {
    control.addEventListener("change", () => {
      updatePrinterProfileFromControl(state, control);
      state.generatedPdfPath = "";
      render();
    });
  });

  app.querySelectorAll<HTMLTableRowElement>("[data-history-index]").forEach((row) => {
    row.addEventListener("click", () => {
      app.querySelectorAll("tr.is-selected").forEach((selected) => selected.classList.remove("is-selected"));
      row.classList.add("is-selected");
    });
  });
}

export async function bootstrap(state: AppState, render: RenderFn) {
  await Promise.allSettled([
    loadEnvironment(state, render),
    refreshPrinters(state, render),
    refreshHistory(state, render, false),
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
      state.status = `${devices.length} devices detected. Select the one to read.`;
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
  const batteryHealth = info.batteryCycleCount
    ? info.batteryHealth
      ? `${info.batteryHealth} (${info.batteryCycleCount} cycles)`
      : `${info.batteryCycleCount} cycles`
    : info.batteryHealth;
  state.info = { ...info, batteryHealth };
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
  state.colorOptions = ["", ...options, ...DEFAULT_COLORS, selectedColor].filter(
    (color, index, values) => values.indexOf(color) === index,
  );
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
  state.history = await api.readHistory().catch(() => []);
  if (showStatus) {
    state.status = "History refreshed.";
  }
  render();
}

async function openGeneratedPdf(state: AppState) {
  if (state.generatedPdfPath) {
    await api.openPath(state.generatedPdfPath);
  }
}

async function openSelectedHistoryPdf(app: HTMLElement, state: AppState, render: RenderFn) {
  const entry = selectedHistoryEntry(app, state);
  if (!entry) {
    setError(state, render, "No History Row Selected", "Select a history row first.");
    return;
  }
  if (entry.pdfPath) {
    await api.openPath(entry.pdfPath);
  }
}

async function reprintSelectedHistory(app: HTMLElement, state: AppState, render: RenderFn) {
  const entry = selectedHistoryEntry(app, state);
  if (!entry) {
    setError(state, render, "No History Row Selected", "Select a history row to reprint.");
    return;
  }
  if (!state.selectedPrinter) {
    setError(state, render, "No Printer Selected", "No printer is selected. Add or select a printer before reprinting.");
    return;
  }
  const fallback = effectiveLabelOptions(state);
  const options: LabelOptions = {
    labelWidthMm: positiveNumber(entry.labelWidthMm, fallback.labelWidthMm),
    labelHeightMm: positiveNumber(entry.labelHeightMm, fallback.labelHeightMm),
    labelOrientation:
      entry.labelOrientation === "portrait" || entry.labelOrientation === "landscape"
        ? entry.labelOrientation
        : fallback.labelOrientation,
    printScaleMode: normalizePrintScaleMode(entry.printScaleMode || fallback.printScaleMode),
  };
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
    await api.openPath(response.destinationPath);
  });
}

async function cleanupGeneratedLabels(state: AppState, render: RenderFn) {
  await withBusy(state, render, "Cleaning generated PDFs...", async () => {
    const response = await api.cleanupGeneratedLabels(Math.round(state.settings.labelRetentionDays));
    state.status = `Deleted ${response.deletedPaths.length} old label PDF(s).`;
  });
}

async function checkForUpdates(state: AppState, render: RenderFn) {
  await withBusy(state, render, "Checking for updates...", async () => {
    const update = await api.check({ timeout: 30_000 });
    if (!update) {
      state.status = "No update available.";
      render();
      return;
    }

    state.status = `Installing iPhoneLabelPrinter ${update.version}...`;
    render();
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        state.status = "Downloading update...";
      } else if (event.event === "Finished") {
        state.status = "Installing update...";
      }
      render();
    });
    state.status = "Update installed. Relaunching...";
    render();
    await api.relaunch();
  });
}

function clearForm(state: AppState, render: RenderFn) {
  state.info = { ...EMPTY_INFO };
  state.generatedPdfPath = "";
  state.status = "No device scanned.";
  render();
}

function saveSettingsFromForm(state: AppState, render: RenderFn) {
  saveSettings(state.settings);
  state.generatedPdfPath = "";
  state.status = "Settings saved.";
  render();
}

function savePrinterProfile(state: AppState, render: RenderFn) {
  if (!state.selectedPrinter) {
    setError(state, render, "No Printer Selected", "Select a printer before saving a profile.");
    return;
  }
  upsertPrinterProfile(state.settings, state.selectedPrinter, selectedPrinterProfile(state));
  state.settings.lastPrinterName = state.selectedPrinter;
  saveSettings(state.settings);
  state.generatedPdfPath = "";
  state.status = `Profile saved for ${state.selectedPrinter}.`;
  render();
}

function resetSettings(state: AppState, render: RenderFn) {
  state.settings = { ...DEFAULT_SETTINGS, printerProfiles: {} };
  saveSettings(state.settings);
  state.generatedPdfPath = "";
  state.status = "Profiles reset.";
  render();
}

async function withBusy(
  state: AppState,
  render: RenderFn,
  message: string,
  action: () => Promise<void>,
) {
  state.busy = true;
  state.status = message;
  render();
  try {
    await action();
  } catch (error) {
    const appError = normalizeError(error);
    setError(state, render, appError.title, appError.message);
  } finally {
    state.busy = false;
    render();
  }
}

function validateLabel(state: AppState, render: RenderFn, requireIdentifier: boolean): boolean {
  if (!state.info.marketingModel.trim()) {
    setError(state, render, "Missing Model", "Enter a model before generating a label.");
    return false;
  }
  const hasIdentifier = Boolean(normalizeImei(state.info.imei) || state.info.serialNumber.trim());
  if (requireIdentifier && !hasIdentifier) {
    setError(state, render, "Missing Identifier", "Enter an IMEI or serial number before printing this label.");
    return false;
  }
  if (!hasIdentifier) {
    state.status = "Identifier missing. The generated label will show a manual-entry warning.";
  }
  return true;
}

function selectedHistoryEntry(app: HTMLElement, state: AppState): HistoryEntry | null {
  const selected = app.querySelector<HTMLTableRowElement>("tr.is-selected");
  if (!selected) return null;
  const index = Number(selected.dataset.historyIndex);
  return filteredHistory(state)[index] || null;
}

function updateGeneratedPathText(app: HTMLElement, state: AppState) {
  const box = app.querySelector(".pdf-box strong");
  if (box) box.textContent = state.generatedPdfPath || "Label changed; generate it again before printing.";
}

function setError(state: AppState, render: RenderFn, title: string, message: string) {
  state.status = `${title}: ${message}`;
  render();
}

function normalizeError(error: unknown): AppError {
  if (typeof error === "object" && error && "title" in error && "message" in error) {
    return error as AppError;
  }
  return {
    title: "Operation Failed",
    message: error instanceof Error ? error.message : String(error),
  };
}

function updateDefaultSettingFromControl(
  settings: AppSettings,
  control: HTMLInputElement | HTMLSelectElement,
) {
  const key = control.dataset.setting as keyof AppSettings;
  if (key === "labelOrientation") {
    settings.labelOrientation = control.value === "portrait" ? "portrait" : "landscape";
  } else if (key === "printScaleMode") {
    settings.printScaleMode = normalizePrintScaleMode(control.value);
  } else if (key === "labelRetentionDays") {
    settings.labelRetentionDays = nonNegativeNumber(control.value, settings.labelRetentionDays);
  } else if (key === "labelWidthMm" || key === "labelHeightMm") {
    settings[key] = positiveNumber(control.value, Number(settings[key]));
  }
}

function updatePrinterProfileFromControl(
  state: AppState,
  control: HTMLInputElement | HTMLSelectElement,
) {
  if (!state.selectedPrinter) return;
  const profile = { ...selectedPrinterProfile(state) };
  const key = control.dataset.profile as keyof PrinterProfile;
  if (key === "labelOrientation") {
    profile.labelOrientation = control.value === "portrait" ? "portrait" : "landscape";
  } else if (key === "printScaleMode") {
    profile.printScaleMode = normalizePrintScaleMode(control.value);
  } else if (key === "labelWidthMm" || key === "labelHeightMm") {
    profile[key] = positiveNumber(control.value, Number(profile[key]));
  }
  upsertPrinterProfile(state.settings, state.selectedPrinter, profile);
}

function bindButton(app: HTMLElement, action: string, listener: () => void) {
  app.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)?.addEventListener("click", listener);
}
