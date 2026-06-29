import { attachEvents, bootstrap } from "./actions";
import { createInitialState } from "./state";
import { renderApp, updateAlerts } from "./views";
import "./styles.css";

const appRoot = document.querySelector<HTMLDivElement>("#app");

if (!appRoot) {
  throw new Error("Missing #app root");
}

const app: HTMLDivElement = appRoot;
const state = createInitialState();

function render() {
  app.innerHTML = renderApp(state);
  attachEvents(app, state, render);
  updateAlerts(app, state);
}

render();
void bootstrap(state, render);
