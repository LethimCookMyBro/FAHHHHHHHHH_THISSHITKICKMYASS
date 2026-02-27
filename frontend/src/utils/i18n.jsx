/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import en from "../locales/en.json";
import th from "../locales/th.json";
import {
  emitLocalePreferenceChanged,
  subscribeLocalePreferenceApply,
} from "./uiPreferenceEvents";

const LOCALES = { en, th };
const STORAGE_KEY = "panya_locale";

const resolveInitial = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "th" || saved === "en") return saved;
  } catch {
    /* noop */
  }
  return "en";
};

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(resolveInitial);

  const applyLocale = useCallback((next, { emitChangeEvent = true } = {}) => {
    const value = next === "th" ? "th" : "en";
    setLocaleState(value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* noop */
    }
    if (emitChangeEvent) {
      emitLocalePreferenceChanged(value);
    }
  }, []);

  const setLocale = useCallback((next) => {
    applyLocale(next, { emitChangeEvent: true });
  }, [applyLocale]);

  useEffect(() => subscribeLocalePreferenceApply((nextLocale) => {
    applyLocale(nextLocale, { emitChangeEvent: false });
  }), [applyLocale]);

  const t = useCallback(
    (key, params) => {
      const dict = LOCALES[locale] || LOCALES.en;
      let text = dict[key] ?? LOCALES.en[key] ?? key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          text = text.replace(`{${k}}`, String(v));
        }
      }
      return text;
    },
    [locale],
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useT() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT must be used within I18nProvider");
  return ctx;
}
