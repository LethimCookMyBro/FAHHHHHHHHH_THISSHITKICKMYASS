import { useEffect, useMemo, useState } from "react";
import api, { getApiErrorMessage } from "../../../../utils/api";
import { normalizeActionsPayload } from "../../../plc/normalizers";
import { usePlcLiveDataContext } from "../../../plc/PlcLiveDataContext";

const toReadableTime = (iso) => {
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

const isToday = (iso) => {
  if (!iso) return false;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  );
};

export default function useActionLogViewModel() {
  const { connectionState } = usePlcLiveDataContext();

  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [quickFilter, setQuickFilter] = useState("all");
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    let mounted = true;
    const loadActions = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await api.get("/api/plc/actions", { params: { limit: 150 } });
        if (!mounted) return;
        const normalized = normalizeActionsPayload(response?.data || {});
        setActions(normalized.actions);
      } catch (requestError) {
        if (!mounted) return;
        setError(getApiErrorMessage(requestError, "Failed to load action history"));
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadActions();
    return () => {
      mounted = false;
    };
  }, []);

  const filteredActions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return actions.filter((action) => {
      if (quickFilter === "failed" && action.execution_status !== "failed") return false;
      if (quickFilter === "manual" && action.execution_status !== "requires_manual") return false;
      if (quickFilter === "executed" && action.execution_status !== "executed") return false;
      if (quickFilter === "today" && !isToday(action.created_at)) return false;

      if (!q) return true;
      return (
        String(action.error_code || "").toLowerCase().includes(q) ||
        String(action.error_message || "").toLowerCase().includes(q) ||
        String(action.action_type || "").toLowerCase().includes(q) ||
        String(action.execution_status || "").toLowerCase().includes(q)
      );
    });
  }, [actions, query, quickFilter]);

  const stats = useMemo(
    () => ({
      total: actions.length,
      executed: actions.filter((item) => item.execution_status === "executed").length,
      failed: actions.filter((item) => item.execution_status === "failed").length,
      manual: actions.filter((item) => item.execution_status === "requires_manual").length,
      today: actions.filter((item) => isToday(item.created_at)).length,
    }),
    [actions],
  );

  const rows = useMemo(
    () =>
      filteredActions.map((action) => ({
        ...action,
        createdText: toReadableTime(action.created_at),
        machineText: action.error_code ? `${action.error_code} - ${action.error_message || "No message"}` : action.error_message || "No message",
        reasonText: action.action_reason || action.recommendation || "No decision reason",
      })),
    [filteredActions],
  );

  return {
    connectionState,
    loading,
    error,
    query,
    setQuery,
    quickFilter,
    setQuickFilter,
    stats,
    rows,
    expandedId,
    setExpandedId,
  };
}
