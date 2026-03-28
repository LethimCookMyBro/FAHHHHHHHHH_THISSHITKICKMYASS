import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useT } from "../../../../utils/i18n";
import { useThemePalette } from "../../../theme/themeContext";

const FALLBACK_MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

const clampPercent = (value) =>
  Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

function MaintenanceTooltip({ active, payload, label }) {
  if (!active || !Array.isArray(payload) || payload.length === 0) return null;
  return (
    <div className="dash-tooltip-card">
      <p>{label}</p>
      {payload.map((item) => (
        <div key={item.name} className="dash-tooltip-row" style={{ "--swatch": item.color }}>
          <span>{item.name}</span>
          <strong>{Math.round(Number(item.value) || 0)}</strong>
        </div>
      ))}
    </div>
  );
}

export default function OeeTrendPanel({ oeeRows, history }) {
  const { t } = useT();
  const palette = useThemePalette();

  const maintenanceData = useMemo(() => {
    const source = Array.isArray(history) && history.length > 0 ? history : [];

    if (source.length === 0) {
      return FALLBACK_MONTHS.map((month, index) => ({
        month,
        actual: 3 + (index % 5),
        planned: 4 + ((index + 2) % 5),
      }));
    }

    const normalized = source.slice(-12).map((point, index) => ({
      month: FALLBACK_MONTHS[index] || `M${index + 1}`,
      actual: Math.max(1, Math.round((Number(point.value) || 0) / 15)),
      planned: Math.max(1, Math.round((Number(point.value) || 0) / 13)),
    }));

    if (normalized.length < 12) {
      const pad = 12 - normalized.length;
      const fallback = FALLBACK_MONTHS.slice(0, pad).map((month, index) => ({
        month,
        actual: 3 + (index % 4),
        planned: 4 + ((index + 1) % 4),
      }));
      return [...fallback, ...normalized];
    }

    return normalized;
  }, [history]);

  const weakestMetric = useMemo(() => {
    if (!Array.isArray(oeeRows) || oeeRows.length === 0) return null;
    return oeeRows.reduce((lowest, current) =>
      Number(current.value) < Number(lowest.value) ? current : lowest,
    );
  }, [oeeRows]);

  return (
    <div className="dash-pulse-shell">
      <div className="dash-pulse-chart-wrap">
        <header className="dash-pulse-head">
          <div>
            <p>{t("dashboard.statistic")}</p>
            <h3>{t("dashboardV2.serviceLoadByMonth")}</h3>
          </div>
          <span>{t("dashboardV2.last12Samples")}</span>
        </header>

        <div className="dash-pulse-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={maintenanceData}
              margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
            >
              <CartesianGrid vertical={false} stroke={palette.chartGrid} />
              <XAxis
                dataKey="month"
                tickLine={false}
                axisLine={false}
                tick={{
                  fontSize: 10,
                  fill: palette.chartText,
                  fontFamily: "var(--font-mono)",
                }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={26}
                tick={{
                  fontSize: 10,
                  fill: palette.chartText,
                  fontFamily: "var(--font-mono)",
                }}
                label={{
                  value: t("dashboardV2.loadAxis"),
                  angle: -90,
                  position: "insideLeft",
                  style: {
                    fill: palette.chartText,
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                  },
                }}
              />
              <Tooltip content={<MaintenanceTooltip />} />
              <Bar
                dataKey="actual"
                name={t("dashboard.actual")}
                radius={[6, 6, 0, 0]}
                fill={palette.accent}
                barSize={10}
              />
              <Bar
                dataKey="planned"
                name={t("dashboard.planned")}
                radius={[6, 6, 0, 0]}
                fill={palette.ok}
                barSize={10}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <aside className="dash-pulse-kpi-rail">
        <div className="dash-pulse-kpi-head">
          <p>{t("dashboardV2.reliabilityPulse")}</p>
          <strong>{weakestMetric ? weakestMetric.text : "-"}</strong>
        </div>

        <div className="dash-pulse-kpi-list">
          {oeeRows.map((row) => (
            <div key={row.label} className="dash-pulse-kpi">
              <div className="dash-pulse-kpi-copy">
                <span>{row.label}</span>
                <strong>{row.text}</strong>
              </div>
              <div className="dash-pulse-track">
                <span style={{ width: `${clampPercent(row.value)}%` }} />
              </div>
            </div>
          ))}
        </div>

        <div className="dash-pulse-note">
          <span>{t("dashboardV2.watchItem")}</span>
          <strong>
            {weakestMetric
              ? t("dashboardV2.watchItemText", { label: weakestMetric.label })
              : t("dashboardV2.watchItemNone")}
          </strong>
        </div>
      </aside>
    </div>
  );
}
