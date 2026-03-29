import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../utils/api";
import { normalizeDashboardPayload } from "../features/plc/normalizers";

const WS_BASE_URL =
  (window.location.protocol === "https:" ? "wss://" : "ws://") +
  window.location.host +
  "/api/plc/ws";

const EMPTY_DASHBOARD = normalizeDashboardPayload({});
const EMPTY_OEE = Object.freeze({
  overall: 0,
  availability: 0,
  performance: 0,
  quality: 0,
});
const MAX_REST_FAILURES = 3;
const MAX_WS_RECONNECT_ATTEMPTS = 4;
const REST_BACKOFF_MS = 60_000;
const WS_AUTH_REJECTION_CODES = new Set([1002, 1008]);

const asNonNegativeInt = (value, fallback = 0) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
};

const buildSnapshotKey = (dashboard = {}) => {
  const summary = dashboard.summary || {};
  const alarmsKey = (dashboard.recent_alarms || [])
    .slice(0, 6)
    .map((alarm) => `${alarm.id ?? "na"}:${alarm.status ?? "active"}`)
    .join("|");

  return [
    summary.total_machines ?? 0,
    summary.running ?? 0,
    summary.idle ?? 0,
    summary.error ?? 0,
    summary.stopped ?? 0,
    alarmsKey,
    dashboard.timestamp || "",
  ].join("::");
};

const clearTimer = (timerRef) => {
  if (!timerRef.current) return;
  window.clearTimeout(timerRef.current);
  timerRef.current = null;
};

const releaseSocket = (socket) => {
  if (!socket) return;
  socket.onopen = null;
  socket.onmessage = null;
  socket.onerror = null;
  socket.onclose = null;
  if (socket.readyState === WebSocket.OPEN) {
    socket.close(1000, "cleanup");
  }
};

const hasActiveSocket = (socket) =>
  !!socket &&
  (socket.readyState === WebSocket.OPEN ||
    socket.readyState === WebSocket.CONNECTING);

const getReconnectDelayMs = (attempts) =>
  Math.min(30_000, 2_000 * 2 ** (attempts - 1));

const mergeStreamCollections = (normalized, current) => ({
  ...normalized,
  recent_alarms:
    normalized.recent_alarms.length > 0
      ? normalized.recent_alarms
      : current.recent_alarms,
  recent_actions:
    normalized.recent_actions.length > 0
      ? normalized.recent_actions
      : current.recent_actions,
});

const deriveLiveMetrics = (dashboard) => {
  const machines = Array.isArray(dashboard?.machines) ? dashboard.machines : [];
  const activeAlarms = Array.isArray(dashboard?.recent_alarms)
    ? dashboard.recent_alarms.filter((alarm) => alarm?.status === "active")
    : [];
  const runningCount = machines.filter(
    (machine) => machine.status === "running",
  ).length;

  return {
    machineCount: machines.length,
    runningCount,
    alarmCount:
      activeAlarms.length > 0
        ? activeAlarms.length
        : machines.filter((machine) => machine.status === "error").length,
    oee: dashboard?.oee || EMPTY_OEE,
    history: dashboard?.oee_history || [],
  };
};

