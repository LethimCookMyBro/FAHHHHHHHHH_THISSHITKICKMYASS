import assert from "node:assert/strict";
import {
  buildMockZoneAssistantReply,
  buildMockZoneChatSearch,
  buildMockZonePrompt,
  buildMockZoneRuntimeContext,
  createMockZoneReplyChunks,
  getMockZoneRouteContext,
  getMockZoneProfile,
  shouldUseMockZoneSend,
} from "./mockZoneChat.js";

const zoneAProfile = getMockZoneProfile("zone-a");
assert.equal(zoneAProfile.plcModel, "Mitsubishi MELSEC iQ-F FX5U-32MR/ES");
assert.equal(zoneAProfile.primaryErrorCode, "F800H");

const search = buildMockZoneChatSearch(
  {
    id: "zone-a",
    name: "Zone A",
    machines: [{ id: 7, name: "Zone A Infeed PLC", model: "Unknown" }],
    alarms: [{ error_code: "F800H", status: "active" }],
  },
  "portmap",
);
const routeContext = getMockZoneRouteContext(`?${search}`);

assert.equal(routeContext.zoneId, "zone-a");
assert.equal(routeContext.source, "portmap");
assert.match(String(routeContext.sessionId), /^mock-zone:zone-a:/);

const runtimeContext = buildMockZoneRuntimeContext({
  routeContext,
  dashboard: {
    machines: [
      {
        id: 7,
        name: "Zone A Infeed PLC",
        model: "Unknown",
        location: "berth lane",
        status: "error",
      },
    ],
    recent_alarms: [
      {
        id: 11,
        machine_id: 7,
        machine_name: "Zone A Infeed PLC",
        error_code: "F800H",
        message: "Smart-function parameter mismatch",
        status: "active",
        severity: "critical",
      },
    ],
    recent_actions: [
      {
        id: 14,
        machine_name: "Zone A Infeed PLC",
        execution_status: "planned",
        recommendation: "Reconfirm parameter download",
      },
    ],
  },
});

assert.equal(runtimeContext.zoneId, "zone-a");
assert.equal(runtimeContext.plcModel, "Mitsubishi MELSEC iQ-F FX5U-32MR/ES");
assert.equal(runtimeContext.errorCode, "F800H");
assert.match(runtimeContext.latestRelevantLog, /Zone A Infeed PLC/);

const prompt = buildMockZonePrompt(runtimeContext);
assert.match(prompt, /^Mitsubishi MELSEC iQ-F FX5U-32MR\/ES \+ F800H/m);
assert.match(prompt, /Zone A is using PLC model Mitsubishi MELSEC iQ-F FX5U-32MR\/ES/);
assert.match(prompt, /error code F800H/);
assert.match(prompt, /Recent zone logs:/);
assert.match(prompt, /Smart-function parameter mismatch|F800H detected/);

const reply = buildMockZoneAssistantReply(runtimeContext, "Check the zone logs");
assert.match(reply, /PLC model/);
assert.match(reply, /F800H/);

const chunks = createMockZoneReplyChunks(reply);
assert.ok(chunks.length >= 10);
assert.ok(chunks.every((chunk) => chunk.delayMs > 0));

assert.equal(
  shouldUseMockZoneSend({
    routeContext,
    activeChatId: null,
    activeChat: null,
  }),
  true,
);
assert.equal(
  shouldUseMockZoneSend({
    routeContext: null,
    activeChatId: "mock-zone:zone-a",
    activeChat: null,
  }),
  true,
);
assert.equal(
  shouldUseMockZoneSend({
    routeContext: null,
    activeChatId: 42,
    activeChat: { id: 42, isMockZone: false },
  }),
  false,
);

console.log("mockZoneChat.test: all assertions passed");
