function resolveCell(row, column) {
  if (typeof column.render === "function") return column.render(row);
  return row?.[column.key] ?? "-";
}

export default function DataTable({
  columns,
  rows,
  rowKey,
  emptyTitle = "No records",
  emptyMessage = "",
  compact = false,
}) {
  const hasRows = Array.isArray(rows) && rows.length > 0;

  return (
    <div className={`ops-data-table-wrap glass-panel-lite glass-noise ${compact ? "is-compact" : ""}`.trim()}>
      <table className="ops-data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hasRows ? (
            rows.map((row) => (
              <tr key={typeof rowKey === "function" ? rowKey(row) : row[rowKey]}>
                {columns.map((column) => (
                  <td key={column.key}>{resolveCell(row, column)}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length}>
                <div className="ops-data-table-empty">
                  <p className="ops-empty-title">{emptyTitle}</p>
                  {emptyMessage ? <p className="ops-empty-message">{emptyMessage}</p> : null}
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
