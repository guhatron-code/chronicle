import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { initActivity } from "./lib/activity";
import { initWindowBacking } from "./lib/window-backing";
import { installFunctionKeyGuard } from "./lib/input-guard";

initActivity();
initWindowBacking();
// an arrow key at the end of a field must never type a square (input-guard.ts)
installFunctionKeyGuard(window);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
