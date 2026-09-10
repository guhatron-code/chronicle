import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { initActivity } from "./lib/activity";
import { initWindowBacking } from "./lib/window-backing";

initActivity();
initWindowBacking();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
