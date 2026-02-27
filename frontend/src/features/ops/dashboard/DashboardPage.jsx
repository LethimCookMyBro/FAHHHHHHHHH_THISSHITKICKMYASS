import { Wifi } from "lucide-react";
import {
  InlineAlert,
  PageHeader,
  SectionCard,
  SkeletonMetricTile,
  SkeletonCard,
} from "../../../components/ui";
import { useT } from "../../../utils/i18n";
import useDashboardViewModel from "./hooks/useDashboardViewModel";
import PlantOverviewCards from "./components/PlantOverviewCards";
import OeeTrendPanel from "./components/OeeTrendPanel";
import MachineQueueTable from "./components/MachineQueueTable";
import "./styles/dashboard.css";

function DashboardSkeleton({ t }) {
  return (
    <>
      <SectionCard
        title={t("dashboard.plantStatus")}
        subtitle={t("dashboard.loadingTelemetry")}
      >
        <div className="ops-dashboard-overview">
          <div className="ops-dashboard-tile-grid">
            <SkeletonMetricTile />
            <SkeletonMetricTile />
            <SkeletonMetricTile />
            <SkeletonMetricTile />
          </div>
        </div>
      </SectionCard>

      <div className="ops-dashboard-main-grid">
        <SkeletonCard lines={5} />
        <SkeletonCard lines={6} />
      </div>
    </>
  );
}

export default function DashboardPage() {
  const { t } = useT();
  const {
    connectionState,
    connectionLabel,
    loading,
    error,
    topTiles,
    oeeRows,
    history,
    machineRows,
    plantSummary,
  } = useDashboardViewModel();

  return (
    <div className="ops-page ops-dashboard-page">
      <PageHeader
        title={t("dashboard.title")}
        subtitle={t("dashboard.subtitle")}
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

      {loading ? (
        <DashboardSkeleton t={t} />
      ) : (
        <>
          <SectionCard
            title={t("dashboard.plantStatus")}
            subtitle={t("dashboard.plantHint")}
          >
            <PlantOverviewCards tiles={topTiles} plantSummary={plantSummary} />
          </SectionCard>

          <div className="ops-dashboard-main-grid">
            <SectionCard
              title={t("dashboard.oeeTrend")}
              subtitle={t("dashboard.oeeHint")}
            >
              <OeeTrendPanel oeeRows={oeeRows} history={history} />
            </SectionCard>

            <SectionCard
              title={t("dashboard.machineQueue")}
              subtitle={t("dashboard.machineHint")}
            >
              <MachineQueueTable rows={machineRows} />
            </SectionCard>
          </div>
        </>
      )}
    </div>
  );
}
