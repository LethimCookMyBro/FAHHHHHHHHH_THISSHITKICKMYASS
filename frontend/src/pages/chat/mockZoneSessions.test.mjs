import assert from "node:assert/strict";
import {
  appendAssistantToMockSession,
  buildMockZoneSessionId,
  createMockZoneSessionToken,
  isMockZoneSessionId,
  mergeSessionsWithMock,
  normalizeMockZoneSession,
  upsertMockZoneSession,
} from "./mockZoneSessions.js";

const zoneASessionId = buildMockZoneSessionId("zone-a");
assert.equal(zoneASessionId, "mock-zone:zone-a");
assert.equal(isMockZoneSessionId(zoneASessionId), true);
assert.equal(isMockZoneSessionId(14), false);
const zoneAUniqueSessionId = buildMockZoneSessionId(
  "zone-a",
  createMockZoneSessionToken(),
);
assert.match(zoneAUniqueSessionId, /^mock-zone:zone-a:/);

const firstHistory = upsertMockZoneSession([], {
  sessionId: zoneASessionId,
  title: "Zone A diagnostics",
  userMessage: {
    id: "u-1",
    text: "Investigate Zone A",
    sender: "user",
    timestamp: "2026-03-28T10:00:00.000Z",
  },
  mockContext: { zoneId: "zone-a", zoneName: "Zone A" },
  timestamp: "2026-03-28T10:00:00.000Z",
});

assert.equal(firstHistory.length, 1);
assert.equal(firstHistory[0].messages.length, 1);

const secondHistory = upsertMockZoneSession(firstHistory, {
  sessionId: zoneASessionId,
  title: "Zone A diagnostics",
  userMessage: {
    id: "u-2",
    text: "Retry diagnosis",
    sender: "user",
    timestamp: "2026-03-28T10:05:00.000Z",
  },
  mockContext: { zoneId: "zone-a", zoneName: "Zone A" },
  timestamp: "2026-03-28T10:05:00.000Z",
});

assert.equal(secondHistory.length, 1);
assert.equal(secondHistory[0].messages.length, 2);
assert.equal(secondHistory[0].id, zoneASessionId);

const withAssistant = appendAssistantToMockSession(secondHistory, {
  sessionId: zoneASessionId,
  assistantMessage: {
    id: "b-1",
    text: "Mock reply",
    sender: "bot",
    timestamp: "2026-03-28T10:05:05.000Z",
  },
  timestamp: "2026-03-28T10:05:05.000Z",
});

assert.equal(withAssistant[0].messages.length, 3);

const merged = mergeSessionsWithMock(
  [{ id: 99, title: "Real session", updated_at: "2026-03-28T09:00:00.000Z" }],
  [
    normalizeMockZoneSession({
      id: buildMockZoneSessionId("zone-b"),
      title: "Zone B diagnostics",
      updated_at: "2026-03-28T11:00:00.000Z",
      messages: [],
      mockContext: { zoneId: "zone-b" },
    }),
    withAssistant[0],
  ],
);

assert.equal(merged.length, 3);
assert.equal(merged[0].id, "mock-zone:zone-b");
assert.equal(merged[1].id, zoneASessionId);

console.log("mockZoneSessions.test: all assertions passed");
