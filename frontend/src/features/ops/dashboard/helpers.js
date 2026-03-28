export const MACHINE_PRIORITY = {
  error: 0,
  warning: 1,
  idle: 2,
  stopped: 3,
  running: 4,
};

const WARNING_THRESHOLDS = {
  temp: 70,
  current: 14,
  vibration: 2.8,
};

const ACTION_HINT_KEYS = {
  error: "dashboard.machineActionError",
  warning: "dashboard.machineActionWarning",
  idle: "dashboard.machineActionIdle",
  stopped: "dashboard.machineActionStopped",
  running: "dashboard.machineActionRunning",
};

const toMetric = (value) => Number(value || 0);
const NUMBERED_STEP_RE = /\d+\.\s+(.+?)(?=(?:\s+\d+\.\s+)|$)/g;

export const isWarningState = (machine) => {
  if (!machine || machine.status === "error") return false;

  return (
    toMetric(machine.temp) >= WARNING_THRESHOLDS.temp ||
    toMetric(machine.current) >= WARNING_THRESHOLDS.current ||
    toMetric(machine.vibration) >= WARNING_THRESHOLDS.vibration
  );
};

export const resolveMachineState = (machine) => {
  if (machine?.status === "error") return "error";
  if (isWarningState(machine)) return "warning";
  if (machine?.status === "idle") return "idle";
  if (machine?.status === "stopped") return "stopped";
  return "running";
};

export const machineActionHint = (state, t = (value) => value) =>
  t(ACTION_HINT_KEYS[state] || ACTION_HINT_KEYS.running);

export const extractInstructionSteps = (text, maxSteps = 4) => {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const numberedMatches = [...normalized.matchAll(NUMBERED_STEP_RE)];
  if (numberedMatches.length > 0) {
    return numberedMatches
      .map(([, step]) => step.trim().replace(/\.$/, ""))
      .slice(0, maxSteps);
  }

  return normalized
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((step) => step.trim().replace(/\.$/, ""))
    .filter(Boolean)
    .slice(0, maxSteps);
};

export const sortMachineQueue = (machines = [], t) =>
  [...machines]
    .map((machine) => {
      const state = resolveMachineState(machine);
      return {
        ...machine,
        machineState: state,
        nextAction: machineActionHint(state, t),
      };
    })
    .sort((a, b) => {
      const aPriority = MACHINE_PRIORITY[a.machineState] ?? 99;
      const bPriority = MACHINE_PRIORITY[b.machineState] ?? 99;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
