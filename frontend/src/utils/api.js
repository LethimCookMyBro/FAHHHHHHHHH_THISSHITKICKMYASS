/**
 * Centralized API module for frontend.
 * Cookie-session + CSRF flow (no localStorage access token usage).
 */

import axios from "axios";

const metaEnv = import.meta.env || {};
const API_URL = metaEnv.VITE_API_URL || "";
const API_TIMEOUT_MS = Number(metaEnv.VITE_API_TIMEOUT_MS || 180000);
const API_BASE_URL = API_URL.replace(/\/$/, "");
const CSRF_HEADER_NAME = "X-CSRF-Token";
const CSRF_COOKIE_NAME = "csrf_token";
const RETRYABLE_STATUS_CODES = new Set([408, 425, 500, 502, 503, 504]);
const SAFE_METHODS = new Set(["get", "head", "options"]);
const CSRF_EXEMPT_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/csrf",
]);

const looksLikeHtml = (value) => {
  if (typeof value !== "string") return false;
  const sample = value.trim().slice(0, 200).toLowerCase();
  return (
    sample.startsWith("<!doctype html") ||
    sample.startsWith("<html") ||
    sample.includes("<head") ||
    sample.includes("<body")
  );
};

const isApiUrl = (url = "") =>
  /^\/?api(\/|$)/.test(url) || url.includes("/api/");
const getHttpStatus = (error) => {
  const status = Number(error?.response?.status);
  return Number.isFinite(status) ? status : null;
};
const getResponseText = (data) => {
  if (typeof data === "string") return data.trim();
  if (!data || typeof data !== "object") return "";
  const candidates = [data.message, data.detail, data.error, data.code];
  const firstText = candidates.find(
    (value) => typeof value === "string" && value.trim(),
  );
  return firstText ? firstText.trim() : "";
};
const isMissingAuthError = (error) => {
  if (getHttpStatus(error) !== 401) return false;
  const text = getResponseText(error?.response?.data).toLowerCase();
  return (
    text.includes("not authenticated") ||
    text.includes("missing refresh token")
  );
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const parseRetryAfterHeader = (value) => {
  if (value == null || value === "") return null;

  const numericSeconds = Number(value);
  if (Number.isFinite(numericSeconds) && numericSeconds >= 0) {
    return Math.round(numericSeconds * 1000);
  }

  const retryDate = Date.parse(String(value));
  if (Number.isNaN(retryDate)) return null;
  return Math.max(0, retryDate - Date.now());
};

const getRetryAfterDelayMs = (error) => {
  const headers = error?.response?.headers;
  if (!headers || typeof headers !== "object") return null;
  return parseRetryAfterHeader(headers["retry-after"] || headers["Retry-After"]);
};

export const isRetryableApiError = (error) => {
  const status = getHttpStatus(error);
  if (status != null) {
    return RETRYABLE_STATUS_CODES.has(status);
  }

  const normalizedCode = String(error?.code || "").toUpperCase();
  if (
    normalizedCode === "ECONNABORTED" ||
    normalizedCode === "ERR_NETWORK" ||
    normalizedCode === "ERR_BAD_RESPONSE"
  ) {
    return true;
  }

  const normalizedMessage = String(error?.message || "").toLowerCase();
  return (
    normalizedMessage.includes("network error") ||
    normalizedMessage.includes("timed out")
  );
};

export const retryApiRequest = async (requestFn, options = {}) => {
  const retries = Number.isInteger(options?.retries)
    ? Math.max(0, options.retries)
    : 1;
  const baseDelayMs =
    Number(options?.baseDelayMs) > 0 ? Number(options.baseDelayMs) : 450;
  const shouldRetry = options?.shouldRetry || isRetryableApiError;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await requestFn();
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !shouldRetry(error)) {
        throw error;
      }
      const retryAfterDelayMs = getRetryAfterDelayMs(error);
      const exponentialDelayMs = baseDelayMs * 2 ** attempt;
      const jitterMs = Math.round(exponentialDelayMs * 0.15 * Math.random());
      await sleep(Math.max(retryAfterDelayMs || 0, exponentialDelayMs + jitterMs));
    }
  }
  throw lastError;
};

