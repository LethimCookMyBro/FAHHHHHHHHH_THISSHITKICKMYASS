import { useEffect, useMemo, useState } from "react";
import { useT } from "../../../../utils/i18n";
import { useOpsSyncContext } from "../../OpsSyncContext";

const PAGE_SIZE = 15;
const STATUS_FILTERS = {
  failed: "failed",
  manual: "requires_manual",
  executed: "executed",
};

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

const matchesQuickFilter = (action, quickFilter) => {
  if (quickFilter === "all") return true;
  if (quickFilter === "today") return isToday(action.created_at);
  return action.execution_status === STATUS_FILTERS[quickFilter];
};

const getActionSearchText = (action) =>
  [
    action.error_code,
    action.error_message,
    action.message,
    action.action_type,
    action.execution_status,
    action.machine_name,
    action.device_id,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

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
  const [currentPage, setCurrentPage] = useState(1);

  const filteredActions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return actions.filter((action) => {
      if (!matchesQuickFilter(action, quickFilter)) return false;
      if (!q) return true;
      return getActionSearchText(action).includes(q);
    });
  }, [actions, query, quickFilter]);

  const stats = useMemo(
    () =>
      actions.reduce(
        (totals, item) => {
          totals.total += 1;
          if (item.execution_status === "executed") totals.executed += 1;
          if (item.execution_status === "failed") totals.failed += 1;
          if (item.execution_status === "requires_manual") totals.manual += 1;
          if (isToday(item.created_at)) totals.today += 1;
          return totals;
        },
        { total: 0, executed: 0, failed: 0, manual: 0, today: 0 },
      ),
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

  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));

  useEffect(() => {
    setCurrentPage(1);
    setExpandedId(null);
  }, [query, quickFilter]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const pagedRows = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    return rows.slice(startIndex, startIndex + PAGE_SIZE);
  }, [currentPage, rows]);

  const pageStart = totalRows === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const pageEnd = totalRows === 0 ? 0 : Math.min(currentPage * PAGE_SIZE, totalRows);

  return {
    connectionState,
    loading,
    error,
    query,
    setQuery,
    quickFilter,
    setQuickFilter,
    stats,
    totalRows,
    currentPage,
    setCurrentPage,
    totalPages,
    pageStart,
    pageEnd,
    pagedRows,
    expandedId,
    setExpandedId,
  };
}
