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

export async function fetchOpsActionsPage({
  limit = 15,
  offset = 0,
  query = "",
  quickFilter = "all",
  signal,
} = {}) {
  const params = {
    limit,
    offset,
  };
  const normalizedQuery = String(query || "").trim();
  if (normalizedQuery) {
    params.q = normalizedQuery;
  }
  if (quickFilter === "today") {
    params.today = true;
  } else if (quickFilter === "manual") {
    params.status = "requires_manual";
  } else if (quickFilter && quickFilter !== "all") {
    params.status = quickFilter;
  }

  const response = await api.get("/api/plc/actions", { params, signal });
  const normalized = normalizeActionsPayload(response?.data || {});
  return {
    actions: normalized.actions,
    total: normalized.total,
    limit: normalized.limit,
    offset: normalized.offset,
    stats: response?.data?.stats || null,
  };
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