export const getApiErrorMessage = (error, fallback = "Request failed") => {
  const status = getHttpStatus(error);
  const data = error?.response?.data;
  if (typeof data === "string" && data.trim()) {
    if (looksLikeHtml(data)) {
      return "API returned HTML instead of JSON. Check VITE_API_URL or /api proxy routing.";
    }
    return data;
  }

  if (data && typeof data === "object") {
    const code = String(data.code || "")
      .trim()
      .toUpperCase();
    if (status === 429) {
      const retryAfterSeconds =
        Number(data?.details?.retry_after_seconds) ||
        Number(data?.retry_after_seconds) ||
        0;
      if (retryAfterSeconds > 0) {
        return `Too many requests. Retry in about ${retryAfterSeconds} seconds.`;
      }
      if (typeof data.message === "string" && data.message.trim()) {
        return data.message;
      }
      return "Too many requests. Please retry later.";
    }
    if (status === 503 && code === "BACKEND_UNAVAILABLE") {
      return "Backend is unavailable or restarting. Wait a few seconds and retry.";
    }
    if (typeof data.message === "string" && data.message.trim()) {
      return data.message;
    }
    if (typeof data.detail === "string" && data.detail.trim()) {
      return data.detail;
    }
    if (Array.isArray(data.detail) && data.detail.length > 0) {
      const first = data.detail[0];
      if (typeof first?.msg === "string" && first.msg.trim()) {
        return first.msg;
      }
    }
    if (typeof data.error === "string" && data.error.trim()) {
      return data.error;
    }
  }

  if (status === 504) {
    return "Server timeout (504). The backend took too long to respond. Please retry in a few moments.";
  }
  if (status === 503) {
    return "Service unavailable (503). Backend may still be starting up.";
  }
  if (status === 502) {
    return "Bad gateway (502). Frontend proxy cannot reach backend service.";
  }

  if (typeof error?.message === "string" && error.message.trim()) {
    return error.message;
  }
  return fallback;
};

const readCookie = (name) => {
  if (typeof document === "undefined") return "";
  const target = `${name}=`;
  const parts = document.cookie.split(";");
  for (const part of parts) {
    const item = part.trim();
    if (item.startsWith(target)) {
      return decodeURIComponent(item.slice(target.length));
    }
  }
  return "";
};

const getOriginForUrlParsing = () =>
  typeof window !== "undefined" ? window.location.origin : "http://localhost";

const normalizeRequestPath = (url = "") => {
  const value = String(url || "");
  if (!value) return "";
  return value.startsWith("http")
    ? new URL(value, getOriginForUrlParsing()).pathname
    : value;
};

const resolveRequestUrl = (url = "") => {
  const value = String(url || "");
  if (!value || value.startsWith("http") || !API_BASE_URL) return value;
  return value.startsWith("/") ? `${API_BASE_URL}${value}` : `${API_BASE_URL}/${value}`;
};

const shouldAttachCsrf = (method, url) => {
  const normalizedMethod = String(method || "get").toLowerCase();
  const normalizedPath = normalizeRequestPath(url);
  return (
    !SAFE_METHODS.has(normalizedMethod) &&
    !CSRF_EXEMPT_PATHS.has(normalizedPath)
  );
};

const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  timeout: API_TIMEOUT_MS,
  headers: {
    "Content-Type": "application/json",
  },
});

const refreshClient = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  timeout: API_TIMEOUT_MS,
  headers: {
    "Content-Type": "application/json",
  },
});

let refreshPromise = null;
let csrfPromise = null;

const ensureCsrf = async () => {
  const current = readCookie(CSRF_COOKIE_NAME);
  if (current) return current;

  if (!csrfPromise) {
    csrfPromise = refreshClient
      .get("/api/auth/csrf")
      .catch(() => null)
      .finally(() => {
        csrfPromise = null;
      });
  }
  await csrfPromise;
  return readCookie(CSRF_COOKIE_NAME);
};

const buildRequestHeaders = async (method, url, headers = {}) => {
  const requestHeaders = new Headers(headers);
  if (shouldAttachCsrf(method, url)) {
    const csrfToken = await ensureCsrf();
    if (csrfToken) {
      requestHeaders.set(CSRF_HEADER_NAME, csrfToken);
    }
  }
  return requestHeaders;
};

export const readResponseErrorMessage = async (
  response,
  fallback = "Request failed",
) => {
  if (!response) return fallback;

  try {
    const cloned = response.clone();
    const contentType = String(cloned.headers.get("content-type") || "").toLowerCase();

    if (contentType.includes("application/json")) {
      const data = await cloned.json();
      return getApiErrorMessage({ response: { status: cloned.status, data } }, fallback);
    }

    const text = await cloned.text();
    if (looksLikeHtml(text)) {
      return "API returned HTML instead of JSON. Check VITE_API_URL or /api proxy routing.";
    }
    return text.trim() || fallback;
  } catch {
    return fallback;
  }
};

export const streamApiRequest = async (url, options = {}) => {
  const method = String(options?.method || "GET").toUpperCase();
  const requestUrl = resolveRequestUrl(url);
  const externalSignal = options?.signal || null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, API_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort();

  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeoutId);
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", abortFromCaller, { once: true });
    }
  }

  try {
    const headers = await buildRequestHeaders(method, url, options?.headers || {});
    const response = await fetch(requestUrl, {
      ...options,
      method,
      headers,
      credentials: "include",
      signal: controller.signal,
    });

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (isApiUrl(url) && contentType.includes("text/html")) {
      const formatError = new Error(
        "API returned HTML instead of JSON. Check VITE_API_URL or /api proxy routing.",
      );
      formatError.response = response;
      formatError.code = "API_INVALID_HTML_RESPONSE";
      throw formatError;
    }

    return response;
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  }
};

