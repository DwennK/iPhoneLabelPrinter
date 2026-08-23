import type { HistoryEntry } from "../types";

const SEARCHABLE_FIELDS: Array<keyof HistoryEntry> = [
  "createdAt",
  "labelId",
  "printedAt",
  "marketingModel",
  "technicalModel",
  "storage",
  "color",
  "imei",
  "serialNumber",
  "deviceName",
  "batteryHealth",
  "printerName",
  "pdfPath",
];

export function filterHistory(entries: HistoryEntry[], rawQuery: string): HistoryEntry[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return entries;
  return entries.filter((entry) =>
    SEARCHABLE_FIELDS.map((field) => entry[field]).join(" ").toLowerCase().includes(query),
  );
}

export function findHistoryEntry(
  entries: HistoryEntry[],
  selectedHistoryId: string,
): HistoryEntry | null {
  if (!selectedHistoryId) return null;
  return entries.find((entry) => entry.labelId === selectedHistoryId) || null;
}
