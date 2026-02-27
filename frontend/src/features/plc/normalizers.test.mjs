import assert from "node:assert/strict";
import {
  normalizeActionsPayload,
  normalizeAlarmsPayload,
  normalizeDashboardPayload,
} from "./normalizers.js";

const dashboard = normalizeDashboardPayload({
  machines: [
    {
      id: 1,
      name: "Line A",
      status: "RUN",
      sensors: { temperature: 40.5, current: 6.4, vibration: 0.7, pressure: 4.2 },
    },
  ],
  oee: { overall: 45.2, availability: 50, performance: 70.1, quality: 92 },
  summary: { total_machines: 1, running: 1, idle: 0, error: 0, stopped: 0 },
});

assert.equal(dashboard.machines[0].status, "running");
assert.equal(dashboard.machines[0].temp, 40.5);
assert.equal(dashboard.oee.overall, 45.2);

const alarms = normalizeAlarmsPayload({
  alarms: [
    {
      id: 2,
      error_code: "6207",
      message: "PARAMETER ERROR",
      status: "active",
      resolved_at: "2026-02-16T08:00:00Z",
      created_at: "2026-02-16T07:00:00Z",
    },
  ],
});

assert.equal(alarms.alarms[0].status, "resolved");
assert.equal(alarms.alarms[0].timestamp, "2026-02-16T07:00:00Z");

const actions = normalizeActionsPayload({
  actions: [
    {
      id: 3,
      action_type: "plan",
      is_hardware: false,
      execution_status: "EXECUTED",
      action_payload: { action_name: "reload_soft_parameters" },
      approval_info: { approved_by: 1 },
    },
  ],
});

assert.equal(actions.actions[0].issue_type, "software");
assert.equal(actions.actions[0].execution_status, "executed");
assert.equal(actions.actions[0].action_payload.action_name, "reload_soft_parameters");

console.log("normalizers.test: all assertions passed");
