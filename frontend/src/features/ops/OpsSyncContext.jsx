/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getApiErrorMessage } from "../../utils/api";
import { useT } from "../../utils/i18n";
import { usePlcLiveDataContext } from "../plc/PlcLiveDataContext";
import { sortMachineQueue } from "./dashboard/helpers";
import { buildZoneSummaries } from "./port-map/zoneModel";
import {
  fetchOpsActions,
  fetchOpsAlarms,
  resolveOpsAlarms,
} from "./opsDataApi";

const OpsSyncContext = createContext(null);

const ACTION_LIMIT = 150;
const ALARM_LIMIT = 200;
const REFRESH_DEBOUNCE_MS = 800;
const POLL_INTERVAL_BY_CONNECTION = {
  live: 5000,
  reconnecting: 7000,
  rest: 10000,
  connecting: 12000,
};

const STATUS_PRIORITY = {
  active: 0,
  acknowledged: 1,
  resolved: 2,
};

const SEVERITY_PRIORITY = {
  critical: 0,
  error: 1,
  warning: 2,
  info: 3,
};

const toArray = (value) => (Array.isArray(value) ? value : []);
const toIsoTime = (value) => Date.parse(value || "") || 0;
const MACHINE_KEY_ID_PREFIX = "id:";
const MACHINE_KEY_NAME_PREFIX = "name:";

const normalizeNameKey = (value) => String(value || "").trim().toLowerCase();
const hasOwn = (value, key) =>
  Object.prototype.hasOwnProperty.call(value || {}, key);

const getMachineLookupKeys = (item = {}) => {
  const keys = [];
  const machineId = item?.machine_id ?? item?.id ?? null;
  const machineName = item?.machine_name || item?.name || "";

  if (machineId !== null && machineId !== undefined && machineId !== "") {
    keys.push(`${MACHINE_KEY_ID_PREFIX}${String(machineId)}`);
  }

  const normalizedName = normalizeNameKey(machineName);
  if (normalizedName) {
    keys.push(`${MACHINE_KEY_NAME_PREFIX}${normalizedName}`);
  }

  return [...new Set(keys)];
};

const buildActiveAlarmMachineKeySet = (alarms = []) => {
  const keySet = new Set();
  toArray(alarms).forEach((alarm) => {
    if (String(alarm?.status || "active").toLowerCase() !== "active") {
      return;
    }

    getMachineLookupKeys(alarm).forEach((key) => keySet.add(key));
  });
  return keySet;
};

const buildResolvedMachineOverrides = (alarms = []) => {
  const overrides = {};
  toArray(alarms).forEach((alarm) => {
    getMachineLookupKeys(alarm).forEach((key) => {
      overrides[key] = {
        status: "running",
        status_legacy: "RUNNING",
        error_code: "",
        active_error: null,
      };
    });
  });
  return overrides;
};

const applyMachineOverrides = (machines, machineOverrides, activeAlarmMachineKeys) =>
  toArray(machines).map((machine) => {
    const lookupKeys = getMachineLookupKeys(machine);

    if (lookupKeys.some((key) => activeAlarmMachineKeys.has(key))) {
      return machine;
    }

    const matchedOverride = lookupKeys.find((key) => hasOwn(machineOverrides, key));
    if (!matchedOverride) {
      return machine;
    }

    return {
      ...machine,
      ...machineOverrides[matchedOverride],
    };
  });

const sortAlarms = (alarms = []) =>
  [...toArray(alarms)].sort((left, right) => {
    const statusDelta =
      (STATUS_PRIORITY[left?.status] ?? 99) - (STATUS_PRIORITY[right?.status] ?? 99);
    if (statusDelta !== 0) return statusDelta;

    const severityDelta =
      (SEVERITY_PRIORITY[left?.severity] ?? 99) -
      (SEVERITY_PRIORITY[right?.severity] ?? 99);
    if (severityDelta !== 0) return severityDelta;

    return (
      toIsoTime(right?.resolved_at || right?.created_at || right?.timestamp) -
      toIsoTime(left?.resolved_at || left?.created_at || left?.timestamp)
    );
  });

const sortActions = (actions = []) =>
  [...toArray(actions)].sort(
    (left, right) =>
      toIsoTime(right?.executed_at || right?.created_at) -
      toIsoTime(left?.executed_at || left?.created_at),
  );

const mergeRowsById = (currentRows, incomingRows) => {
  const nextMap = new Map(
    toArray(currentRows).map((row) => [String(row?.id ?? ""), row]),
  );

  toArray(incomingRows).forEach((row) => {
    const key = String(row?.id ?? "");
    if (!key) return;
    nextMap.set(key, row);
  });

  return [...nextMap.values()];
};

