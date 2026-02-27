const APPLY_LOCALE_EVENT = "panya:ui-pref:apply-locale";
const LOCALE_CHANGED_EVENT = "panya:ui-pref:locale-changed";

const normalizeLocale = (value) => {
  const locale = String(value || "").trim().toLowerCase();
  return locale === "th" ? "th" : locale === "en" ? "en" : "";
};

export const emitLocalePreferenceChanged = (locale) => {
  const normalized = normalizeLocale(locale);
  if (!normalized || typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(LOCALE_CHANGED_EVENT, {
      detail: { locale: normalized },
    }),
  );
};

export const applyLocalePreference = (locale) => {
  const normalized = normalizeLocale(locale);
  if (!normalized || typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(APPLY_LOCALE_EVENT, {
      detail: { locale: normalized },
    }),
  );
};

export const subscribeLocalePreferenceApply = (handler) => {
  if (typeof window === "undefined" || typeof handler !== "function") {
    return () => {};
  }

  const listener = (event) => {
    const nextLocale = normalizeLocale(event?.detail?.locale);
    if (!nextLocale) return;
    handler(nextLocale);
  };

  window.addEventListener(APPLY_LOCALE_EVENT, listener);
  return () => window.removeEventListener(APPLY_LOCALE_EVENT, listener);
};

export const subscribeLocalePreferenceChanged = (handler) => {
  if (typeof window === "undefined" || typeof handler !== "function") {
    return () => {};
  }

  const listener = (event) => {
    const nextLocale = normalizeLocale(event?.detail?.locale);
    if (!nextLocale) return;
    handler(nextLocale);
  };

  window.addEventListener(LOCALE_CHANGED_EVENT, listener);
  return () => window.removeEventListener(LOCALE_CHANGED_EVENT, listener);
};
