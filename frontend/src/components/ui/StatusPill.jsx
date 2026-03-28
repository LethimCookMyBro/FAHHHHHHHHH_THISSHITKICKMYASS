import { useT } from "../../utils/i18n";

const STATUS_LABEL = {
  running: "status.running",
  idle: "status.idle",
  warning: "status.warning",
  error: "status.error",
  critical: "status.critical",
  stopped: "status.stopped",
  active: "status.active",
  acknowledged: "status.acknowledged",
  resolved: "status.resolved",
  planned: "status.planned",
  simulated: "status.simulated",
  executed: "status.executed",
  failed: "status.failed",
  requires_manual: "status.requiresManual",
  diagnosed: "status.diagnosed",
};

export default function StatusPill({ status = "idle", label = "", size = "md" }) {
  const { t } = useT();
  const normalized = String(status || "idle").toLowerCase();
  const text = label || t(STATUS_LABEL[normalized] || normalized);
  return <span className={`ops-status-pill ops-status-${normalized} ops-status-${size}`}>{text}</span>;
}
