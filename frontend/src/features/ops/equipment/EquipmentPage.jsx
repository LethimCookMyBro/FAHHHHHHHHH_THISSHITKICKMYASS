import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useT } from "../../../utils/i18n";
import { useConfigureTopbar } from "../../../layout/AppTopbarContext";
import useConnectionLabel from "../../../hooks/useConnectionLabel";
import {
  Activity,
  Clock,
  Cpu,
  FileText,
  MessageSquare,
  Server,
  Wrench,
} from "lucide-react";
import useAgentAction from "../../../hooks/useAgentAction";
import { downloadText } from "../../../utils/exporters";
import { useOpsSyncContext } from "../OpsSyncContext";
import { resolveMachineState } from "../dashboard/helpers";
import DiagnosticPanel from "./components/DiagnosticPanel";
import SafetyConfirmDialog from "./components/SafetyConfirmDialog";
import "./styles/equipment.css";

const STATUS_BADGES = {
  fault: { className: "fault", labelKey: "status.fault" },
  ok: { className: "ok", labelKey: "status.ok" },
  warning: { className: "warning", labelKey: "status.warning" },
};

const FILTER_TABS = ["all", "fault", "warning", "ok"];

const clampPercent = (value) =>
  Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

const toEquipmentStatus = (machineState) => {
  if (machineState === "error") {
    return "fault";
  }
  if (machineState === "warning") {
    return "warning";
  }
  return "ok";
};

