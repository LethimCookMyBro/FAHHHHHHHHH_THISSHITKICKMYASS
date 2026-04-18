import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Bot, Radar, Sparkles } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { InlineAlert } from "../../../components/ui";
import { useConfigureTopbar } from "../../../layout/AppTopbarContext";
import useConnectionLabel from "../../../hooks/useConnectionLabel";
import useAgentAction from "../../../hooks/useAgentAction";
import { useT } from "../../../utils/i18n";
import { APP_ROUTES, buildPathWithSearch } from "../../../utils/routes";
import { useOpsSyncMeta, useOpsSyncZones } from "../OpsSyncContext";
import { buildMockZoneChatUrl } from "../mockZoneChat";
import ZoneSummaryPanel from "./components/ZoneSummaryPanel";
import {
  buildZoneChatInput,
  buildZonePanelSearch,
  clearZonePanelSearch,
  getZoneIdFromSearch,
} from "./zonePanelState";
import "./styles/port-map.css";

const BUSY_AGENT_STATES = new Set(["confirming", "executing", "streaming"]);

const getZoneDisplayName = (zone) => `${zone.name} / ${zone.title}`;

const getZoneLeadIncident = (zone) =>
  zone?.alarms.find((alarm) => String(alarm?.status || "active").toLowerCase() === "active") ||
  zone?.alarms[0] ||
  null;

const buildAlarmCenterSearch = (zone, search = "") => {
  const params = new URLSearchParams();
  const chatInput = buildZoneChatInput(zone, search);
  const leadAlarm = getZoneLeadIncident(zone);

  params.set("status", zone?.activeIncidentCount > 0 ? "active" : "all");

  if (zone?.id) {
    params.set("zoneId", zone.id);
  }

  const machineId =
    chatInput?.machineId || leadAlarm?.machine_id || leadAlarm?.id || "";
  const machineName =
    chatInput?.machineName || leadAlarm?.machine_name || leadAlarm?.name || "";
  const errorCode = chatInput?.errorCode || leadAlarm?.error_code || "";

  if (machineId) {
    params.set("machineId", String(machineId));
  }
  if (machineName) {
    params.set("machineName", String(machineName));
  }
  if (errorCode) {
    params.set("errorCode", String(errorCode));
  }

  return params.toString();
};

