export const MACHINE_PRIORITY = {
  error: 0,
  warning: 1,
  idle: 2,
  stopped: 3,
  running: 4,
};

export const isWarningState = (machine) => {
  if (!machine || machine.status === "error") return false;
  const temp = Number(machine.temp || 0);
  const current = Number(machine.current || 0);
  const vibration = Number(machine.vibration || 0);
  return temp >= 70 || current >= 14 || vibration >= 2.8;
};

export const resolveMachineState = (machine) => {
  if (machine?.status === "error") return "error";
  if (isWarningState(machine)) return "warning";
  if (machine?.status === "idle") return "idle";
  if (machine?.status === "stopped") return "stopped";
  return "running";
};

export const machineActionHint = (state) => {
  if (state === "error") return "Open incident and run Diagnose";
  if (state === "warning") return "Inspect sensor trend and adjust setpoint";
  if (state === "idle") return "Confirm planned idle or dispatch operator";
  if (state === "stopped") return "Verify stop reason and restart readiness";
  return "Monitor runtime and quality drift";
};

export const sortMachineQueue = (machines = []) => {
  return [...machines]
    .map((machine) => {
      const state = resolveMachineState(machine);
      return {
        ...machine,
        machineState: state,
        nextAction: machineActionHint(state),
      };
    })
    .sort((a, b) => {
      const aPriority = MACHINE_PRIORITY[a.machineState] ?? 99;
      const bPriority = MACHINE_PRIORITY[b.machineState] ?? 99;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
};
