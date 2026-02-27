import assert from "node:assert/strict";
import {
  buildAlarmCounts,
  buildPrimaryAction,
  decorateIncidentRows,
  filterAlarms,
  toReadableTime,
} from "./alarmUtils.js";

const alarms = [
  { id: 1, status: "active", severity: "critical", error_code: "1001", machine_name: "Cutter A", message: "Overheat", category: "software", created_at: "2026-02-17T03:12:00Z" },
  { id: 2, status: "acknowledged", severity: "warning", error_code: "2002", machine_name: "Press B", message: "Vibration high", category: "hardware", created_at: "2026-02-17T02:12:00Z" },
  { id: 3, status: "resolved", severity: "warning", error_code: "3003", machine_name: "Line C", message: "Recovered", category: "software", created_at: "2026-02-16T15:12:00Z" },
];

assert.equal(toReadableTime(null), "-");
assert.equal(toReadableTime("invalid"), "-");
assert.ok(toReadableTime("2026-02-17T03:12:00Z").includes("17/02"));

assert.equal(filterAlarms({ alarms, searchQuery: "cutter", statusFilter: "all" }).length, 1);
assert.equal(filterAlarms({ alarms, searchQuery: "", statusFilter: "active" }).length, 1);

assert.deepEqual(buildAlarmCounts(alarms), {
  active: 1,
  acknowledged: 1,
  resolved: 1,
  critical: 1,
});

const decorated = decorateIncidentRows(alarms);
assert.equal(typeof decorated[0].createdText, "string");
assert.ok(decorated[0].createdText.length > 0);

assert.equal(
  buildPrimaryAction({
    selectedAlarm: alarms[0],
    diagnosticsByAlarm: {},
    plansByAlarm: {},
    diagnosingId: null,
    planningId: null,
    approvingId: null,
    acknowledgingId: null,
  }).kind,
  "diagnose",
);

assert.equal(
  buildPrimaryAction({
    selectedAlarm: alarms[0],
    diagnosticsByAlarm: { 1: { issue_type: "software" } },
    plansByAlarm: { 1: { action_id: 88 } },
    diagnosingId: null,
    planningId: null,
    approvingId: null,
    acknowledgingId: null,
  }).kind,
  "approve",
);

assert.equal(
  buildPrimaryAction({
    selectedAlarm: alarms[0],
    diagnosticsByAlarm: { 1: { issue_type: "hardware" } },
    plansByAlarm: { 1: { action_id: 91 } },
    diagnosingId: null,
    planningId: null,
    approvingId: null,
    acknowledgingId: null,
  }).kind,
  "acknowledge",
);

console.log("ops alarms helpers: all assertions passed");
