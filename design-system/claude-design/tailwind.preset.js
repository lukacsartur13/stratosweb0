/**
 * Claude Design — Tailwind preset
 *
 *   // tailwind.config.js
 *   import claudeDesign from "./design-system/claude-design/tailwind.preset.js";
 *   export default { presets: [claudeDesign], content: [...] };
 *
 * Colours map to the CSS custom properties rather than to hex literals, so
 * `bg-surface-raised` follows the theme toggle with no `dark:` variant and no
 * duplicated class list. Load tokens/tokens.css for the values to exist.
 *
 * For Tailwind v4, skip this file and use the @theme block in README.md
 * instead — v4 reads tokens from CSS directly.
 */

export default {
  theme: {
    extend: {
      colors: {
        surface: {
          canvas: "var(--cd-surface-canvas)",
          raised: "var(--cd-surface-raised)",
          overlay: "var(--cd-surface-overlay)",
          sunken: "var(--cd-surface-sunken)",
          inverse: "var(--cd-surface-inverse)",
          accent: "var(--cd-surface-accent)",
          "accent-subtle": "var(--cd-surface-accent-subtle)",
        },
        content: {
          DEFAULT: "var(--cd-text-primary)",
          secondary: "var(--cd-text-secondary)",
          tertiary: "var(--cd-text-tertiary)",
          disabled: "var(--cd-text-disabled)",
          inverse: "var(--cd-text-inverse)",
          accent: "var(--cd-text-accent)",
          "on-accent": "var(--cd-text-on-accent)",
        },
        line: {
          subtle: "var(--cd-border-subtle)",
          DEFAULT: "var(--cd-border-default)",
          strong: "var(--cd-border-strong)",
          accent: "var(--cd-border-accent)",
          focus: "var(--cd-border-focus)",
        },
        status: {
          info: "var(--cd-status-info)",
          success: "var(--cd-status-success)",
          warning: "var(--cd-status-warning)",
          danger: "var(--cd-status-danger)",
        },
        // Primitive ramps, for the rare case that needs a specific step.
        clay: { 50: "#FBF0EC", 100: "#F6DFD6", 200: "#EEC3B4", 300: "#E5A38C", 400: "#DE8C6F", 500: "#D97757", 600: "#C25F3F", 700: "#A04B31", 800: "#7B3A26", 900: "#552718" },
        ivory: { 50: "#FEFDFB", 100: "#FAF9F5", 200: "#F5F3EE", 300: "#F0EEE6", 400: "#E8E5DA", 500: "#DAD6C8", 600: "#C2BDAC" },
        ink: { 50: "#8A8780", 100: "#6F6C65", 200: "#57544E", 300: "#413F3A", 400: "#302E2B", 500: "#262625", 600: "#1F1E1D", 700: "#191817", 800: "#141413", 900: "#0D0D0C" },
      },

      fontFamily: {
        sans: ["Styrene A", "Styrene B", "Söhne", "Inter", "Hanken Grotesk", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
        serif: ["Tiempos Text", "Source Serif 4", "Newsreader", "Charter", "Iowan Old Style", "Georgia", "Times New Roman", "serif"],
        mono: ["Berkeley Mono", "JetBrains Mono", "ui-monospace", "SFMono-Regular", "SF Mono", "Menlo", "Consolas", "monospace"],
      },

      fontSize: {
        "3xs": ["0.6875rem", { lineHeight: "1.5" }],
        "2xs": ["0.75rem", { lineHeight: "1.5", letterSpacing: "0.12em" }],
        xs: ["0.8125rem", { lineHeight: "1.5" }],
        sm: ["0.875rem", { lineHeight: "1.5" }],
        base: ["1rem", { lineHeight: "1.65" }],
        lg: ["1.125rem", { lineHeight: "1.25" }],
        xl: ["1.25rem", { lineHeight: "1.25" }],
        "2xl": ["1.5rem", { lineHeight: "1.25", letterSpacing: "-0.015em" }],
        "3xl": ["1.875rem", { lineHeight: "1.1", letterSpacing: "-0.015em" }],
        "4xl": ["2.25rem", { lineHeight: "1.1", letterSpacing: "-0.015em" }],
        "5xl": ["3rem", { lineHeight: "1.1", letterSpacing: "-0.03em" }],
        "6xl": ["3.75rem", { lineHeight: "1.1", letterSpacing: "-0.03em" }],
        "display-sm": ["clamp(1.875rem, 1.4rem + 2.4vw, 3rem)", { lineHeight: "1.1", letterSpacing: "-0.015em" }],
        "display-md": ["clamp(2.25rem, 1.5rem + 3.8vw, 3.75rem)", { lineHeight: "1.1", letterSpacing: "-0.015em" }],
        "display-lg": ["clamp(2.75rem, 1.6rem + 5.8vw, 4.5rem)", { lineHeight: "1.1", letterSpacing: "-0.03em" }],
      },

      spacing: {
        1: "0.25rem", 2: "0.5rem", 3: "0.75rem", 4: "1rem", 5: "1.25rem",
        6: "1.5rem", 8: "2rem", 10: "2.5rem", 12: "3rem", 16: "4rem",
        20: "5rem", 24: "6rem", 32: "8rem",
      },

      borderRadius: {
        xs: "0.25rem", sm: "0.375rem", DEFAULT: "0.5rem", md: "0.5rem",
        lg: "0.75rem", xl: "1rem", "2xl": "1.5rem", full: "9999px",
      },

      boxShadow: {
        xs: "var(--cd-shadow-xs)",
        sm: "var(--cd-shadow-sm)",
        DEFAULT: "var(--cd-shadow-md)",
        md: "var(--cd-shadow-md)",
        lg: "var(--cd-shadow-lg)",
        xl: "var(--cd-shadow-xl)",
      },

      transitionTimingFunction: {
        standard: "cubic-bezier(0.2, 0, 0, 1)",
        entrance: "cubic-bezier(0.05, 0.7, 0.1, 1)",
        exit: "cubic-bezier(0.3, 0, 0.8, 0.15)",
        emphasis: "cubic-bezier(0.4, 0, 0.2, 1.4)",
      },

      transitionDuration: {
        instant: "80ms", fast: "140ms", DEFAULT: "220ms",
        base: "220ms", slow: "380ms", slower: "620ms",
      },

      maxWidth: {
        content: "72rem",
        prose: "42rem",
        measure: "68ch",
      },
    },
  },
};