const applyResolvedAlarmMeta = (alarms = [], resolvedAlarmMeta = {}) =>
  toArray(alarms).map((alarm) => {
    const key = String(alarm?.id ?? "");
    if (!key || !hasOwn(resolvedAlarmMeta, key)) {
      return alarm;
    }

    const meta = resolvedAlarmMeta[key] || {};
    return {
      ...alarm,
      status: "resolved",
      resolved_at: alarm?.resolved_at || meta.resolved_at || null,
    };
  });

const buildResolvedAlarmMeta = (alarms = [], resolvedAt) =>
  toArray(alarms).reduce((meta, alarm) => {
    const key = String(alarm?.id ?? "");
    if (!key) {
      return meta;
    }

    meta[key] = { resolved_at: resolvedAt };
    return meta;
  }, {});

const buildAlarmListSignature = (alarms = []) =>
  toArray(alarms)
    .map(
      (alarm) =>
        [
          alarm?.id ?? "",
          alarm?.status ?? "",
          alarm?.severity ?? "",
          alarm?.machine_id ?? "",
          alarm?.error_code ?? "",
          alarm?.message ?? "",
          alarm?.created_at ?? "",
          alarm?.acknowledged_at ?? "",
          alarm?.resolved_at ?? "",
        ].join("::"),
    )
    .join("|");

const buildActionListSignature = (actions = []) =>
  toArray(actions)
    .map(
      (action) =>
        [
          action?.id ?? "",
          action?.alarm_id ?? "",
          action?.action_type ?? "",
          action?.execution_status ?? "",
          action?.severity ?? "",
          action?.created_at ?? "",
          action?.executed_at ?? "",
          action?.recommendation ?? "",
        ].join("::"),
    )
    .join("|");

const buildLocalResolveActions = (
  alarms = [],
  { note = "", source = "system", resolvedAt } = {},
) =>
  toArray(alarms).map((alarm) => {
    const resultMessage =
      note || `Alarm resolved locally via ${String(source || "system").replace(/_/g, " ")}.`;

    return {
      id: `local-resolve-${alarm.id}-${resolvedAt}`,
      alarm_id: alarm.id,
      action_type: "resolve",
      issue_type: "software",
      diagnosis: "Incident resolution confirmed by synchronized workflow.",
      recommendation: resultMessage,
      confidence: 1,
      is_hardware: false,
      repair_steps: [],
      sources: [],
      created_at: resolvedAt,
      executed_at: resolvedAt,
      device_id: String(alarm.machine_id ?? ""),
      machine_name: alarm.machine_name || "",
      error_code: alarm.error_code || "",
      error_message: alarm.message || "",
      message: resultMessage,
      severity: String(alarm.severity || "warning").toLowerCase(),
      action_reason: resultMessage,
      action_payload: {
        source,
        compatibility_mode: true,
      },
      approval_info: {},
      execution_status: "executed",
      execution_result: {
        success: true,
        message: resultMessage,
        compatibility_mode: true,
      },
      before_state: {},
      after_state: {},
      policy_version: "frontend-compat",
    };
  });

const getPollIntervalMs = (connectionState) =>
  POLL_INTERVAL_BY_CONNECTION[connectionState] ||
  POLL_INTERVAL_BY_CONNECTION.connecting;

