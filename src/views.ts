import {
  DEFAULT_COLORS,
  EMPTY_INFO,
  HISTORY_COLUMNS,
  type AppState,
  type HistoryEntry,
  type IPhoneInfo,
  type LabelOptions,
  type PrinterProfile,
  type TabKey,
} from "./types";
import { profileForPrinter } from "./settings";

export function renderApp(state: AppState): string {
  const activeTitle = activeTabTitle(state.activeTab);
  const effective = effectiveLabelSize(state);
  return `
    <main class="shell">
      <aside class="app-rail" aria-label="Primary navigation">
        <div class="brand-lockup">
          <div class="brand-mark">iLP</div>
          <div>
            <strong>iPhoneLabelPrinter</strong>
            <span>Repair desk</span>
          </div>
        </div>
        <nav class="top-actions">
          ${tabButton(state, "label", "Label")}
          ${tabButton(state, "history", "History")}
          ${tabButton(state, "settings", "Settings")}
        </nav>
      </aside>
      <section class="app-main">
        <header class="topbar">
          <div>
            <p class="eyebrow">${activeTitle}</p>
            <h1>${activeTitle}</h1>
            <p class="status-line"><span class="status-dot ${state.busy ? "is-busy" : ""}"></span>${escapeHtml(summaryStatus(state))}</p>
          </div>
          <div class="header-meta" aria-label="Current setup">
            <span>${effective.labelWidthMm} x ${effective.labelHeightMm} mm</span>
            <span>${scaleLabel(effective.printScaleMode)}</span>
            <span>${state.printers.length || 0} printer${state.printers.length === 1 ? "" : "s"}</span>
          </div>
        </header>
        ${state.activeTab === "label" ? labelTab(state) : ""}
        ${state.activeTab === "history" ? historyTab(state) : ""}
        ${state.activeTab === "settings" ? settingsTab(state) : ""}
      </section>
    </main>
  `;
}

export function updateAlerts(app: HTMLElement, state: AppState) {
  const alerts = alertMessages(state);
  const container = app.querySelector<HTMLDivElement>("#alerts");
  if (!container) return;
  if (!alerts.length) {
    container.hidden = true;
    container.className = "alerts is-ok";
    container.textContent = "";
    return;
  }
  container.hidden = false;
  container.className = "alerts is-warning";
  container.innerHTML = alerts.map((alert) => `<div>${escapeHtml(alert)}</div>`).join("");
}

