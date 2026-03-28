import { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  ClipboardList,
  Gauge,
  Map,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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

function TrendTooltip({ active, payload, label }) {
  if (!active || !Array.isArray(payload) || payload.length === 0) return null;
  return (
    <div className="dash-tooltip-card">
      <p>{label}</p>
      {payload.map((item) => (
        <div
          key={item.name}
          className="dash-tooltip-row"
          style={{ "--swatch": item.color }}
        >
          <span>{item.name}</span>
          <strong>{Math.round(Number(item.value) || 0)}</strong>
        </div>
      ))}
    </div>
  );
}

function StatChartCard({ data }) {
  const { t } = useT();
  const palette = useThemePalette();
  const chartHeight = 232;
  const markerIndex = Math.max(0, data.length - 2);
  const markerPoint = data[markerIndex] || null;
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

      <div className="dash-feature-chart" style={{ height: chartHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 6, right: 10, left: 2, bottom: 0 }}
          >
            <CartesianGrid stroke={palette.chartGrid} vertical={false} />
            <XAxis
              dataKey="time"
              tickLine={false}
              axisLine={false}
              tick={{
                fontSize: 10,
                fill: palette.chartText,
                fontFamily: "var(--font-mono)",
              }}
            />
            <YAxis
              domain={yAxisDomain}
              tickCount={4}
              tickFormatter={(value) => String(Math.round(Number(value) || 0))}
              tickLine={false}
              axisLine={false}
              width={40}
              tickMargin={6}
              allowDecimals={false}
              tick={{
                fontSize: 10,
                fill: palette.chartText,
                fontFamily: "var(--font-mono)",
              }}
            />
            <Tooltip content={<TrendTooltip />} />

            {markerPoint ? (
              <ReferenceLine
                x={markerPoint.time}
                stroke={palette.chartReference}
                strokeDasharray="4 4"
              />
            ) : null}

            <Line
              type="monotone"
              dataKey="executed"
              name="Executed"
              stroke={palette.accent}
              strokeWidth={2.2}
              dot={false}
              activeDot={{
                r: 4,
                fill: palette.surface,
                stroke: palette.accent,
                strokeWidth: 2,
              }}
            />
            <Line
              type="monotone"
              dataKey="planned"
              name="Planned"
              stroke={palette.accentAlt}
              strokeWidth={2.2}
              dot={false}
              activeDot={{
                r: 4,
                fill: palette.surface,
                stroke: palette.accentAlt,
                strokeWidth: 2,
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}

export default function PlantOverviewCards({
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
                viewBox="0 0 640 276"
                className="dash-topology-canvas"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <defs>
                  <pattern
                    id="dash-topology-grid-pattern"
                    width="28"
                    height="28"
                    patternUnits="userSpaceOnUse"
                  >
                    <path
                      d="M 28 0 L 0 0 0 28"
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
                  height="276"
                  fill="url(#dash-topology-grid-pattern)"
                  className="dash-topology-grid-surface"
                />
                <circle
                  cx="320"
                  cy="138"
                  r="58"
                  className="dash-topology-core-ring"
                />
                <circle
                  cx="320"
                  cy="138"
                  r="32"
                  className="dash-topology-core-glow"
                  filter="url(#dash-topology-glow)"
                />

                <path
                  className="dash-topology-path edge"
                  d="M 286 126 C 248 118, 220 101, 168 82"
                />
                <path
                  className="dash-topology-path hmi"
                  d="M 354 126 C 394 114, 428 100, 492 82"
                />
                <path
                  className="dash-topology-path zone"
                  d="M 286 150 C 248 164, 218 180, 168 194"
                />
                <path
                  className="dash-topology-path history"
                  d="M 354 150 C 396 164, 430 180, 492 194"
                />

                <g
                  className="dash-topology-flow-badge edge"
                  transform="translate(154 72)"
                >
                  <rect x="0" y="0" width="78" height="24" rx="12" />
                  <text x="39" y="15">{t("dashboardV2.uplink")}</text>
                </g>
                <g
                  className="dash-topology-flow-badge hmi"
                  transform="translate(446 72)"
                >
                  <rect x="0" y="0" width="98" height="24" rx="12" />
                  <text x="49" y="15">{t("dashboardV2.operatorHmi")}</text>
                </g>
                <g
                  className="dash-topology-flow-badge zone"
                  transform="translate(148 180)"
                >
                  <rect x="0" y="0" width="92" height="24" rx="12" />
                  <text x="46" y="15">{t("dashboardV2.remoteIo")}</text>
                </g>
                <g
                  className="dash-topology-flow-badge history"
                  transform="translate(442 180)"
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
              <div>
                <span>{t("dashboardV2.signalCoverage")}</span>
                <strong>
                  {safePlantSummary.total > 0 ? `${utilizationRate}%` : "0%"}
                </strong>
              </div>
              <div>
                <span>{t("dashboardV2.warnings")}</span>
                <strong>{safePlantSummary.warning}</strong>
              </div>
              <div>
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
