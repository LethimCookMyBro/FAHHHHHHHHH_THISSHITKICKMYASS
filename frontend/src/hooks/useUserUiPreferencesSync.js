import { useEffect, useRef } from "react";
import { authAPI } from "../utils/api";
import {
  applyLocalePreference,
  subscribeLocalePreferenceChanged,
} from "../utils/uiPreferenceEvents";

const normalizeLocale = (value) => {
  const next = String(value || "").trim().toLowerCase();
  return next === "th" || next === "en" ? next : "";
};

export function useUserUiPreferencesSync({ user }) {
  const userId = user?.id ?? null;
  const readyRef = useRef(false);
  const activeUserRef = useRef(null);
  const lastSyncedLocaleRef = useRef("");

  useEffect(() => {
    if (!userId) {
      readyRef.current = false;
      activeUserRef.current = null;
      lastSyncedLocaleRef.current = "";
      return undefined;
    }

    let cancelled = false;
    readyRef.current = false;
    activeUserRef.current = userId;

    const applyServerPrefs = async () => {
      try {
        const mePrefs =
          user?.ui_preferences && typeof user.ui_preferences === "object"
            ? user.ui_preferences
            : null;
        const response = mePrefs ? null : await authAPI.getUiPreferences();
        const prefs = mePrefs || response?.data?.ui_preferences || response?.data || {};

        if (cancelled) return;

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
  }, [user?.ui_preferences, userId]);

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
