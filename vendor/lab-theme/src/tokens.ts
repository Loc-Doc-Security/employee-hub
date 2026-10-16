/**
 * LocDoc company brand tokens — Lab apps.
 *
 * Canonical MUI source (OMS): LocDoc_OMS3/client/src/settings/theme.ts
 * Authority doc: LAB_SYSTEM_GUIDE.md §3 (workspace root)
 */
export const OMS_THEME_SOURCE = "LocDoc_OMS3/client/src/settings/theme.ts" as const;

/** LocDoc company brand tokens — primary blue + secondary green (OMS-aligned). */
export const LOC_DOC = {
  primary: {
    light: {
      main: "#3f5280",
      text: "#12151c",
      contrastText: "#ffffff",
      backgroundColor: "#e4e7ef",
      backgroundGradient1: "#3f528018",
      backgroundGradient2: "#e4e7ef00",
    },
    dark: {
      main: "#4a5f8f",
      text: "#f2f3f5",
      contrastText: "#ffffff",
      backgroundColor: "#0f1117",
      backgroundGradient1: "#4a5f8f28",
      backgroundGradient2: "#0f111700",
    },
  },
  secondary: {
    light: {
      main: "#4f7a3d",
      text: "#12151c",
      contrastText: "#ffffff",
    },
    dark: {
      main: "#5a8a45",
      text: "#f2f3f5",
      contrastText: "#ffffff",
    },
  },
  /** @deprecated Use primary.light / primary.dark — kept for imports */
  blue: {
    950: "#dce3f0",
    600: "#3f5280",
    500: "#4a5f8f",
    400: "#5a6fa0",
    300: "#6b7fb0",
    dark600: "#4a5f8f",
  },
  /** @deprecated Use secondary.light / secondary.dark */
  green: {
    950: "#1a2e14",
    600: "#4f7a3d",
    500: "#5a8a4a",
    400: "#659957",
    300: "#78ab68",
  },
  neutral: {
    pageBg: "#e4e7ef",
    surface: "#fefefe",
    paper: "#F4F4F8",
    textOnLight: "#12151c",
    textOnBrand: "#ffffff",
    textOnBlue: "#E6E6EA",
    topBarLight: "#fefefe",
    topBarDark: "#232733",
    paperDark: "#1e293b",
    pageBgDark: "#0f1117",
  },
  semantic: {
    tertiary: "#A81C07",
    quaternary: "#4f9898",
    quinary: "#1C1018",
    error: "#f44336",
    success: "#4f7a3d",
    warning: "#ed6c02",
  },
  slate: {
    950: "#1e293b",
    600: "#64748b",
    500: "#94a3b8",
    400: "#cbd5e1",
    300: "#e2e8f0",
  },
  typography: {
    fontFamily: '"Open Sans", Helvetica, Arial, sans-serif',
    button: {
      fontWeight: 500,
      fontSize: "0.9375rem",
      textTransform: "uppercase" as const,
      borderRadius: "4px",
    },
  },
} as const;

export const DEFAULT_THEME_PREFS = {
  themeMode: "light" as const,
  themePalette: "blue" as const,
};
