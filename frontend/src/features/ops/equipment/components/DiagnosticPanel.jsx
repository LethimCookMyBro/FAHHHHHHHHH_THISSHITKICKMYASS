import { AnimatePresence } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  CheckSquare,
  ClipboardList,
  Clock,
  Download,
  Square,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useT } from "../../../../utils/i18n";

export default function DiagnosticPanel({
  isOpen,
  onClose,
  agentState,
  partialText,
  data,
  onExportReport,
  onOpenActionLog,
}) {
  const { t } = useT();
  const isBusy = ["confirming", "executing", "streaming"].includes(agentState);
  const [logOpen, setLogOpen] = useState(false);
  const [completedSteps, setCompletedSteps] = useState([]);
  const remediationSteps = useMemo(
    () => (Array.isArray(data?.remediationSteps) ? data.remediationSteps : []),
    [data?.remediationSteps],
  );

  useEffect(() => {
    setCompletedSteps([]);
  }, [data?.rootCause]);

  return (
    <AnimatePresence>
      {isOpen ? (
        <div className="diagnostic-side-panel">
          <header className="panel-header">
            <h3>
              <Activity size={18} /> {t("diagnostic.panelTitle")}
            </h3>
            <button type="button" className="close-btn" onClick={onClose}>
              <X size={18} />
            </button>
          </header>

          <div className="panel-content">
            <div className="diagnostic-accordion">
              <button
                type="button"
                className="diagnostic-accordion-toggle"
                onClick={() => setLogOpen((current) => !current)}
              >
                {t("diagnostic.analystLog")}
              </button>
              {logOpen ? (
                <div className="reasoning-stream">
                  <span className="stream-label">{t("diagnostic.analystLogLabel")}</span>
                  <p>
                    {partialText} {isBusy ? <span className="blinking-cursor" /> : null}
                  </p>
                </div>
              ) : null}
            </div>

            {data?.rootCause ? (
              <div className="structured-output">
                <div className="metric-row">
                  <div className="metric-box">
                    <span>{t("diagnostic.confidence")}</span>
                    <strong>{data.confidence}%</strong>
                  </div>
                  <div className="metric-box">
                    <span>{t("diagnostic.severity")}</span>
                    <strong
                      className={`severity-${data.severityLevel?.toLowerCase()}`}
                    >
                      {data.severityLevel}
                    </strong>
                  </div>
                  <div className="metric-box">
                    <span>{t("diagnostic.estimatedRepair")}</span>
                    <strong>
                      <Clock size={12} /> {data.estimatedTimeToRepair}
                    </strong>
                  </div>
                </div>

                <div className="schema-section">
                  <h4>
                    <AlertTriangle size={14} /> {t("diagnostic.rootCause")}
                  </h4>
                  <p>{data.rootCause}</p>
                </div>

                <div className="schema-section">
                  <h4>{t("diagnostic.evidence")}</h4>
                  <ul className="evidence-list">
                    {(data.evidence || []).map((item, index) => (
                      <li key={`${item?.timestamp || "evidence"}-${index}`}>
                        <span className="ev-time">
                          {item?.timestamp
                            ? new Date(item.timestamp).toLocaleTimeString()
                            : t("diagnostic.na")}
                        </span>
                        <span className="ev-log">{item?.log || t("diagnostic.noLog")}</span>
                        <span className="ev-weight">
                          {t("diagnostic.weight")}: {item?.weight ?? "-"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="schema-section">
                  <h4>
                    <CheckCircle size={14} /> {t("diagnostic.remediationSteps")}
                  </h4>
                  <button
                    type="button"
                    className="schema-inline-btn"
                    onClick={() =>
                      setCompletedSteps(remediationSteps.map((_, index) => index))
                    }
                  >
                    {t("diagnostic.markAllDone")}
                  </button>
                  <ol className="remediation-list">
                    {remediationSteps.map((step, index) => (
                      <li
                        key={`${step}-${index}`}
                        className={completedSteps.includes(index) ? "is-done" : ""}
                        onClick={() =>
                          setCompletedSteps((current) =>
                            current.includes(index)
                              ? current.filter((value) => value !== index)
                              : [...current, index],
                          )
                        }
                      >
                        <span className="step-checkbox" aria-hidden="true">
                          {completedSteps.includes(index) ? (
                            <CheckSquare size={16} />
                          ) : (
                            <Square size={16} />
                          )}
                        </span>
                        {step}
                      </li>
                    ))}
                  </ol>
                </div>

                <div className="diagnostic-footer-actions">
                  <button
                    type="button"
                    className="app-topbar-btn secondary"
                    onClick={onExportReport}
                  >
                    <Download size={14} />
                    {t("diagnostic.exportReport")}
                  </button>
                  <button
                    type="button"
                    className="app-topbar-btn primary"
                    onClick={onOpenActionLog}
                  >
                    <ClipboardList size={14} />
                    {t("diagnostic.openActionLog")}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
