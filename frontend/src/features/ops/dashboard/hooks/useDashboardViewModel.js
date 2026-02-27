import { useMemo } from "react";
import { usePlcLiveDataContext } from "../../../plc/PlcLiveDataContext";
import { sortMachineQueue } from "../helpers";

const CONNECTION_LABELS = {
  live: "Live stream",
  reconnecting: "Reconnecting",
  rest: "REST fallback",
  connecting: "Connecting",
};

const toPercent = (value) =>
  `${Math.round(Math.max(0, Math.min(100, Number(value) || 0)))}%`;
const oneDecimal = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(1) : "-";
};

export default function useDashboardViewModel() {
  const { dashboard, derived, connectionState, error } =
    usePlcLiveDataContext();

  const connectionLabel =
    CONNECTION_LABELS[connectionState] || CONNECTION_LABELS.connecting;

  const machineQueue = useMemo(() => {
    const machines = Array.isArray(dashboard?.machines)
      ? dashboard.machines
      : [];
    return sortMachineQueue(machines);
  }, [dashboard?.machines]);

  const criticalAlarmCount = useMemo(() => {
    const alarms = Array.isArray(dashboard?.recent_alarms)
      ? dashboard.recent_alarms
      : [];
    return alarms.filter(
      (alarm) => alarm?.status === "active" && alarm?.severity === "critical",
    ).length;
  }, [dashboard?.recent_alarms]);

  const warningMachineCount = useMemo(
    () =>
      machineQueue.filter((machine) => machine.machineState === "warning")
        .length,
    [machineQueue],
  );

  const topTiles = useMemo(
    () => [
      {
        key: "running",
        label: "Running machines",
        value: `${derived.runningCount}/${derived.machineCount}`,
        hint: "Current active production assets",
        tone: "success",
        actionHint: "Check idle queue if capacity is low",
      },
      {
        key: "critical",
        label: "Critical alarms",
        value: criticalAlarmCount,
        hint: "Active high-risk incidents",
        tone: criticalAlarmCount > 0 ? "error" : "info",
        actionHint:
          criticalAlarmCount > 0
            ? "Open Alarm Center now"
            : "No critical intervention needed",
      },
      {
        key: "warning",
        label: "Warning machines",
        value: warningMachineCount,
        hint: "Sensor drift or soft threshold warnings",
        tone: warningMachineCount > 0 ? "warning" : "info",
        actionHint:
          warningMachineCount > 0
            ? "Review trending and setpoints"
            : "All sensor ranges stable",
      },
      {
        key: "availability",
        label: "Availability",
        value: toPercent(derived.oee.availability),
        hint: "Operational uptime index",
        tone: "info",
        actionHint: "Target >= 85%",
      },
    ],
    [
      criticalAlarmCount,
      derived.machineCount,
      derived.oee.availability,
      derived.runningCount,
      warningMachineCount,
    ],
  );

  const oeeRows = useMemo(
    () => [
      {
        label: "Overall",
        value: Number(derived.oee.overall || 0),
        text: toPercent(derived.oee.overall),
      },
      {
        label: "Availability",
        value: Number(derived.oee.availability || 0),
        text: toPercent(derived.oee.availability),
      },
      {
        label: "Performance",
        value: Number(derived.oee.performance || 0),
        text: toPercent(derived.oee.performance),
      },
      {
        label: "Quality",
        value: Number(derived.oee.quality || 0),
        text: toPercent(derived.oee.quality),
      },
    ],
    [
      derived.oee.availability,
      derived.oee.overall,
      derived.oee.performance,
      derived.oee.quality,
    ],
  );

  const machineRows = useMemo(
    () =>
      machineQueue.map((machine, index) => ({
        id: machine.id ?? `${machine.name}-${index}`,
        priority: index + 1,
        name: machine.name || "Unknown",
        model: machine.model || "-",
        state: machine.machineState,
        temp: `${oneDecimal(machine.temp)} C`,
        current: `${oneDecimal(machine.current)} A`,
        vibration: `${oneDecimal(machine.vibration)} G`,
        nextAction: machine.nextAction,
      })),
    [machineQueue],
  );

  const loading =
    connectionState === "connecting" && derived.machineCount === 0;

  return {
    connectionState,
    connectionLabel,
    loading,
    error,
    history: Array.isArray(derived.history) ? derived.history : [],
    topTiles,
    oeeRows,
    machineRows,
    plantSummary: {
      total: derived.machineCount,
      running: derived.runningCount,
      idle: machineQueue.filter((machine) => machine.machineState === "idle")
        .length,
      stopped: machineQueue.filter(
        (machine) => machine.machineState === "stopped",
      ).length,
      warning: warningMachineCount,
      error: machineQueue.filter((machine) => machine.machineState === "error")
        .length,
      criticalAlarms: criticalAlarmCount,
      oee: toPercent(derived.oee.overall),
    },
  };
}
