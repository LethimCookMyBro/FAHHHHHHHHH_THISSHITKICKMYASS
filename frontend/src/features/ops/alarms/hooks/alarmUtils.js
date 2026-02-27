export const FALLBACK_DIAGNOSIS = {
  issue_type: "unknown",
  diagnosis: "Diagnosis unavailable. Retry when service is stable.",
  recommendation: "Verify backend services and run diagnosis again.",
  confidence: 0,
};

export const toReadableTime = (iso) => {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const isHardwareAlarm = (alarm, diagnosis) => {
  const category = String(alarm?.category || "").toLowerCase();
  const issueType = String(diagnosis?.issue_type || "").toLowerCase();
  return category === "hardware" || issueType === "hardware";
};

export const buildPrimaryAction = ({
  selectedAlarm,
  diagnosticsByAlarm,
  plansByAlarm,
  diagnosingId,
  planningId,
  approvingId,
  acknowledgingId,
}) => {
  if (!selectedAlarm) return { kind: "none", label: "Select an incident", disabled: true };
  if (selectedAlarm.status === "resolved") {
    return { kind: "none", label: "Incident resolved", disabled: true };
  }

  const diagnosis = diagnosticsByAlarm[selectedAlarm.id];
  const plan = plansByAlarm[selectedAlarm.id];
  const hardware = isHardwareAlarm(selectedAlarm, diagnosis);

  if (!diagnosis) {
    return { kind: "diagnose", label: "1) Run Diagnose", disabled: diagnosingId === selectedAlarm.id };
  }

  if (!plan) {
    return { kind: "plan", label: "2) Generate Plan", disabled: planningId === selectedAlarm.id };
  }

  if (hardware && selectedAlarm.status === "active") {
    return {
      kind: "acknowledge",
      label: "3) Acknowledge for Hardware Intervention",
      disabled: acknowledgingId === selectedAlarm.id,
    };
  }

  if (selectedAlarm.status === "active") {
    return {
      kind: "approve",
      label: "3) Approve Planned Action",
      disabled: approvingId === selectedAlarm.id,
    };
  }

  return { kind: "none", label: "No immediate action", disabled: true };
};

export const filterAlarms = ({ alarms, searchQuery, statusFilter }) => {
  const query = searchQuery.trim().toLowerCase();
  return alarms.filter((alarm) => {
    if (statusFilter !== "all" && alarm.status !== statusFilter) return false;
    if (!query) return true;
    return (
      String(alarm.error_code || "").toLowerCase().includes(query) ||
      String(alarm.machine_name || "").toLowerCase().includes(query) ||
      String(alarm.message || "").toLowerCase().includes(query) ||
      String(alarm.category || "").toLowerCase().includes(query)
    );
  });
};

export const buildAlarmCounts = (alarms) => ({
  active: alarms.filter((alarm) => alarm.status === "active").length,
  acknowledged: alarms.filter((alarm) => alarm.status === "acknowledged").length,
  resolved: alarms.filter((alarm) => alarm.status === "resolved").length,
  critical: alarms.filter((alarm) => alarm.severity === "critical" && alarm.status === "active").length,
});

export const decorateIncidentRows = (alarms) =>
  alarms.map((alarm) => ({
    ...alarm,
    createdText: toReadableTime(alarm.created_at || alarm.timestamp),
  }));
