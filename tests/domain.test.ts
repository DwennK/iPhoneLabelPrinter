import assert from "node:assert/strict";
import test from "node:test";
import { deviceAlerts, formatBatteryHealth, normalizeImei, validateLabelInfo } from "../src/domain/device-info";
import { filterHistory, findHistoryEntry } from "../src/domain/history";
import { historyLabelOptions, orientLabelOptions } from "../src/domain/label-options";
import { EMPTY_INFO, type HistoryEntry } from "../src/types";

const historyEntry: HistoryEntry = {
  labelId: "label-1",
  createdAt: "2026-08-23",
  printedAt: "",
  marketingModel: "iPhone 17",
  technicalModel: "iPhone18,3",
  storage: "256 GB",
  color: "Blue",
  imei: "355026429560655",
  serialNumber: "ABC123",
  deviceName: "Desk phone",
  iosVersion: "18.5",
  batteryHealth: "86%",
  printerName: "Zebra",
  pdfPath: "/tmp/label.pdf",
  labelWidthMm: "40",
  labelHeightMm: "62",
  labelOrientation: "portrait",
  printScaleMode: "fit",
};

test("normalizes and validates device identifiers", () => {
  assert.equal(normalizeImei("35 502642-9560655"), "355026429560655");
  assert.deepEqual(validateLabelInfo({ ...EMPTY_INFO }, false), {
    error: { title: "Missing Model", message: "Enter a model before generating a label." },
  });
  assert.equal(
    validateLabelInfo({ ...EMPTY_INFO, marketingModel: "iPhone 17" }, false).warning,
    "Identifier missing. The generated label will show a manual-entry warning.",
  );
});

test("formats battery diagnostics and exposes actionable alerts", () => {
  const info = {
    ...EMPTY_INFO,
    marketingModel: "iPhone 17",
    storage: "256 GB",
    color: "Blue",
    imei: "123",
    batteryHealth: "79%",
    batteryCycleCount: "601",
  };
  assert.equal(formatBatteryHealth(info), "79% (601 cycles)");
  assert.deepEqual(deviceAlerts({ ...info, batteryHealth: formatBatteryHealth(info) }), [
    "IMEI should contain 15 digits.",
    "Battery health is low (79%).",
    "Battery cycle count is high (601 cycles).",
  ]);
});

test("orients profiles and restores historical label options", () => {
  const fallback = orientLabelOptions({
    labelWidthMm: 40,
    labelHeightMm: 62,
    labelOrientation: "landscape",
    printScaleMode: "noscale",
  });
  assert.deepEqual(fallback, {
    labelWidthMm: 62,
    labelHeightMm: 40,
    labelOrientation: "landscape",
    printScaleMode: "noscale",
  });
  assert.deepEqual(historyLabelOptions(historyEntry, fallback), {
    labelWidthMm: 40,
    labelHeightMm: 62,
    labelOrientation: "portrait",
    printScaleMode: "fit",
  });
});

test("filters and selects history by stable label id", () => {
  const entries = [historyEntry, { ...historyEntry, labelId: "label-2", color: "Red" }];
  assert.deepEqual(filterHistory(entries, "blue").map((entry) => entry.labelId), ["label-1"]);
  assert.equal(findHistoryEntry(entries, "label-2")?.color, "Red");
  assert.equal(findHistoryEntry(entries, "missing"), null);
});
