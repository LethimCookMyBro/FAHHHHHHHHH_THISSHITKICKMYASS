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

const EMPTY_OBJECT = Object.freeze({});

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

const maybeObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;

const asArray = (value) => (Array.isArray(value) ? value : []);

const pickPayloadItems = (payload, key) => {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.[key]) ? payload[key] : [];
};

const readObject = (value) => maybeObject(value) || EMPTY_OBJECT;
const normalizeObjectField = (value) => maybeObject(value) || {};

const buildMachineSummary = (machines) =>
  machines.reduce(
    (summary, machine) => {
      summary.total_machines += 1;
      if (machine.status === "running") summary.running += 1;
      if (machine.status === "idle") summary.idle += 1;
      if (machine.status === "error") summary.error += 1;
      if (machine.status === "stopped") summary.stopped += 1;
      return summary;
    },
    {
      total_machines: 0,
      running: 0,
      idle: 0,
      error: 0,
      stopped: 0,
    },
  );

const normalizePaginatedPayload = (payload, key, normalizer) => {
  const items = pickPayloadItems(payload, key);
  return {
    items: items.map(normalizer),
    total: toNumber(payload?.total, items.length),
    limit: toNumber(payload?.limit, items.length),
    offset: toNumber(payload?.offset, 0),
  };
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
  const sensors = readObject(machine.sensors);
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
    diagnosed_at: toIso(alarm.diagnosed_at),
    resolved_at: resolvedAt,
    acknowledged_at: toIso(alarm.acknowledged_at),
    acknowledge_note: alarm.acknowledge_note || "",
    raw_data: normalizeObjectField(alarm.raw_data),
  };
};

export const normalizeAction = (action = {}) => {
  const isHardware = Boolean(action.is_hardware);
  const actionPayload = normalizeObjectField(action.action_payload);

  return {
    id: action.id ?? null,
    alarm_id: action.alarm_id ?? null,
    action_type: action.action_type || "unknown",
    issue_type: action.issue_type || (isHardware ? "hardware" : "software"),
    diagnosis: action.diagnosis || action.response || "",
    recommendation: action.recommendation || "",
    confidence: toNumber(action.confidence, 0),
    is_hardware: isHardware,
    repair_steps: asArray(action.repair_steps),
    sources: asArray(action.sources),
    created_at: toIso(action.created_at),
    executed_at: toIso(action.executed_at),
    device_id: action.device_id || actionPayload.deviceId || "",
    machine_name: action.machine_name || actionPayload.machineName || "",
    error_code: action.error_code || "",
    error_message: action.error_message || action.message || "",
    message: action.error_message || action.message || "",
    severity: String(action.severity || "warning").toLowerCase(),
    action_reason: action.action_reason || "",
    action_payload: actionPayload,
    approval_info: normalizeObjectField(action.approval_info),
    execution_status: String(action.execution_status || "planned").toLowerCase(),
    execution_result: normalizeObjectField(action.execution_result),
    before_state: normalizeObjectField(action.before_state),
    after_state: normalizeObjectField(action.after_state),
    policy_version: action.policy_version || "v1-safe-actions",
  };
};

export const normalizeDashboardPayload = (payload = {}) => {
  const machines = asArray(payload.machines).map(normalizeMachine);
  const oeeRaw = readObject(payload.oee);
  const summaryRaw = readObject(payload.summary);
  const fallbackSummary = buildMachineSummary(machines);

  return {
    machines,
    oee: {
      overall: toNumber(oeeRaw.overall, 0),
      availability: toNumber(oeeRaw.availability, 0),
      performance: toNumber(oeeRaw.performance, 0),
      quality: toNumber(oeeRaw.quality, 0),
    },
    oee_history: asArray(payload.oee_history).map((point) => ({
      time: point?.time || "",
      value: toNumber(point?.value, 0),
    })),
    summary: {
      total_machines: toNumber(
        summaryRaw.total_machines,
        fallbackSummary.total_machines,
      ),
      running: toNumber(summaryRaw.running, fallbackSummary.running),
      idle: toNumber(summaryRaw.idle, fallbackSummary.idle),
      error: toNumber(summaryRaw.error, fallbackSummary.error),
      stopped: toNumber(summaryRaw.stopped, fallbackSummary.stopped),
    },
    recent_alarms: asArray(payload.recent_alarms).map(normalizeAlarm),
    recent_actions: asArray(payload.recent_actions).map(normalizeAction),
    timestamp: toIso(payload.timestamp),
  };
};

export const normalizeAlarmsPayload = (payload = {}) => {
  const normalized = normalizePaginatedPayload(payload, "alarms", normalizeAlarm);
  return {
    alarms: normalized.items,
    total: normalized.total,
    limit: normalized.limit,
    offset: normalized.offset,
  };
};

export const normalizeActionsPayload = (payload = {}) => {
  const normalized = normalizePaginatedPayload(payload, "actions", normalizeAction);
  return {
    actions: normalized.items,
    total: normalized.total,
    limit: normalized.limit,
    offset: normalized.offset,
  };
};
