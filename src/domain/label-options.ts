import { normalizePrintScaleMode, positiveNumber } from "../settings";
import type { HistoryEntry, LabelOptions, PrinterProfile } from "../types";

export function orientLabelOptions(profile: PrinterProfile): LabelOptions {
  const shortSide = Math.min(profile.labelWidthMm, profile.labelHeightMm);
  const longSide = Math.max(profile.labelWidthMm, profile.labelHeightMm);
  return {
    labelWidthMm: profile.labelOrientation === "portrait" ? shortSide : longSide,
    labelHeightMm: profile.labelOrientation === "portrait" ? longSide : shortSide,
    labelOrientation: profile.labelOrientation,
    printScaleMode: profile.printScaleMode,
  };
}

export function historyLabelOptions(
  entry: HistoryEntry,
  fallback: LabelOptions,
): LabelOptions {
  return {
    labelWidthMm: positiveNumber(entry.labelWidthMm, fallback.labelWidthMm),
    labelHeightMm: positiveNumber(entry.labelHeightMm, fallback.labelHeightMm),
    labelOrientation:
      entry.labelOrientation === "portrait" || entry.labelOrientation === "landscape"
        ? entry.labelOrientation
        : fallback.labelOrientation,
    printScaleMode: normalizePrintScaleMode(
      entry.printScaleMode || fallback.printScaleMode,
    ),
  };
}