const formatRuntimeLabel = (machine) => {
  if (machine?.uptime) {
    return machine.uptime;
  }

  if (machine?.last_heartbeat) {
    const time = new Date(machine.last_heartbeat);
    if (!Number.isNaN(time.getTime())) {
      return `HB ${time.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    }
  }

  return "Live";
};

const getEquipmentNote = (status, t) => {
  if (status === "fault") {
    return t("equipment.noteFault");
  }
  if (status === "warning") {
    return t("equipment.noteWarning");
  }
  return t("equipment.noteOk");
};

const buildActionLogUrl = (equipment) => {
  const params = new URLSearchParams();
  const query = equipment?.errorCode || equipment?.name || equipment?.id;
  if (query) {
    params.set("q", query);
  }
  return `/actions${params.toString() ? `?${params.toString()}` : ""}`;
};

export default function EquipmentPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const { connectionState, machines, alarms } = useOpsSyncContext();
  const { label: connectionLabel, tone: connectionTone } =
    useConnectionLabel(connectionState);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [activeEq, setActiveEq] = useState(null);
  const [isDiagnosticOpen, setIsDiagnosticOpen] = useState(false);
  const [isSafetyOpen, setIsSafetyOpen] = useState(false);

  const {
    execute: startDiagnose,
    reset: resetDiagnose,
    state: diagState,
    data: diagData,
    partialText: diagPartial,
  } = useAgentAction({
    deviceId: activeEq?.id,
    actionName: "diagnose",
  });

  const {
    requestConfirm: promptForReset,
    execute: startReset,
    reset: resetResetFlow,
    state: resetState,
    progress: resetProgress,
    data: resetData,
  } = useAgentAction({
    deviceId: activeEq?.id,
    actionName: "reset_fault",
  });

  const handleDiagnose = (equipment) => {
    setActiveEq(equipment);
    if (diagState !== "idle") {
      resetDiagnose();
    }
    setIsDiagnosticOpen(true);
    startDiagnose({ timestamp: new Date().toISOString() });
  };

  const handleReset = (equipment) => {
    setActiveEq(equipment);
    if (resetState !== "idle") {
      resetResetFlow();
    }
    promptForReset();
    setIsSafetyOpen(true);
  };

  const executeResetConfirmed = (mode) => {
    setIsSafetyOpen(false);
    startReset({}, mode);
  };

  const handleCancelReset = () => {
    setIsSafetyOpen(false);
    if (resetState !== "idle") {
      resetResetFlow();
    }
  };

  const handleAskChatbot = (equipment) => {
    const params = new URLSearchParams({
      machineId: equipment.id,
      machineName: equipment.name,
      errorCode: equipment.errorCode || equipment.status.toUpperCase(),
    });
    navigate(`/chat?${params.toString()}`);
  };

  const handleOpenLog = (equipment) => {
    navigate(buildActionLogUrl(equipment));
  };

  const handleExportDiagnosticReport = () => {
    if (!activeEq || !diagData) return;

    const evidenceLines = Array.isArray(diagData.evidence)
      ? diagData.evidence.map(
          (item) =>
            `- ${item.timestamp || t("diagnostic.na")} | ${item.log || t("diagnostic.noLog")} | ${t("diagnostic.weight")} ${item.weight ?? "-"}`,
        )
      : [];
    const remediationLines = Array.isArray(diagData.remediationSteps)
      ? diagData.remediationSteps.map((step, index) => `${index + 1}. ${step}`)
      : [];

    const report = [
      `${t("diagnostic.exportTitle")}: ${activeEq.name}`,
      `${t("diagnostic.assetId")}: ${activeEq.id}`,
      `${t("diagnostic.status")}: ${activeEq.status}`,
      `${t("diagnostic.confidence")}: ${diagData.confidence ?? "-"}%`,
      `${t("diagnostic.severity")}: ${diagData.severityLevel || "-"}`,
      `${t("diagnostic.estimatedRepair")}: ${diagData.estimatedTimeToRepair || "-"}`,
      "",
      t("diagnostic.rootCause"),
      diagData.rootCause || t("diagnostic.noRootCause"),
      "",
      t("diagnostic.evidence"),
      ...(evidenceLines.length ? evidenceLines : [`- ${t("diagnostic.noEvidence")}`]),
      "",
      t("diagnostic.recommendedSteps"),
      ...(remediationLines.length
        ? remediationLines
        : [`- ${t("diagnostic.noRemediationSteps")}`]),
    ].join("\n");

    downloadText(
      `diagnostic_${activeEq.id || activeEq.name || "asset"}`,
      report,
    );
  };

  const equipmentRows = useMemo(
    () =>
      machines.map((machine, index) => {
        const machineState = machine.machineState || resolveMachineState(machine);
        const machineAlarms = alarms.filter((alarm) => {
          const status = String(alarm.status || "active").toLowerCase();
          if (status === "resolved") {
            return false;
          }

          if (
            machine.id != null &&
            alarm.machine_id != null &&
            String(alarm.machine_id) === String(machine.id)
          ) {
            return true;
          }

          return (
            String(alarm.machine_name || "").trim() ===
            String(machine.name || "").trim()
          );
        });
        const leadAlarm =
          machineAlarms.find(
            (alarm) => String(alarm.status || "active").toLowerCase() === "active",
          ) ||
          machineAlarms[0] ||
          null;

        return {
          id: machine.id ?? `machine-${index}`,
          name: machine.name || t("alarms.unknownMachine"),
          status: toEquipmentStatus(machineState),
          firmware: machine.model || machine.plc_type || "Unknown",
          runtime: formatRuntimeLabel(machine),
          cpuLoad: clampPercent((Number(machine.current) || 0) * 6.5),
          memoryUsage: clampPercent(((Number(machine.temp) || 0) / 90) * 100),
          alarms: machineAlarms.filter(
            (alarm) => String(alarm.status || "active").toLowerCase() === "active",
          ).length,
          errorCode:
            leadAlarm?.error_code || machine.error_code || machine.active_error?.error_code || "",
        };
      }),
    [alarms, machines, t],
  );

  useConfigureTopbar(
    {
      title: "",
      subtitle: "",
      search: {
        enabled: true,
        placeholder: t("equipment.searchPlaceholder"),
        value: searchQuery,
        onChange: setSearchQuery,
      },
      statusPill: {
        label: connectionLabel,
        tone: connectionTone,
      },
      secondaryAction: null,
      primaryAction: null,
    },
    [connectionLabel, connectionTone, searchQuery, t],
  );

  const filteredEquipment = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return equipmentRows.filter((equipment) => {
      const matchesStatus =
        statusFilter === "all" ? true : equipment.status === statusFilter;
      const matchesQuery = query
        ? [
            equipment.name,
            equipment.id,
            equipment.firmware,
            equipment.status,
            equipment.errorCode,
          ]
            .join(" ")
            .toLowerCase()
            .includes(query)
        : true;
      return matchesStatus && matchesQuery;
    });
  }, [equipmentRows, searchQuery, statusFilter]);

  const fleetSummary = useMemo(
    () => [
      {
        label: t("equipment.fleetUnits"),
        value: equipmentRows.length,
        hint: t("equipment.controllersInView"),
      },
      {
        label: t("equipment.needsReview"),
        value: equipmentRows.filter(
          (item) => item.status === "fault" || item.status === "warning",
        ).length,
        hint: t("equipment.faultAndWarningAssets"),
      },
      {
        label: t("equipment.healthy"),
        value: equipmentRows.filter((item) => item.status === "ok").length,
        hint: t("equipment.stableOperation"),
      },
      {
        label: t("equipment.assistantReady"),
        value:
          equipmentRows.filter((item) => item.status !== "ok").length ||
          equipmentRows.length,
        hint: t("equipment.directActionsAvailable"),
      },
    ],
    [equipmentRows, t],
  );

  return (
    <div className="ops-page ops-equipment-page ops-page-enter">
      <section className="ops-page-header">
        <div>
          <h1 className="ops-page-title">{t("equipment.pageTitle")}</h1>
          <p className="ops-page-subtitle">
            {t("equipment.pageSubtitle")}
          </p>
        </div>
      </section>

      <div className="equipment-grid-container">
        <div className="equipment-overview-strip">
          {fleetSummary.map((item) => (
            <article key={item.label} className="equipment-summary-card">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <p>{item.hint}</p>
            </article>
          ))}
        </div>

        <div className="equipment-filter-bar">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              className={`equipment-filter-tab ${statusFilter === tab ? "is-active" : ""}`}
              onClick={() => setStatusFilter(tab)}
            >
              <span>
                {tab === "all"
                  ? t("common.all")
                  : t(STATUS_BADGES[tab]?.labelKey || `status.${tab}`)}
              </span>
              <strong>
                {tab === "all"
                  ? equipmentRows.length
                  : equipmentRows.filter((item) => item.status === tab).length}
              </strong>
            </button>
          ))}
        </div>

        <div className="equipment-card-grid">
          {filteredEquipment.map((equipment) => (
            <article
              key={equipment.id}
              className={`equipment-card status-${equipment.status}`}
            >
              <div className="equipment-card-top">
                <div className="equipment-card-identity">
                  <div className="equipment-card-kicker">
                    <span className="equipment-card-label">
                      {equipment.errorCode
                        ? t("equipment.leadCode")
                        : t("equipment.controller")}
                    </span>
                    <span
                      className={`status-badge ${STATUS_BADGES[equipment.status].className}`}
                    >
                      {t(STATUS_BADGES[equipment.status].labelKey)}
                    </span>
                  </div>
                  <h3>{equipment.name}</h3>
                  <p className="equipment-device-meta">
                    <span>{equipment.id}</span>
                    <span>{equipment.firmware}</span>
                  </p>
                </div>

                {equipment.alarms > 0 ? (
                  <span className="alarm-count">{equipment.alarms}</span>
                ) : null}
              </div>

              <div className="equipment-inline-stats">
                <div className="equipment-inline-stat">
                  <Clock size={14} />
                  <span>{t("equipment.runtime")}</span>
                  <strong>{equipment.runtime}</strong>
                </div>
                <div className="equipment-inline-stat">
                  <Activity size={14} />
                  <span>
                    {equipment.errorCode ? t("equipment.leadCode") : t("equipment.health")}
                  </span>
                  <strong>{equipment.errorCode || t("equipment.stable")}</strong>
                </div>
              </div>

              <div className="equipment-metric-grid">
                <div className="equipment-metric-card">
                  <div className="equipment-metric-head">
                    <Cpu size={14} />
                    <span>{t("equipment.cpu")}</span>
                    <strong>{equipment.cpuLoad}%</strong>
                  </div>
                  <div className="equipment-mini-bar">
                    <span style={{ width: `${equipment.cpuLoad}%` }} />
                  </div>
                </div>

                <div className="equipment-metric-card">
                  <div className="equipment-metric-head">
                    <Server size={14} />
                    <span>{t("equipment.mem")}</span>
                    <strong>{equipment.memoryUsage}%</strong>
                  </div>
                  <div className="equipment-mini-bar">
                    <span style={{ width: `${equipment.memoryUsage}%` }} />
                  </div>
                </div>
              </div>

              <p className="equipment-card-note">
                {getEquipmentNote(equipment.status, t)}
              </p>

              <div className="equipment-action-row">
                <button
                  type="button"
                  className="agent-btn primary"
                  onClick={() => handleDiagnose(equipment)}
                >
                  <Activity size={14} />
                  {t("equipment.diagnose")}
                </button>

                <button
                  type="button"
                  className="agent-btn secondary"
                  onClick={() => handleOpenLog(equipment)}
                >
                  <FileText size={14} />
                  {t("equipment.viewLog")}
                </button>

                <button
                  type="button"
                  className="agent-btn warning"
                  onClick={() => handleReset(equipment)}
                >
                  <Wrench size={14} />
                  {t("equipment.config")}
                </button>

                {equipment.status === "fault" || equipment.status === "warning" ? (
                  <button
                    type="button"
                    className="agent-btn chatbot"
                    onClick={() => handleAskChatbot(equipment)}
                  >
                    <MessageSquare size={14} />
                    {t("equipment.askAi")}
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </div>

      <DiagnosticPanel
        isOpen={isDiagnosticOpen}
        onClose={() => setIsDiagnosticOpen(false)}
        agentState={diagState}
        partialText={diagPartial}
        data={diagData}
        onExportReport={handleExportDiagnosticReport}
        onOpenActionLog={() => activeEq && handleOpenLog(activeEq)}
      />

      <SafetyConfirmDialog
        isOpen={isSafetyOpen}
        onCancel={handleCancelReset}
        onConfirm={executeResetConfirmed}
        equipment={activeEq}
        actionName={t("equipment.resetFault")}
      />

      {(resetState === "executing" ||
        resetState === "streaming" ||
        resetState === "completed") && (
        <div className="reset-overlay">
          <div className="reset-status-box">
            <Activity className="spinner-icon" size={24} />
            <h3>
              {resetState === "completed"
                ? t("equipment.executionComplete")
                : t("equipment.agentExecuting")}
            </h3>
            <p>{resetProgress.step}</p>
            {resetState === "completed" && resetData?.message && (
              <div className="success-msg">
                {resetData.message}
                <button
                  type="button"
                  onClick={() => {
                    if (resetState !== "idle") {
                      resetResetFlow();
                    }
                    setActiveEq(null);
                  }}
                >
                  {t("common.close")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
