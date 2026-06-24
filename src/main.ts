import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import "./styles.css";

type TabKey = "label" | "history" | "settings";

interface AppError {
  title: string;
  message: string;
}

interface ConnectedDevice {
  udid: string;
  displayName: string;
}

interface IPhoneInfo {
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

interface PrinterInfo {
  name: string;
  isDefault: boolean;
}

interface LabelOptions {
  labelWidthMm: number;
  labelHeightMm: number;
  labelOrientation: "portrait" | "landscape";
}

interface AppSettings extends LabelOptions {
  labelRetentionDays: number;
}

interface GenerateLabelResponse {
  pdfPath: string;
}

interface CleanupLabelsResponse {
  deletedPaths: string[];
}

interface ExportHistoryResponse {
  destinationPath: string;
}

interface HistoryEntry {
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
}

interface EnvironmentInfo {
  projectRoot: string;
  bundledWindowsBinDir: string;
  generatedLabelsDir: string;
  historyPath: string;
}

const DEFAULT_COLORS = [
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

const EMPTY_INFO: IPhoneInfo = {
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

const HISTORY_COLUMNS: Array<[keyof HistoryEntry, string]> = [
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

const appRoot = document.querySelector<HTMLDivElement>("#app");

if (!appRoot) {
  throw new Error("Missing #app root");
}

const app: HTMLDivElement = appRoot;

const state = {
  activeTab: "label" as TabKey,
  busy: false,
  status: "No device scanned.",
  devices: [] as ConnectedDevice[],
  selectedUdid: "",
  info: { ...EMPTY_INFO },
  colorOptions: [...DEFAULT_COLORS],
  printers: [] as PrinterInfo[],
  selectedPrinter: "",
  generatedPdfPath: "",
  history: [] as HistoryEntry[],
  historyQuery: "",
  environment: null as EnvironmentInfo | null,
  settings: loadSettings(),
};

render();
void bootstrap();

async function bootstrap() {
  await Promise.allSettled([loadEnvironment(), refreshPrinters(), refreshHistory()]);
}

function loadSettings(): AppSettings {
  const fallback: AppSettings = {
    labelWidthMm: 62,
    labelHeightMm: 40,
    labelOrientation: "landscape",
    labelRetentionDays: 30,
  };
  try {
    const raw = localStorage.getItem("iphoneLabelPrinter.tauri.settings");
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      labelWidthMm: positiveNumber(parsed.labelWidthMm, fallback.labelWidthMm),
      labelHeightMm: positiveNumber(parsed.labelHeightMm, fallback.labelHeightMm),
      labelOrientation:
        parsed.labelOrientation === "portrait" ? "portrait" : "landscape",
      labelRetentionDays: nonNegativeNumber(parsed.labelRetentionDays, fallback.labelRetentionDays),
    };
  } catch {
    return fallback;
  }
}

function saveSettings() {
  localStorage.setItem(
    "iphoneLabelPrinter.tauri.settings",
    JSON.stringify(state.settings),
  );
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

async function loadEnvironment() {
  try {
    state.environment = await invoke<EnvironmentInfo>("environment_info");
    render();
  } catch {
    state.environment = null;
  }
}

function render() {
  app.innerHTML = `
    <main class="shell">
      <header class="topbar">
        <div>
          <h1>iPhoneLabelPrinter</h1>
          <p class="status-line">${escapeHtml(state.status)}</p>
        </div>
        <div class="top-actions">
          ${tabButton("label", "Label")}
          ${tabButton("history", "History")}
          ${tabButton("settings", "Settings")}
        </div>
      </header>
      ${state.activeTab === "label" ? labelTab() : ""}
      ${state.activeTab === "history" ? historyTab() : ""}
      ${state.activeTab === "settings" ? settingsTab() : ""}
    </main>
  `;
  attachEvents();
  updateAlerts();
}

function tabButton(tab: TabKey, label: string): string {
  const active = state.activeTab === tab ? "is-active" : "";
  return `<button class="tab-button ${active}" data-tab="${tab}" type="button">${label}</button>`;
}

function labelTab(): string {
  const effective = effectiveLabelSize();
  return `
    <section class="workspace label-workspace">
      <section class="panel connection-panel">
        <div class="panel-heading">
          <h2>Connection</h2>
          <button class="primary" data-action="scan" type="button" ${disabledIfBusy()}>Scan Device</button>
        </div>
        <p class="muted">${escapeHtml(state.status)}</p>
        ${deviceSelector()}
      </section>

      <section class="panel checks-panel">
        <h2>Checks</h2>
        <div id="alerts" class="alerts"></div>
      </section>

      <section class="panel device-panel">
        <div class="panel-heading">
          <h2>Device Information</h2>
          <button class="secondary" data-action="clear" type="button" ${disabledIfBusy()}>Clear</button>
        </div>
        <div class="form-grid">
          ${field("marketingModel", "Model")}
          ${field("technicalModel", "Technical model")}
          ${field("storage", "Storage")}
          ${field("color", "Color", "text", "color-options")}
          ${field("imei", "IMEI")}
          ${field("serialNumber", "Serial number")}
          ${field("deviceName", "Device name")}
          ${field("iosVersion", "OS version")}
          ${field("batteryHealth", "Battery health")}
        </div>
        <datalist id="color-options">
          ${state.colorOptions.map((color) => `<option value="${escapeAttribute(color)}"></option>`).join("")}
        </datalist>
      </section>

      <aside class="panel print-panel">
        <div class="panel-heading">
          <h2>Label</h2>
          <span class="size-pill">${effective.width} x ${effective.height} mm</span>
        </div>
        <dl class="label-summary">
          <div><dt>Model</dt><dd>${escapeHtml(state.info.marketingModel || "Manual entry needed")}</dd></div>
          <div><dt>Variant</dt><dd>${escapeHtml([state.info.storage, state.info.color].filter(Boolean).join(" - ") || "Missing")}</dd></div>
          <div><dt>Identifier</dt><dd>${escapeHtml(primaryIdentifier())}</dd></div>
          <div><dt>Battery</dt><dd>${escapeHtml(state.info.batteryHealth || "Optional")}</dd></div>
        </dl>
        <div class="pdf-box">
          <span class="muted">PDF</span>
          <strong>${escapeHtml(state.generatedPdfPath || "No label generated yet.")}</strong>
          <button class="secondary" data-action="open-pdf" type="button" ${state.generatedPdfPath ? "" : "disabled"}>Open PDF</button>
        </div>
        <label class="field full">
          <span>Printer</span>
          <select data-printer ${disabledIfBusy()}>
            ${printerOptions()}
          </select>
        </label>
        <div class="button-row">
          <button class="secondary" data-action="refresh-printers" type="button" ${disabledIfBusy()}>Refresh Printers</button>
          <button class="primary" data-action="generate" type="button" ${disabledIfBusy()}>Generate Label</button>
          <button class="primary strong" data-action="print" type="button" ${disabledIfBusy()}>Print Label</button>
        </div>
      </aside>
    </section>
  `;
}

function deviceSelector(): string {
  if (state.devices.length <= 1) return "";
  return `
    <div class="device-select-row">
      <select data-device>
        ${state.devices
          .map(
            (device) =>
              `<option value="${escapeAttribute(device.udid)}" ${device.udid === state.selectedUdid ? "selected" : ""}>${escapeHtml(device.displayName)}</option>`,
          )
          .join("")}
      </select>
      <button class="secondary" data-action="read-selected" type="button" ${disabledIfBusy()}>Read Selected</button>
    </div>
  `;
}

function field(
  key: keyof IPhoneInfo,
  label: string,
  type = "text",
  list = "",
): string {
  const listAttr = list ? `list="${list}"` : "";
  return `
    <label class="field">
      <span>${label}</span>
      <input type="${type}" data-field="${key}" ${listAttr} value="${escapeAttribute(String(state.info[key] ?? ""))}" />
    </label>
  `;
}

function printerOptions(): string {
  if (!state.printers.length) {
    return `<option value="">No printers found</option>`;
  }
  return state.printers
    .map((printer) => {
      const selected = printer.name === state.selectedPrinter ? "selected" : "";
      const label = printer.isDefault ? `${printer.name} (default)` : printer.name;
      return `<option value="${escapeAttribute(printer.name)}" ${selected}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

function historyTab(): string {
  const entries = filteredHistory();
  return `
    <section class="workspace single-column">
      <section class="panel">
        <div class="history-toolbar">
          <input class="search" data-history-search value="${escapeAttribute(state.historyQuery)}" placeholder="Search model, IMEI, serial, color..." />
          <button class="secondary" data-action="refresh-history" type="button" ${disabledIfBusy()}>Refresh</button>
          <button class="secondary" data-action="reprint-history" type="button" ${disabledIfBusy()}>Reprint Selected</button>
          <button class="secondary" data-action="open-history-pdf" type="button" ${disabledIfBusy()}>Open Selected PDF</button>
          <button class="secondary" data-action="export-history" type="button" ${disabledIfBusy()}>Export CSV</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>${HISTORY_COLUMNS.map(([, label]) => `<th>${label}</th>`).join("")}</tr>
            </thead>
            <tbody>
              ${
                entries.length
                  ? entries.map(historyRow).join("")
                  : `<tr><td colspan="${HISTORY_COLUMNS.length}" class="empty">No history rows.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `;
}

function historyRow(entry: HistoryEntry, index: number): string {
  return `
    <tr data-history-index="${index}">
      ${HISTORY_COLUMNS.map(([key]) => `<td>${escapeHtml(String(entry[key] ?? ""))}</td>`).join("")}
    </tr>
  `;
}

function settingsTab(): string {
  return `
    <section class="workspace settings-layout">
      <section class="panel">
        <h2>Label Size</h2>
        <div class="settings-grid">
          <label class="field">
            <span>Width</span>
            <input data-setting="labelWidthMm" type="number" min="30" max="200" step="0.1" value="${state.settings.labelWidthMm}" />
          </label>
          <label class="field">
            <span>Height</span>
            <input data-setting="labelHeightMm" type="number" min="25" max="200" step="0.1" value="${state.settings.labelHeightMm}" />
          </label>
          <label class="field">
            <span>Orientation</span>
            <select data-setting="labelOrientation">
              <option value="portrait" ${state.settings.labelOrientation === "portrait" ? "selected" : ""}>Portrait</option>
              <option value="landscape" ${state.settings.labelOrientation === "landscape" ? "selected" : ""}>Landscape</option>
            </select>
          </label>
          <label class="field">
            <span>Keep generated PDFs</span>
            <input data-setting="labelRetentionDays" type="number" min="0" max="365" step="1" value="${state.settings.labelRetentionDays}" />
          </label>
        </div>
        <div class="button-row">
          <button class="secondary" data-action="cleanup-labels" type="button" ${disabledIfBusy()}>Clean Now</button>
          <button class="secondary" data-action="print-test-label" type="button" ${disabledIfBusy()}>Print Test Label</button>
          <button class="secondary" data-action="reset-settings" type="button">Reset Label Size</button>
          <button class="primary" data-action="save-settings" type="button">Save Settings</button>
        </div>
      </section>
      <section class="panel">
        <h2>Migration Notes</h2>
        <dl class="env-list">
          <div><dt>Project root</dt><dd>${escapeHtml(state.environment?.projectRoot || "Loading...")}</dd></div>
          <div><dt>Windows binaries</dt><dd>${escapeHtml(state.environment?.bundledWindowsBinDir || "Loading...")}</dd></div>
          <div><dt>Generated PDFs</dt><dd>${escapeHtml(state.environment?.generatedLabelsDir || "Loading...")}</dd></div>
          <div><dt>History CSV</dt><dd>${escapeHtml(state.environment?.historyPath || "Loading...")}</dd></div>
        </dl>
        <p class="muted">The Tauri backend now scans devices, generates PDFs, prints labels, and writes history from Rust.</p>
      </section>
    </section>
  `;
}

function attachEvents() {
  app.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.tab as TabKey;
      render();
    });
  });

  app.querySelector<HTMLButtonElement>('[data-action="scan"]')?.addEventListener("click", scanDevices);
  app.querySelector<HTMLButtonElement>('[data-action="read-selected"]')?.addEventListener("click", readSelectedDevice);
  app.querySelector<HTMLButtonElement>('[data-action="clear"]')?.addEventListener("click", clearForm);
  app.querySelector<HTMLButtonElement>('[data-action="refresh-printers"]')?.addEventListener("click", refreshPrinters);
  app.querySelector<HTMLButtonElement>('[data-action="generate"]')?.addEventListener("click", generateLabel);
  app.querySelector<HTMLButtonElement>('[data-action="print"]')?.addEventListener("click", printLabel);
  app.querySelector<HTMLButtonElement>('[data-action="print-test-label"]')?.addEventListener("click", printTestLabel);
  app.querySelector<HTMLButtonElement>('[data-action="open-pdf"]')?.addEventListener("click", openGeneratedPdf);
  app.querySelector<HTMLButtonElement>('[data-action="refresh-history"]')?.addEventListener("click", () => {
    void refreshHistory();
  });
  app.querySelector<HTMLButtonElement>('[data-action="open-history-pdf"]')?.addEventListener("click", openSelectedHistoryPdf);
  app.querySelector<HTMLButtonElement>('[data-action="reprint-history"]')?.addEventListener("click", reprintSelectedHistory);
  app.querySelector<HTMLButtonElement>('[data-action="export-history"]')?.addEventListener("click", exportHistoryCsv);
  app.querySelector<HTMLButtonElement>('[data-action="save-settings"]')?.addEventListener("click", saveSettingsFromForm);
  app.querySelector<HTMLButtonElement>('[data-action="reset-settings"]')?.addEventListener("click", resetSettings);
  app.querySelector<HTMLButtonElement>('[data-action="cleanup-labels"]')?.addEventListener("click", cleanupGeneratedLabels);

  app.querySelector<HTMLSelectElement>("[data-device]")?.addEventListener("change", (event) => {
    state.selectedUdid = (event.target as HTMLSelectElement).value;
  });
  app.querySelector<HTMLSelectElement>("[data-printer]")?.addEventListener("change", (event) => {
    state.selectedPrinter = (event.target as HTMLSelectElement).value;
  });

  app.querySelectorAll<HTMLInputElement>("[data-field]").forEach((input) => {
    input.addEventListener("input", () => {
      const key = input.dataset.field as keyof IPhoneInfo;
      state.info[key] = input.value as never;
      state.generatedPdfPath = "";
      updateGeneratedPathText();
      updateAlerts();
    });
  });

  app.querySelector<HTMLInputElement>("[data-history-search]")?.addEventListener("input", (event) => {
    state.historyQuery = (event.target as HTMLInputElement).value;
    render();
  });

  app.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-setting]").forEach((control) => {
    control.addEventListener("change", () => {
      const key = control.dataset.setting as keyof AppSettings;
      if (key === "labelOrientation") {
        state.settings.labelOrientation =
          control.value === "portrait" ? "portrait" : "landscape";
      } else if (key === "labelRetentionDays") {
        state.settings.labelRetentionDays = nonNegativeNumber(
          control.value,
          state.settings.labelRetentionDays,
        );
      } else {
        state.settings[key] = positiveNumber(control.value, Number(state.settings[key])) as never;
      }
    });
  });

