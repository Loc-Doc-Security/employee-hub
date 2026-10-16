import { DEFAULT_THEME_PREFS } from "./tokens";

export type ThemeMode = "light" | "dark" | "system";
export type ThemePalette = "green" | "blue" | "red";

/** Primary blue is the only palette — secondary green is fixed in CSS. */
export const THEME_PALETTES: { id: ThemePalette; label: string; swatch: string }[] = [
  { id: "blue", label: "LocDoc Blue", swatch: "#3f5280" },
];

export const THEME_MODES: { id: ThemeMode; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

export type ThemePrefs = {
  themeMode: ThemeMode;
  themePalette: ThemePalette;
};

/** Flat theme id used by PM legacy picker and data-theme attribute. */
export type FlatThemeId =
  | "light"
  | "dark"
  | "light-blue"
  | "dark-blue"
  | "light-green"
  | "dark-green"
  | "light-red"
  | "dark-red";

export function normalizePalette(_palette: unknown): ThemePalette {
  return "blue";
}

export function normalizeMode(mode: unknown): ThemeMode {
  if (mode === "dark") return "dark";
  return "light";
}

export function resolveThemeId(mode: ThemeMode, palette: ThemePalette): FlatThemeId {
  const effectiveMode = normalizeMode(mode);
  const effectivePalette = normalizePalette(palette);
  if (effectivePalette === "blue") {
    return effectiveMode === "dark" ? "dark-blue" : "light-blue";
  }
  if (effectivePalette === "red") {
    return effectiveMode === "dark" ? "dark-red" : "light-red";
  }
  return `${effectiveMode}-${effectivePalette}` as FlatThemeId;
}

export function applyThemeToDocument(mode: ThemeMode, palette: ThemePalette) {
  document.documentElement.setAttribute("data-theme", resolveThemeId(mode, palette));
}

export function applyFlatTheme(themeId: FlatThemeId) {
  document.documentElement.setAttribute("data-theme", migrateFlatTheme(themeId));
}

export function flatThemeToPrefs(themeId: FlatThemeId): ThemePrefs {
  const isDark =
    themeId === "dark" ||
    themeId === "dark-blue" ||
    themeId === "dark-green" ||
    themeId === "dark-red";
  return { themeMode: isDark ? "dark" : "light", themePalette: "blue" };
}

/** Migrate any stored flat theme id to LocDoc blue light/dark. */
export function migrateFlatTheme(themeId: FlatThemeId): FlatThemeId {
  return resolveThemeId(flatThemeToPrefs(themeId).themeMode, "blue");
}

export function prefsToFlatTheme(prefs: ThemePrefs): FlatThemeId {
  return resolveThemeId(prefs.themeMode, prefs.themePalette);
}

export function createThemeStorage(storageKey: string, defaults: ThemePrefs = DEFAULT_THEME_PREFS) {
  const normalizedDefaults: ThemePrefs = {
    themeMode: normalizeMode(defaults.themeMode),
    themePalette: normalizePalette(defaults.themePalette),
  };

  return {
    loadLocalThemePrefs(): ThemePrefs {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return normalizedDefaults;
        const parsed = JSON.parse(raw) as Partial<ThemePrefs>;
        return {
          themeMode: normalizeMode(parsed.themeMode),
          themePalette: normalizePalette(parsed.themePalette),
        };
      } catch {
        return normalizedDefaults;
      }
    },
    saveLocalThemePrefs(prefs: ThemePrefs) {
      const normalized = {
        themeMode: normalizeMode(prefs.themeMode),
        themePalette: normalizePalette(prefs.themePalette),
      };
      localStorage.setItem(storageKey, JSON.stringify(normalized));
    },
    /** Migrate PM flat theme string in localStorage. */
    loadFlatTheme(): FlatThemeId {
      const flat = localStorage.getItem(storageKey) as FlatThemeId | null;
      const valid: FlatThemeId[] = [
        "light",
        "dark",
        "light-blue",
        "dark-blue",
        "light-green",
        "dark-green",
        "light-red",
        "dark-red",
      ];
      if (flat && valid.includes(flat)) return migrateFlatTheme(flat);
      return resolveThemeId(normalizedDefaults.themeMode, normalizedDefaults.themePalette);
    },
    saveFlatTheme(themeId: FlatThemeId) {
      localStorage.setItem(storageKey, migrateFlatTheme(themeId));
    },
  };
}
