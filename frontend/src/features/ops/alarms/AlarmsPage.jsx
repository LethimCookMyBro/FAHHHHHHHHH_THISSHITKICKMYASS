import { ShieldAlert, Wifi, Bell, ChevronDown } from "lucide-react";
import { EmptyState, InlineAlert, SkeletonCard } from "../../../components/ui";
import { useT } from "../../../utils/i18n";
import useAlarmsViewModel from "./hooks/useAlarmsViewModel";
import IncidentQueue from "./components/IncidentQueue";
import DecisionPanel from "./components/DecisionPanel";

const CONNECTION_LABELS = {
  live: "common.liveStream",
  reconnecting: "sidebar.reconnecting",
  rest: "sidebar.restFallback",
  connecting: "sidebar.connecting",
};

export default function AlarmsPage() {
  const { t } = useT();
  const {
    connectionState,
    loading,
    error,
    statusFilter,
    setStatusFilter,
    searchQuery,
    setSearchQuery,
    incidentRows,
    selectedAlarm,
    setSelectedAlarmId,
    selectedDiagnosis,
    selectedPlan,
    primaryAction,
    triggerPrimaryAction,
    isPrimaryBusy,
    acknowledgeSelectedAlarm,
    ignoreSelectedAlarm,
    isAcknowledgeBusy,
  } = useAlarmsViewModel();

  const connectionLabel = t(
    CONNECTION_LABELS[connectionState] || CONNECTION_LABELS.connecting,
  );

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative bg-[color:var(--background-dark)] h-full">
      {/* Custom Header */}
      <header className="h-20 flex items-center justify-between px-8 border-b border-slate-800 bg-[color:var(--surface-dark)]/95 backdrop-blur-sm z-10 sticky top-0 shrink-0">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-white tracking-tight">
              Alarm Control Center
            </h2>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[color:var(--primary)]/20 text-[color:var(--primary)] border border-[color:var(--primary)]/30 uppercase">
              Variant 2.0
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-0.5">
            Real-time anomaly detection &amp; autonomous diagnostics
          </p>
        </div>
        <div className="flex items-center gap-4 hidden md:flex">
          <div className="px-4 py-2 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold flex items-center gap-2.5 shadow-[0_0_10px_rgba(16,185,129,0.1)]">
            <span
              className={`w-2 h-2 rounded-full ${connectionState === "live" ? "bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]" : "bg-slate-500"}`}
            ></span>
            {connectionLabel}
          </div>
          <div className="h-8 w-px bg-slate-700 mx-2"></div>
          <button className="p-2.5 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors relative">
            <Bell size={20} />
            {incidentRows.length > 0 && (
              <span className="absolute top-2 right-2.5 w-2 h-2 rounded-full bg-red-500 border border-slate-800"></span>
            )}
          </button>
        </div>
      </header>

      {error && (
        <div className="px-6 pt-4 shrink-0">
          <InlineAlert message={error} tone="error" />
        </div>
      )}

      {/* Main Content Grid */}
      <div className="flex-1 p-6 overflow-hidden flex flex-col lg:flex-row gap-6 relative min-h-0">
        <div
          className="absolute inset-0 z-0 pointer-events-none opacity-[0.03]"
          style={{
            backgroundImage: "radial-gradient(#60a5fa 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        ></div>

        {loading ? (
          <div className="flex-1 flex gap-6 z-10">
            <div className="flex-1 lg:flex-[5] h-full">
              <SkeletonCard lines={6} />
            </div>
            <div className="flex-1 lg:flex-[7] h-full">
              <SkeletonCard lines={4} />
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 lg:flex-[5] flex flex-col gap-4 h-full min-w-0 z-10">
              <IncidentQueue
                incidents={incidentRows}
                selectedAlarm={selectedAlarm}
                onSelect={setSelectedAlarmId}
                statusFilter={statusFilter}
                onStatusFilterChange={setStatusFilter}
                searchQuery={searchQuery}
                onSearchQueryChange={setSearchQuery}
              />
            </div>

            <div className="flex-1 lg:flex-[7] h-full flex flex-col z-10 min-w-0">
              <DecisionPanel
                selectedAlarm={selectedAlarm}
                diagnosis={selectedDiagnosis}
                plan={selectedPlan}
                primaryAction={primaryAction}
                onPrimaryAction={triggerPrimaryAction}
                primaryBusy={isPrimaryBusy}
                onAcknowledge={acknowledgeSelectedAlarm}
                acknowledgeBusy={isAcknowledgeBusy}
                onIgnore={ignoreSelectedAlarm}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