export function usePlcLiveData({
  refreshIntervalMs = 15000,
  updateThrottleMs = 0,
  stabilityMode = "off",
  enableWebsocket = true,
} = {}) {
  const [dashboard, setDashboard] = useState(EMPTY_DASHBOARD);
  const [connectionState, setConnectionState] = useState("connecting");
  const [error, setError] = useState("");

  const wsRef = useRef(null);
  const reconnectRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const wsDisabledForSessionRef = useRef(false);
  const throttleTimerRef = useRef(null);
  const queuedUpdateRef = useRef(null);
  const lastUiCommitAtRef = useRef(0);
  const lastSnapshotKeyRef = useRef("");
  const restFailuresRef = useRef(0);
  const restBackoffTimerRef = useRef(null);
  const refreshInFlightRef = useRef(null);

  const resolvedThrottleMs = useMemo(() => {
    const parsed = asNonNegativeInt(updateThrottleMs, 0);
    if (stabilityMode === "aggressive") {
      return Math.max(500, parsed);
    }
    return parsed;
  }, [stabilityMode, updateThrottleMs]);

  const commitDashboard = useCallback((normalized, source, snapshotKey) => {
    setDashboard((current) => {
      if (source === "ws") {
        return mergeStreamCollections(normalized, current);
      }
      return normalized;
    });

    lastSnapshotKeyRef.current = snapshotKey;
    lastUiCommitAtRef.current = Date.now();
  }, []);

  const flushQueuedDashboard = useCallback(() => {
    throttleTimerRef.current = null;
    const queued = queuedUpdateRef.current;
    queuedUpdateRef.current = null;
    if (!queued) return;
    commitDashboard(queued.normalized, queued.source, queued.snapshotKey);
  }, [commitDashboard]);

  const mergeDashboard = useCallback(
    (nextPayload, source = "rest") => {
      const normalized = normalizeDashboardPayload(nextPayload || {});
      const snapshotKey = buildSnapshotKey(normalized);
      if (snapshotKey === lastSnapshotKeyRef.current) return;

      if (source === "ws" && resolvedThrottleMs > 0) {
        const now = Date.now();
        const elapsed = now - lastUiCommitAtRef.current;

        if (elapsed >= resolvedThrottleMs && !throttleTimerRef.current) {
          commitDashboard(normalized, source, snapshotKey);
          return;
        }

        queuedUpdateRef.current = { normalized, source, snapshotKey };
        if (!throttleTimerRef.current) {
          const waitMs = Math.max(0, resolvedThrottleMs - elapsed);
          throttleTimerRef.current = window.setTimeout(
            flushQueuedDashboard,
            waitMs,
          );
        }
        return;
      }

      commitDashboard(normalized, source, snapshotKey);
    },
    [commitDashboard, flushQueuedDashboard, resolvedThrottleMs],
  );

  const mergeDashboardRef = useRef(mergeDashboard);
  mergeDashboardRef.current = mergeDashboard;

  const cleanupRealtimeResources = useCallback(() => {
    clearTimer(reconnectRef);
    clearTimer(throttleTimerRef);
    clearTimer(restBackoffTimerRef);
    queuedUpdateRef.current = null;

    const socket = wsRef.current;
    wsRef.current = null;
    releaseSocket(socket);
  }, []);

  const disableWebsocketForSession = useCallback((message) => {
    wsDisabledForSessionRef.current = true;
    setConnectionState("rest");
    setError(message);
  }, []);

  const refreshSnapshot = useCallback(async () => {
    if (restBackoffTimerRef.current) return null;
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }

    const request = (async () => {
      try {
        const response = await api.get("/api/plc/dashboard");
        mergeDashboardRef.current(response?.data, "rest");
        setConnectionState((prev) => (prev === "live" ? prev : "rest"));
        setError("");
        restFailuresRef.current = 0;
        return response?.data ?? null;
      } catch (error) {
        restFailuresRef.current += 1;

        if (restFailuresRef.current >= MAX_REST_FAILURES) {
          setError("Backend unreachable - polling paused. Will retry in 60s.");
          restBackoffTimerRef.current = window.setTimeout(() => {
            restBackoffTimerRef.current = null;
            restFailuresRef.current = 0;
          }, REST_BACKOFF_MS);
        } else {
          setError("Failed to load PLC snapshot");
        }
        throw error;
      } finally {
        refreshInFlightRef.current = null;
      }
    })();

    refreshInFlightRef.current = request;
    return request;
  }, []);

  useEffect(() => {
    let closedByUnmount = false;

    refreshSnapshot();

    if (!enableWebsocket) {
      setConnectionState("rest");
      setError("");
      return () => {
        closedByUnmount = true;
        cleanupRealtimeResources();
      };
    }

    const connect = async () => {
      if (closedByUnmount || wsDisabledForSessionRef.current) return;
      if (hasActiveSocket(wsRef.current)) return;

      setConnectionState((prev) => (prev === "live" ? prev : "connecting"));

      let wsUrl = WS_BASE_URL;
      try {
        const ticketRes = await api.post("/api/auth/ws-ticket");
        const ticket = ticketRes?.data?.ticket;
        if (!ticket) {
          disableWebsocketForSession(
            "Live PLC stream ticket unavailable. Running in REST fallback mode.",
          );
          return;
        }
        wsUrl = `${WS_BASE_URL}?ticket=${encodeURIComponent(ticket)}`;
      } catch {
        disableWebsocketForSession(
          "Live PLC stream auth failed. Running in REST fallback mode.",
        );
        return;
      }

      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;
      let opened = false;

      socket.onopen = () => {
        if (closedByUnmount) return;
        opened = true;
        reconnectAttemptsRef.current = 0;
        setConnectionState("live");
        setError("");
      };

      socket.onmessage = (event) => {
        if (closedByUnmount) return;
        try {
          const payload = JSON.parse(event.data);
          mergeDashboardRef.current(payload, "ws");
          setConnectionState("live");
          setError("");
        } catch {
          setError("Received invalid PLC stream payload");
        }
      };

      socket.onerror = () => {
        if (closedByUnmount) return;
        setConnectionState("reconnecting");
        setError("PLC stream connection issue");
      };

      socket.onclose = (event) => {
        if (wsRef.current === socket) {
          wsRef.current = null;
        }
        if (closedByUnmount) return;

        const closeCode = Number(event?.code || 1006);
        if (!opened && WS_AUTH_REJECTION_CODES.has(closeCode)) {
          disableWebsocketForSession(
            "Live stream auth/origin rejected. Using REST fallback.",
          );
          return;
        }

        reconnectAttemptsRef.current += 1;
        const attempts = reconnectAttemptsRef.current;

        if (attempts >= MAX_WS_RECONNECT_ATTEMPTS) {
          setConnectionState("rest");
          setError("Live stream unavailable - using REST fallback.");
          reconnectRef.current = window.setTimeout(() => {
            reconnectAttemptsRef.current = 0;
            void connect();
          }, 120_000);
          return;
        }

        setConnectionState("reconnecting");
        reconnectRef.current = window.setTimeout(() => {
          void connect();
        }, getReconnectDelayMs(attempts));
      };
    };

    void connect();

    return () => {
      closedByUnmount = true;
      cleanupRealtimeResources();
    };
  }, [
    cleanupRealtimeResources,
    disableWebsocketForSession,
    enableWebsocket,
    refreshSnapshot,
  ]);

  useEffect(() => {
    if (!refreshIntervalMs || refreshIntervalMs <= 0) return undefined;

    const intervalId = window.setInterval(() => {
      refreshSnapshot();
    }, refreshIntervalMs);

    return () => window.clearInterval(intervalId);
  }, [refreshIntervalMs, refreshSnapshot]);

  const derived = useMemo(() => deriveLiveMetrics(dashboard), [dashboard]);

  return {
    dashboard,
    derived,
    connectionState,
    error,
    refreshSnapshot,
  };
}

export default usePlcLiveData;
