export const createFallbackDiagnosis = (t) => ({
  issue_type: "unknown",
  diagnosis: t("alarms.diagnosisUnavailable"),
  recommendation: t("alarms.verifyBackendServices"),
  confidence: 0,
});

const EMPTY_COUNTS = Object.freeze({
  active: 0,
  acknowledged: 0,
  resolved: 0,
  critical: 0,
});

const SEARCH_FIELDS = ["error_code", "machine_name", "message", "category"];

const createDisabledAction = (label) => ({
  kind: "none",
  label,
  disabled: true,
});

const matchesAlarmQuery = (alarm, query) =>
  !query ||
  SEARCH_FIELDS.some((field) =>
    String(alarm?.[field] || "").toLowerCase().includes(query),
  );

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
  t = (value) => value,
}) => {
  if (!selectedAlarm) return createDisabledAction(t("alarms.selectIncident"));
  if (selectedAlarm.status === "resolved") {
    return createDisabledAction(t("alarms.incidentResolved"));
  }

  const diagnosis = diagnosticsByAlarm[selectedAlarm.id];
  const plan = plansByAlarm[selectedAlarm.id];
  const hardware = isHardwareAlarm(selectedAlarm, diagnosis);

  if (!diagnosis) {
    return {
      kind: "diagnose",
      label: t("alarms.runDiagnoseButton"),
      disabled: diagnosingId === selectedAlarm.id,
    };
  }

  if (!plan) {
    return {
      kind: "plan",
      label: t("alarms.generatePlanButton"),
      disabled: planningId === selectedAlarm.id,
    };
  }

  if (hardware && selectedAlarm.status === "active") {
    return {
      kind: "acknowledge",
      label: t("alarms.acknowledgeHardwareWork"),
      disabled: acknowledgingId === selectedAlarm.id,
    };
  }

  if (selectedAlarm.status === "active") {
    return {
      kind: "approve",
      label: t("alarms.approvePlannedAction"),
      disabled: approvingId === selectedAlarm.id,
    };
  }

  return createDisabledAction(t("alarms.noImmediateAction"));
};

export const filterAlarms = ({ alarms, searchQuery, statusFilter }) => {
  const query = searchQuery.trim().toLowerCase();

  return alarms.filter((alarm) => {
    if (statusFilter !== "all" && alarm.status !== statusFilter) return false;
    return matchesAlarmQuery(alarm, query);
  });
};

export const buildAlarmCounts = (alarms) =>
  alarms.reduce((counts, alarm) => {
    if (alarm.status === "active") {
      counts.active += 1;
      if (alarm.severity === "critical") {
        counts.critical += 1;
      }
    } else if (alarm.status === "acknowledged") {
      counts.acknowledged += 1;
    } else if (alarm.status === "resolved") {
      counts.resolved += 1;
    }

    return counts;
  }, { ...EMPTY_COUNTS });

export const decorateIncidentRows = (alarms) =>
  alarms.map((alarm) => ({
    ...alarm,
    createdText: toReadableTime(alarm.created_at || alarm.timestamp),
  }));
