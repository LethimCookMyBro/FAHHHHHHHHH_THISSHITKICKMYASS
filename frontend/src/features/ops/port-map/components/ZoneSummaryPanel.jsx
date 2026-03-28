import { AnimatePresence } from "framer-motion";
import { AlertTriangle, Bot, Radar, Thermometer, X } from "lucide-react";
import { useT } from "../../../../utils/i18n";

const busyStates = new Set(["confirming", "executing", "streaming"]);

const asArray = (value) => (Array.isArray(value) ? value : []);
const statusKeyByTone = {
  critical: "alarms.critical",
  warning: "dashboard.warning",
  running: "dashboard.running",
  idle: "dashboard.idle",
};

export default function ZoneSummaryPanel({
  isOpen,
  onClose,
  zone,
  agentState,
  partialText,
  data,
  onOpenAlarmCenter,
  onOpenChat,
  isOpeningChat = false,
}) {
  const { t } = useT();
  const isBusy = busyStates.has(agentState);

  return (
    <AnimatePresence>
      {isOpen && zone ? (
        <aside className="zone-summary-panel">
          <header className="zone-panel-header">
            <h3>
              <Radar size={18} /> {t("portMap.zoneBriefingTitle", { zone: zone.name })}
            </h3>
            <button type="button" className="zone-panel-close" onClick={onClose}>
              <X size={18} />
            </button>
          </header>

          <div className="zone-panel-body zone-panel-content">
            <section className="zone-panel-overview-card">
              <div className="zone-panel-intro">
                <div>
                  <p className="zone-panel-eyebrow">{zone.title}</p>
                  <h4>{zone.headline}</h4>
                </div>
                <span className={`zone-panel-status tone-${zone.status}`}>
                  {t(statusKeyByTone[zone.status] || "common.unknown")}
                </span>
              </div>

              <div className="zone-panel-metric-row">
                <div className="zone-panel-metric-box">
                  <span>{t("portMap.assetsLabel")}</span>
                  <strong>{zone.machineCount}</strong>
                </div>
                <div className="zone-panel-metric-box">
                  <span>{t("portMap.criticalLabel")}</span>
                  <strong>{zone.criticalCount}</strong>
                </div>
                <div className="zone-panel-metric-box">
                  <span>{t("portMap.avgTempLabel")}</span>
                  <strong>{zone.tempLabel}</strong>
                </div>
              </div>
            </section>

            <section className="zone-panel-section zone-panel-stream-card">
              <span className="zone-panel-section-label">{t("portMap.spatialAnalystLog")}</span>
              <p>
                {partialText || t("portMap.awaitingZoneReasoning")}
                {isBusy ? <span className="zone-panel-cursor" /> : null}
              </p>
            </section>

            <div className="zone-panel-actions">
              <button
                type="button"
                className="app-topbar-btn secondary"
                onClick={() => onOpenAlarmCenter?.(zone)}
              >
                <AlertTriangle size={15} />
                {t("dashboardV2.incidentCenter")}
              </button>
              <button
                type="button"
                className="app-topbar-btn primary"
                disabled={isOpeningChat}
                onClick={() => onOpenChat?.(zone)}
              >
                <Bot size={15} />
                {t("portMap.askAi")}
              </button>
            </div>

            <section className="zone-panel-section">
              <div className="zone-panel-section-head">
                <h4>
                  <Thermometer size={14} /> {t("portMap.liveAssets")}
                </h4>
                <span>{t("portMap.mappedCount", { count: zone.machines.length })}</span>
              </div>
              <div className="zone-asset-list">
                {zone.machines.length > 0 ? (
                  zone.machines.slice(0, 4).map((machine) => (
                    <article key={machine.id || machine.name} className="zone-asset-card">
                      <div>
                        <strong>{machine.name}</strong>
                        <p>{machine.model || t("portMap.unknownModel")}</p>
                      </div>
                      <span>
                        {Number(machine.temp || machine.sensors?.temperature || 0).toFixed(1)} C
                      </span>
                    </article>
                  ))
                ) : (
                  <p className="zone-empty-copy">
                    {t("portMap.noMappedAssets")}
                  </p>
                )}
              </div>
            </section>

            <section className="zone-panel-section">
              <div className="zone-panel-section-head">
                <h4>
                  <AlertTriangle size={14} /> {t("portMap.activeIncidents")}
                </h4>
                <span>{t("portMap.openCount", { count: zone.activeIncidentCount })}</span>
              </div>
              <div className="zone-incident-list">
                {zone.alarms.length > 0 ? (
                  zone.alarms.slice(0, 4).map((alarm) => (
                    <article key={alarm.id || alarm.error_code} className="zone-incident-card">
                      <div>
                        <strong>{alarm.error_code || t("common.unknownCode")}</strong>
                        <p>{alarm.machine_name || t("alarms.unknownMachine")}</p>
                      </div>
                      <span>{t(`status.${alarm.status || "active"}`)}</span>
                    </article>
                  ))
                ) : (
                  <p className="zone-empty-copy">{t("portMap.noActiveIncidents")}</p>
                )}
              </div>
            </section>

            {data && data.zoneId ? (
              <section className="zone-panel-section zone-panel-ai-summary">
                <div className="zone-panel-structured-metrics">
                  <div className="zone-panel-metric-box">
                    <span>{t("portMap.criticality")}</span>
                    <strong>{data.criticalityScore}/100</strong>
                  </div>
                  <div className="zone-panel-metric-box">
                    <span>{t("portMap.confidence")}</span>
                    <strong>{data.anomalyConfidence}%</strong>
                  </div>
                  <div className="zone-panel-metric-box">
                    <span>{t("portMap.affectedAssets")}</span>
                    <strong>{asArray(data.affectedAssets).length}</strong>
                  </div>
                </div>

                <div className="zone-panel-section-block">
                  <h4>{t("portMap.aiSummary")}</h4>
                  <p>{data.activeAlarmsSummary || t("portMap.noStructuredSummary")}</p>
                </div>

                <div className="zone-panel-section-block">
                  <h4>{t("portMap.inspectionRecommendations")}</h4>
                  <ol className="zone-panel-remediation-list">
                    {asArray(data.inspectionRecommendations).length > 0 ? (
                      asArray(data.inspectionRecommendations).map((step, index) => (
                        <li key={`${step}-${index}`}>{step}</li>
                      ))
                    ) : (
                      <li>{t("portMap.fallbackInspection")}</li>
                    )}
                  </ol>
                </div>
              </section>
            ) : null}
          </div>
        </aside>
      ) : null}
    </AnimatePresence>
  );
}
