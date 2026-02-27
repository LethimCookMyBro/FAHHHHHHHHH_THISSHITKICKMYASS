import { ClipboardList, Wifi } from "lucide-react";
import {
  EmptyState,
  InlineAlert,
  PageHeader,
  SectionCard,
  SkeletonCard,
} from "../../../components/ui";
import { useT } from "../../../utils/i18n";
import useActionLogViewModel from "./hooks/useActionLogViewModel";
import ActionSummaryStrip from "./components/ActionSummaryStrip";
import ActionFilterBar from "./components/ActionFilterBar";
import ActionTimeline from "./components/ActionTimeline";
import "./styles/actions.css";

const CONNECTION_LABELS = {
  live: "common.liveStream",
  reconnecting: "sidebar.reconnecting",
  rest: "sidebar.restFallback",
  connecting: "sidebar.connecting",
};

export default function ActionLogPage() {
  const { t } = useT();
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

  const connectionLabel = t(
    CONNECTION_LABELS[connectionState] || CONNECTION_LABELS.connecting,
  );
  const hasRecords = rows.length > 0;

  return (
    <div className="ops-page ops-actions-page">
      <PageHeader
        title={t("actions.title")}
        subtitle={t("actions.subtitle")}
        right={
          <span className="live-indicator">
            <span
              className={`live-dot ${connectionState === "live" ? "" : connectionState === "reconnecting" ? "warn" : "off"}`}
            />
            <Wifi size={12} /> {connectionLabel}
          </span>
        }
      />

      <InlineAlert message={error} tone="error" />

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
