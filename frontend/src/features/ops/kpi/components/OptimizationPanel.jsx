import { AnimatePresence } from "framer-motion";
import { X, Activity, Lightbulb, BarChart2 } from "lucide-react";
import { useT } from "../../../../utils/i18n";

export default function OptimizationPanel({
  isOpen,
  onClose,
  kpi,
  agentState,
  partialText,
  progress,
  data,
}) {
  const { t } = useT();
  const isBusy = ["confirming", "executing", "streaming"].includes(agentState);

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="diagnostic-side-panel optimization-panel"
        >
          <header className="panel-header">
            <h3>
              <Lightbulb size={18} /> {t("optimization.title")}: {kpi?.title}
            </h3>
            <button className="close-btn" onClick={onClose}>
              <X size={18} />
            </button>
          </header>

          <div className="panel-content">
            {/* Status Progress Bar */}
            {isBusy && progress && progress.step && (
              <div
                className="execution-progress"
                style={{ marginBottom: "20px" }}
              >
                <div className="progress-header">
                  <span className="step-text">
                    <Activity size={14} className="spin" /> {progress.step}
                  </span>
                  <span className="percent-text">{progress.percent}%</span>
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
              </div>
            )}

            {/* Streaming Reasoning Text */}
            <div className="reasoning-stream">
              <span className="stream-label">{t("optimization.engineLabel")}</span>
              <p>
                {partialText} {isBusy && <span className="blinking-cursor" />}
              </p>
            </div>

            {/* Structured Schema Output for Optimization */}
            {data && data.kpiId && (
              <div
                className="structured-output"
              >
                <div className="metric-row">
                  <div className="metric-box">
                    <span>{t("optimization.current")}</span>
                    <strong>{data.currentOEE}%</strong>
                  </div>
                  <div className="metric-box">
                    <span>{t("optimization.target")}</span>
                    <strong>{data.targetOEE}%</strong>
                  </div>
                  <div className="metric-box">
                    <span>{t("optimization.variance")}</span>
                    <strong className="text-error">
                      -{(data.targetOEE - data.currentOEE).toFixed(1)}%
                    </strong>
                  </div>
                </div>

                <div className="schema-section">
                  <h4>
                    <BarChart2 size={14} /> {t("optimization.structuralLossAnalysis")}
                  </h4>
                  <div className="loss-waterfall">
                    <div className="loss-row">
                      <span>{t("optimization.availabilityLoss")}</span>
                      <span className="loss-val">
                        -{data.lossAnalysis?.availability}%
                      </span>
                    </div>
                    <div className="loss-row">
                      <span>{t("optimization.performanceLoss")}</span>
                      <span className="loss-val">
                        -{data.lossAnalysis?.performance}%
                      </span>
                    </div>
                    <div className="loss-row">
                      <span>{t("optimization.qualityLoss")}</span>
                      <span className="loss-val">
                        -{data.lossAnalysis?.quality}%
                      </span>
                    </div>
                  </div>
                </div>

                <div className="schema-section">
                  <h4>
                    <Lightbulb size={14} /> {t("optimization.suggestedAiTuning")}
                  </h4>
                  <ul className="remediation-list">
                    {data.aiRecommendations?.map((rec, i) => (
                      <li key={i}>{rec}</li>
                    ))}
                  </ul>

                  <div style={{ textAlign: "center" }}>
                    <span className="projected-gain">
                      {t("optimization.projectedGain")}: {data.projectedGain}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </AnimatePresence>
  );
}
