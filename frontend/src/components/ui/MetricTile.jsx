export default function MetricTile({
  icon: Icon,
  label,
  value,
  hint = "",
  tone = "info",
  actionHint = "",
}) {
  return (
    <article className={`ops-metric-tile glass-panel-lite glass-noise glass-interactive ops-tone-${tone}`}>
      <div className="ops-metric-head">
        <p className="ops-metric-label">{label}</p>
        {Icon ? (
          <span className="ops-metric-icon" aria-hidden="true">
            <Icon size={14} />
          </span>
        ) : null}
      </div>
      <p className="ops-metric-value">{value}</p>
      {hint ? <p className="ops-metric-hint">{hint}</p> : null}
      {actionHint ? <p className="ops-metric-action">{actionHint}</p> : null}
    </article>
  );
}
