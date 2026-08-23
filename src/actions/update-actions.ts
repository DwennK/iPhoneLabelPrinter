import * as api from "../api";
import type { AppState } from "../types";
import { withBusy, type RenderFn } from "./runtime";

export async function checkForUpdates(state: AppState, render: RenderFn): Promise<void> {
  await withBusy(state, render, "Checking for updates...", async () => {
    const update = await api.check({ timeout: 30_000 });
    if (!update) {
      state.updateAvailableVersion = "";
      state.updateReadyToRelaunch = false;
      state.status = "No update available.";
      render();
      return;
    }

    state.updateAvailableVersion = update.version;
    state.updateReadyToRelaunch = false;
    state.status = `Update available: iPhoneLabelPrinter ${update.version}.`;
  });
}

export async function refreshUpdateBadge(state: AppState, render: RenderFn): Promise<void> {
  try {
    const update = await api.check({ timeout: 10_000 });
    state.updateAvailableVersion = update?.version || "";
    state.updateReadyToRelaunch = false;
    render();
  } catch {
    state.updateAvailableVersion = "";
  }
}

export async function installUpdate(state: AppState, render: RenderFn): Promise<void> {
  await withBusy(state, render, "Preparing update...", async () => {
    const update = await api.check({ timeout: 30_000 });
    if (!update) {
      state.updateAvailableVersion = "";
      state.updateReadyToRelaunch = false;
      state.status = "No update available.";
      return;
    }
    state.updateAvailableVersion = update.version;
    state.status = `Downloading iPhoneLabelPrinter ${update.version}...`;
    render();
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        state.status = "Downloading update...";
      } else if (event.event === "Finished") {
        state.status = "Update installed. Relaunch to finish.";
      }
      render();
    });
    state.updateReadyToRelaunch = true;
    state.status = "Update installed. Relaunch to finish.";
  });
}

export async function relaunchNow(state: AppState, render: RenderFn): Promise<void> {
  await withBusy(state, render, "Relaunching app...", async () => {
    await api.relaunch();
  });
}
