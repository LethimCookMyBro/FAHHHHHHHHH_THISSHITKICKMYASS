import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useT } from "../../../../utils/i18n";

const BAR_COLORS = {
  Overall: "var(--primary)",
  Availability: "var(--neon-amber)",
  Performance: "var(--neon-blue)",
  Quality: "var(--neon-green)",
};

export default function OeeTrendPanel({ oeeRows, history }) {
  const { t } = useT();

  return (
    <div className="oee-panel">
      {/* OEE Bars */}
      <div className="oee-bars">
        {oeeRows.map((row) => (
          <div key={row.label} className="oee-bar-row">
            <div className="oee-bar-header">
              <span className="oee-bar-label">{row.label}</span>
              <span
                className="oee-bar-value"
                style={{
                  color: BAR_COLORS[row.label] || "var(--text-primary)",
                }}
              >
                {row.text}
              </span>
            </div>
            <div className="oee-bar-track">
              <div
                className="oee-bar-fill"
                style={{
                  width: `${Math.max(0, Math.min(100, row.value))}%`,
                  background: BAR_COLORS[row.label] || "var(--primary)",
                  boxShadow: `0 0 8px ${BAR_COLORS[row.label] || "var(--primary)"}66`,
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Trend Chart */}
      <div className="oee-chart-wrap">
        <div className="oee-chart-header">
          <span className="oee-chart-title">{t("dashboard.oeeTrend")}</span>
        </div>
        {history.length === 0 ? (
          <div className="oee-chart-empty">
            <p>{t("dashboard.noTrendSamples")}</p>
            <p className="oee-chart-empty-hint">
              {t("dashboard.trendWillAppear")}
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220} minWidth={0}>
            <AreaChart
              data={history}
              margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
            >
              <defs>
                <linearGradient id="opsOeeGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="var(--primary)"
                    stopOpacity={0.4}
                  />
                  <stop
                    offset="100%"
                    stopColor="var(--primary)"
                    stopOpacity={0.02}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid
                stroke="rgba(255,255,255,0.06)"
                strokeDasharray="3 4"
              />
              <XAxis
                dataKey="time"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: "var(--text-muted)" }}
              />
              <YAxis
                domain={[0, 100]}
                tickLine={false}
                axisLine={false}
                width={32}
                tick={{ fontSize: 10, fill: "var(--text-muted)" }}
              />
              <Tooltip
                cursor={{
                  stroke: "var(--primary)",
                  strokeOpacity: 0.4,
                  strokeWidth: 1,
                }}
                contentStyle={{
                  borderRadius: "8px",
                  border: "1px solid var(--surface-700)",
                  background: "var(--surface-800)",
                  color: "var(--text-primary)",
                  fontSize: "12px",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
                }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="var(--primary)"
                strokeWidth={2}
                fill="url(#opsOeeGradient)"
                dot={false}
                isAnimationActive
                animationDuration={500}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
