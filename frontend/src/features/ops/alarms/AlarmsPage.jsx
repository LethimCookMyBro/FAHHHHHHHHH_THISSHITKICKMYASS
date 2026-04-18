import { Download, PlayCircle, RefreshCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { InlineAlert, SkeletonCard } from "../../../components/ui";
import { useT } from "../../../utils/i18n";
import useAlarmsViewModel from "./hooks/useAlarmsViewModel";
import IncidentQueue from "./components/IncidentQueue";
import DecisionPanel from "./components/DecisionPanel";
import { useConfigureTopbar } from "../../../layout/AppTopbarContext";
import { downloadCsv } from "../../../utils/exporters";
import useConnectionLabel from "../../../hooks/useConnectionLabel";
import {
  buildZoneRouteSearch,
  resolveZoneIdForMachine,
} from "../port-map/zoneModel";
import { buildMockZoneChatUrl } from "../mockZoneChat";
import "./styles/alarms.css";

export default function AlarmsPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [pendingChatAlarmId, setPendingChatAlarmId] = useState(null);
  const {
    connectionState,
    alarms,
    loading,
    error,
    counts,
    statusFilter,
    setStatusFilter,
    searchQuery,
    setSearchQuery,
    incidentRows,
    selectedAlarm,
    setSelectedAlarmId,
    selectedDiagnosis,
    selectedPlan,
    selectedResult,
    primaryAction,
    triggerPrimaryAction,
    isPrimaryBusy,
    acknowledgeAlarm,
    acknowledgeSelectedAlarm,
    ignoreSelectedAlarm,
    isAcknowledgeBusy,
    refresh,
  } = useAlarmsViewModel();

  const { label: connectionLabel, tone: connectionTone } = useConnectionLabel(connectionState);
  const isEmptyIncidentState = incidentRows.length === 0 && !selectedAlarm;

  useEffect(() => {
    const requestedStatus = searchParams.get("status");
    if (requestedStatus && requestedStatus !== statusFilter) {
      setStatusFilter(requestedStatus);
    }
  }, [searchParams, setStatusFilter, statusFilter]);

  useEffect(() => {
    const requestedZoneId = searchParams.get("zoneId");
    const requestedMachineId = searchParams.get("machineId");
    const requestedMachineName = searchParams.get("machineName");
    const requestedErrorCode = searchParams.get("errorCode");

    if (
      !requestedZoneId &&
      !requestedMachineId &&
      !requestedMachineName &&
      !requestedErrorCode
    ) {
      return;
    }

    const requestedAlarm =
      alarms.find((alarm) => {
        if (
          requestedZoneId &&
          resolveZoneIdForMachine(alarm) !== requestedZoneId
        ) {
          return false;
        }

        if (
          requestedMachineId &&
          String(alarm.machine_id ?? alarm.id ?? "") !== String(requestedMachineId)
        ) {
          return false;
        }

        if (
          requestedMachineName &&
          String(alarm.machine_name || "").trim() !== String(requestedMachineName).trim()
        ) {
          return false;
        }

        if (
          requestedErrorCode &&
          String(alarm.error_code || "").trim() !== String(requestedErrorCode).trim()
        ) {
          return false;
        }

        return true;
      }) || null;

    if (!requestedAlarm) {
      return;
    }

    if (statusFilter !== "all" && statusFilter !== requestedAlarm.status) {
      setStatusFilter(requestedAlarm.status);
      return;
    }

    if (selectedAlarm?.id !== requestedAlarm.id) {
      setSelectedAlarmId(requestedAlarm.id);
    }
  }, [
    alarms,
    searchParams,
    selectedAlarm?.id,
    setSelectedAlarmId,
    setStatusFilter,
    statusFilter,
  ]);

  const openAlarmInChat = (alarm) => {
    if (!alarm) return;
    if (pendingChatAlarmId === alarm.id) return;
    setPendingChatAlarmId(alarm.id);
    navigate(buildMockZoneChatUrl(alarm, "alarms"));
  };

  const openAlarmInMap = (alarm) => {
    if (!alarm) return;
    navigate(`/overview?${buildZoneRouteSearch(alarm)}`);
  };

  const exportCurrentView = () => {
    downloadCsv(
      `incidents_${new Date().toISOString().slice(0, 10)}`,
      incidentRows.map((row) => ({
        id: row.id,
        code: row.error_code,
        machine: row.machine_name,
        message: row.message,
        severity: row.severity,
        status: row.status,
        category: row.category,
        created: row.createdText,
      })),
    );
  };

  useConfigureTopbar(
    {
      title: "",
      subtitle: "",
      search: {
        enabled: true,
        placeholder: t("alarms.searchPlaceholder"),
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
    [
      connectionLabel,
      connectionState,
      searchQuery,
      selectedAlarm,
      setSearchQuery,
      t,
    ],
  );

  return (
    <div className="ops-page ops-alarms-page ops-page-enter">
      <InlineAlert message={error} tone="error" />

      <section className="ops-page-header">
        <div>
          <h1 className="ops-page-title">{t("alarms.title")}</h1>
          <p className="ops-page-subtitle">{t("alarms.subtitle")}</p>
        </div>

        <div className="ops-page-actions">
          <button type="button" className="app-topbar-btn secondary" onClick={exportCurrentView}>
            <Download size={16} />
            {t("topbar.exportView")}
          </button>
          <button
            type="button"
            className="app-topbar-btn primary"
            onClick={triggerPrimaryAction}
            disabled={
              primaryAction.disabled ||
              isPrimaryBusy ||
              !selectedAlarm ||
              primaryAction.kind === "none"
            }
          >
            <PlayCircle size={16} />
            {isPrimaryBusy ? t("common.loading") : primaryAction.label}
          </button>
        </div>
      </section>

      <div className="alarms-summary-strip">
        <div className="alarms-summary-item">
          <span>{t("alarms.active")}</span>
          <strong>{counts.active}</strong>
        </div>
        <div className="alarms-summary-item tone-critical">
          <span>{t("alarms.critical")}</span>
          <strong className="is-critical">{counts.critical}</strong>
        </div>
        <div className="alarms-summary-item tone-info">
          <span>{t("alarms.acknowledged")}</span>
          <strong>{counts.acknowledged}</strong>
        </div>
        <div className="alarms-summary-item tone-ok">
          <span>{t("alarms.resolved")}</span>
          <strong>{counts.resolved}</strong>
        </div>
        <button type="button" className="alarms-refresh-btn" onClick={refresh}>
          <RefreshCcw size={14} />
          {t("alarms.refreshQueue")}
        </button>
      </div>

      <div className="alarms-status-line">
        <span>
          {t("alarms.requireImmediateAction", {
            critical: counts.critical,
            total: incidentRows.length || counts.active || 0,
          })}
        </span>
        <span>
          {t("alarms.oldestUnacknowledged", {
            time:
              incidentRows.find((item) => item.status === "active")?.createdText ||
              t("common.na"),
          })}
        </span>
      </div>

      {loading ? (
        <div className="ops-alarms-grid">
          <SkeletonCard lines={7} />
          <SkeletonCard lines={6} />
        </div>
      ) : (
        <div className={`ops-alarms-grid ${isEmptyIncidentState ? "is-empty-state" : ""}`.trim()}>
          <IncidentQueue
            incidents={incidentRows}
            selectedAlarm={selectedAlarm}
            onSelect={setSelectedAlarmId}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            onAcknowledge={acknowledgeAlarm}
            onOpenChat={openAlarmInChat}
          />

          <DecisionPanel
            selectedAlarm={selectedAlarm}
            diagnosis={selectedDiagnosis}
            plan={selectedPlan}
            result={selectedResult}
            primaryAction={primaryAction}
            onPrimaryAction={triggerPrimaryAction}
            primaryBusy={isPrimaryBusy}
            onAcknowledge={acknowledgeSelectedAlarm}
            acknowledgeBusy={isAcknowledgeBusy}
            onIgnore={ignoreSelectedAlarm}
            onOpenChat={openAlarmInChat}
            onOpenMap={openAlarmInMap}
          />
        </div>
      )}
    </div>
  );
}