export function OpsSyncProvider({ children }) {
  const { t } = useT();
  const {
    dashboard,
    derived,
    connectionState,
    error: liveError,
    refreshSnapshot,
  } = usePlcLiveDataContext();

  const [alarms, setAlarms] = useState([]);
  const [actions, setActions] = useState([]);
  const [error, setError] = useState("");
  const [hasLoaded, setHasLoaded] = useState(false);
  const [machineOverrides, setMachineOverrides] = useState({});
  const [resolvedAlarmMeta, setResolvedAlarmMeta] = useState({});
  const [localActions, setLocalActions] = useState([]);

  const refreshInFlightRef = useRef(null);
  const lastRefreshAtRef = useRef(0);
  const alarmsSignatureRef = useRef("");
  const actionsSignatureRef = useRef("");
  const activeAlarmMachineKeys = useMemo(
    () => buildActiveAlarmMachineKeySet(alarms),
    [alarms],
  );

  useEffect(() => {
    alarmsSignatureRef.current = buildAlarmListSignature(alarms);
  }, [alarms]);

  useEffect(() => {
    actionsSignatureRef.current = buildActionListSignature(actions);
  }, [actions]);

  const machines = useMemo(
    () =>
      sortMachineQueue(
        applyMachineOverrides(
          toArray(dashboard?.machines),
          machineOverrides,
          activeAlarmMachineKeys,
        ),
        t,
      ),
    [activeAlarmMachineKeys, dashboard?.machines, machineOverrides, t],
  );

  const refreshOpsData = useCallback(
    async ({ force = false } = {}) => {
      const now = Date.now();
      if (
        !force &&
        refreshInFlightRef.current &&
        now - lastRefreshAtRef.current < REFRESH_DEBOUNCE_MS
      ) {
        return refreshInFlightRef.current;
      }

      const request = (async () => {
        try {
          const [nextAlarms, nextActions] = await Promise.all([
            fetchOpsAlarms(ALARM_LIMIT),
            fetchOpsActions(ACTION_LIMIT),
          ]);
          const nextSortedAlarms = sortAlarms(
            applyResolvedAlarmMeta(nextAlarms, resolvedAlarmMeta),
          );
          const nextSortedActions = sortActions(
            mergeRowsById(nextActions, localActions),
          );
          const nextAlarmsSignature = buildAlarmListSignature(nextSortedAlarms);
          const nextActionsSignature = buildActionListSignature(nextSortedActions);

          if (nextAlarmsSignature !== alarmsSignatureRef.current) {
            setAlarms(nextSortedAlarms);
          }
          if (nextActionsSignature !== actionsSignatureRef.current) {
            setActions(nextSortedActions);
          }
          setError("");
          setHasLoaded(true);
          lastRefreshAtRef.current = Date.now();
          return { alarms: nextAlarms, actions: nextActions };
        } catch (requestError) {
          setError(getApiErrorMessage(requestError, t("ops.loadFailed")));
          throw requestError;
        } finally {
          refreshInFlightRef.current = null;
        }
      })();

      refreshInFlightRef.current = request;
      return request;
    },
    [localActions, resolvedAlarmMeta, t],
  );

  useEffect(() => {
    refreshOpsData({ force: true }).catch(() => {});
  }, [refreshOpsData]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      refreshOpsData().catch(() => {});
    }, getPollIntervalMs(connectionState));

    return () => window.clearInterval(intervalId);
  }, [connectionState, refreshOpsData]);

  useEffect(() => {
    const handleFocus = () => {
      refreshOpsData().catch(() => {});
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refreshOpsData]);

  const zoneSummaries = useMemo(
    () =>
      buildZoneSummaries({
        machines,
        alarms,
        actions,
      }),
    [actions, alarms, machines],
  );

  const recentAlarms = useMemo(() => alarms.slice(0, 10), [alarms]);
  const recentActions = useMemo(() => actions.slice(0, 8), [actions]);

  const refreshSyncedOps = useCallback(
    async ({ force = true } = {}) => {
      return Promise.allSettled([
        refreshSnapshot?.(),
        refreshOpsData({ force }),
      ]);
    },
    [refreshOpsData, refreshSnapshot],
  );

  const resolveAlarmIds = useCallback(
    async ({ alarmIds, note = "", source = "system" } = {}) => {
      const uniqueIds = [...new Set(toArray(alarmIds).map((id) => Number(id)).filter(Number.isFinite))];
      if (!uniqueIds.length) {
        return { resolved_count: 0, alarms: [], actions: [] };
      }

      const resolvedAt = new Date().toISOString();
      const targetIdSet = new Set(uniqueIds);
      const targetAlarms = alarms.filter((alarm) => targetIdSet.has(Number(alarm?.id)));
      const nextResolvedAlarmMeta = buildResolvedAlarmMeta(targetAlarms, resolvedAt);
      const nextMachineOverrides = buildResolvedMachineOverrides(targetAlarms);
      const nextMachineOverrideKeys = Object.keys(nextMachineOverrides);
      const previousMachineOverrides = nextMachineOverrideKeys.reduce((snapshot, key) => {
        if (hasOwn(machineOverrides, key)) {
          snapshot[key] = machineOverrides[key];
        }
        return snapshot;
      }, {});
      const nextResolvedAlarmKeys = Object.keys(nextResolvedAlarmMeta);
      const previousResolvedAlarmMeta = nextResolvedAlarmKeys.reduce((snapshot, key) => {
        if (hasOwn(resolvedAlarmMeta, key)) {
          snapshot[key] = resolvedAlarmMeta[key];
        }
        return snapshot;
      }, {});

      if (nextResolvedAlarmKeys.length > 0) {
        setResolvedAlarmMeta((current) => ({
          ...current,
          ...nextResolvedAlarmMeta,
        }));
      }
      setAlarms((current) =>
        sortAlarms(
          current.map((alarm) =>
            targetIdSet.has(Number(alarm?.id))
              ? {
                  ...alarm,
                  status: "resolved",
                  resolved_at: resolvedAt,
                }
              : alarm,
          ),
        ),
      );
      if (nextMachineOverrideKeys.length > 0) {
        setMachineOverrides((current) => ({
          ...current,
          ...nextMachineOverrides,
        }));
      }

      try {
        const payload = await resolveOpsAlarms({
          alarmIds: uniqueIds,
          note,
          source,
        });

        if (payload.alarms?.length) {
          setAlarms((current) => sortAlarms(mergeRowsById(current, payload.alarms)));
        }
        if (payload.actions?.length) {
          setActions((current) => sortActions(mergeRowsById(current, payload.actions)));
        }

        await refreshSyncedOps({ force: true });

        return payload;
      } catch (requestError) {
        const requestStatus = Number(requestError?.response?.status || 0);
        if (requestStatus === 404) {
          const compatibilityActions = buildLocalResolveActions(targetAlarms, {
            note,
            source,
            resolvedAt,
          });

          if (compatibilityActions.length > 0) {
            setLocalActions((current) =>
              sortActions(mergeRowsById(current, compatibilityActions)),
            );
            setActions((current) =>
              sortActions(mergeRowsById(current, compatibilityActions)),
            );
          }

          return {
            resolved_count: targetAlarms.length,
            alarms: applyResolvedAlarmMeta(targetAlarms, nextResolvedAlarmMeta),
            actions: compatibilityActions,
            compatibility_mode: true,
          };
        }

        if (nextMachineOverrideKeys.length > 0) {
          setMachineOverrides((current) => {
            const reverted = { ...current };
            nextMachineOverrideKeys.forEach((key) => {
              if (hasOwn(previousMachineOverrides, key)) {
                reverted[key] = previousMachineOverrides[key];
              } else {
                delete reverted[key];
              }
            });
            return reverted;
          });
        }
        if (nextResolvedAlarmKeys.length > 0) {
          setResolvedAlarmMeta((current) => {
            const reverted = { ...current };
            nextResolvedAlarmKeys.forEach((key) => {
              if (hasOwn(previousResolvedAlarmMeta, key)) {
                reverted[key] = previousResolvedAlarmMeta[key];
              } else {
                delete reverted[key];
              }
            });
            return reverted;
          });
        }
        await refreshOpsData({ force: true }).catch(() => {});
        throw requestError;
      }
    },
    [
      alarms,
      machineOverrides,
      refreshSyncedOps,
      refreshOpsData,
      resolvedAlarmMeta,
    ],
  );

  const resolveZoneIncidents = useCallback(
    async ({
      zoneId,
      machineId,
      machineName,
      errorCode,
      note = "",
      source = "mock_chat",
    } = {}) => {
      const normalizedZoneId = String(zoneId || "").trim().toLowerCase();
      const activeZone = zoneSummaries.find((zone) => zone.id === normalizedZoneId);

      let targetAlarms =
        activeZone?.alarms.filter(
          (alarm) => String(alarm.status || "active").toLowerCase() !== "resolved",
        ) || [];

      if (!targetAlarms.length) {
        targetAlarms = alarms.filter((alarm) => {
          if (String(alarm.status || "active").toLowerCase() === "resolved") {
            return false;
          }

          if (machineId && String(alarm.machine_id ?? alarm.id) !== String(machineId)) {
            return false;
          }

          if (
            machineName &&
            String(alarm.machine_name || alarm.name || "").trim() !==
              String(machineName).trim()
          ) {
            return false;
          }

          if (
            errorCode &&
            String(alarm.error_code || "").trim() !== String(errorCode).trim()
          ) {
            return false;
          }

          return Boolean(machineId || machineName || errorCode);
        });
      }

      return resolveAlarmIds({
        alarmIds: targetAlarms.map((alarm) => alarm.id),
        note,
        source,
      });
    },
    [alarms, resolveAlarmIds, zoneSummaries],
  );

  const value = useMemo(
    () => ({
      dashboard,
      derived,
      connectionState,
      liveError,
      loading: !hasLoaded,
      error,
      machines,
      alarms,
      actions,
      recentAlarms,
      recentActions,
      zoneSummaries,
      refreshOpsData,
      refreshSyncedOps,
      resolveAlarmIds,
      resolveZoneIncidents,
    }),
    [
      actions,
      alarms,
      connectionState,
      dashboard,
      derived,
      error,
      hasLoaded,
      liveError,
      machines,
      recentActions,
      recentAlarms,
      refreshOpsData,
      refreshSyncedOps,
      resolveAlarmIds,
      resolveZoneIncidents,
      zoneSummaries,
    ],
  );

  return (
    <OpsSyncContext.Provider value={value}>{children}</OpsSyncContext.Provider>
  );
}

export function useOpsSyncContext() {
  const context = useContext(OpsSyncContext);
  if (!context) {
    throw new Error("useOpsSyncContext must be used within OpsSyncProvider");
  }
  return context;
}

export default OpsSyncContext;
