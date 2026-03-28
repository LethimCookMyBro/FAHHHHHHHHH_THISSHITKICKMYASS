import React, { useState } from "react";
import { useConfigureTopbar } from "../../../layout/AppTopbarContext";
import { useT } from "../../../utils/i18n";
import { Activity, Zap } from "lucide-react";
import useAgentAction from "../../../hooks/useAgentAction";
import SystemScanPanel from "./components/SystemScanPanel";
import "./styles/overview.css";

export default function OverviewPage() {
  const { t } = useT();
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  // useAgentAction handles the backend Idempotency and SSE Streaming
  const {
    execute: startScan,
    reset: resetScan,
    state: scanState,
    data: scanData,
    partialText: scanPartial,
    progress: scanProgress,
  } = useAgentAction({
    deviceId: "system-wide",
    actionName: "system_scan",
  });

  useConfigureTopbar(
    {
      title: "",
      subtitle: "",
      statusPill: { label: t("overview.statusPill"), tone: "success" },
    },
    [t],
  );

  const handleRunScan = () => {
    resetScan();
    setIsPanelOpen(true);
    startScan({ mode: "full-trace" });
  };

  const isScanning = ["confirming", "executing", "streaming"].includes(
    scanState,
  );

  return (
    <div className="ops-page ops-overview-page ops-page-enter">
      <section className="ops-page-header">
        <div>
          <h1 className="ops-page-title">{t("overview.pageTitle")}</h1>
          <p className="ops-page-subtitle">{t("overview.pageSubtitle")}</p>
        </div>
      </section>

      <div className="topology-container">
        <button
          className="system-scan-btn"
          onClick={handleRunScan}
          disabled={isScanning}
        >
          {isScanning ? (
            <Activity className="spin" size={18} />
          ) : (
            <Zap size={18} />
          )}
          {isScanning ? t("overview.scanning") : t("overview.runSystemScan")}
        </button>

        <svg viewBox="0 0 800 500" className="interactive-topology">
          <defs>
            <pattern
              id="grid-topo"
              width="40"
              height="40"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="2" cy="2" r="1" fill="var(--line-strong)" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid-topo)" />

          {/* Links */}
          <line
            x1="400"
            y1="250"
            x2="200"
            y2="150"
            className={`topo-link ${isScanning ? "scanning" : ""}`}
          />
          <line
            x1="400"
            y1="250"
            x2="200"
            y2="350"
            className={`topo-link ${isScanning ? "scanning" : ""}`}
          />
          <line
            x1="400"
            y1="250"
            x2="600"
            y2="150"
            className={`topo-link ${isScanning ? "scanning" : ""}`}
          />
          <line
            x1="400"
            y1="250"
            x2="600"
            y2="350"
            className={`topo-link ${isScanning ? "scanning" : ""}`}
          />

          {/* Nodes */}
          <g transform="translate(400, 250)">
            {isScanning && <circle className="scan-pulse" r="50" />}
            <rect
              x="-60"
              y="-40"
              width="120"
              height="80"
              rx="8"
              className="topo-node core"
            />
            <text className="topo-label" y="-5">
              AXC F 2152
            </text>
            <text
              className="topo-label"
              y="15"
              fill="var(--accent)"
              fontSize="10"
            >
              {t("overview.corePlc")}
            </text>
          </g>

          <g transform="translate(200, 150)">
            <rect
              x="-40"
              y="-30"
              width="80"
              height="60"
              rx="6"
              className="topo-node edge"
            />
            <text className="topo-label">{t("overview.edgeGw1")}</text>
          </g>

          <g transform="translate(200, 350)">
            <rect
              x="-40"
              y="-30"
              width="80"
              height="60"
              rx="6"
              className="topo-node"
            />
            <text className="topo-label">{t("overview.zoneAio")}</text>
          </g>

          <g transform="translate(600, 150)">
            <rect
              x="-40"
              y="-30"
              width="80"
              height="60"
              rx="6"
              className="topo-node"
            />
            <text className="topo-label">{t("overview.hmiPanel")}</text>
          </g>

          <g transform="translate(600, 350)">
            <rect
              x="-40"
              y="-30"
              width="80"
              height="60"
              rx="6"
              className="topo-node"
            />
            <text className="topo-label">{t("overview.historianDb")}</text>
          </g>
        </svg>
      </div>

      <SystemScanPanel
        isOpen={isPanelOpen}
        onClose={() => setIsPanelOpen(false)}
        agentState={scanState}
        partialText={scanPartial}
        progress={scanProgress}
        data={scanData}
      />
    </div>
  );
}
