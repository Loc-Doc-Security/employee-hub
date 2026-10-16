import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./lib/fetchAuth";
import { applyThemeToDocument, loadLocalThemePrefs } from "./lib/theme";

const prefs = loadLocalThemePrefs();
applyThemeToDocument(prefs.themeMode, prefs.themePalette);

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);