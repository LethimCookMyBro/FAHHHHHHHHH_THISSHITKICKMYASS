const BULLET_LINE_RE = /^\s*(?:[-*]|\d+[.)])\s+/;
const SECTION_HEADER_RE = /^\s*\[[A-Z][A-Z0-9 _/.-]{2,}\]\s*$/;
const KEY_VALUE_LINE_RE = /^([A-Za-z][^:]{1,60}):\s+(.+)$/;
const EMPTY_ASSISTANT_REPLY =
  "- I couldn't generate a response right now. Please try again.";
const RELATIVE_TIME_LOCALE = {
  en: "en",
  th: "th-TH",
};
const CLOCK_LOCALE = {
  en: "en-GB",
  th: "th-TH",
};
const RESPONSE_TEXT_PATHS = [
  ["reply"],
  ["answer"],
  ["message"],
  ["response"],
  ["content"],
];
const SESSION_ID_PATHS = [
  ["session_id"],
  ["sessionId"],
  ["id"],
  ["chat_id"],
  ["chatId"],
  ["session", "id"],
  ["session", "session_id"],
  ["chat", "id"],
  ["chat", "session_id"],
  ["meta", "session_id"],
];

const resolveLocale = (locale, dictionary, fallback = "en") =>
  dictionary[locale] || dictionary[fallback];

const getNestedValue = (value, path) => {
  let current = value;
  for (const segment of path) {
    if (!current || typeof current !== "object") return undefined;
    current = current[segment];
  }
  return current;
};

const pickFirstString = (sources, paths) => {
  for (const source of sources) {
    for (const path of paths) {
      const candidate = getNestedValue(source, path);
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate;
      }
    }
  }
  return "";
};

const pickFirstChatId = (sources, paths) => {
  for (const source of sources) {
    for (const path of paths) {
      const normalizedId = normalizeChatId(getNestedValue(source, path));
      if (normalizedId != null) {
        return normalizedId;
      }
    }
  }
  return null;
};

const createFallbackMessageId = (message) =>
  `${message?.created_at || Date.now()}-${message?.role || "msg"}-${Math.random().toString(36).slice(2, 8)}`;

export const formatTimeAgo = (ts, locale = "en") => {
  if (!ts) return "";

  const timestamp = Date.parse(ts);
  if (Number.isNaN(timestamp)) return "";

  const resolvedLocale = resolveLocale(locale, RELATIVE_TIME_LOCALE);
  const formatter = new Intl.RelativeTimeFormat(resolvedLocale, {
    numeric: "auto",
  });
  const diffSeconds = Math.round((timestamp - Date.now()) / 1000);
  const absSeconds = Math.abs(diffSeconds);

  if (absSeconds < 60) {
    return formatter.format(diffSeconds, "second");
  }
  if (absSeconds < 3600) {
    return formatter.format(Math.round(diffSeconds / 60), "minute");
  }
  if (absSeconds < 86400) {
    return formatter.format(Math.round(diffSeconds / 3600), "hour");
  }
  if (absSeconds < 604800) {
    return formatter.format(Math.round(diffSeconds / 86400), "day");
  }
  return new Date(timestamp).toLocaleDateString(
    resolveLocale(locale, CLOCK_LOCALE),
  );
};

export const formatTime = (ts, locale = "en") =>
  ts
    ? new Date(ts).toLocaleTimeString(resolveLocale(locale, CLOCK_LOCALE), {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

export const toArray = (value) => (Array.isArray(value) ? value : []);

export const normalizeChatId = (value) => {
  if (value == null || value === "") return null;
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
};

const pickListPayload = (payload, keys) => {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
};

export const unwrapResponsePayload = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  const nested = payload.data;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested;
  }
  return payload;
};

export const stripTrailingSourcesBlock = (text) => {
  if (typeof text !== "string") return "";
  return text
    .replace(
      /\n{2,}(?:Sources|Source citations|References)\s*:\s*(?:\n-\s.*)+\s*$/i,
      "",
    )
    .trim();
};

export const normalizePageNumber = (value) => {
  if (value == null || value === "") return 0;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  const match = String(value).match(/\d+/);
  if (!match) return 0;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
};