  app.querySelectorAll<HTMLTableRowElement>("[data-history-index]").forEach((row) => {
    row.addEventListener("click", () => {
      app.querySelectorAll("tr.is-selected").forEach((selected) => selected.classList.remove("is-selected"));
      row.classList.add("is-selected");
    });
  });
}

async function scanDevices() {
  await withBusy("Scanning for connected iPhones and iPads...", async () => {
    const devices = await invoke<ConnectedDevice[]>("scan_devices");
    state.devices = devices;
    if (devices.length === 0) {
      state.status =
        "No iPhone or iPad detected. Connect by USB, unlock it, and trust this computer if prompted.";
      return;
    }
    state.selectedUdid = devices[0].udid;
    if (devices.length === 1) {
      await readDevice(devices[0].udid);
    } else {
      state.status = `${devices.length} devices detected. Select the one to read.`;
    }
  });
}

async function readSelectedDevice() {
  if (!state.selectedUdid) return;
  await withBusy(`Reading device information from ${state.selectedUdid}...`, async () => {
    await readDevice(state.selectedUdid);
  });
}

async function readDevice(udid: string) {
  const info = await invoke<IPhoneInfo>("read_device_info", { udid });
  const batteryHealth = info.batteryCycleCount
    ? info.batteryHealth
      ? `${info.batteryHealth} (${info.batteryCycleCount} cycles)`
      : `${info.batteryCycleCount} cycles`
    : info.batteryHealth;
  state.info = { ...info, batteryHealth };
  state.generatedPdfPath = "";
  await loadColorOptions(info.technicalModel, info.color);
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

async function loadColorOptions(productType: string, selectedColor = "") {
  const options = productType
    ? await invoke<string[]>("color_options", { productType }).catch(() => [])
    : [];
  const merged = ["", ...options, ...DEFAULT_COLORS, selectedColor].filter(
    (color, index, values) => values.indexOf(color) === index,
  );
  state.colorOptions = merged;
}

async function refreshPrinters() {
  await withBusy("Refreshing printer list...", async () => {
    state.printers = await invoke<PrinterInfo[]>("list_printers");
    const defaultPrinter = state.printers.find((printer) => printer.isDefault);
    state.selectedPrinter = defaultPrinter?.name || state.printers[0]?.name || "";
    state.status = state.printers.length
      ? "Printer list refreshed."
      : "No printers found. Add the thermal printer in the operating system, then refresh.";
  });
}

async function generateLabel() {
  if (!validateLabel(false)) return;
  const options = effectiveLabelOptions();
  await withBusy("Generating label PDF...", async () => {
    const response = await invoke<GenerateLabelResponse>("generate_label", {
      request: {
        info: state.info,
        options,
      },
    });
    state.generatedPdfPath = response.pdfPath;
    state.status = `Label generated: ${response.pdfPath}`;
    await refreshHistory(false);
  });
}

async function printLabel() {
  if (!state.selectedPrinter) {
    setError("No Printer Selected", "No printer is selected. Add or select a printer before printing.");
    return;
  }
  if (!validateLabel(true)) return;
  if (!state.generatedPdfPath) {
    await generateLabel();
    if (!state.generatedPdfPath) return;
  }
  const options = effectiveLabelOptions();
  await withBusy("Submitting print job...", async () => {
    const message = await invoke<string>("print_label", {
      request: {
        printerName: state.selectedPrinter,
        pdfPath: state.generatedPdfPath,
        labelWidthMm: options.labelWidthMm,
        labelHeightMm: options.labelHeightMm,
        orientation: options.labelOrientation,
      },
    });
    state.status = message || "Print job submitted.";
    await refreshHistory(false);
  });
}

async function printTestLabel() {
  if (!state.selectedPrinter) {
    setError("No Printer Selected", "No printer is selected. Add or select a printer before printing a test label.");
    return;
  }
  const options = effectiveLabelOptions();
  await withBusy("Generating calibration label...", async () => {
    const response = await invoke<GenerateLabelResponse>("generate_calibration_label", {
      request: { options },
    });
    state.generatedPdfPath = response.pdfPath;
    const message = await invoke<string>("print_label", {
      request: {
        printerName: state.selectedPrinter,
        pdfPath: response.pdfPath,
        labelWidthMm: options.labelWidthMm,
        labelHeightMm: options.labelHeightMm,
        orientation: options.labelOrientation,
      },
    });
    state.status = message || "Test label submitted.";
  });
}

async function refreshHistory(showStatus = true) {
  state.history = await invoke<HistoryEntry[]>("read_history").catch(() => []);
  if (showStatus) {
    state.status = "History refreshed.";
  }
  render();
}

async function openGeneratedPdf() {
  if (state.generatedPdfPath) {
    await openPath(state.generatedPdfPath);
  }
}

async function openSelectedHistoryPdf() {
  const entry = selectedHistoryEntry();
  if (!entry) {
    setError("No History Row Selected", "Select a history row first.");
    return;
  }
  if (entry.pdfPath) {
    await openPath(entry.pdfPath);
  }
}

async function reprintSelectedHistory() {
  const entry = selectedHistoryEntry();
  if (!entry) {
    setError("No History Row Selected", "Select a history row to reprint.");
    return;
  }
  if (!state.selectedPrinter) {
    setError("No Printer Selected", "No printer is selected. Add or select a printer before reprinting.");
    return;
  }
  const fallback = effectiveLabelOptions();
  const labelWidthMm = positiveNumber(entry.labelWidthMm, fallback.labelWidthMm);
  const labelHeightMm = positiveNumber(entry.labelHeightMm, fallback.labelHeightMm);
  const orientation =
    entry.labelOrientation === "portrait" || entry.labelOrientation === "landscape"
      ? entry.labelOrientation
      : fallback.labelOrientation;
  await withBusy("Submitting history label...", async () => {
    const message = await invoke<string>("print_label", {
      request: {
        printerName: state.selectedPrinter,
        pdfPath: entry.pdfPath,
        labelWidthMm,
        labelHeightMm,
        orientation,
      },
    });
    state.status = message || "History label reprinted.";
    await refreshHistory(false);
  });
}

async function exportHistoryCsv() {
  await withBusy("Exporting history CSV...", async () => {
    const response = await invoke<ExportHistoryResponse>("export_history", {
      request: { destinationPath: null },
    });
    state.status = `History exported: ${response.destinationPath}`;
    await openPath(response.destinationPath);
  });
}

async function cleanupGeneratedLabels() {
  await withBusy("Cleaning generated PDFs...", async () => {
    const response = await invoke<CleanupLabelsResponse>("cleanup_generated_labels", {
      request: { retentionDays: Math.round(state.settings.labelRetentionDays) },
    });
    state.status = `Deleted ${response.deletedPaths.length} old label PDF(s).`;
  });
}

function clearForm() {
  state.info = { ...EMPTY_INFO };
  state.generatedPdfPath = "";
  state.status = "No device scanned.";
  render();
}

function saveSettingsFromForm() {
  saveSettings();
  state.generatedPdfPath = "";
  state.status = "Settings saved.";
  render();
}

function resetSettings() {
  state.settings = {
    labelWidthMm: 62,
    labelHeightMm: 40,
    labelOrientation: "landscape",
    labelRetentionDays: 30,
  };
  saveSettings();
  state.generatedPdfPath = "";
  state.status = "Settings reset.";
  render();
}

function selectedHistoryEntry(): HistoryEntry | null {
  const selected = app.querySelector<HTMLTableRowElement>("tr.is-selected");
  if (!selected) return null;
  const index = Number(selected.dataset.historyIndex);
  return filteredHistory()[index] || null;
}

async function withBusy(message: string, action: () => Promise<void>) {
  state.busy = true;
  state.status = message;
  render();
  try {
    await action();
  } catch (error) {
    const appError = normalizeError(error);
    setError(appError.title, appError.message);
  } finally {
    state.busy = false;
    render();
  }
}

function validateLabel(requireIdentifier: boolean): boolean {
  if (!state.info.marketingModel.trim()) {
    setError("Missing Model", "Enter a model before generating a label.");
    return false;
  }
  const hasIdentifier = Boolean(normalizeImei(state.info.imei) || state.info.serialNumber.trim());
  if (requireIdentifier && !hasIdentifier) {
    setError("Missing Identifier", "Enter an IMEI or serial number before printing this label.");
    return false;
  }
  if (!hasIdentifier) {
    state.status = "Identifier missing. The generated label will show a manual-entry warning.";
  }
  return true;
}

function updateAlerts() {
  const alerts = alertMessages();
  const container = app.querySelector<HTMLDivElement>("#alerts");
  if (!container) return;
  if (!alerts.length) {
    container.className = "alerts is-ok";
    container.textContent = "No alerts.";
    return;
  }
  container.className = "alerts is-warning";
  container.innerHTML = alerts.map((alert) => `<div>${escapeHtml(alert)}</div>`).join("");
}

function alertMessages(): string[] {
  const info = state.info;
  const hasAnyValue = [
    info.marketingModel,
    info.technicalModel,
    info.storage,
    info.color,
    info.imei,
    info.serialNumber,
    info.batteryHealth,
  ].some(Boolean);
  if (!hasAnyValue) return [];

  const alerts: string[] = [];
  if (!info.marketingModel || info.marketingModel.toLowerCase() === "unknown model") {
    alerts.push("Model must be verified manually.");
  }
  if (!info.storage) alerts.push("Storage is missing.");
  if (!info.color) alerts.push("Color is missing.");

  const imei = normalizeImei(info.imei);
  if (!imei && !info.serialNumber.trim()) {
    alerts.push("IMEI/serial number is missing.");
  } else if (imei && imei.length !== 15) {
    alerts.push("IMEI should contain 15 digits.");
  }

  const batteryPercent = parseInt(info.batteryHealth, 10);
  if (Number.isFinite(batteryPercent) && batteryPercent < 80) {
    alerts.push(`Battery health is low (${batteryPercent}%).`);
  }
  const cycleMatch = info.batteryHealth.match(/(\d+)\s*cycles?/i);
  if (cycleMatch && Number(cycleMatch[1]) > 500) {
    alerts.push(`Battery cycle count is high (${cycleMatch[1]} cycles).`);
  }
  return alerts;
}

function filteredHistory(): HistoryEntry[] {
  const query = state.historyQuery.trim().toLowerCase();
  if (!query) return state.history;
  return state.history.filter((entry) =>
    [
      entry.createdAt,
      entry.printedAt,
      entry.marketingModel,
      entry.technicalModel,
      entry.storage,
      entry.color,
      entry.imei,
      entry.serialNumber,
      entry.deviceName,
      entry.batteryHealth,
      entry.printerName,
      entry.pdfPath,
    ]
      .join(" ")
      .toLowerCase()
      .includes(query),
  );
}

function updateGeneratedPathText() {
  const box = app.querySelector(".pdf-box strong");
  if (box) box.textContent = state.generatedPdfPath || "Label changed; generate it again before printing.";
}

function setError(title: string, message: string) {
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

function effectiveLabelSize() {
  const shortSide = Math.min(state.settings.labelWidthMm, state.settings.labelHeightMm);
  const longSide = Math.max(state.settings.labelWidthMm, state.settings.labelHeightMm);
  if (state.settings.labelOrientation === "portrait") {
    return { width: shortSide, height: longSide };
  }
  return { width: longSide, height: shortSide };
}

function effectiveLabelOptions(): LabelOptions {
  const size = effectiveLabelSize();
  return {
    labelWidthMm: size.width,
    labelHeightMm: size.height,
    labelOrientation: state.settings.labelOrientation,
  };
}

function primaryIdentifier(): string {
  const imei = normalizeImei(state.info.imei);
  if (imei) return `IMEI: ${imei}`;
  if (state.info.serialNumber.trim()) return `Serial: ${state.info.serialNumber.trim()}`;
  return "Manual entry needed";
}

function normalizeImei(value: string): string {
  return value.replace(/\D+/g, "");
}

function disabledIfBusy(): string {
  return state.busy ? "disabled" : "";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
