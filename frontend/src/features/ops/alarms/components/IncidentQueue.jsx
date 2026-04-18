import {
  Check,
  Clock,
  Eye,
  Filter,
  ShieldAlert,
  Thermometer,
  Radio,
  Cpu,
  Wrench,
} from "lucide-react";
import { EmptyState } from "../../../../components/ui";
import { useT } from "../../../../utils/i18n";

const SEVERITY_CONFIG = {
  critical: {
    className: "is-critical",
    icon: ShieldAlert,
  },
  warning: {
    className: "is-warning",
    icon: Thermometer,
  },
  info: {
    className: "is-info",
    icon: Radio,
  },
};

const FILTERS = [
  { key: "active", label: "alarms.filterActive" },
  { key: "acknowledged", label: "alarms.filterAcknowledged" },
  { key: "resolved", label: "alarms.filterResolved" },
  { key: "all", label: "alarms.filterAll" },
];

const CATEGORY_ICONS = {
  communication: Radio,
  software: Cpu,
  hardware: Wrench,
};

export default function IncidentQueue({
  incidents,
  selectedAlarm,
  onSelect,
  statusFilter,
  onStatusFilterChange,
  onAcknowledge,
  onOpenChat,
}) {
  const { t } = useT();

  return (
    <section className={`alarms-panel ${incidents.length === 0 ? "is-empty" : ""}`.trim()}>
      <header className="alarms-panel-head">
        <div>
          <h3>{t("alarms.incidentQueue")}</h3>
          <p>{t("alarms.incidentCount", { count: incidents.length })}</p>
        </div>
        <span className="alarms-queue-count">{incidents.length}</span>
      </header>

      <div className="alarms-filter-row">
        <Filter size={14} />
        {FILTERS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`alarms-filter-chip ${statusFilter === item.key ? "is-active" : ""}`}
            onClick={() => onStatusFilterChange(item.key)}
          >
            {t(item.label)}
          </button>
        ))}
      </div>

      <div className={`alarms-queue-scroll ${incidents.length === 0 ? "is-empty" : ""}`.trim()}>
        {incidents.length === 0 ? (
          <EmptyState
            compact
            title={t("alarms.noInQueue")}
            message={t("alarms.adjustFilters")}
          />
        ) : (
          incidents.map((alarm, index) => {
            const isSelected = selectedAlarm?.id === alarm.id;
            const severity =
              SEVERITY_CONFIG[alarm.severity] || SEVERITY_CONFIG.info;
            const SevIcon = severity.icon;
            const CategoryIcon =
              CATEGORY_ICONS[String(alarm.category || "").toLowerCase()] ||
              SevIcon;

            return (
              <article
                key={alarm.id}
                className={`incident-card ${severity.className} ${isSelected ? "is-selected" : ""}`}
                style={{ "--incident-delay": `${index * 0.04}s` }}
                onClick={() => onSelect(alarm.id)}
              >
                <div className="incident-card-head">
                  <div className="incident-head-main">
                    <span className="incident-severity-icon">
                      <CategoryIcon size={16} />
                    </span>
                    <div className="incident-main-copy">
                      <p className="incident-machine-name">
                        {alarm.machine_name || t("alarms.unknownMachine")}
                      </p>
                      <h4>{alarm.error_code || "UNKNOWN"}</h4>
                    </div>
                  </div>
                  <span className="incident-severity-badge">
                    {t(`status.${alarm.severity || "info"}`)}
                  </span>
                </div>

                <p className="incident-message">
                  {alarm.message || t("alarms.noMessage")}
                </p>

                <div className="incident-meta-row">
                  <span>
                    <Clock size={12} /> {alarm.createdText}
                  </span>
                  <span>{alarm.category || t("common.unknown")}</span>
                  <span>{t(`status.${alarm.status || "active"}`)}</span>
                </div>

                <div className="incident-actions">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(alarm.id);
                    }}
                  >
                    <Eye size={13} /> {t("alarms.review")}
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onAcknowledge?.(alarm);
                    }}
                  >
                    <Check size={13} /> {t("alarms.ackShort")}
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenChat?.(alarm);
                    }}
                  >
                    {t("alarms.diagnoseShort")}
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
