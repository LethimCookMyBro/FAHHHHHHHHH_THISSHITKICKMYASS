const normalizeFilename = (value, fallback = "export") => {
  const base = String(value || fallback).trim() || fallback;
  return base.replace(/[^a-z0-9-_]+/gi, "_").replace(/^_+|_+$/g, "");
};

const downloadBlob = (blob, filename) => {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
};

export const downloadText = (filename, content) => {
  const blob = new Blob([String(content || "")], { type: "text/plain;charset=utf-8" });
  downloadBlob(blob, `${normalizeFilename(filename)}.txt`);
};

const escapeCsvCell = (value) => {
  const raw = String(value ?? "");
  if (raw.includes(",") || raw.includes("\n") || raw.includes('"')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
};

export const downloadCsv = (filename, rows, columns = []) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  const safeColumns =
    columns.length > 0
      ? columns
      : Object.keys(safeRows[0] || {}).map((key) => ({ key, label: key }));

  const header = safeColumns.map((col) => escapeCsvCell(col.label || col.key)).join(",");
  const body = safeRows
    .map((row) =>
      safeColumns.map((col) => escapeCsvCell(row?.[col.key] ?? "")).join(","),
    )
    .join("\n");

  const blob = new Blob([`${header}\n${body}`], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `${normalizeFilename(filename)}.csv`);
};
