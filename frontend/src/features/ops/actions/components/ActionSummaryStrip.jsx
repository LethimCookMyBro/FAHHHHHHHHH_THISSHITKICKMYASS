import {
  CheckCircle2,
  ClipboardList,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { useT } from "../../../../utils/i18n";

const STATS_CONFIG = [
  {
    key: "total",
    icon: ClipboardList,
    color: "var(--primary)",
    tLabel: "actions.totalActions",
  },
  {
    key: "executed",
    icon: CheckCircle2,
    color: "var(--neon-green)",
    tLabel: "actions.executed",
  },
  {
    key: "failed",
    icon: XCircle,
    color: "var(--neon-red)",
    tLabel: "actions.failed",
  },
  {
    key: "manual",
    icon: ShieldAlert,
    color: "var(--neon-amber)",
    tLabel: "actions.manualRequired",
  },
];

export default function ActionSummaryStrip({ stats }) {
  const { t } = useT();

  return (
    <div className="action-stats-grid">
      {STATS_CONFIG.map(({ key, icon: Icon, color, tLabel }) => (
        <div key={key} className="action-stat-card">
          <div className="action-stat-icon" style={{ color }}>
            <Icon size={18} />
          </div>
          <div className="action-stat-content">
            <span className="action-stat-label">{t(tLabel)}</span>
            <span className="action-stat-value" style={{ color }}>
              {stats[key] ?? 0}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
