/**
 * Skeleton loading primitives for professional shimmer effects.
 */

export function Skeleton({
  width = "100%",
  height = "1rem",
  radius = "6px",
  className = "",
}) {
  return (
    <span
      className={`ops-skeleton ${className}`.trim()}
      style={{ width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

export function SkeletonMetricTile() {
  return (
    <article className="ops-metric-tile ops-skeleton-tile" aria-hidden="true">
      <div className="ops-metric-head">
        <Skeleton width="60%" height="0.68rem" />
        <Skeleton width="24px" height="24px" radius="8px" />
      </div>
      <Skeleton width="45%" height="1.9rem" className="mt-2" />
      <Skeleton width="80%" height="0.72rem" className="mt-2" />
      <Skeleton width="55%" height="0.66rem" className="mt-2" />
    </article>
  );
}

export function SkeletonCard({ lines = 4, barHeight = "0.82rem" }) {
  return (
    <section className="ops-section-card ops-skeleton-enter" aria-hidden="true">
      <div className="ops-section-head">
        <div style={{ flex: 1 }}>
          <Skeleton width="40%" height="1rem" />
          <Skeleton width="65%" height="0.72rem" className="mt-1" />
        </div>
      </div>
      <div
        className="ops-section-body"
        style={{ display: "flex", flexDirection: "column", gap: "10px" }}
      >
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} width={`${85 - i * 12}%`} height={barHeight} />
        ))}
      </div>
    </section>
  );
}
