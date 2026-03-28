export default function MetricTile({
  icon: Icon,
  label,
  value,
  hint = "",
  tone = "info",
  actionHint = "",
}) {
  const parsedPercent = Number.parseInt(String(value).replace(/[^\d]/g, ""), 10);
  const isPercentMetric =
    typeof value === "string" &&
    value.includes("%") &&
    Number.isFinite(parsedPercent);

  return (
    <article className={`ops-metric-tile glass-panel-lite glass-noise glass-interactive ops-tone-${tone}`}>
      <div className="ops-metric-head">
        <p className="ops-metric-label">{label}</p>
        {Icon ? (
          <span className="ops-metric-icon" aria-hidden="true">
            <Icon size={20} />
          </span>
        ) : null}
      </div>
      <p className="ops-metric-value">{value}</p>
      {isPercentMetric ? (
        <div className="ops-metric-progress" aria-hidden="true">
          <span style={{ width: `${Math.max(0, Math.min(100, parsedPercent))}%` }} />
        </div>
      ) : null}
      {hint ? <p className="ops-metric-hint">{hint}</p> : null}
      {actionHint ? <p className="ops-metric-action">{actionHint}</p> : null}
    </article>
  );
}
