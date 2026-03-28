import assert from "node:assert/strict";
import {
  buildZoneChatInput,
  buildZonePanelSearch,
  clearZonePanelSearch,
  getZonePanelContextFromSearch,
  getZoneIdFromSearch,
} from "./zonePanelState.js";

assert.equal(buildZonePanelSearch("", "zone-a"), "zoneId=zone-a");

assert.equal(
  buildZonePanelSearch(
    "source=equipment&zoneId=zone-b&machineId=robot-1&machineName=Robot+A&errorCode=F800H",
    "zone-c",
  ),
  "source=equipment&zoneId=zone-c",
);

assert.equal(
  clearZonePanelSearch(
    "zoneId=zone-a&machineId=robot-1&machineName=Robot+A&errorCode=F800H&source=portmap",
  ),
  "source=portmap",
);

assert.equal(getZoneIdFromSearch("?zoneId=zone-d&source=portmap"), "zone-d");
assert.equal(getZoneIdFromSearch("?source=portmap"), "");

assert.deepEqual(
  getZonePanelContextFromSearch(
    "?zoneId=zone-a&machineId=robot-1&machineName=Robot+A&errorCode=F800H&source=alarms",
  ),
  {
    zoneId: "zone-a",
    machineId: "robot-1",
    machineName: "Robot A",
    errorCode: "F800H",
  },
);

assert.deepEqual(
  buildZoneChatInput(
    { id: "zone-a", name: "Zone A" },
    "?zoneId=zone-a&machineId=robot-1&machineName=Robot+A&errorCode=F800H",
  ),
  {
    id: "zone-a",
    name: "Zone A",
    machineId: "robot-1",
    machineName: "Robot A",
    errorCode: "F800H",
  },
);

assert.deepEqual(
  buildZoneChatInput(
    { id: "zone-b", name: "Zone B" },
    "?zoneId=zone-a&machineId=robot-1&machineName=Robot+A&errorCode=F800H",
  ),
  { id: "zone-b", name: "Zone B" },
);

console.log("zonePanelState.test.mjs passed");
