import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  ClipboardList,
  Gauge,
  Map,
} from "lucide-react";
import { MetricTile } from "../../../../components/ui";
import { useT } from "../../../../utils/i18n";
import { useThemePalette } from "../../../theme/themeContext";
import { extractInstructionSteps } from "../helpers";

const FALLBACK_SERIES = [
  { time: "Mon", value: 62 },
  { time: "Tue", value: 74 },
  { time: "Wed", value: 67 },
  { time: "Thu", value: 79 },
  { time: "Fri", value: 84 },
  { time: "Sat", value: 72 },
];

const TILE_ICONS = {
  running: Activity,
  critical: AlertTriangle,
  warning: ClipboardList,
  availability: Gauge,
};

const buildSeries = (history) => {
  if (!Array.isArray(history) || history.length === 0) {
    return FALLBACK_SERIES;
  }

  return history.slice(-6).map((point, index) => ({
    time: String(point.time || point.month || `S${index + 1}`),
    value: Number(point.value) || 0,
  }));
};

const buildLinePath = (data, key, xForIndex, yForValue) => {
  if (!data.length) return "";
  return data
    .map((point, index) => {
      const command = index === 0 ? "M" : "L";
      return `${command} ${xForIndex(index).toFixed(1)} ${yForValue(point[key]).toFixed(1)}`;
    })
    .join(" ");
};

function TrendTooltip({ point, t }) {
  if (!point) return null;

  return (
    <div className="dash-tooltip-card">
      <p>{point.time}</p>
      <div className="dash-tooltip-row" style={{ "--swatch": "var(--accent)" }}>
        <span>{t("dashboard.executed")}</span>
        <strong>{Math.round(Number(point.executed) || 0)}</strong>
      </div>
      <div
        className="dash-tooltip-row"
        style={{ "--swatch": "var(--chart-accent-alt)" }}
      >
        <span>{t("dashboard.planned")}</span>
        <strong>{Math.round(Number(point.planned) || 0)}</strong>
      </div>
    </div>
  );
}

