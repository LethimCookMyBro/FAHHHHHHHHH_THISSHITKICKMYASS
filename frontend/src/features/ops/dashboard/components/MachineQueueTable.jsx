import { memo } from "react";
import { AlertCircle, ArrowUpRight, MapPinned, Search } from "lucide-react";
import { StatusPill } from "../../../../components/ui";
import { useT } from "../../../../utils/i18n";

const STATE_CONFIG = {
  running: {
    color: "var(--status-ok-text)",
    borderColor: "var(--status-ok-border)",
  },
  error: {
    color: "var(--status-critical-text)",
    borderColor: "var(--status-critical-border)",
  },
  warning: {
    color: "var(--status-warning-text)",
    borderColor: "var(--status-warning-border)",
  },
  idle: { color: "var(--text-muted)", borderColor: "var(--surface-border)" },
  stopped: { color: "var(--text-muted)", borderColor: "var(--surface-border)" },
};

function MachineQueueTable({
  rows,
  onOpenChat,
  onOpenMap,
  onOpenAll,
}) {
  const { t } = useT();
  const visibleRows = Array.isArray(rows) ? rows.slice(0, 4) : [];
  const overflowRows = Array.isArray(rows) ? rows.slice(4) : [];

  if (!rows || rows.length === 0) {
    return (
      <div className="machine-empty">
        <p>{t("dashboard.noMachineTelemetry")}</p>
        <p className="machine-empty-hint">{t("dashboard.waitingForStream")}</p>
      </div>
    );
  }

  return (
    <div className="machine-queue-shell">
      <div className="machine-card-grid">
        {visibleRows.map((row) => {
          const config = STATE_CONFIG[row.state] || STATE_CONFIG.idle;
          const isError = row.state === "error";
          const isIdle = row.state === "idle" || row.state === "stopped";

          return (
            <div
              key={row.id}
              className={`machine-card ${isError ? "is-error" : ""} ${isIdle ? "is-idle" : ""}`}
              style={{ borderColor: config.borderColor }}
            >
              <div className="machine-card-head">
                <div className="machine-card-info">
                  <div className="machine-card-meta">
                    <span className="machine-card-rank">
                      {t("dashboard.priority")} {row.priority}
                    </span>
                    {row.location ? (
                      <span className="machine-card-location">{row.location}</span>
                    ) : null}
                    {row.errorCode ? (
                      <span className="machine-card-location machine-card-code">
                        {row.errorCode}
                      </span>
                    ) : null}
                  </div>
                  <h4 className="machine-card-name">{row.name}</h4>
                  <span className="machine-card-model">{row.model}</span>
                </div>
                <StatusPill status={row.state} size="sm" />
              </div>

              <div className="machine-sensor-grid">
                <div className="machine-sensor">
                  <span className="machine-sensor-label">
                    {t("dashboard.temp")}
                  </span>
                  <div className="machine-sensor-stack">
                    <span
                      className="machine-sensor-value"
                      style={
                        isError
                          ? { color: "var(--status-critical-text)", fontWeight: 700 }
                          : {}
                      }
                    >
                      {row.temp}
                    </span>
                    <span className="machine-sparkline" />
                  </div>
                </div>
                <div className="machine-sensor">
                  <span className="machine-sensor-label">
                    {t("dashboard.current")}
                  </span>
                  <div className="machine-sensor-stack">
                    <span className="machine-sensor-value">{row.current}</span>
                    <span className="machine-sparkline" />
                  </div>
                </div>
                <div className="machine-sensor">
                  <span className="machine-sensor-label">
                    {t("dashboard.vibration")}
                  </span>
                  <span className="machine-sensor-value">{row.vibration}</span>
                </div>
              </div>

              {row.nextAction ? (
                <div
                  className={`machine-card-action ${isError ? "is-error" : ""}`}
                >
                  {isError ? <AlertCircle size={12} /> : null}
                  <div>
                    <span className="machine-card-action-label">
                      {t("dashboardV2.nextMove")}
                    </span>
                    <p>{row.nextAction}</p>
                  </div>
                </div>
              ) : null}

              <div className="machine-card-actions">
                <button
                  type="button"
                  className="machine-card-btn"
                  onClick={() => onOpenMap?.(row)}
                >
                  <MapPinned size={12} />
                  {t("dashboardV2.openMap")}
                </button>
                <button
                  type="button"
                  className="machine-card-btn primary"
                  onClick={() => onOpenChat?.(row)}
                >
                  <Search size={12} />
                  {t("dashboardV2.runDiagnose")}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {overflowRows.length > 0 ? (
        <div className="machine-overflow-strip">
          <div className="machine-overflow-copy">
            <span className="machine-overflow-label">
              {t("dashboardV2.moreAssetsInFocus", { count: overflowRows.length })}
            </span>
            <p>{t("dashboardV2.moreAssetsHint")}</p>
          </div>

          <div className="machine-overflow-tags">
            {overflowRows.slice(0, 3).map((row) => (
              <span key={row.id} className="machine-overflow-tag">
                {row.name}
              </span>
            ))}
            {overflowRows.length > 3 ? (
              <span className="machine-overflow-tag is-muted">
                {t("dashboardV2.moreCount", { count: overflowRows.length - 3 })}
              </span>
            ) : null}
          </div>

          <button
            type="button"
            className="machine-overflow-btn"
            onClick={() => onOpenAll?.()}
          >
            {t("dashboardV2.viewFullQueue")}
            <ArrowUpRight size={14} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default memo(MachineQueueTable);
