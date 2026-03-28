import React, { useState } from "react";
import { useConfigureTopbar } from "../../../layout/AppTopbarContext";
import { useT } from "../../../utils/i18n";
import { Zap, Settings, ArrowUpRight, ArrowDownRight } from "lucide-react";
import useAgentAction from "../../../hooks/useAgentAction";
import OptimizationPanel from "./components/OptimizationPanel";
import "./styles/kpi.css";

const KPIS = [
  {
    id: "OEE-Line1",
    title: "OEE - Main Line",
    current: 78.5,
    target: 85.0,
    unit: "%",
    trend: "up",
    status: "warn",
  },
  {
    id: "Avail-Line1",
    title: "Availability",
    current: 94.8,
    target: 95.0,
    unit: "%",
    trend: "up",
    status: "good",
  },
  {
    id: "Perf-Line1",
    title: "Performance",
    current: 87.9,
    target: 90.0,
    unit: "%",
    trend: "down",
    status: "warn",
  },
  {
    id: "Qual-Line1",
    title: "Quality Rate",
    current: 95.8,
    target: 99.0,
    unit: "%",
    trend: "down",
    status: "bad",
  },
];

export default function KpiPage() {
  const { t } = useT();
  const [activeKpi, setActiveKpi] = useState(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  const {
    execute: startOptimize,
    reset: resetOptimize,
    state: optState,
    data: optData,
    partialText: optPartial,
    progress: optProgress,
  } = useAgentAction({
    deviceId: "plant-kpi",
    actionName: "optimize_kpi",
  });

  useConfigureTopbar(
    {
      title: "",
      subtitle: "",
      statusPill: { label: t("kpi.statusPill"), tone: "info" },
    },
    [t],
  );

  const localizedKpis = KPIS.map((kpi) => ({
    ...kpi,
    title: t(`kpi.metric.${kpi.id}`),
  }));

  const handleOptimizeClick = (kpi) => {
    setActiveKpi(kpi);
    resetOptimize();
    setIsPanelOpen(true);
    startOptimize({ kpiId: kpi.id });
  };

  return (
    <div className="ops-page ops-kpi-page ops-page-enter">
      <section className="ops-page-header">
        <div>
          <h1 className="ops-page-title">{t("kpi.pageTitle")}</h1>
          <p className="ops-page-subtitle">{t("kpi.pageSubtitle")}</p>
        </div>
      </section>

      <div className="kpi-grid">
        {localizedKpis.map((kpi) => {
          const isBusy =
            activeKpi?.id === kpi.id &&
            ["confirming", "executing", "streaming"].includes(optState);

          return (
            <div key={kpi.id} className="kpi-card">
              <div className="kpi-card-header">
                <div className="kpi-title-block">
                  <Settings size={16} />
                  <h3>{kpi.title}</h3>
                </div>
                {kpi.trend === "up" ? (
                  <ArrowUpRight size={20} color="var(--success)" />
                ) : (
                  <ArrowDownRight size={20} color="var(--error)" />
                )}
              </div>

              <div>
                <div className="kpi-current-value">
                  {kpi.current}
                  <span
                    style={{
                      fontSize: "1.2rem",
                      color: "var(--text-tertiary)",
                    }}
                  >
                    {kpi.unit}
                  </span>
                </div>
                <div className="kpi-target">
                  {t("kpi.target")}: {kpi.target}
                  {kpi.unit}
                </div>
              </div>

              {/* Simple Mock Sparkline */}
              <div className="sparkline-container">
                {[40, 60, 50, 80, 70, 90, 85, kpi.current].map((val, i) => (
                  <div
                    key={i}
                    className={`spark-bar ${kpi.status}`}
                    style={{ height: `${val}%` }}
                  />
                ))}
              </div>

              <button
                className="optimize-btn"
                onClick={() => handleOptimizeClick(kpi)}
                disabled={isBusy}
              >
                {isBusy ? (
                  <Zap size={16} className="spin" />
                ) : (
                  <Zap size={16} />
                )}
                {isBusy ? t("kpi.analyzingSetup") : t("kpi.analyzeOptimize")}
              </button>
            </div>
          );
        })}
      </div>

      <OptimizationPanel
        isOpen={isPanelOpen}
        onClose={() => setIsPanelOpen(false)}
        kpi={activeKpi}
        agentState={optState}
        partialText={optPartial}
        progress={optProgress}
        data={optData}
      />
    </div>
  );
}
