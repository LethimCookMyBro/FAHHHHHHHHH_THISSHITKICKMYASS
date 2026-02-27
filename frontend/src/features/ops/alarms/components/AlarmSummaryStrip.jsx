import { AlertTriangle, CheckCircle2, Siren, Wrench } from "lucide-react";
import { MetricTile } from "../../../../components/ui";
import { useT } from "../../../../utils/i18n";

export default function AlarmSummaryStrip({ counts }) {
  const { t } = useT();

  return (
    <div className="ops-alarms-summary-grid">
      <MetricTile
        icon={Siren}
        label={t("alarms.activeIncidents")}
        value={counts.active}
        hint={t("alarms.openAlerts")}
        tone={counts.active > 0 ? "error" : "info"}
        actionHint={t("alarms.prioritizeCritical")}
      />
      <MetricTile
        icon={AlertTriangle}
        label={t("alarms.critical")}
        value={counts.critical}
        hint={t("alarms.highRisk")}
        tone={counts.critical > 0 ? "error" : "warning"}
        actionHint={
          counts.critical > 0
            ? t("alarms.dispatchResponse")
            : t("alarms.noCritical")
        }
      />
      <MetricTile
        icon={Wrench}
        label={t("alarms.acknowledged")}
        value={counts.acknowledged}
        hint={t("alarms.awaitingIntervention")}
        tone="warning"
        actionHint={t("alarms.trackCompletion")}
      />
      <MetricTile
        icon={CheckCircle2}
        label={t("alarms.resolved")}
        value={counts.resolved}
        hint={t("alarms.closedIncidents")}
        tone="success"
        actionHint={t("alarms.reviewTrend")}
      />
    </div>
  );
}
