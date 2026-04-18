import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowUpRight, ClipboardList } from "lucide-react";
import {
  EmptyState,
  InlineAlert,
  SectionCard,
  SkeletonCard,
  SkeletonMetricTile,
  StatusPill,
} from "../../../components/ui";
import { useT } from "../../../utils/i18n";
import useDashboardViewModel from "./hooks/useDashboardViewModel";
import PlantOverviewCards from "./components/PlantOverviewCards";
import OeeTrendPanel from "./components/OeeTrendPanel";
import MachineQueueTable from "./components/MachineQueueTable";
import { extractInstructionSteps } from "./helpers";
import { useConfigureTopbar } from "../../../layout/AppTopbarContext";
import { useNavigate } from "react-router-dom";
import { buildZoneRouteSearch } from "../port-map/zoneModel";
import "./styles/dashboard.css";

const statusToneByConnection = {
  live: "live",
  reconnecting: "warning",
  rest: "warning",
  connecting: "neutral",
};

const formatFeedTime = (value, t) => {
  if (!value) return t("common.pending");

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return t("common.pending");

  return new Date(timestamp).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const truncatePreviewText = (value, maxLength = 140) => {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
};

function DashboardSkeleton() {
  return (
    <>
      <div className="ops-dashboard-tile-grid">
        <SkeletonMetricTile />
        <SkeletonMetricTile />
        <SkeletonMetricTile />
        <SkeletonMetricTile />
      </div>

      <div className="dash-feature-grid">
        <SkeletonCard lines={7} />
        <div className="dash-feature-side">
          <SkeletonCard lines={8} />
          <SkeletonCard lines={8} />
        </div>
      </div>

      <div className="ops-dashboard-main-grid">
        <SkeletonCard lines={8} />
        <SkeletonCard lines={8} />
      </div>
    </>
  );
}

const FeedList = memo(function FeedList({
  rows,
  emptyIcon: Icon,
  emptyTitle,
  emptyMessage,
  kind,
}) {
  const { t } = useT();
  const safeRows = Array.isArray(rows) ? rows : [];

  if (!safeRows.length) {
    return (
      <EmptyState
        icon={Icon}
        title={emptyTitle}
        message={emptyMessage}
        compact
      />
    );
  }

  return (
    <div
      className={`dash-feed-list ${kind === "action" ? "is-action-list" : ""}`}
    >
      {safeRows.map((row) => {
        const actionSteps =
          kind === "action"
            ? extractInstructionSteps(row.result || row.detail || row.title, 2).map(
                (step) => truncatePreviewText(step, 120),
              )
            : [];
        const compactActionCopy = truncatePreviewText(
          row.result || row.detail,
          180,
        );

        return (
          <article
            key={row.id}
            className={`dash-feed-item ${kind === "alert" ? "is-alert" : "is-action"}`}
          >
            <div className="dash-feed-head">
              <div>
                <p className="dash-feed-eyebrow">
                  {kind === "alert" ? row.machine : row.detail}
                </p>
                <h3 className="dash-feed-title">
                  {kind === "alert" ? row.code : row.title}
                </h3>
              </div>
              <StatusPill
                status={kind === "alert" ? row.severity : row.status}
                size="sm"
              />
            </div>

            {kind === "alert" ? (
              <p className="dash-feed-copy">{row.message}</p>
            ) : actionSteps.length > 0 ? (
              <ol className="dash-feed-step-list">
                {actionSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            ) : (
              <p className="dash-feed-copy is-compact">{compactActionCopy}</p>
            )}

            <div className="dash-feed-meta">
              <span>{formatFeedTime(row.timestamp, t)}</span>
              <span>
                {kind === "alert"
                  ? row.status || t("common.pending")
                  : String(row.status || "").replace(/_/g, " ")}
              </span>
            </div>
          </article>
        );
      })}
    </div>
  );
});

export default function DashboardPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const [machineSearch, setMachineSearch] = useState("");
  const deferredMachineSearch = useDeferredValue(machineSearch);
  const [showSecondarySections, setShowSecondarySections] = useState(false);
  const secondaryPlaceholderRef = useRef(null);
  const {
    connectionState,
    connectionLabel,
    loading,
    error,
    topTiles,
    oeeRows,
    history,
    machineRows,
    alertRows,
    actionRows,
    plantSummary,
    utilizationRate,
    focusMessage,
  } = useDashboardViewModel();

  const filteredMachineRows = useMemo(() => {
    const query = deferredMachineSearch.trim().toLowerCase();
    if (!query) return machineRows;

    return machineRows.filter((row) => {
      const haystack = [
        row.name,
        row.model,
        row.state,
        row.nextAction,
        row.temp,
        row.current,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [deferredMachineSearch, machineRows]);

  const visibleMachineRows = filteredMachineRows;
  const priorityAssetSubtitle =
    visibleMachineRows.length > 4
      ? t("dashboardV2.priorityAssetsSubtitleTop", {
          count: visibleMachineRows.length,
        })
      : t("dashboardV2.priorityAssetsSubtitleCount", {
          count: visibleMachineRows.length,
        });

  useEffect(() => {
    if (loading) {
      setShowSecondarySections(false);
      return undefined;
    }

    const reveal = () => setShowSecondarySections(true);
    const timeoutId = window.setTimeout(reveal, 4500);

    if (!("IntersectionObserver" in window) || !secondaryPlaceholderRef.current) {
      return () => window.clearTimeout(timeoutId);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        window.clearTimeout(timeoutId);
        observer.disconnect();
        reveal();
      },
      { rootMargin: "360px 0px" },
    );
    observer.observe(secondaryPlaceholderRef.current);

    return () => {
      window.clearTimeout(timeoutId);
      observer.disconnect();
    };
  }, [loading]);

  const openActionTimeline = useCallback(() => {
    navigate("/actions");
  }, [navigate]);

  const openAlerts = useCallback(() => {
    navigate("/alarms");
  }, [navigate]);

  const openAnalytics = useCallback(() => {
    navigate("/analytics");
  }, [navigate]);

  const openEquipment = useCallback(() => {
    navigate("/equipment");
  }, [navigate]);

  const openPortMap = useCallback(() => {
    navigate("/port-map");
  }, [navigate]);

  const openMachineInChat = useCallback(
    (machine) => {
      navigate(
        `/chat?machineId=${encodeURIComponent(machine.id || machine.name)}&machineName=${encodeURIComponent(machine.name || t("alarms.unknownMachine"))}&errorCode=${encodeURIComponent(machine.errorCode || machine.state || "CHECK")}`,
      );
    },
    [navigate, t],
  );

  const openMachineInMap = useCallback(
    (machine) => {
      navigate(`/port-map?${buildZoneRouteSearch(machine)}`);
    },
    [navigate],
  );

  useConfigureTopbar(
    {
      title: "",
      subtitle: "",
      search: {
        enabled: true,
        placeholder: t("dashboard.searchMachines"),
        value: machineSearch,
        onChange: setMachineSearch,
      },
      statusPill: {
        label: connectionLabel,
        tone: statusToneByConnection[connectionState] || "neutral",
      },
      secondaryAction: null,
      primaryAction: null,
    },
    [connectionLabel, connectionState, machineSearch, t],
  );

  return (
    <div className="ops-page ops-dashboard-page ops-page-enter">
      <InlineAlert message={error} tone="error" />

      <section className="ops-page-header">
        <div>
          <h1 className="ops-page-title">{t("nav.overview")}</h1>
          <p className="ops-page-subtitle">
            {t("dashboardV2.overviewSubtitle")}
          </p>
        </div>

        <div className="ops-page-actions">
          <button
            type="button"
            className="app-topbar-btn secondary"
            onClick={openActionTimeline}
          >
            <ClipboardList size={16} />
            {t("dashboardV2.actionTimeline")}
          </button>
          <button
            type="button"
            className="app-topbar-btn primary"
            onClick={openAlerts}
          >
            <AlertTriangle size={16} />
            {t("dashboardV2.openAlerts")}
          </button>
        </div>
      </section>

      {loading ? (
        <DashboardSkeleton />
      ) : (
        <>
          <PlantOverviewCards
            tiles={topTiles}
            plantSummary={plantSummary}
            history={history}
            alertRows={alertRows}
            actionRows={actionRows}
            utilizationRate={utilizationRate}
            focusMessage={focusMessage}
            onOpenPortMap={openPortMap}
            onOpenAnalytics={openAnalytics}
            onOpenActions={openActionTimeline}
          />

          {showSecondarySections ? (
            <div className="ops-dashboard-columns">
              <div className="ops-dashboard-column">
                <SectionCard
                  title={t("dashboardV2.maintenanceRhythm")}
                  subtitle={t("dashboardV2.maintenanceRhythmSubtitle")}
                  right={
                    <button
                      type="button"
                      className="dash-inline-link"
                      onClick={openAnalytics}
                    >
                      {t("dashboardV2.predictiveLens")}
                      <ArrowUpRight size={14} />
                    </button>
                  }
                >
                  <OeeTrendPanel oeeRows={oeeRows} history={history} />
                </SectionCard>

                <SectionCard
                  title={t("dashboardV2.alertWatchlist")}
                  subtitle={t("dashboardV2.alertWatchlistSubtitle")}
                  right={
                    <button
                      type="button"
                      className="dash-inline-link"
                      onClick={openAlerts}
                    >
                      {t("dashboardV2.incidentCenter")}
                      <ArrowUpRight size={14} />
                    </button>
                  }
                >
                  <FeedList
                    rows={alertRows}
                    kind="alert"
                    emptyIcon={AlertTriangle}
                    emptyTitle={t("dashboardV2.noActiveAlerts")}
                    emptyMessage={t("dashboardV2.noActiveAlertsMessage")}
                  />
                </SectionCard>
              </div>

              <div className="ops-dashboard-column">
                <SectionCard
                  title={t("dashboardV2.priorityAssets")}
                  subtitle={priorityAssetSubtitle}
                  right={
                    <button
                      type="button"
                      className="dash-inline-link"
                      onClick={openEquipment}
                    >
                      {t("dashboardV2.equipmentView")}
                      <ArrowUpRight size={14} />
                    </button>
                  }
                >
                  <MachineQueueTable
                    rows={visibleMachineRows}
                    onOpenChat={openMachineInChat}
                    onOpenMap={openMachineInMap}
                    onOpenAll={openEquipment}
                  />
                </SectionCard>

                <SectionCard
                  title={t("dashboardV2.recentActions")}
                  subtitle={t("dashboardV2.recentActionsSubtitle")}
                  right={
                    <button
                      type="button"
                      className="dash-inline-link"
                      onClick={openActionTimeline}
                    >
                      {t("dashboardV2.fullTimeline")}
                      <ArrowUpRight size={14} />
                    </button>
                  }
                >
                  <FeedList
                    rows={actionRows}
                    kind="action"
                    emptyIcon={ClipboardList}
                    emptyTitle={t("dashboardV2.noRecordedActions")}
                    emptyMessage={t("dashboardV2.noRecordedActionsMessage")}
                  />
                </SectionCard>
              </div>
            </div>
          ) : (
            <div
              ref={secondaryPlaceholderRef}
              className="dash-secondary-placeholder"
              aria-hidden="true"
            />
          )}
        </>
      )}
    </div>
  );
}
