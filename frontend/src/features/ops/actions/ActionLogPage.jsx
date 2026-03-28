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
    rows,
    expandedId,
    setExpandedId,
  } = useActionLogViewModel();

  const { label: connectionLabel, tone: connectionTone } = useConnectionLabel(connectionState);
  const hasRecords = rows.length > 0;

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
      rows.map((row) => ({
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
          subtitle={t("actions.recordCount", { count: rows.length })}
        >
          <ActionFilterBar
            query={query}
            onQueryChange={setQuery}
            quickFilter={quickFilter}
            onQuickFilterChange={setQuickFilter}
          />
          {hasRecords ? (
            <ActionTimeline
              rows={rows}
              expandedId={expandedId}
              onToggleExpand={setExpandedId}
            />
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
