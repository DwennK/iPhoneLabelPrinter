import type {
  AppSettings,
  LabelOptions,
  PrinterProfile,
  PrintScaleMode,
} from "./types";

const SETTINGS_KEY = "iphoneLabelPrinter.tauri.settings";

export const DEFAULT_LABEL_OPTIONS: LabelOptions = {
  labelWidthMm: 62,
  labelHeightMm: 40,
  labelOrientation: "landscape",
  printScaleMode: "noscale",
};

export const DEFAULT_SETTINGS: AppSettings = {
  ...DEFAULT_LABEL_OPTIONS,
  labelRetentionDays: 30,
  lastPrinterName: "",
  printerProfiles: {},
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS, printerProfiles: {} };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      labelWidthMm: positiveNumber(parsed.labelWidthMm, DEFAULT_SETTINGS.labelWidthMm),
      labelHeightMm: positiveNumber(parsed.labelHeightMm, DEFAULT_SETTINGS.labelHeightMm),
      labelOrientation:
        parsed.labelOrientation === "portrait" ? "portrait" : "landscape",
      printScaleMode: normalizePrintScaleMode(parsed.printScaleMode),
      labelRetentionDays: nonNegativeNumber(
        parsed.labelRetentionDays,
        DEFAULT_SETTINGS.labelRetentionDays,
      ),
      lastPrinterName: typeof parsed.lastPrinterName === "string" ? parsed.lastPrinterName : "",
      printerProfiles: normalizePrinterProfiles(parsed.printerProfiles),
    };
  } catch {
    return { ...DEFAULT_SETTINGS, printerProfiles: {} };
  }
}

export function saveSettings(settings: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function nonNegativeNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function normalizePrintScaleMode(value: unknown): PrintScaleMode {
  return value === "fit" ? "fit" : "noscale";
}

export function defaultPrinterProfile(settings: AppSettings): PrinterProfile {
  return {
    labelWidthMm: settings.labelWidthMm,
    labelHeightMm: settings.labelHeightMm,
    labelOrientation: settings.labelOrientation,
    printScaleMode: settings.printScaleMode,
  };
}

export function profileForPrinter(settings: AppSettings, printerName: string): PrinterProfile {
  return settings.printerProfiles[printerName] || defaultPrinterProfile(settings);
}

export function upsertPrinterProfile(
  settings: AppSettings,
  printerName: string,
  profile: PrinterProfile,
) {
  if (!printerName.trim()) return;
  settings.printerProfiles = {
    ...settings.printerProfiles,
    [printerName]: normalizePrinterProfile(profile, defaultPrinterProfile(settings)),
  };
}

function normalizePrinterProfiles(value: unknown): Record<string, PrinterProfile> {
  if (!value || typeof value !== "object") return {};
  const profiles: Record<string, PrinterProfile> = {};
  for (const [printerName, profile] of Object.entries(value)) {
    if (!printerName.trim() || !profile || typeof profile !== "object") continue;
    profiles[printerName] = normalizePrinterProfile(
      profile as Partial<PrinterProfile>,
      DEFAULT_LABEL_OPTIONS,
    );
  }
  return profiles;
}

function normalizePrinterProfile(
  profile: Partial<PrinterProfile>,
  fallback: PrinterProfile | LabelOptions,
): PrinterProfile {
  return {
    labelWidthMm: positiveNumber(profile.labelWidthMm, fallback.labelWidthMm),
    labelHeightMm: positiveNumber(profile.labelHeightMm, fallback.labelHeightMm),
    labelOrientation:
      profile.labelOrientation === "portrait" ? "portrait" : "landscape",
    printScaleMode: normalizePrintScaleMode(profile.printScaleMode || fallback.printScaleMode),
  };
}
