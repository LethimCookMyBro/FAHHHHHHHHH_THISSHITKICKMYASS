import { useEffect } from "react";
import { ClipboardList, Download, MessageSquareText } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  EmptyState,
  InlineAlert,
  SectionCard,
  SkeletonCard,
} from "../../../components/ui";
import { useT } from "../../../utils/i18n";
import useActionLogViewModel from "./hooks/useActionLogViewModel";
import ActionSummaryStrip from "./components/ActionSummaryStrip";
import ActionFilterBar from "./components/ActionFilterBar";
import ActionTimeline from "./components/ActionTimeline";
import { useConfigureTopbar } from "../../../layout/AppTopbarContext";
import { downloadCsv } from "../../../utils/exporters";
import useConnectionLabel from "../../../hooks/useConnectionLabel";
import "./styles/actions.css";

const QUICK_FILTERS = new Set(["all", "failed", "manual", "executed", "today"]);

function buildPageItems(currentPage, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const items = [1];
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);

  if (start > 2) items.push("ellipsis-left");

  for (let page = start; page <= end; page += 1) {
    items.push(page);
  }

  if (end < totalPages - 1) items.push("ellipsis-right");

  items.push(totalPages);
  return items;
}

export default function ActionLogPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
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
  } = useActionLogViewModel();

  const { label: connectionLabel, tone: connectionTone } = useConnectionLabel(connectionState);
  const hasRecords = totalRows > 0;
  const pageItems = buildPageItems(currentPage, totalPages);
  const paginationSummary = t("actions.paginationSummary", {
    start: pageStart,
    end: pageEnd,
    total: totalRows,
  });

  const goToPage = (page) => {
    setExpandedId(null);
    setCurrentPage(page);
  };

  useEffect(() => {
    const searchQuery = searchParams.get("q");
    const filter = searchParams.get("filter");

    if (typeof searchQuery === "string") {
      setQuery(searchQuery);
    }

    if (QUICK_FILTERS.has(filter || "")) {
      setQuickFilter(filter);
    }
  }, [searchParams, setQuery, setQuickFilter]);

  const exportCurrentView = () => {
    downloadCsv(
      `action_history_${new Date().toISOString().slice(0, 10)}`,
      pagedRows.map((row) => ({
        id: row.id,
        asset: row.machine_name || row.device_id || "",
        machine: row.machineText,
        status: row.execution_status,
        type: row.action_type,
        code: row.error_code,
        mode: row.issue_type,
        created_at: row.created_at,
        result: row.execution_result?.message || row.reasonText || "",
      })),
    );
  };

  useConfigureTopbar(
    {
      title: "",
      subtitle: "",
      search: {
        enabled: true,
        placeholder: t("actions.searchPlaceholder"),
        value: query,
        onChange: setQuery,
      },
      statusPill: {
        label: connectionLabel,
        tone: connectionTone,
      },
      secondaryAction: null,
      primaryAction: null,
    },
    [connectionLabel, connectionState, query, setQuery, t],
  );

  return (
    <div className="ops-page ops-actions-page ops-page-enter">
      <InlineAlert message={error} tone="error" />

      <section className="ops-page-header">
        <div>
          <h1 className="ops-page-title">{t("actions.title")}</h1>
          <p className="ops-page-subtitle">{t("actions.subtitle")}</p>
        </div>

        <div className="ops-page-actions">
          <button type="button" className="app-topbar-btn secondary" onClick={exportCurrentView}>
            <Download size={16} />
            {t("topbar.exportView")}
          </button>
          <button
            type="button"
            className="app-topbar-btn primary"
            onClick={() => navigate("/chat")}
          >
            <MessageSquareText size={16} />
            {t("topbar.openAssistant")}
          </button>
        </div>
      </section>

      <ActionSummaryStrip stats={stats} />

      {loading ? (
        <SkeletonCard lines={7} />
      ) : (
        <SectionCard
          title={t("actions.timeline")}
          subtitle={t("actions.recordCount", { count: totalRows })}
        >
          <ActionFilterBar
            query={query}
            onQueryChange={setQuery}
            quickFilter={quickFilter}
            onQuickFilterChange={setQuickFilter}
          />
          {hasRecords ? (
            <>
              <ActionTimeline
                rows={pagedRows}
                expandedId={expandedId}
                onToggleExpand={setExpandedId}
              />
              <div className="action-pagination">
                <div className="action-pagination-summary">{paginationSummary}</div>
                <div className="action-pagination-controls">
                  <button
                    type="button"
                    className="action-pagination-btn"
                    onClick={() => goToPage(Math.max(1, currentPage - 1))}
                    disabled={currentPage === 1}
                  >
                    {t("actions.previousPage")}
                  </button>
                  <div className="action-pagination-pages">
                    {pageItems.map((item) =>
                      typeof item === "number" ? (
                        <button
                          key={item}
                          type="button"
                          className={`action-pagination-page ${item === currentPage ? "is-active" : ""}`}
                          onClick={() => goToPage(item)}
                        >
                          {item}
                        </button>
                      ) : (
                        <span key={item} className="action-pagination-ellipsis">
                          ...
                        </span>
                      ),
                    )}
                  </div>
                  <button
                    type="button"
                    className="action-pagination-btn"
                    onClick={() => goToPage(Math.min(totalPages, currentPage + 1))}
                    disabled={currentPage === totalPages}
                  >
                    {t("actions.nextPage")}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <EmptyState
              icon={ClipboardList}
              title={t("actions.noRecords")}
              message={t("actions.noRecordsHint")}
            />
          )}
        </SectionCard>
      )}
    </div>
  );
}
