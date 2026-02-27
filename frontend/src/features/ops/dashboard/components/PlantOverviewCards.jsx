import {
  AlertTriangle,
  Factory,
  Gauge,
  PlayCircle,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { useT } from "../../../../utils/i18n";

const ICON_BY_KEY = {
  running: PlayCircle,
  critical: AlertTriangle,
  warning: AlertTriangle,
  availability: Gauge,
};

const TONE_COLORS = {
  success: "var(--neon-green)",
  error: "var(--neon-red)",
  warning: "var(--neon-amber)",
  info: "var(--primary)",
};

export default function PlantOverviewCards({ tiles, plantSummary }) {
  const { t } = useT();

  return (
    <div className="dash-overview">
      {/* Summary Strip */}
      <div className="dash-summary-strip">
        <div className="dash-summary-item">
          <span className="dash-summary-label">{t("dashboard.total")}</span>
          <span className="dash-summary-value">{plantSummary.total}</span>
        </div>
        <div className="dash-summary-item">
          <span className="dash-summary-label">{t("dashboard.running")}</span>
          <span className="dash-summary-value is-success">
            {plantSummary.running}
          </span>
        </div>
        <div className="dash-summary-item">
          <span className="dash-summary-label">{t("dashboard.idle")}</span>
          <span className="dash-summary-value">{plantSummary.idle}</span>
        </div>
        <div className="dash-summary-item">
          <span className="dash-summary-label">{t("dashboard.error")}</span>
          <span className="dash-summary-value is-error">
            {plantSummary.error}
          </span>
        </div>
        <div className="dash-summary-item">
          <span className="dash-summary-label">OEE</span>
          <span className="dash-summary-value">{plantSummary.oee}</span>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="dash-metric-grid">
        {tiles.map((tile) => {
          const Icon = ICON_BY_KEY[tile.key];
          const color = TONE_COLORS[tile.tone] || "var(--primary)";
          const isError = tile.tone === "error" && Number(tile.value) > 0;

          return (
            <div
              key={tile.key}
              className={`dash-metric-card ${isError ? "is-alert" : ""}`}
            >
              <div className="dash-metric-icon" style={{ color }}>
                {Icon ? <Icon size={18} /> : null}
              </div>
              <p className="dash-metric-label">{tile.label}</p>
              <p
                className="dash-metric-value"
                style={{ color: isError ? color : undefined }}
              >
                {tile.value}
              </p>
              <p className="dash-metric-hint">{tile.hint}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