api.interceptors.request.use(
  async (config) => {
    const method = String(config?.method || "get").toLowerCase();
    const url = String(config?.url || "");
    const normalizedPath = normalizeRequestPath(url);

    if (!SAFE_METHODS.has(method) && !CSRF_EXEMPT_PATHS.has(normalizedPath)) {
      const csrfToken = await ensureCsrf();
      if (csrfToken) {
        config.headers = config.headers || {};
        config.headers[CSRF_HEADER_NAME] = csrfToken;
      }
    }
    return config;
  },
  (error) => Promise.reject(error),
);

refreshClient.interceptors.request.use(
  async (config) => {
    const method = String(config?.method || "get").toLowerCase();
    const url = String(config?.url || "");
    const normalizedPath = normalizeRequestPath(url);

    if (!SAFE_METHODS.has(method) && !CSRF_EXEMPT_PATHS.has(normalizedPath)) {
      const csrfToken = await ensureCsrf();
      if (csrfToken) {
        config.headers = config.headers || {};
        config.headers[CSRF_HEADER_NAME] = csrfToken;
      }
    }
    return config;
  },
  (error) => Promise.reject(error),
);

api.interceptors.response.use(
  (response) => {
    const url = response?.config?.url || "";
    if (isApiUrl(url) && looksLikeHtml(response?.data)) {
      const formatError = new Error(
        "API returned HTML instead of JSON. Check VITE_API_URL or /api proxy routing.",
      );
      formatError.response = response;
      formatError.config = response?.config;
      formatError.code = "API_INVALID_HTML_RESPONSE";
      return Promise.reject(formatError);
    }
    return response;
  },
  async (error) => {
    const originalRequest = error.config || {};
    const url = String(originalRequest.url || "");
    const isAuthEndpoint =
      url.includes("/auth/login") ||
      url.includes("/auth/register") ||
      url.includes("/auth/refresh");

    if (
      error.response?.status === 401 &&
      !isMissingAuthError(error) &&
      !isAuthEndpoint &&
      !originalRequest._retry
    ) {
      originalRequest._retry = true;
      try {
        if (!refreshPromise) {
          refreshPromise = refreshClient
            .post("/api/auth/refresh")
            .finally(() => {
              refreshPromise = null;
            });
        }
        await refreshPromise;
        return api(originalRequest);
      } catch (refreshError) {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("auth:expired"));
        }
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  },
);

export const chatAPI = {
  sendMessage: (message, sessionId = null, collection = "plcnext") =>
    api.post("/api/chat", { message, session_id: sessionId, collection }),
  getSessions: () => api.get("/api/chat/sessions"),
  getMessages: (sessionId) => api.get(`/api/chat/sessions/${sessionId}`),
  deleteSession: (sessionId) => api.delete(`/api/chat/sessions/${sessionId}`),
  transcribe: (audioBlob, signal, language = "en", prompt = "") => {
    const formData = new FormData();
    formData.append("file", audioBlob, "recording.webm");
    formData.append("language", language);
    if (prompt) {
      formData.append("prompt", prompt);
    }
    return api.post("/api/transcribe", formData, {
      headers: { "Content-Type": "multipart/form-data" },
      signal,
    });
  },
};

const shouldRetryAuthMe = (error) => {
  const status = getHttpStatus(error);
  if (status === 401) return false;
  return isRetryableApiError(error);
};

const shouldRetryAuthLogin = (error) => {
  const status = getHttpStatus(error);
  if (status === 401 || status === 403 || status === 409 || status === 422)
    return false;
  return isRetryableApiError(error);
};

export const authAPI = {
  login: (email, password) =>
    retryApiRequest(() => api.post("/api/auth/login", { email, password }), {
      retries: 2,
      baseDelayMs: 300,
      shouldRetry: shouldRetryAuthLogin,
    }),
  register: (fullName, email, password) =>
    api.post("/api/auth/register", { full_name: fullName, email, password }),
  me: () =>
    retryApiRequest(() => api.get("/api/auth/me"), {
      retries: 1,
      baseDelayMs: 250,
      shouldRetry: shouldRetryAuthMe,
    }),
  logout: () => api.post("/api/auth/logout"),
  csrf: () => api.get("/api/auth/csrf"),
  createWsTicket: () => api.post("/api/auth/ws-ticket"),
  getUiPreferences: () => api.get("/api/auth/preferences"),
  updateUiPreferences: (patch) =>
    api.patch("/api/auth/preferences", patch || {}),
};

export default api;
