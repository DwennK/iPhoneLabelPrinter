import { DEFAULT_COLORS, EMPTY_INFO, type AppState } from "./types";
import { loadSettings } from "./settings";

export function createInitialState(): AppState {
  return {
    activeTab: "label",
    busy: false,
    status: "No device scanned.",
    devices: [],
    selectedUdid: "",
    info: { ...EMPTY_INFO },
    colorOptions: [...DEFAULT_COLORS],
    printers: [],
    selectedPrinter: "",
    generatedPdfPath: "",
    history: [],
    historyQuery: "",
    environment: null,
    settings: loadSettings(),
  };
}
