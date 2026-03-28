import assert from "node:assert/strict";
import {
  isAlarmResolvedByMockChat,
  markMockZoneIncidentResolved,
  readMockZoneIncidentResolutions,
} from "./mockZoneResolution.js";

const createMemoryStorage = () => {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
  };
};

const storage = createMemoryStorage();

markMockZoneIncidentResolved(
  {
    zoneId: "zone-b",
    machineId: "plc-002",
    machineName: "Main Conveyor Safety PLC",
    errorCode: "A051",
  },
  storage,
);

const resolutions = readMockZoneIncidentResolutions(storage);
assert.equal(resolutions.length, 1);
assert.equal(resolutions[0].zoneId, "zone-b");

assert.equal(
  isAlarmResolvedByMockChat(
    {
      resolvedZoneId: "zone-b",
      machine_id: "plc-002",
      machine_name: "Main Conveyor Safety PLC",
      error_code: "A051",
    },
    resolutions,
  ),
  true,
);

assert.equal(
  isAlarmResolvedByMockChat(
    {
      resolvedZoneId: "zone-c",
      machine_id: "plc-003",
      machine_name: "Packaging Robot B",
      error_code: "W201",
    },
    resolutions,
  ),
  false,
);

console.log("mockZoneResolution.test: all assertions passed");
