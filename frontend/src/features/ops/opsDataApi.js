import api from "../../utils/api";
import {
  normalizeAction,
  normalizeActionsPayload,
  normalizeAlarm,
  normalizeAlarmsPayload,
} from "../plc/normalizers";

export async function fetchOpsAlarms(limit = 200) {
  const response = await api.get("/api/plc/alarms", { params: { limit } });
  const normalized = normalizeAlarmsPayload(response?.data || {});
  return normalized.alarms;
}

export async function fetchOpsActions(limit = 150) {
  const response = await api.get("/api/plc/actions", { params: { limit } });
  const normalized = normalizeActionsPayload(response?.data || {});
  return normalized.actions;
}

export async function resolveOpsAlarms({
  alarmIds = [],
  note = "",
  source = "system",
} = {}) {
  const response = await api.post("/api/plc/alarms/resolve", {
    alarm_ids: alarmIds,
    note,
    source,
  });
  const payload = response?.data || {};

  return {
    ...payload,
    alarms: Array.isArray(payload.alarms)
      ? payload.alarms.map((alarm) => normalizeAlarm(alarm))
      : [],
    actions: Array.isArray(payload.actions)
      ? payload.actions.map((action) => normalizeAction(action))
      : [],
  };
}
