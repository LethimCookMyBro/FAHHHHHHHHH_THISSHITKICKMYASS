const MOCK_ZONE_STORAGE_KEY = "mockZoneChatSessions";
const MOCK_ZONE_SESSION_PREFIX = "mock-zone:";
const DEFAULT_ZONE_ID = "zone-b";
const SESSION_TOKEN_RE = /[^a-z0-9_-]+/g;

const asArray = (value) => (Array.isArray(value) ? value : []);
const normalizeSessionToken = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(SESSION_TOKEN_RE, "-")
    .replace(/^-+|-+$/g, "");

const toIsoString = (value) => {
  if (!value) return new Date().toISOString();
  if (typeof value === "string") return value;

  try {
    return new Date(value).toISOString();
  } catch {
    return new Date().toISOString();
  }
};

const normalizeMessage = (message = {}) => ({
  id: message.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  text: String(message.text || ""),
  sender: message.sender === "user" ? "user" : "bot",
  timestamp: toIsoString(message.timestamp),
  status: String(message.status || "sent"),
  processingTime: message.processingTime,
  ragas: message.ragas,
  sources: asArray(message.sources),
});

const compareByUpdatedAt = (left, right) => {
  const leftTime = Date.parse(left?.updated_at || left?.created_at || "") || 0;
  const rightTime = Date.parse(right?.updated_at || right?.created_at || "") || 0;
  return rightTime - leftTime;
};

export const buildMockZoneSessionId = (
  zoneId = DEFAULT_ZONE_ID,
  sessionToken = "",
) => {
  const normalizedZoneId = String(zoneId || DEFAULT_ZONE_ID).trim().toLowerCase();
  const normalizedToken = normalizeSessionToken(sessionToken);
  return normalizedToken
    ? `${MOCK_ZONE_SESSION_PREFIX}${normalizedZoneId}:${normalizedToken}`
    : `${MOCK_ZONE_SESSION_PREFIX}${normalizedZoneId}`;
};

export const createMockZoneSessionToken = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const isMockZoneSessionId = (sessionId) =>
  typeof sessionId === "string" && sessionId.startsWith(MOCK_ZONE_SESSION_PREFIX);

export const normalizeMockZoneSession = (session = {}) => {
  const zoneId = String(
    session?.mockContext?.zoneId || session.zoneId || DEFAULT_ZONE_ID,
  )
    .trim()
    .toLowerCase();
  const createdAt = toIsoString(session.created_at);
  const updatedAt = toIsoString(session.updated_at || createdAt);

  return {
    id: isMockZoneSessionId(session.id)
      ? session.id
      : buildMockZoneSessionId(zoneId),
    title: String(session.title || "Mock diagnostics"),
    messages: asArray(session.messages).map(normalizeMessage),
    created_at: createdAt,
    updated_at: updatedAt,
    isMockZone: true,
    mockContext:
      session.mockContext && typeof session.mockContext === "object"
        ? { ...session.mockContext, zoneId }
        : { zoneId },
  };
};

export const mergeSessionsWithMock = (remoteSessions = [], mockSessions = []) => {
  const merged = new Map();

  remoteSessions.forEach((session) => {
    if (session?.id == null) return;
    merged.set(session.id, session);
  });

  mockSessions.forEach((session) => {
    const normalized = normalizeMockZoneSession(session);
    merged.set(normalized.id, normalized);
  });

  return [...merged.values()].sort(compareByUpdatedAt);
};

export const readStoredMockZoneSessions = (
  storage = typeof localStorage !== "undefined" ? localStorage : null,
) => {
  if (!storage) return [];

  try {
    const parsed = JSON.parse(storage.getItem(MOCK_ZONE_STORAGE_KEY) || "[]");
    return asArray(parsed).map(normalizeMockZoneSession).sort(compareByUpdatedAt);
  } catch {
    return [];
  }
};

export const persistMockZoneSessions = (
  sessions,
  storage = typeof localStorage !== "undefined" ? localStorage : null,
) => {
  if (!storage) return;

  const normalized = asArray(sessions)
    .filter((session) => isMockZoneSessionId(session?.id))
    .map(normalizeMockZoneSession)
    .sort(compareByUpdatedAt);
  const serialized = JSON.stringify(normalized);
  if (storage.getItem(MOCK_ZONE_STORAGE_KEY) === serialized) {
    return;
  }
  storage.setItem(MOCK_ZONE_STORAGE_KEY, serialized);
};

export const upsertMockZoneSession = (
  sessions,
  { sessionId, title, userMessage, mockContext, timestamp },
) => {
  const targetId =
    sessionId ||
    buildMockZoneSessionId(mockContext?.zoneId || DEFAULT_ZONE_ID);
  const nowIso = toIsoString(timestamp);
  const existing = asArray(sessions).find((session) => session.id === targetId);

  const nextSession = normalizeMockZoneSession({
    ...existing,
    id: targetId,
    title: title || existing?.title || "Mock diagnostics",
    created_at: existing?.created_at || nowIso,
    updated_at: nowIso,
    messages: existing
      ? [...asArray(existing.messages), normalizeMessage(userMessage)]
      : [normalizeMessage(userMessage)],
    mockContext: { ...(existing?.mockContext || {}), ...(mockContext || {}) },
  });

  return [
    nextSession,
    ...asArray(sessions).filter((session) => session.id !== targetId),
  ];
};

export const appendAssistantToMockSession = (
  sessions,
  { sessionId, assistantMessage, timestamp },
) =>
  asArray(sessions).map((session) =>
    session.id === sessionId
      ? normalizeMockZoneSession({
          ...session,
          updated_at: toIsoString(timestamp),
          messages: [...asArray(session.messages), normalizeMessage(assistantMessage)],
        })
      : session,
  );

export default {
  buildMockZoneSessionId,
  createMockZoneSessionToken,
  isMockZoneSessionId,
  mergeSessionsWithMock,
  readStoredMockZoneSessions,
  persistMockZoneSessions,
  upsertMockZoneSession,
  appendAssistantToMockSession,
};
