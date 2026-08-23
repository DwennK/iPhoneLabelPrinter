import type { IPhoneInfo } from "../types";

export interface LabelValidation {
  error?: { title: string; message: string };
  warning?: string;
}

export function normalizeImei(value: string): string {
  return value.replace(/\D+/g, "");
}

export function formatBatteryHealth(info: IPhoneInfo): string {
  if (!info.batteryCycleCount) return info.batteryHealth;
  return info.batteryHealth
    ? `${info.batteryHealth} (${info.batteryCycleCount} cycles)`
    : `${info.batteryCycleCount} cycles`;
}

export function primaryIdentifier(info: IPhoneInfo): string {
  const imei = normalizeImei(info.imei);
  if (imei) return `IMEI: ${imei}`;
  if (info.serialNumber.trim()) return `Serial: ${info.serialNumber.trim()}`;
  return "Manual entry needed";
}

export function validateLabelInfo(
  info: IPhoneInfo,
  requireIdentifier: boolean,
): LabelValidation {
  if (!info.marketingModel.trim()) {
    return {
      error: {
        title: "Missing Model",
        message: "Enter a model before generating a label.",
      },
    };
  }

  const hasIdentifier = Boolean(normalizeImei(info.imei) || info.serialNumber.trim());
  if (requireIdentifier && !hasIdentifier) {
    return {
      error: {
        title: "Missing Identifier",
        message: "Enter an IMEI or serial number before printing this label.",
      },
    };
  }

  return hasIdentifier
    ? {}
    : { warning: "Identifier missing. The generated label will show a manual-entry warning." };
}

export function deviceAlerts(info: IPhoneInfo): string[] {
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

export function mergeColorOptions(
  catalogOptions: string[],
  defaultOptions: string[],
  selectedColor = "",
): string[] {
  return ["", ...catalogOptions, ...defaultOptions, selectedColor].filter(
    (color, index, values) => values.indexOf(color) === index,
  );
}
