import { AnimatePresence } from "framer-motion";
import { Activity, AlertTriangle, ShieldCheck, Wrench } from "lucide-react";
import { useT } from "../../../../utils/i18n";

export default function PredictionPanel({
  agentState,
  partialText,
  progress,
  data,
}) {
  const { t } = useT();
  const isBusy = ["confirming", "executing", "streaming"].includes(agentState);
  const anomalySignatures = Array.isArray(data?.anomalySignatures)
    ? data.anomalySignatures
    : [];

  return (
    <AnimatePresence>
      <aside className="prediction-panel">
        <header className="prediction-panel-head">
          <div>
            <p className="prediction-panel-label">{t("prediction.failureForecast")}</p>
            <h3>
              <AlertTriangle size={18} className="text-warning" />
              {t("prediction.engineName")}
            </h3>
          </div>
          <span className="prediction-panel-status">
            {isBusy
              ? t("prediction.streaming")
              : data?.forecast
                ? t("prediction.forecastReady")
                : t("prediction.standby")}
          </span>
        </header>

        <div className="prediction-panel-body">
          {isBusy && progress && progress.step && (
            <div className="prediction-progress">
              <div className="prediction-progress-header">
                <span className="prediction-step-text">
                  <Activity size={14} className="spin" /> {progress.step}
                </span>
                <span className="prediction-percent-text">{progress.percent}%</span>
              </div>
              <div className="prediction-progress-bar">
                <div
                  className="prediction-progress-fill"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>
          )}

          <div className="prediction-stream">
            <span className="prediction-stream-label">{t("prediction.modelRationale")}</span>
            <p>
              {partialText} {isBusy && <span className="prediction-cursor" />}
            </p>
          </div>

          {data && data.timeToFailureHours && (
            <div className="prediction-results">
              <div className="ttf-display">
                <span className="ttf-value">{data.timeToFailureHours}h</span>
                <span className="ttf-label">{t("prediction.estTimeToFailure")}</span>
                <div className="confidence-badge">
                  <ShieldCheck size={14} className="text-success" />
                  {t("prediction.confidence")}: {data.confidenceScore}%
                </div>
              </div>

              <section className="prediction-summary">
                <h4>{data.forecast}</h4>
                <p>
                  {t("prediction.asset")} <strong>{data.assetId}</strong>
                  <span className="prediction-separator" />
                  {t("prediction.riskLevel")} <strong>{data.maintenanceRisk}</strong>
                </p>
              </section>

              <section className="prediction-section">
                <h4 className="prediction-section-title">
                  <Activity size={14} /> {t("prediction.anomalySignatures")}
                </h4>
                <ul className="prediction-list">
                  {anomalySignatures.map((sig, i) => (
                    <li key={i}>{sig}</li>
                  ))}
                </ul>
              </section>

              <section className="prediction-section">
                <h4 className="prediction-section-title">
                  <Wrench size={14} /> {t("prediction.recommendedIntervention")}
                </h4>
                <div className="prediction-recommendation">
                  {data.recommendedIntervention}
                </div>
              </section>
            </div>
          )}
        </div>
      </aside>
    </AnimatePresence>
  );
}
