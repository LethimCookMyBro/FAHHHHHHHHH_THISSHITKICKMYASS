import { AnimatePresence } from "framer-motion";
import { X, Activity, Zap, ShieldAlert, Cpu } from "lucide-react";
import { useT } from "../../../../utils/i18n";

export default function SystemScanPanel({
  isOpen,
  onClose,
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
          className="diagnostic-side-panel system-scan-panel"
        >
          <header className="panel-header">
            <h3>
              <Zap size={18} /> {t("scan.panelTitle")}
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
              <span className="stream-label">{t("scan.traceLog")}</span>
              <p>
                {partialText} {isBusy && <span className="blinking-cursor" />}
              </p>
            </div>

            {/* Structured Schema Output for Overview */}
            {data && data.scanId && (
              <div
                className="structured-output"
              >
                <div className="score-display">
                  <div>
                    <h4
                      style={{
                        margin: "0 0 4px 0",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {t("scan.systemHealthIndex")}
                    </h4>
                    <span
                      style={{
                        fontSize: "1.2rem",
                        fontWeight: "600",
                        color: "var(--text-primary)",
                      }}
                    >
                      {data.systemStatus}
                    </span>
                  </div>
                  <div
                    className={`score-circle ${data.overallHealthScore < 90 ? "warning" : ""}`}
                  >
                    {data.overallHealthScore}
                  </div>
                </div>

                <div className="schema-section">
                  <h4>
                    <ShieldAlert size={14} /> {t("scan.topVulnerabilities")}
                  </h4>
                  {data.topVulnerabilities?.map((vuln, i) => (
                    <div key={i} className={`vuln-item ${vuln.severity}`}>
                      <span className="vuln-node">{vuln.node}</span>
                      <span>{vuln.issue}</span>
                    </div>
                  ))}
                </div>

                <div className="schema-section">
                  <h4>
                    <Cpu size={14} /> {t("scan.optimizationInsights")}
                  </h4>
                  <ul className="remediation-list">
                    {data.optimizationInsights?.map((insight, i) => (
                      <li key={i}>{insight}</li>
                    ))}
                  </ul>
                </div>

                <div
                  style={{
                    marginTop: "24px",
                    fontSize: "0.8rem",
                    color: "var(--text-tertiary)",
                  }}
                >
                  <p>{t("scan.scanId")}: {data.scanId}</p>
                  <p>{data.lastAuditLog}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </AnimatePresence>
  );
}
