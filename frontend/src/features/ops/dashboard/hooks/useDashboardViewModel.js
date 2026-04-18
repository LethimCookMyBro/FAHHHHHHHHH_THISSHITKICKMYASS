import { useMemo } from "react";
import { useT } from "../../../../utils/i18n";
import {
  useOpsSyncActions,
  useOpsSyncAlarms,
  useOpsSyncMachines,
  useOpsSyncMeta,
} from "../../OpsSyncContext";

const CONNECTION_LABELS = {
  live: "common.liveStream",
  reconnecting: "sidebar.reconnecting",
  rest: "sidebar.restFallback",
  connecting: "sidebar.connecting",
};

const toPercent = (value) =>
  `${Math.round(Math.max(0, Math.min(100, Number(value) || 0)))}%`;

const oneDecimal = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(1) : "-";
};
const humanizeToken = (value, fallback) => {
  const normalized = String(value || "").trim();
  if (!normalized) return fallback;
  return normalized
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const toArray = (value) => (Array.isArray(value) ? value : []);

const countMachineStates = (machines) =>
  machines.reduce(
    (counts, machine) => {
      const state = machine.machineState || "idle";
      counts[state] = (counts[state] || 0) + 1;
      return counts;
    },
    {
      error: 0,
      idle: 0,
      running: 0,
      stopped: 0,
      warning: 0,
    },
  );

export default function useDashboardViewModel() {
  const { t } = useT();
  const {
    derived,
    connectionState,
    error: opsError,
    liveError,
    loading: opsLoading,
  } = useOpsSyncMeta();
  const { machines } = useOpsSyncMachines();
  const { criticalAlarmCount, recentAlarms } = useOpsSyncAlarms();
  const { recentActions } = useOpsSyncActions();

  const connectionLabel =
    t(CONNECTION_LABELS[connectionState] || CONNECTION_LABELS.connecting);

  const machineQueue = useMemo(() => toArray(machines), [machines]);

  const machineStateCounts = useMemo(
    () => countMachineStates(machineQueue),
    [machineQueue],
  );
  const runningMachineCount = machineStateCounts.running;
  const totalMachineCount = machineQueue.length;
  const availabilityRate = useMemo(() => {
    if (totalMachineCount <= 0) return 0;
    return Math.round((runningMachineCount / totalMachineCount) * 100);
  }, [runningMachineCount, totalMachineCount]);

  const warningMachineCount = machineStateCounts.warning;

  const topTiles = useMemo(
    () => [
      {
        key: "running",
        label: t("dashboard.runningMachines"),
        value: `${runningMachineCount}/${totalMachineCount}`,
        hint: t("dashboard.runningMachinesHint"),
        tone: "success",
        actionHint: t("dashboard.runningMachinesAction"),
      },
      {
        key: "critical",
        label: t("dashboard.criticalAlarms"),
        value: criticalAlarmCount,
        hint: t("dashboard.criticalAlarmsHint"),
        tone: criticalAlarmCount > 0 ? "error" : "info",
        actionHint:
          criticalAlarmCount > 0
            ? t("dashboard.criticalAlarmsAction")
            : t("dashboard.criticalAlarmsIdleAction"),
      },
      {
        key: "warning",
        label: t("dashboard.warningMachines"),
        value: warningMachineCount,
        hint: t("dashboard.warningMachinesHint"),
        tone: warningMachineCount > 0 ? "warning" : "info",
        actionHint:
          warningMachineCount > 0
            ? t("dashboard.warningMachinesAction")
            : t("dashboard.warningMachinesIdleAction"),
      },
      {
        key: "availability",
        label: t("dashboard.availability"),
        value: toPercent(availabilityRate),
        hint: t("dashboard.availabilityHint"),
        tone: "info",
        actionHint: t("dashboard.availabilityAction"),
      },
    ],
    [
      availabilityRate,
      criticalAlarmCount,
      runningMachineCount,
      t,
      totalMachineCount,
      warningMachineCount,
    ],
  );

  const oeeRows = useMemo(
    () => [
      {
        label: t("dashboard.overall"),
        value: Number(derived.oee.overall || 0),
        text: toPercent(derived.oee.overall),
      },
      {
        label: t("dashboard.availability"),
        value: availabilityRate,
        text: toPercent(availabilityRate),
      },
      {
        label: t("dashboard.performance"),
        value: Number(derived.oee.performance || 0),
        text: toPercent(derived.oee.performance),
      },
      {
        label: t("dashboard.quality"),
        value: Number(derived.oee.quality || 0),
        text: toPercent(derived.oee.quality),
      },
    ],
    [
      availabilityRate,
      derived.oee.overall,
      derived.oee.performance,
      derived.oee.quality,
      t,
    ],
  );

  const machineRows = useMemo(
    () =>
      machineQueue.map((machine, index) => ({
        id: machine.id ?? `${machine.name}-${index}`,
        priority: index + 1,
        name: machine.name || t("common.unknown"),
        model: machine.model || "-",
        location: machine.location || "",
        state: machine.machineState || "idle",
        errorCode: machine.error_code || machine.active_error?.error_code || "",
        temp: `${oneDecimal(machine.temp)} C`,
        current: `${oneDecimal(machine.current)} A`,
        vibration: `${oneDecimal(machine.vibration)} G`,
        nextAction: machine.nextAction || t("dashboard.machineActionRunning"),
      })),
    [machineQueue, t],
  );

  const alertRows = useMemo(
    () =>
      recentAlarms
        .slice(0, 4)
        .map((alarm, index) => ({
          id: alarm.id ?? `alarm-${index}`,
          machine: alarm.machine_name || t("alarms.unknownMachine"),
          code: alarm.error_code || t("common.noCode"),
          message: alarm.message || t("alarms.triggeredWithoutDescription"),
          severity: alarm.severity || "warning",
          status: alarm.status || "active",
          timestamp: alarm.created_at || alarm.timestamp || null,
        })),
    [recentAlarms, t],
  );

  const actionRows = useMemo(
    () =>
      recentActions
        .slice(0, 4)
        .map((action, index) => ({
          id: action.id ?? `action-${index}`,
          title: humanizeToken(action.action_type, t("actions.actionRecordCaptured")),
          detail:
            action.error_code && action.issue_type
              ? `${action.error_code} - ${action.issue_type}`
              : action.error_code || action.issue_type || t("status.planned"),
          status: action.execution_status || "planned",
          severity: action.severity || "warning",
          timestamp: action.executed_at || action.created_at || null,
          result:
            action.recommendation ||
            action.execution_result?.message ||
            action.message ||
            action.diagnosis ||
            "",
        })),
    [recentActions, t],
  );

  const utilizationRate = availabilityRate;

  const focusMessage = useMemo(() => {
    if (criticalAlarmCount > 0) {
      return t("dashboard.focusCritical");
    }
    if (warningMachineCount > 0) {
      return t("dashboard.focusWarning");
    }
    if (runningMachineCount === 0) {
      return t("dashboard.focusNoAssets");
    }
    return t("dashboard.focusStable");
  }, [criticalAlarmCount, runningMachineCount, t, warningMachineCount]);

  const loading =
    opsLoading || (connectionState === "connecting" && totalMachineCount === 0);

  return {
    connectionState,
    connectionLabel,
    loading,
    error: opsError || liveError,
    history: Array.isArray(derived.history) ? derived.history : [],
    topTiles,
    oeeRows,
    machineRows,
    alertRows,
    actionRows,
    utilizationRate,
    focusMessage,
    plantSummary: {
      total: totalMachineCount,
      running: runningMachineCount,
      idle: machineStateCounts.idle,
      stopped: machineStateCounts.stopped,
      warning: warningMachineCount,
      error: machineStateCounts.error,
      criticalAlarms: criticalAlarmCount,
      oee: toPercent(derived.oee.overall),
    },
  };
}
