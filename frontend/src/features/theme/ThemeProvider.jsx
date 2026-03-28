import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import {
  DARK_THEME,
  LIGHT_THEME,
  normalizeTheme,
  THEME_STORAGE_KEY,
  ThemeContext,
} from "./themeContext";

const readInitialTheme = () => {
  if (typeof document === "undefined") {
    return LIGHT_THEME;
  }

  const rootTheme = document.documentElement.dataset.theme;
  if (rootTheme) {
    return normalizeTheme(rootTheme);
  }

  if (typeof window === "undefined") {
    return LIGHT_THEME;
  }

  try {
    return normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return LIGHT_THEME;
  }
};

const applyThemeToDocument = (theme) => {
  if (typeof document === "undefined") return;
  const nextTheme = normalizeTheme(theme);
  document.documentElement.dataset.theme = nextTheme;
  document.documentElement.style.colorScheme =
    nextTheme === DARK_THEME ? "dark" : "light";
};

const disableThemeTransitionsTemporarily = () => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  const root = document.documentElement;
  root.dataset.themeSwitching = "true";
  window.getComputedStyle(root).getPropertyValue("--bg");

  let rafOne = 0;
  let rafTwo = 0;

  const release = () => {
    delete root.dataset.themeSwitching;
  };

  rafOne = window.requestAnimationFrame(() => {
    rafTwo = window.requestAnimationFrame(release);
  });

  return () => {
    if (rafOne) window.cancelAnimationFrame(rafOne);
    if (rafTwo) window.cancelAnimationFrame(rafTwo);
    release();
  };
};

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    const initialTheme = readInitialTheme();
    applyThemeToDocument(initialTheme);
    return initialTheme;
  });

  const commitTheme = (nextTheme) => {
    const normalizedTheme = normalizeTheme(nextTheme);
    applyThemeToDocument(normalizedTheme);
    return normalizedTheme;
  };

  useLayoutEffect(() => {
    const cleanup = disableThemeTransitionsTemporarily();
    applyThemeToDocument(theme);
    return cleanup;
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore persistence failures and keep the in-memory theme.
    }
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handleStorage = (event) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      setThemeState(commitTheme(event.newValue));
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const value = useMemo(
    () => ({
      theme,
      isDark: theme === DARK_THEME,
      setTheme: (nextTheme) => {
        setThemeState((currentTheme) =>
          commitTheme(
            typeof nextTheme === "function" ? nextTheme(currentTheme) : nextTheme,
          ),
        );
      },
      toggleTheme: () => {
        setThemeState((currentTheme) =>
          commitTheme(
            currentTheme === DARK_THEME ? LIGHT_THEME : DARK_THEME,
          ),
        );
      },
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