const StatChartCard = memo(function StatChartCard({ data }) {
  const { t } = useT();
  const palette = useThemePalette();
  const chartFrameRef = useRef(null);
  const [chartWidth, setChartWidth] = useState(960);
  const [activeIndex, setActiveIndex] = useState(null);
  const chartHeight = 232;
  const plot = useMemo(
    () => ({
      left: Math.max(48, Math.round(chartWidth * 0.045)),
      right: Math.max(20, Math.round(chartWidth * 0.02)),
      top: 16,
      bottom: 32,
    }),
    [chartWidth],
  );

  useEffect(() => {
    const element = chartFrameRef.current;
    if (!element) return undefined;

    const syncChartWidth = () => {
      const nextWidth = Math.max(320, Math.round(element.clientWidth || 0));
      setChartWidth((current) => (current === nextWidth ? current : nextWidth));
    };

    syncChartWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", syncChartWidth);
      return () => window.removeEventListener("resize", syncChartWidth);
    }

    const observer = new ResizeObserver(() => {
      syncChartWidth();
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const yAxisDomain = useMemo(() => {
    const values = data.flatMap((point) => [
      Number(point.executed) || 0,
      Number(point.planned) || 0,
    ]);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const range = Math.max(8, maxValue - minValue);
    const padding = Math.max(4, Math.ceil(range * 0.18));
    const min = Math.max(0, Math.floor((minValue - padding) / 5) * 5);
    const max = Math.ceil((maxValue + padding) / 5) * 5;

    return [min, max <= min ? min + 10 : max];
  }, [data]);
  const yTicks = useMemo(() => {
    const [min, max] = yAxisDomain;
    return Array.from({ length: 4 }, (_, index) =>
      Math.round(min + ((max - min) / 3) * index),
    );
  }, [yAxisDomain]);
  const xForIndex = (index) => {
    if (data.length <= 1) return plot.left;
    const width = chartWidth - plot.left - plot.right;
    return plot.left + (width / (data.length - 1)) * index;
  };
  const yForValue = (value) => {
    const [min, max] = yAxisDomain;
    const height = chartHeight - plot.top - plot.bottom;
    const ratio = (Number(value) - min) / Math.max(1, max - min);
    return plot.top + height - ratio * height;
  };
  const executedPath = buildLinePath(data, "executed", xForIndex, yForValue);
  const plannedPath = buildLinePath(data, "planned", xForIndex, yForValue);
  const fallbackIndex = Math.max(0, data.length - 2);
  const resolvedActiveIndex = activeIndex == null ? fallbackIndex : activeIndex;
  const activePoint = data[resolvedActiveIndex] || null;
  const markerX = xForIndex(resolvedActiveIndex);
  const executedY = activePoint ? yForValue(activePoint.executed) : plot.top;
  const plannedY = activePoint ? yForValue(activePoint.planned) : plot.top;
  const tooltipAlign =
    markerX > chartWidth - 150 ? "right" : markerX < 150 ? "left" : "center";

  const handlePointerMove = (event) => {
    if (!chartFrameRef.current || data.length === 0) return;
    const rect = chartFrameRef.current.getBoundingClientRect();
    if (!rect.width) return;

    const relativeX = ((event.clientX - rect.left) / rect.width) * chartWidth;
    const clampedX = Math.min(
      chartWidth - plot.right,
      Math.max(plot.left, relativeX),
    );
    const step =
      data.length > 1
        ? (chartWidth - plot.left - plot.right) / (data.length - 1)
        : 1;
    const nextIndex = Math.round((clampedX - plot.left) / step);
    setActiveIndex(Math.max(0, Math.min(data.length - 1, nextIndex)));
  };

  const handlePointerLeave = () => {
    setActiveIndex(null);
  };

  return (
    <article className="dash-feature-card dash-feature-card-primary">
      <header className="dash-feature-head">
        <div>
          <p className="dash-feature-label">{t("dashboardV2.coordinatedLoad")}</p>
          <h3 className="dash-feature-title">{t("dashboard.workOrders")}</h3>
        </div>
        <div className="dash-feature-legend">
          <span>
            <i className="dot dot-a" />
            {t("dashboard.executed")}
          </span>
          <span>
            <i className="dot dot-b" />
            {t("dashboard.planned")}
          </span>
        </div>
      </header>

      <div
        ref={chartFrameRef}
        className="dash-feature-chart"
        style={{ height: chartHeight }}
      >
        {activePoint ? (
          <div
            className={`dash-feature-tooltip is-${tooltipAlign}`}
            style={{ left: `${markerX}px` }}
          >
            <TrendTooltip point={activePoint} t={t} />
          </div>
        ) : null}
        <svg
          className="dash-native-chart"
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          role="img"
          aria-label={t("dashboard.workOrders")}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
        >
          {yTicks.map((tick) => {
            const y = yForValue(tick);
            return (
              <g key={tick}>
                <line
                  x1={plot.left}
                  x2={chartWidth - plot.right}
                  y1={y}
                  y2={y}
                  stroke={palette.chartGrid}
                  strokeDasharray="5 7"
                />
                <text
                  x={plot.left - 10}
                  y={y + 4}
                  textAnchor="end"
                  fill={palette.chartText}
                  fontSize="11"
                  fontFamily="var(--font-mono)"
                >
                  {tick}
                </text>
              </g>
            );
          })}
          <line
            x1={markerX}
            x2={markerX}
            y1={plot.top}
            y2={chartHeight - plot.bottom}
            stroke={palette.chartReference}
            strokeDasharray="4 4"
          />
          <path
            d={plannedPath}
            fill="none"
            stroke={palette.accentAlt}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={executedPath}
            fill="none"
            stroke={palette.accent}
            strokeWidth="3.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {activePoint ? (
            <>
              <circle
                cx={markerX}
                cy={plannedY}
                r="5.5"
                fill={palette.surface}
                stroke={palette.accentAlt}
                strokeWidth="2.4"
              />
              <circle
                cx={markerX}
                cy={executedY}
                r="5.5"
                fill={palette.surface}
                stroke={palette.accent}
                strokeWidth="2.4"
              />
            </>
          ) : null}
          {data.map((point, index) => (
            <text
              key={point.time}
              x={xForIndex(index)}
              y={chartHeight - 10}
              textAnchor="middle"
              fill={palette.chartText}
              fontSize="11"
              fontFamily="var(--font-mono)"
            >
              {point.time}
            </text>
          ))}
        </svg>
      </div>
    </article>
  );
});

function PlantOverviewCards({
  tiles,
  plantSummary,
  history,
  alertRows = [],
  actionRows = [],
  utilizationRate,
  focusMessage,
  onOpenPortMap,
  onOpenAnalytics,
  onOpenActions,
}) {
  const { t } = useT();
  const safeTiles = Array.isArray(tiles) ? tiles : [];
  const safePlantSummary = plantSummary || {
    total: 0,
    running: 0,
    warning: 0,
    criticalAlarms: 0,
    oee: "0%",
  };
  const baseSeries = useMemo(() => buildSeries(history), [history]);

  const workOrderSeries = useMemo(
    () =>
      baseSeries.map((point, index) => ({
        time: point.time,
        executed: Math.max(22, Math.round(point.value * 1.6 + index * 2)),
        planned: Math.max(20, Math.round(point.value * 1.35 + (5 - index))),
      })),
    [baseSeries],
  );

  const latestAlert = alertRows[0] || null;
  const latestAction = actionRows[0] || null;
  const parsedActionSteps = extractInstructionSteps(latestAction?.result, 5);
  const actionSteps = parsedActionSteps.length
    ? parsedActionSteps
    : [
        t("dashboardV2.defaultStepPowerOff"),
        t("dashboardV2.defaultStepCheckFieldbus"),
        t("dashboardV2.defaultStepRestart"),
      ];
  const latestActionStatus = String(
    latestAction?.status || t("dashboardV2.manualReview"),
  ).replace(/_/g, " ");

  return (
    <div className="dash-overview-v3">
      <div className="ops-dashboard-tile-grid">
        {safeTiles.map((tile) => (
          <MetricTile
            key={tile.key}
            icon={TILE_ICONS[tile.key]}
            label={tile.label}
            value={tile.value}
            hint={tile.hint}
            tone={tile.tone}
            actionHint={tile.actionHint}
          />
        ))}
      </div>

      <div className="dash-feature-grid">
        <StatChartCard data={workOrderSeries} />

        <div className="dash-feature-side">
          <article className="dash-command-card">
            <div className="dash-command-hero">
              <div className="dash-command-capacity">
                <p className="dash-command-eyebrow">{t("dashboardV2.shiftFocus")}</p>
                <strong>{utilizationRate}%</strong>
                <span>{t("dashboardV2.runningCapacity")}</span>
              </div>

              <div className="dash-command-status">
                <p className="dash-command-copy">{focusMessage}</p>
                <div className="dash-command-latest">
                  <span className="dash-latest-code">
                    {latestAlert?.code || t("dashboardV2.noActiveAlertCode")}
                  </span>
                  <span
                    className={`dash-latest-badge ${
                      latestAlert?.severity === "critical" ? "critical" : "warning"
                    }`}
                  >
                    {String(latestAlert?.severity || "stable").toUpperCase()}
                  </span>
                </div>
              </div>

              <div className="dash-command-action-block">
                <p className="dash-command-label">{t("dashboard.recommendedAction")}</p>
                <ol className="dash-command-steps">
                  {actionSteps.map((step) => (
                    <li key={step}>{step.replace(/\.$/, "")}.</li>
                  ))}
                </ol>
                <span className="dash-manual-pill">
                  {latestActionStatus.toUpperCase()}
                </span>
              </div>
            </div>

            <div className="dash-command-actions">
              <button
                type="button"
                className="dash-command-link"
                onClick={onOpenActions}
              >
                {t("dashboardV2.actionTimeline")}
                <ArrowUpRight size={14} />
              </button>
              <button
                type="button"
                className="dash-command-link muted"
                onClick={onOpenAnalytics}
              >
                {t("dashboardV2.predictiveAnalysis")}
                <ArrowUpRight size={14} />
              </button>
            </div>
          </article>

          <article className="dash-topology-card">
            <header className="dash-topology-head">
              <div>
                <p className="dash-feature-label">{t("dashboardV2.systemMap")}</p>
                <h3 className="dash-topology-title">{t("dashboardV2.controlTopology")}</h3>
              </div>
              <button
                type="button"
                className="dash-inline-link dash-inline-button"
                onClick={onOpenPortMap}
              >
                <Map size={14} />
                {t("dashboardV2.viewPortMap")}
              </button>
            </header>

            <div className="dash-topology-stage">
              <svg
                viewBox="0 0 640 292"
                className="dash-topology-canvas"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <defs>
                  <pattern
                    id="dash-topology-grid-pattern"
                    width="30"
                    height="30"
                    patternUnits="userSpaceOnUse"
                  >
                    <path
                      d="M 30 0 L 0 0 0 30"
                      fill="none"
                      className="dash-topology-grid-line"
                      strokeWidth="1"
                    />
                  </pattern>
                  <filter
                    id="dash-topology-glow"
                    x="-30%"
                    y="-30%"
                    width="160%"
                    height="160%"
                  >
                    <feGaussianBlur stdDeviation="10" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>

                <rect
                  width="640"
                  height="292"
                  fill="url(#dash-topology-grid-pattern)"
                  className="dash-topology-grid-surface"
                />
                <circle
                  cx="320"
                  cy="146"
                  r="60"
                  className="dash-topology-core-ring"
                />
                <circle
                  cx="320"
                  cy="146"
                  r="34"
                  className="dash-topology-core-glow"
                  filter="url(#dash-topology-glow)"
                />

                <path
                  className="dash-topology-path edge"
                  d="M 286 136 C 246 126, 214 108, 166 90"
                />
                <path
                  className="dash-topology-path hmi"
                  d="M 354 136 C 398 122, 432 108, 494 88"
                />
                <path
                  className="dash-topology-path zone"
                  d="M 286 158 C 244 170, 214 186, 168 206"
                />
                <path
                  className="dash-topology-path history"
                  d="M 354 158 C 398 170, 434 188, 494 206"
                />

                <g
                  className="dash-topology-flow-badge edge"
                  transform="translate(150 78)"
                >
                  <rect x="0" y="0" width="78" height="24" rx="12" />
                  <text x="39" y="15">{t("dashboardV2.uplink")}</text>
                </g>
                <g
                  className="dash-topology-flow-badge hmi"
                  transform="translate(452 76)"
                >
                  <rect x="0" y="0" width="98" height="24" rx="12" />
                  <text x="49" y="15">{t("dashboardV2.operatorHmi")}</text>
                </g>
                <g
                  className="dash-topology-flow-badge zone"
                  transform="translate(146 190)"
                >
                  <rect x="0" y="0" width="92" height="24" rx="12" />
                  <text x="46" y="15">{t("dashboardV2.remoteIo")}</text>
                </g>
                <g
                  className="dash-topology-flow-badge history"
                  transform="translate(444 188)"
                >
                  <rect x="0" y="0" width="106" height="24" rx="12" />
                  <text x="53" y="15">{t("dashboardV2.historianSync")}</text>
                </g>
              </svg>

              <div className="dash-topology-node edge">
                <span className="dash-topology-node-kind">{t("dashboardV2.gateway")}</span>
                <strong className="dash-topology-node-name">{t("dashboardV2.edgeGw")}</strong>
              </div>
              <div className="dash-topology-node hmi">
                <span className="dash-topology-node-kind">{t("dashboardV2.operator")}</span>
                <strong className="dash-topology-node-name">{t("dashboardV2.hmiPanel")}</strong>
              </div>
              <div className="dash-topology-node core">
                <span className="dash-topology-node-kind">{t("dashboardV2.controller")}</span>
                <strong className="dash-topology-node-name">{t("dashboardV2.corePlc")}</strong>
              </div>
              <div className="dash-topology-node zone">
                <span className="dash-topology-node-kind">{t("dashboardV2.field")}</span>
                <strong className="dash-topology-node-name">{t("dashboardV2.zoneAio")}</strong>
              </div>
              <div className="dash-topology-node historian">
                <span className="dash-topology-node-kind">{t("dashboardV2.archive")}</span>
                <strong className="dash-topology-node-name">{t("dashboardV2.historian")}</strong>
              </div>
            </div>

            <div className="dash-topology-foot">
              <div className="dash-topology-metric coverage">
                <span>{t("dashboardV2.signalCoverage")}</span>
                <strong>
                  {safePlantSummary.total > 0 ? `${utilizationRate}%` : "0%"}
                </strong>
              </div>
              <div className="dash-topology-metric warning">
                <span>{t("dashboardV2.warnings")}</span>
                <strong>{safePlantSummary.warning}</strong>
              </div>
              <div className="dash-topology-metric critical">
                <span>{t("dashboardV2.criticalLabel")}</span>
                <strong>{safePlantSummary.criticalAlarms}</strong>
              </div>
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}

export default memo(PlantOverviewCards);
