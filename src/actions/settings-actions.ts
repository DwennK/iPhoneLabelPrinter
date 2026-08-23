import {
  DEFAULT_SETTINGS,
  nonNegativeNumber,
  normalizePrintScaleMode,
  positiveNumber,
  saveSettings,
  upsertPrinterProfile,
} from "../settings";
import type { AppSettings, AppState, PrinterProfile } from "../types";
import { selectedPrinterProfile } from "../views";
import { setError, type RenderFn } from "./runtime";

export function saveSettingsFromForm(state: AppState, render: RenderFn): void {
  saveSettings(state.settings);
  state.generatedPdfPath = "";
  state.status = "Settings saved.";
  render();
}

export function savePrinterProfile(state: AppState, render: RenderFn): void {
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

export function resetSettings(state: AppState, render: RenderFn): void {
  state.settings = { ...DEFAULT_SETTINGS, printerProfiles: {} };
  saveSettings(state.settings);
  state.generatedPdfPath = "";
  state.status = "Profiles reset.";
  render();
}

export function updateDefaultSettingFromControl(
  settings: AppSettings,
  control: HTMLInputElement | HTMLSelectElement,
): void {
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

export function updatePrinterProfileFromControl(
  state: AppState,
  control: HTMLInputElement | HTMLSelectElement,
): void {
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
