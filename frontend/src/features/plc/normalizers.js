const MACHINE_STATUS_MAP = {
  run: "running",
  running: "running",
  idle: "idle",
  error: "error",
  stop: "stopped",
  stopped: "stopped",
};

const ALARM_STATUS_MAP = {
  active: "active",
  acknowledged: "acknowledged",
  resolved: "resolved",
};

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const toIso = (value) => {
  if (!value) return null;
  if (typeof value === "string") return value;
  try {
    return new Date(value).toISOString();
  } catch {
    return null;
  }
};

export const normalizeMachineStatus = (status) => {
  const key = String(status || "").trim().toLowerCase();
  return MACHINE_STATUS_MAP[key] || "idle";
};

export const normalizeAlarmStatus = (status, resolvedAt) => {
  if (resolvedAt) return "resolved";
  const key = String(status || "active").trim().toLowerCase();
  return ALARM_STATUS_MAP[key] || "active";
};

export const normalizeMachine = (machine = {}) => {
  const sensors = machine.sensors || {};
  const status = normalizeMachineStatus(machine.status);

  const temp = toNumber(machine.temp ?? sensors.temperature, 0);
  const current = toNumber(machine.current ?? sensors.current, 0);
  const vibration = toNumber(machine.vibration ?? sensors.vibration, 0);
  const pressure = toNumber(machine.pressure ?? sensors.pressure, 0);

  return {
    id: machine.id ?? null,
    name: machine.name || "Unknown",
    model: machine.model || "Unknown",
    plc_type: machine.plc_type || "unknown",
    location: machine.location || "",
    status,
    status_legacy: machine.status_legacy || String(machine.status || "").toUpperCase(),
    uptime: machine.uptime || "",
    production_count: toNumber(machine.production_count, 0),
    production_target: toNumber(machine.production_target, 0),
    temp,
    current,
    vibration,
    pressure,
    sensors: {
      temperature: temp,
      current,
      vibration,
      pressure,
    },
    active_error: machine.active_error || null,
    error_code:
      machine.error_code || machine.active_error?.error_code || machine.active_error?.code || "",
    last_heartbeat: machine.last_heartbeat || null,
  };
};

export const normalizeAlarm = (alarm = {}) => {
  const createdAt = toIso(alarm.created_at || alarm.timestamp);
  const resolvedAt = toIso(alarm.resolved_at);
  const diagnosedAt = toIso(alarm.diagnosed_at);
  const acknowledgedAt = toIso(alarm.acknowledged_at);

  return {
    id: alarm.id ?? null,
    machine_id: alarm.machine_id ?? 0,
    machine_name: alarm.machine_name || "",
    error_code: String(alarm.error_code || ""),
    message: alarm.message || alarm.error_message || "",
    error_message: alarm.message || alarm.error_message || "",
    severity: String(alarm.severity || "warning").toLowerCase(),
    category: String(alarm.category || "unknown").toLowerCase(),
    status: normalizeAlarmStatus(alarm.status, resolvedAt),
    created_at: createdAt,
    timestamp: createdAt,
    diagnosed_at: diagnosedAt,
    resolved_at: resolvedAt,
    acknowledged_at: acknowledgedAt,
    acknowledge_note: alarm.acknowledge_note || "",
    raw_data: alarm.raw_data || {},
  };
};

export const normalizeAction = (action = {}) => {
  const isHardware = Boolean(action.is_hardware);
  const issueType = action.issue_type || (isHardware ? "hardware" : "software");

  return {
    id: action.id ?? null,
    alarm_id: action.alarm_id ?? null,
    action_type: action.action_type || "unknown",
    issue_type: issueType,
    diagnosis: action.diagnosis || action.response || "",
    recommendation: action.recommendation || "",
    confidence: toNumber(action.confidence, 0),
    is_hardware: isHardware,
    repair_steps: Array.isArray(action.repair_steps) ? action.repair_steps : [],
    sources: Array.isArray(action.sources) ? action.sources : [],
    created_at: toIso(action.created_at),
    executed_at: toIso(action.executed_at),
    error_code: action.error_code || "",
    error_message: action.error_message || action.message || "",
    message: action.error_message || action.message || "",
    severity: String(action.severity || "warning").toLowerCase(),
    action_reason: action.action_reason || "",
    action_payload:
      action.action_payload && typeof action.action_payload === "object"
        ? action.action_payload
        : {},
    approval_info:
      action.approval_info && typeof action.approval_info === "object"
        ? action.approval_info
        : {},
    execution_status: String(action.execution_status || "planned").toLowerCase(),
    execution_result:
      action.execution_result && typeof action.execution_result === "object"
        ? action.execution_result
        : {},
    before_state:
      action.before_state && typeof action.before_state === "object" ? action.before_state : {},
    after_state:
      action.after_state && typeof action.after_state === "object" ? action.after_state : {},
    policy_version: action.policy_version || "v1-safe-actions",
  };
};

export const normalizeDashboardPayload = (payload = {}) => {
  const machines = Array.isArray(payload.machines)
    ? payload.machines.map(normalizeMachine)
    : [];

  const oeeRaw = payload.oee || {};
  const oee = {
    overall: toNumber(oeeRaw.overall, 0),
    availability: toNumber(oeeRaw.availability, 0),
    performance: toNumber(oeeRaw.performance, 0),
    quality: toNumber(oeeRaw.quality, 0),
  };

  const oeeHistory = Array.isArray(payload.oee_history)
    ? payload.oee_history.map((point) => ({
        time: point.time || "",
        value: toNumber(point.value, 0),
      }))
    : [];

  const summaryRaw = payload.summary || {};
  const summary = {
    total_machines: toNumber(summaryRaw.total_machines, machines.length),
    running: toNumber(
      summaryRaw.running,
      machines.filter((machine) => machine.status === "running").length,
    ),
    idle: toNumber(
      summaryRaw.idle,
      machines.filter((machine) => machine.status === "idle").length,
    ),
    error: toNumber(
      summaryRaw.error,
      machines.filter((machine) => machine.status === "error").length,
    ),
    stopped: toNumber(
      summaryRaw.stopped,
      machines.filter((machine) => machine.status === "stopped").length,
    ),
  };

  return {
    machines,
    oee,
    oee_history: oeeHistory,
    summary,
    recent_alarms: Array.isArray(payload.recent_alarms)
      ? payload.recent_alarms.map(normalizeAlarm)
      : [],
    recent_actions: Array.isArray(payload.recent_actions)
      ? payload.recent_actions.map(normalizeAction)
      : [],
    timestamp: toIso(payload.timestamp),
  };
};

export const normalizeAlarmsPayload = (payload = {}) => {
  const alarms = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.alarms)
      ? payload.alarms
      : [];

  return {
    alarms: alarms.map(normalizeAlarm),
    total: toNumber(payload.total, alarms.length),
    limit: toNumber(payload.limit, alarms.length),
    offset: toNumber(payload.offset, 0),
  };
};

export const normalizeActionsPayload = (payload = {}) => {
  const actions = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.actions)
      ? payload.actions
      : [];

  return {
    actions: actions.map(normalizeAction),
    total: toNumber(payload.total, actions.length),
    limit: toNumber(payload.limit, actions.length),
    offset: toNumber(payload.offset, 0),
  };
};
