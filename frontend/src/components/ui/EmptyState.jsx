export default function EmptyState({
  icon: Icon,
  title = "No data",
  message = "",
  compact = false,
  actionLabel = "",
  onAction,
}) {
  return (
    <div className={`ops-empty-state glass-panel-lite glass-noise ${compact ? "is-compact" : ""}`.trim()}>
      {Icon ? (
        <span className="ops-empty-icon" aria-hidden="true">
          <Icon size={20} />
        </span>
      ) : null}
      <p className="ops-empty-title">{title}</p>
      {message ? <p className="ops-empty-message">{message}</p> : null}
      {actionLabel && onAction ? (
        <button type="button" className="ops-empty-action" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
