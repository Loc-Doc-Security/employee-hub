import { applyThemeToDocument, createThemeStorage } from "lab-theme/theme";
const storage = createThemeStorage("employee-hub_theme_prefs");
export const loadLocalThemePrefs = storage.loadLocalThemePrefs;
export const saveLocalThemePrefs = storage.saveLocalThemePrefs;
export { applyThemeToDocument };