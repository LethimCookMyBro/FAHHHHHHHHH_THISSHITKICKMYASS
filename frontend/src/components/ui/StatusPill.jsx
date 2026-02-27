const STATUS_LABEL = {
  running: "Running",
  idle: "Idle",
  warning: "Warning",
  error: "Error",
  critical: "Critical",
  stopped: "Stopped",
  active: "Active",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
  planned: "Planned",
  simulated: "Simulated",
  executed: "Executed",
  failed: "Failed",
  requires_manual: "Manual Required",
  diagnosed: "Diagnosed",
};

export default function StatusPill({ status = "idle", label = "", size = "md" }) {
  const normalized = String(status || "idle").toLowerCase();
  const text = label || STATUS_LABEL[normalized] || normalized;
  return <span className={`ops-status-pill ops-status-${normalized} ops-status-${size}`}>{text}</span>;
}
