import { createContext, useContext, useMemo } from "react";

export const THEME_STORAGE_KEY = "theme";
export const LIGHT_THEME = "light";
export const DARK_THEME = "dark";

export const ThemeContext = createContext(null);

export const normalizeTheme = (value) =>
  value === DARK_THEME ? DARK_THEME : LIGHT_THEME;

const readCssVar = (styles, name, fallback = "") => {
  const value = styles.getPropertyValue(name).trim();
  return value || fallback;
};

const resolveCssColor = (probe, styles, name, fallback = "") => {
  const rawValue = readCssVar(styles, name, fallback);
  probe.style.color = fallback;
  probe.style.color = rawValue || fallback;
  const resolvedValue = getComputedStyle(probe).color.trim();
  return resolvedValue || rawValue || fallback;
};

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }
  return context;
}

export function useThemePalette() {
  const { theme } = useTheme();

  return useMemo(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return {
        accent: "",
        accentSoft: "",
        accentAlt: "",
        chartGrid: "",
        chartText: "",
        chartReference: "",
        critical: "",
        criticalSoft: "",
        ok: "",
        surface: "",
        surface2: "",
        textMuted: "",
      };
    }

    const styles = getComputedStyle(document.documentElement);
    const host = document.body || document.documentElement;
    const probe = document.createElement("span");
    probe.style.position = "absolute";
    probe.style.opacity = "0";
    probe.style.pointerEvents = "none";
    host.appendChild(probe);

    const palette = {
      accent: resolveCssColor(probe, styles, "--accent"),
      accentSoft: resolveCssColor(probe, styles, "--accent-soft"),
      accentAlt: resolveCssColor(probe, styles, "--chart-accent-alt"),
      chartGrid: resolveCssColor(probe, styles, "--chart-grid"),
      chartText: resolveCssColor(
        probe,
        styles,
        "--text-secondary",
        theme === DARK_THEME ? "#e8e8e8" : "#0d0d0d",
      ),
      chartReference: resolveCssColor(probe, styles, "--chart-reference"),
      critical: resolveCssColor(probe, styles, "--critical"),
      criticalSoft: resolveCssColor(probe, styles, "--critical-soft"),
      ok: resolveCssColor(probe, styles, "--ok"),
      surface: resolveCssColor(probe, styles, "--surface"),
      surface2: resolveCssColor(probe, styles, "--surface2"),
      textMuted: resolveCssColor(
        probe,
        styles,
        "--text-muted",
        theme === DARK_THEME ? "rgba(255, 255, 255, 0.42)" : "rgba(0, 0, 0, 0.45)",
      ),
    };

    probe.remove();

    return palette;
  }, [theme]);
}
