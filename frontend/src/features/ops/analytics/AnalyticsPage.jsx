import { useState } from "react";
import { Activity, LineChart, Zap } from "lucide-react";
import { useConfigureTopbar } from "../../../layout/AppTopbarContext";
import useAgentAction from "../../../hooks/useAgentAction";
import { useT } from "../../../utils/i18n";
import { useThemePalette } from "../../theme/themeContext";
import PredictionPanel from "./components/PredictionPanel";
import "./styles/analytics.css";

function MotorVibrationChart() {
  const { t } = useT();
  const palette = useThemePalette();

  return (
    <div className="motor-chart-shell">
      <div className="motor-chart-frame">
        <svg
          viewBox="0 0 720 260"
          role="img"
          aria-label={t("analytics.chartAria")}
          style={{ width: "100%", height: "100%" }}
        >
          {[40, 90, 140, 190, 240].map((y) => (
            <line
              key={y}
              x1="40"
              y1={y}
              x2="690"
              y2={y}
              stroke={palette.chartGrid}
              strokeDasharray="4 6"
            />
          ))}

          {[80, 180, 280, 380, 480, 580, 680].map((x) => (
            <line
              key={x}
              x1={x}
              y1="30"
              x2={x}
              y2="240"
              stroke={palette.chartGrid}
            />
          ))}

          <path
            d="M 50 200 Q 150 190 250 210 T 450 200 T 650 190 L 650 240 L 50 240 Z"
            fill={palette.accentSoft}
          />
          <path
            d="M 50 200 Q 150 190 250 210 T 450 200 T 650 190"
            fill="none"
            stroke={palette.accent}
            strokeWidth="4"
            strokeLinecap="round"
          />

          <path
            d="M 450 200 Q 550 150 650 80 L 650 240 L 450 240 Z"
            fill={palette.criticalSoft}
          />
          <path
            d="M 450 200 Q 550 150 650 80"
            fill="none"
            stroke={palette.critical}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray="8 8"
          />

          {[
            { x: 450, y: 200, label: t("analytics.baselineSplit") },
            { x: 550, y: 150, label: t("analytics.frequencyRise") },
            { x: 650, y: 80, label: t("analytics.failureRisk") },
          ].map((point) => (
            <g key={point.label}>
              <circle
                cx={point.x}
                cy={point.y}
                r="6"
                fill={palette.surface}
                stroke={palette.critical}
                strokeWidth="3"
              />
              <text
                x={point.x - 18}
                y={point.y - 16}
                fill={palette.critical}
                fontSize="11"
                fontWeight="700"
                fontFamily="var(--font-mono)"
              >
                {point.label}
              </text>
            </g>
          ))}

          <text
            x="40"
            y="18"
            fill={palette.chartText}
            fontSize="12"
            fontFamily="var(--font-mono)"
          >
            Hz
          </text>
          {[1, 7, 14, 21, 28].map((day, index) => (
            <text
              key={day}
              x={60 + index * 150}
              y="254"
              fill={palette.chartText}
              fontSize="11"
              fontFamily="var(--font-mono)"
            >
              {t("analytics.dayLabel", { day })}
            </text>
          ))}
        </svg>
      </div>

      <div className="analytics-chart-pills">
        <span className="ops-status-pill ops-status-running ops-status-sm">
          {t("analytics.stableLoadBand")}
        </span>
        <span className="ops-status-pill ops-status-warning ops-status-sm">
          {t("analytics.harmonicDrift")}
        </span>
        <span className="ops-status-pill ops-status-critical ops-status-sm">
          {t("analytics.bearingFailureWindow")}
        </span>
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const { t } = useT();
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  const {
    execute: startPdM,
    reset: resetPdM,
    state: pdmState,
    data: pdmData,
    partialText: pdmPartial,
    progress: pdmProgress,
  } = useAgentAction({
    deviceId: "historian-db",
    actionName: "predictive_analysis",
  });

  const telemetryHighlights = [
    { label: t("analytics.historicalWindow"), value: t("analytics.historicalWindowValue") },
    { label: t("analytics.peakDrift"), value: "+5 Hz / 7d" },
    { label: t("analytics.thermalCoupling"), value: t("analytics.thermalCouplingValue") },
  ];

  useConfigureTopbar(
    {
      title: "",
      subtitle: "",
      statusPill: { label: t("analytics.predictiveLens"), tone: "warning" },
    },
    [t],
  );

  const handleRunPredictive = () => {
    if (pdmState !== "idle") {
      resetPdM();
    }
    setIsPanelOpen(true);
    startPdM({ assetId: "Motor-M2" });
  };

  const isBusy = ["confirming", "executing", "streaming"].includes(pdmState);

  return (
    <div className="ops-page ops-analytics-page ops-page-enter">
      <section className="ops-page-header">
        <div>
          <h1 className="ops-page-title">{t("analytics.pageTitle")}</h1>
          <p className="ops-page-subtitle">{t("analytics.pageSubtitle")}</p>
        </div>
      </section>

      <div className="analytics-layout">
        <div className="chart-container-card">
          <div className="chart-header">
            <div>
              <h3>{t("analytics.chartTitle")}</h3>
              <p className="chart-subtitle">{t("analytics.chartSubtitle")}</p>
            </div>
            <button
              className="run-pdm-btn"
              onClick={handleRunPredictive}
              disabled={isBusy}
            >
              {isBusy ? (
                <Activity size={16} className="spin" />
              ) : (
                <Zap size={16} />
              )}
              {isBusy ? t("analytics.running") : t("analytics.run")}
            </button>
          </div>

          <div className="analytics-metric-strip">
            {telemetryHighlights.map((item) => (
              <article key={item.label} className="analytics-metric-tile">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </article>
            ))}
          </div>

          <MotorVibrationChart />
        </div>

        {isPanelOpen ? (
          <PredictionPanel
            agentState={pdmState}
            partialText={pdmPartial}
            progress={pdmProgress}
            data={pdmData}
          />
        ) : (
          <aside className="analytics-standby-card">
            <div className="analytics-standby-head">
              <div className="analytics-standby-icon">
                <LineChart size={24} strokeWidth={1.6} />
              </div>
              <div>
                <p className="analytics-standby-label">{t("analytics.standbyLabel")}</p>
                <h3>{t("analytics.standbyTitle")}</h3>
              </div>
            </div>

            <p className="analytics-standby-copy">{t("analytics.standbyCopy")}</p>

            <div className="analytics-standby-rail">
              <article className="analytics-standby-note">
                <span>{t("analytics.escalationLogic")}</span>
                <strong>{t("analytics.escalationLogicValue")}</strong>
              </article>
              <article className="analytics-standby-note">
                <span>{t("analytics.contextMerge")}</span>
                <strong>{t("analytics.contextMergeValue")}</strong>
              </article>
              <article className="analytics-standby-note">
                <span>{t("analytics.outputPackage")}</span>
                <strong>{t("analytics.outputPackageValue")}</strong>
              </article>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
