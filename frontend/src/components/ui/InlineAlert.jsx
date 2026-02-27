import { AlertTriangle } from "lucide-react";

export default function InlineAlert({ message, tone = "error" }) {
  if (!message) return null;
  return (
    <div className={`ops-inline-alert glass-panel-lite glass-noise ops-inline-${tone}`} role="alert">
      <AlertTriangle size={15} />
      <p>{message}</p>
    </div>
  );
}
