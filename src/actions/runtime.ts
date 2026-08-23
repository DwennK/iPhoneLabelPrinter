import type { AppError, AppState } from "../types";

export type RenderFn = () => void;

const activeOperations = new WeakMap<AppState, number>();

export async function withBusy(
  state: AppState,
  render: RenderFn,
  message: string,
  action: () => Promise<void>,
): Promise<void> {
  const operationCount = (activeOperations.get(state) || 0) + 1;
  activeOperations.set(state, operationCount);
  state.busy = true;
  state.status = message;
  render();

  try {
    await action();
  } catch (error) {
    const appError = normalizeError(error);
    setError(state, render, appError.title, appError.message);
  } finally {
    const remainingOperations = Math.max((activeOperations.get(state) || 1) - 1, 0);
    activeOperations.set(state, remainingOperations);
    state.busy = remainingOperations > 0;
    render();
  }
}

export function setError(
  state: AppState,
  render: RenderFn,
  title: string,
  message: string,
): void {
  state.status = `${title}: ${message}`;
  render();
}

export function normalizeError(error: unknown): AppError {
  if (
    typeof error === "object" &&
    error &&
    "title" in error &&
    "message" in error
  ) {
    return error as AppError;
  }
  return {
    title: "Operation Failed",
    message: error instanceof Error ? error.message : String(error),
  };
}

export function bindButton(
  app: HTMLElement,
  action: string,
  listener: () => void | Promise<void>,
  state: AppState,
  render: RenderFn,
): void {
  app.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)?.addEventListener(
    "click",
    () => {
      Promise.resolve(listener()).catch((error) => {
        const appError = normalizeError(error);
        setError(state, render, appError.title, appError.message);
      });
    },
  );
}