export const normalizeSourceItems = (value) =>
  toArray(value)
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const source = String(item.source || item.source_key || "").trim();
      if (!source) return null;
      return {
        source,
        page: normalizePageNumber(item.page),
      };
    })
    .filter(Boolean);

export const formatSourceItemLabel = (item) => {
  if (!item || typeof item !== "object") return "";
  const source = String(item.source || "").trim();
  if (!source) return "";
  return item.page > 0 ? `${source} (p.${item.page})` : source;
};

const normalizePatternLinesToBullets = (text) => {
  const lines = String(text || "").split("\n");
  const result = [];
  let converted = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (result[result.length - 1] !== "") result.push("");
      continue;
    }

    if (SECTION_HEADER_RE.test(line)) {
      const label = line.replace(/^\[/, "").replace(/\]$/, "").trim();
      result.push(`- **${label}**`);
      converted += 1;
      continue;
    }

    if (BULLET_LINE_RE.test(line)) {
      result.push(line);
      continue;
    }

    const keyValue = line.match(KEY_VALUE_LINE_RE);
    if (keyValue) {
      result.push(`- **${keyValue[1].trim()}**: ${keyValue[2].trim()}`);
      converted += 1;
      continue;
    }

    result.push(line);
  }

  return converted > 0 ? result.join("\n").trim() : text;
};

export const formatAssistantText = (rawText) => {
  const cleaned = stripTrailingSourcesBlock(rawText || "");
  if (!cleaned) {
    return EMPTY_ASSISTANT_REPLY;
  }

  const normalizedPattern = normalizePatternLinesToBullets(cleaned);
  return normalizedPattern || EMPTY_ASSISTANT_REPLY;
};

export const getReplyText = (payload) => {
  const normalizedPayload = unwrapResponsePayload(payload);
  const text = pickFirstString(
    [normalizedPayload, payload],
    RESPONSE_TEXT_PATHS,
  );
  return formatAssistantText(text || "");
};

export const getResponseSessionId = (payload) => {
  const normalizedPayload = unwrapResponsePayload(payload);
  return pickFirstChatId([normalizedPayload, payload], SESSION_ID_PATHS);
};

export const findFallbackSessionId = (payload, userText) => {
  const sessions = pickListPayload(payload, ["items", "sessions"])
    .map((s) => ({
      id: normalizeChatId(s?.id ?? s?.session_id ?? s?.sessionId),
      title: typeof s?.title === "string" ? s.title : "",
      updated_at: s?.updated_at || s?.created_at,
    }))
    .filter((s) => s.id != null);

  if (!sessions.length) return null;

  const targetTitle = userText.slice(0, 50).trim().toLowerCase();
  const now = Date.now();
  const freshSessions = sessions.filter((s) => {
    const timestamp = Date.parse(s.updated_at || "");
    if (Number.isNaN(timestamp)) return false;
    return Math.abs(now - timestamp) <= 5 * 60 * 1000;
  });

  const titleMatched = freshSessions.find(
    (s) => s.title.trim().toLowerCase() === targetTitle,
  );

  if (titleMatched) return titleMatched.id;
  return freshSessions[0]?.id ?? sessions[0]?.id ?? null;
};

export const mapSessionsFromPayload = (payload) =>
  pickListPayload(payload, ["items", "sessions"])
    .map((s) => ({
      id: normalizeChatId(s?.id ?? s?.session_id ?? s?.sessionId),
      title: s?.title,
      messages: [],
      created_at: s?.created_at,
      updated_at: s?.updated_at || s?.created_at,
    }))
    .filter((s) => s.id != null);

export const mapMessagesFromPayload = (payload) =>
  pickListPayload(payload, ["items", "messages"]).map((message) => ({
    id: message?.id ?? message?.message_id ?? createFallbackMessageId(message),
    text:
      message?.role === "assistant"
        ? formatAssistantText(message?.content || "")
        : message?.content || "",
    sender: message?.role === "user" ? "user" : "bot",
    timestamp: message?.created_at,
    processingTime: message?.metadata?.processing_time,
    ragas: message?.metadata?.ragas,
    sources: normalizeSourceItems(message?.metadata?.sources),
    status: "sent",
  }));

export const makeLocalMessageId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
