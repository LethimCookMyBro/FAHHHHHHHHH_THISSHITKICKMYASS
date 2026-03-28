import assert from "node:assert/strict";
import { buildZoneSummaries } from "./zoneModel.js";

const baseInput = {
  machines: [
    {
      id: "plc-002",
      name: "Core Assembly Panel PLC",
      machineState: "warning",
      temp: 42,
      model: "S7-1200",
      location: "Core Assembly",
    },
  ],
  alarms: [
    {
      id: "alarm-1",
      machine_id: "plc-002",
      machine_name: "Core Assembly Panel PLC",
      error_code: "A051",
      severity: "critical",
      status: "active",
      location: "Core Assembly",
    },
    {
      id: "alarm-2",
      machine_id: "plc-002",
      machine_name: "Core Assembly Panel PLC",
      error_code: "A052",
      severity: "warning",
      status: "active",
      location: "Core Assembly",
    },
  ],
};

const unresolvedZone = buildZoneSummaries(baseInput).find(
  (zone) => zone.id === "zone-b",
);

assert.equal(unresolvedZone.activeIncidentCount, 2);
assert.equal(unresolvedZone.criticalCount, 1);
assert.equal(unresolvedZone.status, "critical");
assert.equal(unresolvedZone.alarms.length, 2);

const resolvedZone = buildZoneSummaries({
  ...baseInput,
  resolutions: [{ zoneId: "zone-b" }],
}).find((zone) => zone.id === "zone-b");

assert.equal(resolvedZone.activeIncidentCount, 0);
assert.equal(resolvedZone.criticalCount, 0);
assert.equal(resolvedZone.warningCount, 0);
assert.equal(resolvedZone.status, "running");
assert.equal(resolvedZone.alarms.length, 0);

const backendResolvedZone = buildZoneSummaries({
  ...baseInput,
  alarms: [
    {
      ...baseInput.alarms[0],
      status: "resolved",
    },
    baseInput.alarms[1],
  ],
}).find((zone) => zone.id === "zone-b");

assert.equal(backendResolvedZone.activeIncidentCount, 1);
assert.equal(backendResolvedZone.criticalCount, 0);
assert.equal(backendResolvedZone.alarms.length, 1);

console.log("zoneModel.test: all assertions passed");
