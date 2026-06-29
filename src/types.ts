export type TabKey = "label" | "history" | "settings";
export type LabelOrientation = "portrait" | "landscape";
export type PrintScaleMode = "noscale" | "fit";

export interface AppError {
  title: string;
  message: string;
}

export interface ConnectedDevice {
  udid: string;
  displayName: string;
}

export interface IPhoneInfo {
  udid: string;
  marketingModel: string;
  technicalModel: string;
  modelNumber: string;
  storage: string;
  color: string;
  imei: string;
  serialNumber: string;
  deviceName: string;
  iosVersion: string;
  buildVersion: string;
  batteryHealth: string;
  batteryCycleCount: string;
  modelIsUnknown: boolean;
  colorSourceNote: string;
  variantSourceNote: string;
}

export interface PrinterInfo {
  name: string;
  isDefault: boolean;
}

export interface LabelOptions {
  labelWidthMm: number;
  labelHeightMm: number;
  labelOrientation: LabelOrientation;
  printScaleMode: PrintScaleMode;
}

export interface PrinterProfile extends LabelOptions {}

export interface AppSettings extends LabelOptions {
  labelRetentionDays: number;
  lastPrinterName: string;
  printerProfiles: Record<string, PrinterProfile>;
}

export interface GenerateLabelResponse {
  pdfPath: string;
}

export interface CleanupLabelsResponse {
  deletedPaths: string[];
}

export interface CleanupHistoryResponse {
  deletedCount: number;
}

export interface ExportHistoryResponse {
  destinationPath: string;
}

export interface HistoryEntry {
  labelId: string;
  createdAt: string;
  printedAt: string;
  marketingModel: string;
  technicalModel: string;
  storage: string;
  color: string;
  imei: string;
  serialNumber: string;
  deviceName: string;
  iosVersion: string;
  batteryHealth: string;
  printerName: string;
  pdfPath: string;
  labelWidthMm: string;
  labelHeightMm: string;
  labelOrientation: string;
  printScaleMode: string;
}

export interface EnvironmentInfo {
  projectRoot: string;
  dataRoot: string;
  bundledWindowsBinDir: string;
  bundledMacosBinDir: string;
  generatedLabelsDir: string;
  historyPath: string;
  supportLogPath: string;
}

export interface AppState {
  activeTab: TabKey;
  busy: boolean;
  status: string;
  devices: ConnectedDevice[];
  selectedUdid: string;
  info: IPhoneInfo;
  colorOptions: string[];
  printers: PrinterInfo[];
  selectedPrinter: string;
  generatedPdfPath: string;
  history: HistoryEntry[];
  historyQuery: string;
  environment: EnvironmentInfo | null;
  settings: AppSettings;
}

export const DEFAULT_COLORS = [
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
];

export const EMPTY_INFO: IPhoneInfo = {
  udid: "",
  marketingModel: "",
  technicalModel: "",
  modelNumber: "",
  storage: "",
  color: "",
  imei: "",
  serialNumber: "",
  deviceName: "",
  iosVersion: "",
  buildVersion: "",
  batteryHealth: "",
  batteryCycleCount: "",
  modelIsUnknown: false,
  colorSourceNote: "",
  variantSourceNote: "",
};

export const HISTORY_COLUMNS: Array<[keyof HistoryEntry, string]> = [
  ["createdAt", "Generated"],
  ["printedAt", "Printed"],
  ["marketingModel", "Model"],
  ["storage", "Storage"],
  ["color", "Color"],
  ["imei", "IMEI"],
  ["serialNumber", "Serial"],
  ["batteryHealth", "Battery"],
  ["printerName", "Printer"],
  ["pdfPath", "PDF"],
];