export default function PortMapPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    connectionState,
    error,
    liveError,
  } = useOpsSyncMeta();
  const { zoneSummaries } = useOpsSyncZones();
  const { label: connectionLabel, tone: connectionTone } =
    useConnectionLabel(connectionState);

  const [hoveredZoneId, setHoveredZoneId] = useState(null);
  const [activeZoneId, setActiveZoneId] = useState(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [pendingChatZoneId, setPendingChatZoneId] = useState("");
  const pendingChatResetRef = useRef(null);
  const startedSummaryKeyRef = useRef("");

  const {
    state: summaryState,
    data: summaryData,
    partialText: summaryPartial,
    execute: executeSummary,
    cancel: cancelSummary,
    reset: resetSummary,
  } = useAgentAction({
    deviceId: activeZoneId || "facility-map",
    actionName: "summarize_zone",
  });

  const activeZone = useMemo(
    () => zoneSummaries.find((zone) => zone.id === activeZoneId) || null,
    [activeZoneId, zoneSummaries],
  );

  const hoveredZone = useMemo(
    () => zoneSummaries.find((zone) => zone.id === hoveredZoneId) || null,
    [hoveredZoneId, zoneSummaries],
  );

  const activeZoneChatInput = useMemo(
    () => buildZoneChatInput(activeZone, searchParams.toString()),
    [activeZone, searchParams],
  );

  const summaryRequest = useMemo(() => {
    if (!isPanelOpen || !activeZone) {
      return null;
    }

    const machineId = activeZoneChatInput?.machineId || "";
    const machineName = activeZoneChatInput?.machineName || "";
    const errorCode = activeZoneChatInput?.errorCode || "";

    return {
      key: [
        activeZone.id,
        machineId,
        machineName,
        errorCode,
        activeZone.activeIncidentCount,
        activeZone.criticalCount,
      ].join("::"),
      payload: {
        zoneId: activeZone.id,
        zoneName: activeZone.name,
        zoneTitle: activeZone.title,
        machineId,
        machineName,
        errorCode,
        activeIncidentCount: activeZone.activeIncidentCount,
        criticalCount: activeZone.criticalCount,
      },
    };
  }, [activeZone, activeZoneChatInput, isPanelOpen]);

  useConfigureTopbar(
    {
      title: "",
      subtitle: "",
      statusPill: { label: connectionLabel, tone: connectionTone },
      secondaryAction: null,
      primaryAction: null,
    },
    [connectionLabel, connectionTone],
  );

  useEffect(() => {
    const zoneIdFromQuery = getZoneIdFromSearch(searchParams.toString());
    if (!zoneIdFromQuery) {
      setActiveZoneId(null);
      setIsPanelOpen(false);
      return;
    }

    const match = zoneSummaries.find((zone) => zone.id === zoneIdFromQuery);
    if (!match) {
      setActiveZoneId(null);
      setIsPanelOpen(false);
      return;
    }

    setActiveZoneId(match.id);
    setIsPanelOpen(true);
  }, [searchParams, zoneSummaries]);

  useEffect(() => {
    return () => {
      if (pendingChatResetRef.current) {
        clearTimeout(pendingChatResetRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!summaryRequest) {
      startedSummaryKeyRef.current = "";
      if (BUSY_AGENT_STATES.has(summaryState)) {
        cancelSummary();
        return;
      }
      if (summaryState !== "idle") {
        resetSummary();
      }
      return;
    }

    if (startedSummaryKeyRef.current === summaryRequest.key) {
      return;
    }

    if (BUSY_AGENT_STATES.has(summaryState)) {
      cancelSummary();
      return;
    }

    if (summaryState !== "idle") {
      resetSummary();
      return;
    }

    startedSummaryKeyRef.current = summaryRequest.key;
    executeSummary(summaryRequest.payload);
  }, [
    cancelSummary,
    executeSummary,
    resetSummary,
    summaryRequest,
    summaryState,
  ]);

  const handleZoneSelect = (zone) => {
    if (!zone) return;

    setActiveZoneId(zone.id);
    setIsPanelOpen(true);
    setPendingChatZoneId("");

    const nextSearch = buildZonePanelSearch(searchParams.toString(), zone.id);
    setSearchParams(nextSearch, {
      replace: getZoneIdFromSearch(searchParams.toString()) === zone.id,
    });
  };

  const handleOpenZoneChat = (zone) => {
    if (!zone || pendingChatZoneId) return;

    setPendingChatZoneId(zone.id);

    if (pendingChatResetRef.current) {
      clearTimeout(pendingChatResetRef.current);
    }

    pendingChatResetRef.current = setTimeout(() => {
      setPendingChatZoneId("");
      pendingChatResetRef.current = null;
    }, 1500);

    navigate(
      buildMockZoneChatUrl(
        buildZoneChatInput(zone, searchParams.toString()),
        "portmap",
      ),
    );
  };

  const handleOpenAlarmCenter = (zone) => {
    if (!zone) return;
    navigate(
      buildPathWithSearch(
        APP_ROUTES.alarms,
        buildAlarmCenterSearch(zone, searchParams.toString()),
      ),
    );
  };

  const handleClosePanel = () => {
    setPendingChatZoneId("");
    setActiveZoneId(null);
    setIsPanelOpen(false);
    startedSummaryKeyRef.current = "";
    setSearchParams(clearZonePanelSearch(searchParams.toString()), {
      replace: true,
    });
  };

  const pageError = error || liveError;

  return (
    <div
      className={`ops-page ops-portmap-page ops-page-enter ${
        isPanelOpen && activeZone ? "has-zone-panel" : ""
      }`}
    >
      <InlineAlert message={pageError} tone="error" />

      <section className="ops-page-header">
        <div>
          <h1 className="ops-page-title">{t("nav.portMap")}</h1>
          <p className="ops-page-subtitle">{t("portMap.pageSubtitle")}</p>
        </div>
      </section>

      <div className="portmap-summary-grid">
        {zoneSummaries.map((zone) => (
          <button
            key={zone.id}
            type="button"
            className={`portmap-summary-card state-${zone.status} ${activeZoneId === zone.id ? "is-active" : ""}`}
            onClick={() => handleZoneSelect(zone)}
          >
            <div>
              <p className="portmap-summary-label">{zone.name}</p>
              <h3>{zone.title}</h3>
            </div>
            <div className="portmap-summary-metrics">
              <span>{t("portMap.assetsCount", { count: zone.machineCount })}</span>
              <strong>{t("portMap.criticalCount", { count: zone.criticalCount })}</strong>
            </div>
          </button>
        ))}
      </div>

      <div className="map-container">
        <svg viewBox="0 0 650 500" className="interactive-svg">
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path
              d="M 20 0 L 0 0 0 20"
              fill="none"
              stroke="var(--line-soft)"
              strokeWidth="0.5"
            />
          </pattern>
          <rect width="100%" height="100%" fill="url(#grid)" />

          {zoneSummaries.map((zone) => {
            const isHovered = hoveredZone?.id === zone.id;
            const isActive = activeZone?.id === zone.id;
            return (
              <g key={zone.id}>
                <path
                  d={zone.path}
                  className={`map-zone ${isHovered ? "hovered" : ""} ${isActive ? "active" : ""} state-${zone.status}`}
                  onMouseEnter={() => setHoveredZoneId(zone.id)}
                  onMouseLeave={() => setHoveredZoneId(null)}
                  onClick={() => handleZoneSelect(zone)}
                />
                <text x={zone.center.x} y={zone.center.y - 8} className="map-zone-title">
                  {zone.name}
                </text>
                <text x={zone.center.x} y={zone.center.y + 14} className="map-zone-subtitle">
                  {t("portMap.zoneMapStats", {
                    assets: zone.machineCount,
                    incidents: zone.activeIncidentCount,
                  })}
                </text>
              </g>
            );
          })}
        </svg>

        {hoveredZone ? (
          <div className="zone-tooltip">
            <strong>{getZoneDisplayName(hoveredZone)}</strong>
            <div className="tooltip-metrics">
              <span>{hoveredZone.tempLabel}</span>
              <span
                className={
                  hoveredZone.criticalCount > 0 ? "text-error" : "text-success"
                }
              >
                {t("portMap.criticalCount", { count: hoveredZone.criticalCount })}
              </span>
            </div>
            <p>{hoveredZone.headline}</p>
          </div>
        ) : null}
      </div>

      <div className="portmap-action-grid">
        <article className="portmap-action-card">
          <div className="portmap-action-head">
            <Radar size={16} />
            <div>
              <p className="portmap-action-label">{t("portMap.liveZoneFocus")}</p>
              <h3>{activeZone ? getZoneDisplayName(activeZone) : t("portMap.selectZone")}</h3>
            </div>
          </div>

          <p className="portmap-action-copy">
            {activeZone
              ? activeZone.headline
              : t("portMap.selectZoneHelp")}
          </p>

          <div className="portmap-action-buttons">
            <button
              type="button"
              className="app-topbar-btn secondary"
              disabled={!activeZone}
              onClick={() => activeZone && handleOpenAlarmCenter(activeZone)}
            >
              <AlertTriangle size={16} />
              {t("dashboardV2.incidentCenter")}
            </button>
            <button
              type="button"
              className="app-topbar-btn primary"
              disabled={!activeZone || Boolean(pendingChatZoneId)}
              onClick={() => activeZone && handleOpenZoneChat(activeZone)}
            >
              <Bot size={16} />
              {t("portMap.askAi")}
            </button>
          </div>
        </article>

        <article className="portmap-action-card is-highlight">
          <div className="portmap-action-head">
            <Sparkles size={16} />
            <div>
              <p className="portmap-action-label">{t("portMap.aiZoneScan")}</p>
              <h3>
                {BUSY_AGENT_STATES.has(summaryState)
                  ? t("portMap.streamingGuidance")
                  : summaryState === "completed"
                    ? t("portMap.zoneBriefingReady")
                    : t("portMap.onDemandAnalysis")}
              </h3>
            </div>
          </div>

          <p className="portmap-action-copy">
            {activeZone
              ? t("portMap.zoneScanHelp")
              : t("portMap.panelAutoOpenHelp")}
          </p>
        </article>
      </div>

      <ZoneSummaryPanel
        isOpen={isPanelOpen}
        onClose={handleClosePanel}
        zone={activeZone}
        agentState={summaryState}
        partialText={summaryPartial}
        data={summaryData}
        onOpenAlarmCenter={handleOpenAlarmCenter}
        onOpenChat={handleOpenZoneChat}
        isOpeningChat={Boolean(pendingChatZoneId)}
      />
    </div>
  );
}
