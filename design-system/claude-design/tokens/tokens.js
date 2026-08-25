/**
 * Claude Design — tokens.js
 *
 * The semantic layer as JavaScript, for anything that can't read CSS custom
 * properties: canvas, WebGL, Chart.js, PDF generation, native, email builders.
 *
 * Values are resolved per theme rather than aliased, because the consumers
 * listed above have no cascade to resolve aliases through.
 *
 * Keep in sync with tokens.css. If you change one, change the other — there
 * is no build step generating this, deliberately: a build step nobody runs is
 * worse than two files someone edits.
 */

export const primitive = {
  clay: { 50: "#FBF0EC", 100: "#F6DFD6", 200: "#EEC3B4", 300: "#E5A38C", 400: "#DE8C6F", 500: "#D97757", 600: "#C25F3F", 700: "#A04B31", 800: "#7B3A26", 900: "#552718" },
  ivory: { 50: "#FEFDFB", 100: "#FAF9F5", 200: "#F5F3EE", 300: "#F0EEE6", 400: "#E8E5DA", 500: "#DAD6C8", 600: "#C2BDAC" },
  ink: { 50: "#8A8780", 100: "#6F6C65", 200: "#57544E", 300: "#413F3A", 400: "#302E2B", 500: "#262625", 600: "#1F1E1D", 700: "#191817", 800: "#141413", 900: "#0D0D0C" },
  sky: { 100: "#E3EDF3", 300: "#A9C7D8", 500: "#6A9BB8", 700: "#3F6E8B", 900: "#26445A" },
  moss: { 100: "#E4EDE2", 300: "#A9C4A2", 500: "#6E9264", 700: "#4A6A42", 900: "#2C4127" },
  amber: { 100: "#F8EBD2", 300: "#EBC680", 500: "#C8942B", 700: "#946A17", 900: "#5A400C" },
  rose: { 100: "#F9E3E1", 300: "#E9A8A2", 500: "#C4544A", 700: "#96372F", 900: "#5C1F1A" },
  white: "#FFFFFF",
  black: "#000000",
};

export const themes = {
  light: {
    surfaceCanvas: primitive.ivory[300],
    surfaceRaised: primitive.ivory[100],
    surfaceOverlay: primitive.ivory[50],
    surfaceSunken: primitive.ivory[400],
    surfaceInverse: primitive.ink[800],
    surfaceAccent: primitive.clay[500],
    textPrimary: primitive.ink[800],
    textSecondary: primitive.ink[200],
    textTertiary: primitive.ink[100],
    textInverse: primitive.ivory[100],
    textAccent: primitive.clay[700],
    textOnAccent: primitive.white,
    borderSubtle: primitive.ivory[500],
    borderDefault: primitive.ivory[600],
    borderStrong: primitive.ink[100],
    statusInfo: primitive.sky[700],
    statusSuccess: primitive.moss[700],
    statusWarning: primitive.amber[700],
    statusDanger: primitive.rose[700],
    chart: [primitive.clay[500], primitive.sky[700], primitive.moss[500], primitive.amber[500], primitive.ink[200], primitive.sky[300]],
    chartGrid: primitive.ivory[500],
    chartAxis: primitive.ink[100],
  },
  dark: {
    surfaceCanvas: primitive.ink[800],
    surfaceRaised: primitive.ink[600],
    surfaceOverlay: primitive.ink[500],
    surfaceSunken: primitive.ink[900],
    surfaceInverse: primitive.ivory[100],
    surfaceAccent: primitive.clay[500],
    textPrimary: primitive.ivory[200],
    textSecondary: "#B5B1A6",
    textTertiary: "#918D84",
    textInverse: primitive.ink[800],
    textAccent: primitive.clay[300],
    textOnAccent: primitive.ink[900],
    borderSubtle: "#2E2C2A",
    borderDefault: "#3D3A36",
    borderStrong: "#5A5651",
    statusInfo: primitive.sky[300],
    statusSuccess: primitive.moss[300],
    statusWarning: primitive.amber[300],
    statusDanger: primitive.rose[300],
    chart: [primitive.clay[400], primitive.sky[300], primitive.moss[300], primitive.amber[300], "#B5B1A6", primitive.sky[500]],
    chartGrid: "#2E2C2A",
    chartAxis: "#918D84",
  },
};

export const font = {
  sans: '"Styrene A", "Styrene B", Söhne, Inter, "Hanken Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  serif: '"Tiempos Text", "Source Serif 4", Newsreader, Charter, "Iowan Old Style", Georgia, "Times New Roman", serif',
  mono: '"Berkeley Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  weight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
  size: { "3xs": 11, "2xs": 12, xs: 13, sm: 14, md: 16, lg: 18, xl: 20, "2xl": 24, "3xl": 30, "4xl": 36, "5xl": 48, "6xl": 60, "7xl": 72 },
  leading: { none: 1, tight: 1.1, snug: 1.25, normal: 1.5, relaxed: 1.65, loose: 1.8 },
};

/** Space scale in px. Multiply by 1/16 for rem. */
export const space = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64, 20: 80, 24: 96, 32: 128 };

export const radius = { none: 0, xs: 4, sm: 6, md: 8, lg: 12, xl: 16, "2xl": 24, full: 9999 };

export const motion = {
  duration: { instant: 80, fast: 140, base: 220, slow: 380, slower: 620 },
  ease: {
    standard: [0.2, 0, 0, 1],
    entrance: [0.05, 0.7, 0.1, 1],
    exit: [0.3, 0, 0.8, 0.15],
    emphasis: [0.4, 0, 0.2, 1.4],
  },
};

/**
 * Resolve the active theme the same way the CSS does: an explicit
 * data-theme on <html> beats the OS preference.
 */
export function activeTheme(doc = globalThis.document) {
  const explicit = doc?.documentElement?.dataset?.theme;
  if (explicit === "dark" || explicit === "light") return themes[explicit];
  const prefersDark = globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches;
  return prefersDark ? themes.dark : themes.light;
}

export default { primitive, themes, font, space, radius, motion, activeTheme };
