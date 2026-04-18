import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useT } from "../../../../utils/i18n";
import { getApiErrorMessage } from "../../../../utils/api";
import { useOpsSyncContext } from "../../OpsSyncContext";
import { fetchOpsActionsPage } from "../../opsDataApi";

const PAGE_SIZE = 15;
const EMPTY_STATS = Object.freeze({
  total: 0,
  executed: 0,
  failed: 0,
  manual: 0,
  today: 0,
});

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

const toStats = (stats) => ({
  total: Number(stats?.total) || 0,
  executed: Number(stats?.executed) || 0,
  failed: Number(stats?.failed) || 0,
  manual: Number(stats?.manual) || 0,
  today: Number(stats?.today) || 0,
});

export default function useActionLogViewModel() {
  const { t } = useT();
  const {
    connectionState,
    error: syncError,
  } = useOpsSyncContext();
  const [query, setQuery] = useState("");
  const [quickFilter, setQuickFilter] = useState("all");
  const [expandedId, setExpandedId] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageData, setPageData] = useState({
    rows: [],
    total: 0,
    stats: EMPTY_STATS,
  });
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim();
  const stats = pageData.stats;

  const rows = useMemo(
    () =>
      pageData.rows.map((action) => ({
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
    [pageData.rows, t],
  );

  const totalRows = pageData.total;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));

  useEffect(() => {
    setCurrentPage(1);
    setExpandedId(null);
  }, [normalizedQuery, quickFilter]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    const controller = new AbortController();
    const offset = (currentPage - 1) * PAGE_SIZE;

    setLoading(true);
    setPageError("");

    fetchOpsActionsPage({
      limit: PAGE_SIZE,
      offset,
      query: normalizedQuery,
      quickFilter,
      signal: controller.signal,
    })
      .then((payload) => {
        setPageData({
          rows: payload.actions,
          total: payload.total,
          stats: toStats(payload.stats),
        });
      })
      .catch((requestError) => {
        if (requestError?.code === "ERR_CANCELED") return;
        setPageError(getApiErrorMessage(requestError, t("ops.loadFailed")));
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [currentPage, normalizedQuery, quickFilter, t]);

  const pageStart = totalRows === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const pageEnd = totalRows === 0 ? 0 : Math.min(currentPage * PAGE_SIZE, totalRows);

  return {
    connectionState,
    loading,
    error: pageError || syncError,
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
    pagedRows: rows,
    expandedId,
    setExpandedId,
  };
}
