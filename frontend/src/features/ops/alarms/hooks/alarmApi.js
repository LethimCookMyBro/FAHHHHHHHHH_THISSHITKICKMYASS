import api from "../../../../utils/api";
import { normalizeAlarmsPayload } from "../../../plc/normalizers";

export const DEFAULT_HW_CHECKLIST = [
  "Perform lockout/tagout before touching cabinet hardware.",
  "Inspect wiring, fuse, and connector integrity for the affected module.",
  "Verify RUN/ERR/LINK LEDs and compare with the service manual.",
  "Confirm replacement/repair and acknowledge when completed.",
];

export async function fetchAlarms() {
  const response = await api.get("/api/plc/alarms", { params: { limit: 200 } });
  const normalized = normalizeAlarmsPayload(response?.data || {});
  return normalized.alarms;
}

export async function diagnoseAlarm(alarm) {
  const response = await api.post("/api/plc/diagnose", {
    error_code: alarm.error_code,
    error_message: alarm.error_message || alarm.message,
    machine_id: alarm.machine_id,
    machine_name: alarm.machine_name,
    category: alarm.category,
    model: alarm.raw_data?.model,
    sensors: alarm.raw_data?.sensors || {},
  });
  return response?.data || {};
}

export async function createPlan(alarm, diagnosis) {
  const response = await api.post("/api/plc/actions/plan", {
    alarm_id: alarm.id,
    error_code: alarm.error_code,
    error_message: alarm.error_message || alarm.message,
    machine_id: alarm.machine_id,
    machine_name: alarm.machine_name,
    category: alarm.category,
    diagnosis: diagnosis?.diagnosis || "",
    recommendation: diagnosis?.recommendation || "",
    confidence: diagnosis?.confidence || 0,
    issue_type: diagnosis?.issue_type || "",
    sensors: alarm.raw_data?.sensors || {},
  });
  const payload = response?.data || {};
  return {
    ...payload,
    execution_status: payload.execution_status || payload.status || "",
    plan:
      payload.plan && typeof payload.plan === "object" && !Array.isArray(payload.plan)
        ? payload.plan
        : {},
  };
}

export async function approvePlan(planActionId) {
  const response = await api.post(`/api/plc/actions/${planActionId}/approve`, {
    reason: "Approved from Incident Center",
  });
  const payload = response?.data || {};
  return {
    ...payload,
    execution_status: payload.execution_status || payload.status || "",
    execution_result:
      payload.execution_result &&
      typeof payload.execution_result === "object" &&
      !Array.isArray(payload.execution_result)
        ? payload.execution_result
        : payload.result || {},
  };
}

export async function acknowledgeAlarm(alarmId) {
  await api.post(`/api/plc/alarms/${alarmId}/acknowledge`, {
    note: "Acknowledged for on-site hardware intervention.",
    checklist: DEFAULT_HW_CHECKLIST,
  });
}
