export default function PageHeader({
  title,
  subtitle = "",
  right = null,
}) {
  return (
    <header className="ops-page-header">
      <div className="ops-page-header-main">
        <h1 className="ops-page-title">{title}</h1>
        {subtitle ? <p className="ops-page-subtitle">{subtitle}</p> : null}
      </div>
      {right ? <div className="ops-page-header-right">{right}</div> : null}
    </header>
  );
}
