import { AlertCircle, Pause, Thermometer } from "lucide-react";
import { StatusPill } from "../../../../components/ui";
import { useT } from "../../../../utils/i18n";

const STATE_CONFIG = {
  running: {
    color: "var(--neon-green)",
    borderColor: "rgba(0, 255, 157, 0.3)",
  },
  error: { color: "var(--neon-red)", borderColor: "rgba(255, 51, 102, 0.4)" },
  warning: {
    color: "var(--neon-amber)",
    borderColor: "rgba(255, 204, 0, 0.3)",
  },
  idle: { color: "var(--text-muted)", borderColor: "var(--surface-700)" },
  stopped: { color: "var(--text-muted)", borderColor: "var(--surface-700)" },
};

export default function MachineQueueTable({ rows }) {
  const { t } = useT();

  if (!rows || rows.length === 0) {
    return (
      <div className="machine-empty">
        <p>{t("dashboard.noMachineTelemetry")}</p>
        <p className="machine-empty-hint">{t("dashboard.waitingForStream")}</p>
      </div>
    );
  }

  return (
    <div className="machine-card-grid">
      {rows.map((row) => {
        const config = STATE_CONFIG[row.state] || STATE_CONFIG.idle;
        const isError = row.state === "error";
        const isIdle = row.state === "idle" || row.state === "stopped";

        return (
          <div
            key={row.id}
            className={`machine-card ${isError ? "is-error" : ""} ${isIdle ? "is-idle" : ""}`}
            style={{ borderColor: config.borderColor }}
          >
            {/* Header */}
            <div className="machine-card-head">
              <div className="machine-card-info">
                <h4 className="machine-card-name">{row.name}</h4>
                <span className="machine-card-model">{row.model}</span>
              </div>
              <span
                className="machine-card-dot"
                style={{ background: config.color }}
              />
            </div>

            {/* Sensor Grid */}
            <div className="machine-sensor-grid">
              <div className="machine-sensor">
                <span className="machine-sensor-label">
                  {t("dashboard.temp")}
                </span>
                <span
                  className="machine-sensor-value"
                  style={
                    isError ? { color: "var(--neon-red)", fontWeight: 700 } : {}
                  }
                >
                  {row.temp}
                </span>
              </div>
              <div className="machine-sensor">
                <span className="machine-sensor-label">
                  {t("dashboard.current")}
                </span>
                <span className="machine-sensor-value">{row.current}</span>
              </div>
              <div className="machine-sensor">
                <span className="machine-sensor-label">
                  {t("dashboard.vibration")}
                </span>
                <span className="machine-sensor-value">{row.vibration}</span>
              </div>
              <div className="machine-sensor">
                <span className="machine-sensor-label">
                  {t("dashboard.state")}
                </span>
                <StatusPill status={row.state} />
              </div>
            </div>

            {/* Action hint */}
            {row.nextAction ? (
              <div
                className={`machine-card-action ${isError ? "is-error" : ""}`}
              >
                {isError ? <AlertCircle size={12} /> : null}
                <span>{row.nextAction}</span>
              </div>
            ) : null}

            {/* Progress bar */}
            <div className="machine-bar">
              <div
                className="machine-bar-fill"
                style={{
                  background: config.color,
                  width: isIdle ? "0%" : isError ? "100%" : "70%",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