export function filteredHistory(state: AppState): HistoryEntry[] {
  const query = state.historyQuery.trim().toLowerCase();
  if (!query) return state.history;
  return state.history.filter((entry) =>
    [
      entry.createdAt,
      entry.labelId,
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

export function effectiveLabelSize(state: AppState): LabelOptions {
  const profile = selectedPrinterProfile(state);
  const shortSide = Math.min(profile.labelWidthMm, profile.labelHeightMm);
  const longSide = Math.max(profile.labelWidthMm, profile.labelHeightMm);
  if (profile.labelOrientation === "portrait") {
    return {
      labelWidthMm: shortSide,
      labelHeightMm: longSide,
      labelOrientation: profile.labelOrientation,
      printScaleMode: profile.printScaleMode,
    };
  }
  return {
    labelWidthMm: longSide,
    labelHeightMm: shortSide,
    labelOrientation: profile.labelOrientation,
    printScaleMode: profile.printScaleMode,
  };
}

export function effectiveLabelOptions(state: AppState): LabelOptions {
  return effectiveLabelSize(state);
}

export function selectedPrinterProfile(state: AppState): PrinterProfile {
  return profileForPrinter(state.settings, state.selectedPrinter);
}

export function primaryIdentifier(state: AppState): string {
  const imei = normalizeImei(state.info.imei);
  if (imei) return `IMEI: ${imei}`;
  if (state.info.serialNumber.trim()) return `Serial: ${state.info.serialNumber.trim()}`;
  return "Manual entry needed";
}

export function normalizeImei(value: string): string {
  return value.replace(/\D+/g, "");
}

export function emptyIPhoneInfo(): IPhoneInfo {
  return { ...EMPTY_INFO };
}

export function defaultColorOptions(selectedColor = "") {
  return ["", ...DEFAULT_COLORS, selectedColor].filter(
    (color, index, values) => values.indexOf(color) === index,
  );
}

export function disabledIfBusy(state: AppState): string {
  return state.busy ? "disabled" : "";
}

function activeTabTitle(tab: TabKey): string {
  if (tab === "history") return "History";
  if (tab === "settings") return "Settings";
  return "Label workspace";
}

function summaryStatus(state: AppState): string {
  return state.status.split(/\n+/)[0] || state.status;
}

function tabButton(state: AppState, tab: TabKey, label: string): string {
  const active = state.activeTab === tab ? "is-active" : "";
  const updateBadge =
    tab === "settings" && (state.updateAvailableVersion || state.updateReadyToRelaunch)
      ? `<span class="nav-badge">Update</span>`
      : "";
  return `<button class="tab-button ${active}" data-tab="${tab}" type="button"><span>${label}</span>${updateBadge}</button>`;
}

function labelTab(state: AppState): string {
  const effective = effectiveLabelSize(state);
  return `
    <section class="workspace label-workspace">
      <section class="panel connection-panel">
        <div class="panel-heading compact-heading">
          <h2>Connection</h2>
          <button class="primary" data-action="scan" type="button" ${disabledIfBusy(state)}>Scan Device</button>
        </div>
        <p class="connection-status">${escapeHtml(state.status)}</p>
        ${deviceSelector(state)}
        <div id="alerts" class="alerts inline-alerts"></div>
      </section>

      <div class="technician-grid">
        <section class="panel device-panel">
          <div class="panel-heading">
            <h2>Device Information</h2>
            <button class="secondary" data-action="clear" type="button" ${disabledIfBusy(state)}>Clear</button>
          </div>
          <div class="form-grid">
            ${field(state, "marketingModel", "Model")}
            ${field(state, "technicalModel", "Technical model")}
            ${field(state, "storage", "Storage")}
            ${field(state, "color", "Color", "text", "color-options")}
            ${field(state, "imei", "IMEI")}
            ${field(state, "serialNumber", "Serial number")}
            ${field(state, "deviceName", "Device name")}
            ${field(state, "iosVersion", "OS version")}
            ${field(state, "batteryHealth", "Battery health")}
          </div>
          <datalist id="color-options">
            ${state.colorOptions.map((color) => `<option value="${escapeAttribute(color)}"></option>`).join("")}
          </datalist>
        </section>

        <section class="panel preview-panel">
          <div class="panel-heading">
            <h2>Label Preview</h2>
            <span class="size-pill">${effective.labelWidthMm} x ${effective.labelHeightMm} mm</span>
          </div>
          ${renderLabelPreview(state)}
          <div class="pdf-line">
            <strong>${escapeHtml(state.generatedPdfPath || "No label generated yet.")}</strong>
            <button class="secondary" data-action="open-pdf" type="button" ${state.generatedPdfPath ? "" : "disabled"}>Open PDF</button>
          </div>
        </section>
      </div>

      <section class="panel print-dock">
        <div class="printer-strip">
          <span>Printer</span>
          <strong>${escapeHtml(state.selectedPrinter || "Not selected")}</strong>
          <button class="secondary compact-button" data-tab="settings" type="button">Settings</button>
        </div>
        <p class="action-status">${escapeHtml(summaryStatus(state))}</p>
        <div class="button-row">
          <button class="secondary" data-action="clear" type="button" ${disabledIfBusy(state)}>Clear</button>
          <button class="primary" data-action="generate" type="button" ${disabledIfBusy(state)}>Generate Label</button>
          <button class="primary strong" data-action="print" type="button" ${disabledIfBusy(state)}>Print Label</button>
        </div>
      </section>
    </section>
  `;
}

function deviceSelector(state: AppState): string {
  if (state.devices.length <= 1) return "";
  const selected = state.devices.find((device) => device.udid === state.selectedUdid);
  return `
    <div class="device-card-grid">
      ${state.devices.map(deviceCard(state)).join("")}
    </div>
    <div class="device-select-row">
      <span class="muted">${escapeHtml(selected?.displayName || "No device selected")}</span>
      <button class="primary" data-action="read-selected" type="button" ${disabledIfBusy(state)}>Read Selected</button>
    </div>
  `;
}

function deviceCard(state: AppState) {
  return (device: AppState["devices"][number]) => {
    const isSelected = device.udid === state.selectedUdid;
    const label = device.displayName.replace(`(${device.udid})`, "").trim() || device.udid;
    return `
      <button class="device-card ${isSelected ? "is-selected" : ""}" data-device-card="${escapeAttribute(device.udid)}" type="button" ${disabledIfBusy(state)}>
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(shortIdentifier(device.udid))}</span>
        ${isSelected ? `<em>Selected</em>` : ""}
      </button>
    `;
  };
}

export function renderLabelPreview(state: AppState): string {
  const effective = effectiveLabelSize(state);
  const isCurrent = Boolean(state.generatedPdfPath);
  const statusClass = isCurrent ? "is-current" : "is-stale";
  const statusLabel = isCurrent ? "Up to date" : "Changed, regenerate";
  const variant = [state.info.storage, state.info.color].filter(Boolean).join(" - ") || "Missing variant";
  const os = state.info.iosVersion ? `OS: ${state.info.iosVersion}` : "";
  const serial = state.info.serialNumber ? `S/N: ${state.info.serialNumber}` : "S/N: -";
  return `
    <section class="label-preview-box" aria-label="Label preview">
      <div class="preview-header">
        <span>Preview</span>
        <strong class="preview-status ${statusClass}">${statusLabel}</strong>
      </div>
      <div class="label-preview-shell">
        <div class="label-preview-frame ${effective.labelOrientation}">
          <div class="label-preview-copy">
            <strong>${escapeHtml(state.info.marketingModel || "Unknown model")}</strong>
            <span>${escapeHtml(variant)}</span>
            <span>${escapeHtml(primaryIdentifier(state))}</span>
            <span>${escapeHtml(state.info.batteryHealth ? `Battery: ${state.info.batteryHealth}` : "Battery: optional")}</span>
            ${os ? `<span>${escapeHtml(os)}</span>` : ""}
            <span>${escapeHtml(serial)}</span>
          </div>
          <div class="label-preview-qr" aria-hidden="true"></div>
          <div class="label-preview-footer">
            <span>${escapeHtml(effective.labelWidthMm.toString())} x ${escapeHtml(effective.labelHeightMm.toString())} mm</span>
            <span>${escapeHtml(state.info.technicalModel || "")}</span>
          </div>
        </div>
      </div>
    </section>
  `;
}

function field(
  state: AppState,
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

function printerOptions(state: AppState): string {
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

function historyTab(state: AppState): string {
  const entries = filteredHistory(state);
  return `
    <section class="workspace single-column">
      <section class="panel">
        <div class="history-toolbar">
          <input class="search" data-history-search value="${escapeAttribute(state.historyQuery)}" placeholder="Search model, IMEI, serial, color..." />
          <button class="secondary" data-action="refresh-history" type="button" ${disabledIfBusy(state)}>Refresh</button>
          <button class="secondary" data-action="reprint-history" type="button" ${disabledIfBusy(state)}>Reprint Selected</button>
          <button class="secondary" data-action="open-history-pdf" type="button" ${disabledIfBusy(state)}>Open Selected PDF</button>
          <button class="secondary" data-action="export-history" type="button" ${disabledIfBusy(state)}>Export CSV</button>
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

function settingsTab(state: AppState): string {
  const profile = selectedPrinterProfile(state);
  return `
    <section class="workspace settings-layout">
      <section class="panel settings-primary">
        <div class="panel-heading">
          <h2>Printer & label</h2>
          <button class="secondary" data-action="refresh-printers" type="button" ${disabledIfBusy(state)}>Refresh Printers</button>
        </div>
        <div class="settings-grid">
          <label class="field full">
            <span>Selected printer</span>
            <select data-printer ${disabledIfBusy(state)}>
              ${printerOptions(state)}
            </select>
          </label>
          ${profileControls(profile)}
        </div>
        <div class="button-row">
          <button class="secondary" data-action="print-test-label" type="button" ${disabledIfBusy(state)}>Print Calibration</button>
          <button class="primary" data-action="save-printer-profile" type="button" ${state.selectedPrinter ? "" : "disabled"}>Save Printer Profile</button>
        </div>
      </section>
      <section class="panel settings-secondary">
        <h2>Fallback defaults</h2>
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
            <span>Scaling</span>
            <select data-setting="printScaleMode">
              ${scaleOptions(state.settings.printScaleMode)}
            </select>
          </label>
          <label class="field">
            <span>Keep labels/history</span>
            <input data-setting="labelRetentionDays" type="number" min="0" max="365" step="1" value="${state.settings.labelRetentionDays}" />
          </label>
        </div>
        <div class="button-row">
          <button class="secondary" data-action="cleanup-labels" type="button" ${disabledIfBusy(state)}>Clean Now</button>
          ${updateActions(state)}
          <button class="secondary" data-action="open-support-log" type="button" ${disabledIfBusy(state)}>Open Support Log</button>
          <button class="secondary" data-action="reset-settings" type="button">Reset Profiles</button>
          <button class="primary" data-action="save-settings" type="button">Save Settings</button>
        </div>
      </section>
      <details class="panel system-details">
        <summary>System paths</summary>
        <dl class="env-list">
          <div><dt>Project root</dt><dd>${escapeHtml(state.environment?.projectRoot || "Loading...")}</dd></div>
          <div><dt>Data folder</dt><dd>${escapeHtml(state.environment?.dataRoot || "Loading...")}</dd></div>
          <div><dt>Windows binaries</dt><dd>${escapeHtml(state.environment?.bundledWindowsBinDir || "Loading...")}</dd></div>
          <div><dt>macOS binaries</dt><dd>${escapeHtml(state.environment?.bundledMacosBinDir || "Loading...")}</dd></div>
          <div><dt>Generated PDFs</dt><dd>${escapeHtml(state.environment?.generatedLabelsDir || "Loading...")}</dd></div>
          <div><dt>History CSV</dt><dd>${escapeHtml(state.environment?.historyPath || "Loading...")}</dd></div>
          <div><dt>Support log</dt><dd>${escapeHtml(state.environment?.supportLogPath || "Loading...")}</dd></div>
        </dl>
      </details>
    </section>
  `;
}

function updateActions(state: AppState): string {
  if (state.updateReadyToRelaunch) {
    return `<button class="primary strong" data-action="relaunch-now" type="button" ${disabledIfBusy(state)}>Relaunch Now</button>`;
  }
  if (state.updateAvailableVersion) {
    return `
      <span class="update-badge">v${escapeHtml(state.updateAvailableVersion)}</span>
      <button class="primary" data-action="install-update" type="button" ${disabledIfBusy(state)}>Install Update</button>
    `;
  }
  return `<button class="secondary" data-action="check-updates" type="button" ${disabledIfBusy(state)}>Check Updates</button>`;
}

function profileControls(profile: PrinterProfile): string {
  return `
    <div class="profile-grid">
      <label class="field">
        <span>Width</span>
        <input data-profile="labelWidthMm" type="number" min="30" max="200" step="0.1" value="${profile.labelWidthMm}" />
      </label>
      <label class="field">
        <span>Height</span>
        <input data-profile="labelHeightMm" type="number" min="25" max="200" step="0.1" value="${profile.labelHeightMm}" />
      </label>
      <label class="field">
        <span>Orientation</span>
        <select data-profile="labelOrientation">
          <option value="portrait" ${profile.labelOrientation === "portrait" ? "selected" : ""}>Portrait</option>
          <option value="landscape" ${profile.labelOrientation === "landscape" ? "selected" : ""}>Landscape</option>
        </select>
      </label>
      <label class="field">
        <span>Scaling</span>
        <select data-profile="printScaleMode">
          ${scaleOptions(profile.printScaleMode)}
        </select>
      </label>
    </div>
  `;
}

function scaleOptions(selected: string): string {
  return `
    <option value="noscale" ${selected === "noscale" ? "selected" : ""}>Actual size</option>
    <option value="fit" ${selected === "fit" ? "selected" : ""}>Fit to page</option>
  `;
}

function scaleLabel(value: string): string {
  return value === "fit" ? "fit to page" : "actual size";
}

function shortIdentifier(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-6)}`;
}

function alertMessages(state: AppState): string[] {
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
