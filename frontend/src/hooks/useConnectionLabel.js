import { useT } from "../utils/i18n";

const CONNECTION_LABELS = {
  live: "common.liveStream",
  reconnecting: "sidebar.reconnecting",
  rest: "sidebar.restFallback",
  connecting: "sidebar.connecting",
};

const STATUS_TONE = {
  live: "live",
  reconnecting: "warning",
  rest: "warning",
  connecting: "neutral",
};

export default function useConnectionLabel(connectionState) {
  const { t } = useT();

  const label = t(
    CONNECTION_LABELS[connectionState] || CONNECTION_LABELS.connecting,
  );
  const tone = STATUS_TONE[connectionState] || "neutral";

  return { label, tone };
}
