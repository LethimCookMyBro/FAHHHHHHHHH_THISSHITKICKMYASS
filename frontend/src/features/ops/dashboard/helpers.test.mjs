import assert from "node:assert/strict";
import {
  extractInstructionSteps,
  isWarningState,
  resolveMachineState,
  sortMachineQueue,
} from "./helpers.js";

assert.equal(isWarningState({ status: "running", temp: 72 }), true);
assert.equal(isWarningState({ status: "running", temp: 60, current: 8, vibration: 1.1 }), false);
assert.equal(resolveMachineState({ status: "error", temp: 40 }), "error");
assert.equal(resolveMachineState({ status: "running", temp: 71 }), "warning");
assert.equal(resolveMachineState({ status: "idle", temp: 30 }), "idle");

const queue = sortMachineQueue([
  { id: 1, name: "B", status: "running", temp: 40 },
  { id: 2, name: "A", status: "error", temp: 40 },
  { id: 3, name: "C", status: "idle", temp: 40 },
  { id: 4, name: "D", status: "running", temp: 75 },
]);

assert.deepEqual(
  queue.map((item) => item.id),
  [2, 4, 3, 1],
  "Queue should be ordered by urgency: error > warning > idle > running",
);

assert.deepEqual(
  extractInstructionSteps(
    "1. Open the GX Works project used for this PLC. 2. Review parameter settings related to the affected module/function. 3. Correct the configuration mismatch or invalid assignment.",
  ),
  [
    "Open the GX Works project used for this PLC",
    "Review parameter settings related to the affected module/function",
    "Correct the configuration mismatch or invalid assignment",
  ],
);

console.log("ops dashboard helpers: all assertions passed");
