import {
  Filter,
  ArrowUpDown,
  Clock,
  Eye,
  Check,
  Thermometer,
  ShieldAlert,
  Radio,
} from "lucide-react";
import { EmptyState } from "../../../../components/ui";
import { useT } from "../../../../utils/i18n";

const SEVERITY_CONFIG = {
  critical: {
    colorClass: "text-red-500",
    bgClass: "bg-red-500/10",
    borderClass: "border-red-500/20",
    leftBorderClass: "border-l-red-500",
    badgeClass: "text-red-400 bg-red-900/20 border-red-500/30",
    gradientClass: "from-red-500/5 group-hover:from-red-500/10",
    shadowClass: "shadow-[0_0_15px_rgba(239,68,68,0.15)]",
    hoverTextClass: "group-hover:text-red-400",
    icon: ShieldAlert,
  },
  warning: {
    colorClass: "text-yellow-500",
    bgClass: "bg-yellow-500/10",
    borderClass: "border-yellow-500/20",
    leftBorderClass: "border-l-yellow-500",
    badgeClass: "text-yellow-500 bg-yellow-900/20 border-yellow-500/30",
    gradientClass: "from-yellow-500/5 group-hover:from-yellow-500/10",
    shadowClass: "shadow-md",
    hoverTextClass: "group-hover:text-yellow-400",
    icon: Thermometer,
  },
  info: {
    colorClass: "text-slate-400",
    bgClass: "bg-slate-700/30",
    borderClass: "border-slate-700/50",
    leftBorderClass: "border-l-slate-600",
    badgeClass: "text-slate-400 bg-slate-800 border-slate-600",
    gradientClass: "from-slate-600/5 group-hover:from-slate-600/10",
    shadowClass: "shadow-md",
    hoverTextClass: "group-hover:text-slate-300",
    icon: Radio,
  },
};

export default function IncidentQueue({
  incidents,
  selectedAlarm,
  onSelect,
  statusFilter,
  onStatusFilterChange,
  searchQuery,
  onSearchQueryChange,
}) {
  const { t } = useT();

  return (
    <div className="flex flex-col gap-4 h-full min-w-0 z-10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-slate-200">Active Incidents</h3>
          <span className="bg-slate-700 text-slate-300 px-2 py-0.5 rounded text-xs font-mono">
            {incidents.length}
          </span>
        </div>
        <div className="flex gap-2">
          <button className="p-1.5 text-slate-400 hover:text-[color:var(--primary)] transition-colors">
            <Filter size={18} />
          </button>
          <button className="p-1.5 text-slate-400 hover:text-[color:var(--primary)] transition-colors">
            <ArrowUpDown size={18} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 space-y-4 scrollbar-hide pb-4">
        {incidents.length === 0 ? (
          <EmptyState
            compact
            title={t("alarms.noInQueue")}
            message={t("alarms.adjustFilters")}
          />
        ) : (
          incidents.map((alarm) => {
            const isSelected = selectedAlarm?.id === alarm.id;
            const sev = SEVERITY_CONFIG[alarm.severity] || SEVERITY_CONFIG.info;
            const SevIcon = sev.icon;

            return (
              <div
                key={alarm.id}
                onClick={() => onSelect(alarm.id)}
                className={`group relative p-0 rounded-xl border-l-4 ${sev.leftBorderClass} border-y border-r border-slate-700/50 ${sev.shadowClass} hover:border-r-slate-600 transition-all cursor-pointer overflow-hidden ${isSelected ? "bg-slate-800" : "bg-[color:var(--surface-dark)] opacity-90 hover:opacity-100"}`}
              >
                <div
                  className={`absolute inset-0 bg-gradient-to-r ${sev.gradientClass} pointer-events-none transition-colors ${isSelected ? "opacity-100" : ""}`}
                ></div>

                <div className="p-4 flex gap-4 relative">
                  <div
                    className={`mt-1 w-10 h-10 rounded-lg ${sev.bgClass} border ${sev.borderClass} flex items-center justify-center ${sev.colorClass} flex-shrink-0 ${isSelected ? sev.shadowClass : ""}`}
                  >
                    <SevIcon size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-1 gap-2">
                      <h4
                        className={`font-semibold text-slate-200 ${sev.hoverTextClass} transition-colors truncate`}
                      >
                        {alarm.error_code || "UNKNOWN"}
                      </h4>
                      <span
                        className={`text-[10px] font-mono px-2 py-1 rounded border uppercase tracking-wider whitespace-nowrap ${sev.badgeClass}`}
                      >
                        {alarm.severity || "info"}
                      </span>
                    </div>

                    <div className="text-xs text-slate-400 mb-3 font-mono flex items-center gap-2">
                      <Clock size={14} /> {alarm.createdText}
                      <span className="w-1 h-1 bg-slate-600 rounded-full"></span>
                      <span className="truncate">
                        {alarm.machine_name || t("alarms.unknownMachine")}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs text-slate-500 font-mono bg-[color:var(--background-dark)] opacity-80 p-2 rounded border border-slate-800">
                      <span className="truncate max-w-[70%]">
                        {alarm.message || t("alarms.noMessage")}
                      </span>
                      <span className="text-slate-300 ml-2 shrink-0">
                        {alarm.category || t("common.unknown")}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-800/40 border-t border-slate-700/50 px-4 py-2 flex justify-end gap-2 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                  <button className="text-xs text-slate-400 hover:text-white flex items-center gap-1 px-2 py-1 hover:bg-slate-700/50 rounded transition-colors">
                    <Eye size={14} /> View
                  </button>
                  <button
                    className="text-xs text-slate-400 hover:text-white flex items-center gap-1 px-2 py-1 hover:bg-slate-700/50 rounded transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Check size={14} /> Ack
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
