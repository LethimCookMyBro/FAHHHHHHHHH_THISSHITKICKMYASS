import { useMemo, useState } from "react";
import { useT } from "../../../../utils/i18n";
import { useOpsSyncContext } from "../../OpsSyncContext";

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
  const { t } = useT();
  const {
    connectionState,
    actions,
    loading,
    error,
  } = useOpsSyncContext();
  const [query, setQuery] = useState("");
  const [quickFilter, setQuickFilter] = useState("all");
  const [expandedId, setExpandedId] = useState(null);

  const filteredActions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return actions.filter((action) => {
      if (quickFilter === "failed" && action.execution_status !== "failed") return false;
      if (quickFilter === "manual" && action.execution_status !== "requires_manual") return false;
      if (quickFilter === "executed" && action.execution_status !== "executed") return false;
      if (quickFilter === "today" && !isToday(action.created_at)) return false;

      if (!q) return true;
      return [
        action.error_code,
        action.error_message,
        action.message,
        action.action_type,
        action.execution_status,
        action.machine_name,
        action.device_id,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
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
        machineText:
          [
            action.machine_name || action.device_id || "",
            action.error_code || action.error_message || action.action_type || "",
          ]
            .filter(Boolean)
            .join(" / ") || t("actions.unknownAsset"),
        reasonText:
          action.action_reason ||
          action.recommendation ||
          t("actions.noDecisionReason"),
      })),
    [filteredActions, t],
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
