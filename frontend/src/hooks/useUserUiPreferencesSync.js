import { useEffect, useRef } from "react";
import { authAPI } from "../utils/api";
import {
  applyLocalePreference,
  subscribeLocalePreferenceChanged,
} from "../utils/uiPreferenceEvents";

const normalizeTheme = (value) => {
  const next = String(value || "").trim().toLowerCase();
  return next === "dark" || next === "light" ? next : "";
};

const normalizeLocale = (value) => {
  const next = String(value || "").trim().toLowerCase();
  return next === "th" || next === "en" ? next : "";
};

export function useUserUiPreferencesSync({ user, theme, setTheme }) {
  const userId = user?.id ?? null;
  const readyRef = useRef(false);
  const activeUserRef = useRef(null);
  const lastSyncedThemeRef = useRef("");
  const lastSyncedLocaleRef = useRef("");
  const themeRef = useRef(normalizeTheme(theme));

  themeRef.current = normalizeTheme(theme);

  useEffect(() => {
    if (!userId) {
      readyRef.current = false;
      activeUserRef.current = null;
      lastSyncedThemeRef.current = "";
      lastSyncedLocaleRef.current = "";
      return undefined;
    }

    let cancelled = false;
    readyRef.current = false;
    activeUserRef.current = userId;

    const applyServerPrefs = async () => {
      try {
        const mePrefs = user?.ui_preferences && typeof user.ui_preferences === "object"
          ? user.ui_preferences
          : null;
        const response = mePrefs ? null : await authAPI.getUiPreferences();
        const prefs =
          (mePrefs || response?.data?.ui_preferences || response?.data || {});

        if (cancelled) return;

        const serverTheme = normalizeTheme(prefs?.theme);
        if (serverTheme && serverTheme !== themeRef.current) {
          setTheme(serverTheme);
        }
        if (serverTheme) {
          lastSyncedThemeRef.current = serverTheme;
        }

        const serverLocale = normalizeLocale(prefs?.locale);
        if (serverLocale) {
          applyLocalePreference(serverLocale);
          lastSyncedLocaleRef.current = serverLocale;
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("UI preference sync (load) failed:", error);
        }
      } finally {
        if (!cancelled && activeUserRef.current === userId) {
          readyRef.current = true;
        }
      }
    };

    applyServerPrefs();

    return () => {
      cancelled = true;
    };
  }, [user?.ui_preferences, userId, setTheme]);

  useEffect(() => {
    const normalizedTheme = normalizeTheme(theme);
    if (!userId || !readyRef.current || !normalizedTheme) return;
    if (lastSyncedThemeRef.current === normalizedTheme) return;

    let cancelled = false;
    lastSyncedThemeRef.current = normalizedTheme;

    authAPI
      .updateUiPreferences({ theme: normalizedTheme })
      .catch((error) => {
        if (!cancelled) {
          console.warn("UI preference sync (theme) failed:", error);
          lastSyncedThemeRef.current = "";
        }
      });

    return () => {
      cancelled = true;
    };
  }, [theme, userId]);

  useEffect(() => {
    if (!userId) return () => {};

    return subscribeLocalePreferenceChanged((nextLocale) => {
      if (!readyRef.current) return;
      if (!nextLocale) return;
      if (lastSyncedLocaleRef.current === nextLocale) return;

      lastSyncedLocaleRef.current = nextLocale;
      authAPI.updateUiPreferences({ locale: nextLocale }).catch((error) => {
        console.warn("UI preference sync (locale) failed:", error);
        lastSyncedLocaleRef.current = "";
      });
    });
  }, [userId]);
}
