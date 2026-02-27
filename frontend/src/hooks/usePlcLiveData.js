import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../utils/api";
import { normalizeDashboardPayload } from "../features/plc/normalizers";

const WS_BASE_URL =
  (window.location.protocol === "https:" ? "wss://" : "ws://") +
  window.location.host +
  "/api/plc/ws";

const EMPTY_DASHBOARD = normalizeDashboardPayload({});

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

/* Max consecutive REST failures before pausing polling */
const MAX_REST_FAILURES = 3;
/* How long to pause polling (ms) after too many failures */
const REST_BACKOFF_MS = 60_000;

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
        return {
          ...normalized,
          recent_alarms:
            normalized.recent_alarms.length > 0
              ? normalized.recent_alarms
              : current.recent_alarms,
          recent_actions:
            normalized.recent_actions.length > 0
              ? normalized.recent_actions
              : current.recent_actions,
        };
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

  /* --- Stable refs so effects don't re-run when callbacks change --- */
  const mergeDashboardRef = useRef(mergeDashboard);
  mergeDashboardRef.current = mergeDashboard;

  const refreshSnapshot = useCallback(async () => {
    /* Skip if we're in backoff after too many failures */
    if (restBackoffTimerRef.current) return;

    try {
      const response = await api.get("/api/plc/dashboard");
      mergeDashboardRef.current(response?.data, "rest");
      setConnectionState((prev) => (prev === "live" ? prev : "rest"));
      setError("");
      restFailuresRef.current = 0;
    } catch {
      restFailuresRef.current += 1;

      if (restFailuresRef.current >= MAX_REST_FAILURES) {
        setError("Backend unreachable — polling paused. Will retry in 60s.");
        restBackoffTimerRef.current = window.setTimeout(() => {
          restBackoffTimerRef.current = null;
          restFailuresRef.current = 0;
        }, REST_BACKOFF_MS);
      } else {
        setError("Failed to load PLC snapshot");
      }
    }
  }, []);

  /* --- WebSocket connection effect --- */
  useEffect(() => {
    let closedByUnmount = false;

    refreshSnapshot();

    if (!enableWebsocket) {
      setConnectionState("rest");
      setError("");
      return () => {
        closedByUnmount = true;
        if (reconnectRef.current) window.clearTimeout(reconnectRef.current);
        if (throttleTimerRef.current) {
          window.clearTimeout(throttleTimerRef.current);
          throttleTimerRef.current = null;
        }
        queuedUpdateRef.current = null;
        const socket = wsRef.current;
        wsRef.current = null;
        if (socket) {
          socket.onopen = null;
          socket.onmessage = null;
          socket.onerror = null;
          socket.onclose = null;
          if (socket.readyState === WebSocket.OPEN) {
            socket.close(1000, "cleanup");
          }
        }
      };
    }

    const connect = async () => {
      if (closedByUnmount) return;
      if (wsDisabledForSessionRef.current) return;
      if (
        wsRef.current &&
        (wsRef.current.readyState === WebSocket.OPEN ||
          wsRef.current.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }

      setConnectionState((prev) => (prev === "live" ? prev : "connecting"));

      let wsUrl = WS_BASE_URL;
      try {
        const ticketRes = await api.post("/api/auth/ws-ticket");
        const ticket = ticketRes?.data?.ticket;
        if (!ticket) {
          wsDisabledForSessionRef.current = true;
          setConnectionState("rest");
          setError(
            "Live PLC stream ticket unavailable. Running in REST fallback mode.",
          );
          return;
        }
        wsUrl = `${WS_BASE_URL}?ticket=${encodeURIComponent(ticket)}`;
      } catch {
        wsDisabledForSessionRef.current = true;
        setConnectionState("rest");
        setError("Live PLC stream auth failed. Running in REST fallback mode.");
        return;
      }

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      let opened = false;

      ws.onopen = () => {
        if (closedByUnmount) return;
        opened = true;
        reconnectAttemptsRef.current = 0;
        setConnectionState("live");
        setError("");
      };

      ws.onmessage = (event) => {
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

      ws.onerror = () => {
        if (closedByUnmount) return;
        setConnectionState("reconnecting");
        setError("PLC stream connection issue");
      };

      ws.onclose = (event) => {
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
        if (closedByUnmount) return;

        const closeCode = Number(event?.code || 1006);
        const authRelatedClose = closeCode === 1008 || closeCode === 1002;
        if (!opened && authRelatedClose) {
          wsDisabledForSessionRef.current = true;
          setConnectionState("rest");
          setError("Live stream auth/origin rejected. Using REST fallback.");
          return;
        }

        reconnectAttemptsRef.current += 1;
        const attempts = reconnectAttemptsRef.current;

        /* After 4 attempts, fall back to REST and wait 2 minutes before retrying WS */
        if (attempts >= 4) {
          setConnectionState("rest");
          setError("Live stream unavailable — using REST fallback.");
          reconnectRef.current = window.setTimeout(() => {
            reconnectAttemptsRef.current = 0;
            void connect();
          }, 120_000);
          return;
        }

        const delay = Math.min(30000, 2000 * 2 ** (attempts - 1));
        setConnectionState("reconnecting");
        reconnectRef.current = window.setTimeout(() => {
          void connect();
        }, delay);
      };
    };

    void connect();

    return () => {
      closedByUnmount = true;
      if (reconnectRef.current) window.clearTimeout(reconnectRef.current);
      if (throttleTimerRef.current) {
        window.clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
      if (restBackoffTimerRef.current) {
        window.clearTimeout(restBackoffTimerRef.current);
        restBackoffTimerRef.current = null;
      }
      queuedUpdateRef.current = null;
      const socket = wsRef.current;
      wsRef.current = null;
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        if (socket.readyState === WebSocket.OPEN) {
          socket.close(1000, "cleanup");
        }
      }
    };
    // Stable deps only — no callback deps that change on every render
  }, [enableWebsocket, refreshSnapshot]);

  /* --- REST polling interval --- */
  useEffect(() => {
    if (!refreshIntervalMs || refreshIntervalMs <= 0) return undefined;

    const id = window.setInterval(() => {
      refreshSnapshot();
    }, refreshIntervalMs);

    return () => window.clearInterval(id);
  }, [refreshIntervalMs, refreshSnapshot]);

  const derived = useMemo(() => {
    const machines = dashboard.machines || [];
    const runningCount = machines.filter(
      (machine) => machine.status === "running",
    ).length;
    const alarmCount = machines.filter(
      (machine) => machine.status === "error",
    ).length;

    return {
      machineCount: machines.length,
      runningCount,
      alarmCount,
      oee: dashboard.oee || {
        overall: 0,
        availability: 0,
        performance: 0,
        quality: 0,
      },
      history: dashboard.oee_history || [],
    };
  }, [dashboard]);

  return {
    dashboard,
    derived,
    connectionState,
    error,
    refreshSnapshot,
  };
}

export default usePlcLiveData;
