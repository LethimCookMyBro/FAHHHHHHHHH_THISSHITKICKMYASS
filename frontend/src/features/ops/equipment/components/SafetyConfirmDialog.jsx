import { AnimatePresence } from "framer-motion";
import { AlertTriangle, HardDrive, Zap, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "../../../../utils/i18n";

export default function SafetyConfirmDialog({
  isOpen,
  onCancel,
  onConfirm,
  equipment,
  actionName,
}) {
  const { t } = useT();
  const [mode, setMode] = useState("dry-run");

  useEffect(() => {
    if (isOpen) {
      setMode("dry-run");
    }
  }, [equipment?.id, isOpen]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div
        className="safety-overlay"
      >
        <div
          className="safety-dialog"
        >
          <header className="dialog-header has-warning">
            <AlertTriangle size={20} />
            <h2>{t("safety.title")}</h2>
            <button type="button" className="close-btn" onClick={onCancel}>
              <X size={16} />
            </button>
          </header>

          <div className="dialog-body">
            <p className="auth-warning">
              {t("safety.warningText", {
                action: actionName,
                equipment: equipment?.name || t("common.unknown"),
              })}
            </p>

            <div className="mode-selector">
              <label
                className={`mode-card ${mode === "dry-run" ? "active" : ""}`}
              >
                <input
                  type="radio"
                  name="execMode"
                  value="dry-run"
                  checked={mode === "dry-run"}
                  onChange={() => setMode("dry-run")}
                />
                <div className="mode-content">
                  <span className="mode-icon">
                    <HardDrive size={18} />
                  </span>
                  <div>
                    <h4>{t("safety.dryRunTitle")}</h4>
                    <p>{t("safety.dryRunDescription")}</p>
                  </div>
                </div>
              </label>

              <label
                className={`mode-card ${mode === "execute" ? "active danger" : ""}`}
              >
                <input
                  type="radio"
                  name="execMode"
                  value="execute"
                  checked={mode === "execute"}
                  onChange={() => setMode("execute")}
                />
                <div className="mode-content">
                  <span className="mode-icon">
                    <Zap size={18} />
                  </span>
                  <div>
                    <h4>{t("safety.executeTitle")}</h4>
                    <p>{t("safety.executeDescription")}</p>
                  </div>
                </div>
              </label>
            </div>

            <p className="audit-notice">{t("safety.auditNotice")}</p>
          </div>

          <footer className="dialog-footer">
            <button type="button" className="btn-secondary" onClick={onCancel}>
              {t("safety.cancel")}
            </button>
            <button
              type="button"
              className={`btn-primary ${mode === "execute" ? "btn-danger" : ""}`}
              onClick={() => onConfirm(mode)}
            >
              {mode === "dry-run"
                ? t("safety.authorizeSimulation")
                : t("safety.authorizeExecution")}
            </button>
          </footer>
        </div>
      </div>
    </AnimatePresence>
  );
}
