import GlassSurface from "./GlassSurface";
import featureFlags from "../../utils/featureFlags";

export default function SectionCard({
  title,
  subtitle = "",
  right = null,
  children,
  className = "",
}) {
  const surfaceClasses = `ops-section-card glass-noise ${className}`.trim();
  const fallbackClasses = `ops-section-card glass-panel-strong glass-noise ${className}`.trim();

  if (!featureFlags.liquidGlass) {
    return (
      <section className={fallbackClasses}>
        <div className="ops-section-head">
          <div>
            <h2 className="ops-section-title">{title}</h2>
            {subtitle ? <p className="ops-section-subtitle">{subtitle}</p> : null}
          </div>
          {right ? <div>{right}</div> : null}
        </div>
        <div className="ops-section-body">{children}</div>
      </section>
    );
  }

  return (
    <GlassSurface
      as="section"
      className={surfaceClasses}
      borderRadius={14}
      blur={12}
      displace={0.58}
      brightness={52}
      opacity={0.88}
      saturation={1.14}
      backgroundOpacity={0.08}
    >
      <div className="ops-section-head">
        <div>
          <h2 className="ops-section-title">{title}</h2>
          {subtitle ? <p className="ops-section-subtitle">{subtitle}</p> : null}
        </div>
        {right ? <div>{right}</div> : null}
      </div>
      <div className="ops-section-body">{children}</div>
    </GlassSurface>
  );
}
