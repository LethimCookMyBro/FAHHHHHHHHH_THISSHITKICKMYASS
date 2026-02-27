const envEnabled = (value, defaultValue) => {
  if (value == null || value === "") return defaultValue;
  return String(value).trim().toLowerCase() === "true";
};

const envString = (value, defaultValue) => {
  if (value == null || value === "") return defaultValue;
  return String(value).trim();
};

const envInteger = (value, defaultValue) => {
  if (value == null || value === "") return defaultValue;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
};

const resolveStabilityMode = (value) => {
  const normalized = envString(value, "aggressive").toLowerCase();
  if (normalized === "off" || normalized === "moderate" || normalized === "aggressive") {
    return normalized;
  }
  return "aggressive";
};

const stabilityMode = resolveStabilityMode(import.meta.env.VITE_STABILITY_MODE);

export const featureFlags = {
  uiV2: envEnabled(import.meta.env.VITE_FEATURE_UI_V2, true),
  agentWorkflow: envEnabled(import.meta.env.VITE_FEATURE_AGENT_WORKFLOW, true),
  autofixExecution: envEnabled(import.meta.env.VITE_FEATURE_AUTOFIX_EXECUTION, false),
  stabilityMode,
  liquidGlass:
    envEnabled(import.meta.env.VITE_FEATURE_LIQUID_GLASS, true) &&
    stabilityMode !== "aggressive",
  disableChatSyntaxHighlight: envEnabled(
    import.meta.env.VITE_DISABLE_CHAT_SYNTAX_HIGHLIGHT,
    stabilityMode === "aggressive",
  ),
  plcUiUpdateThrottleMs: Math.max(
    0,
    envInteger(import.meta.env.VITE_PLC_UI_UPDATE_THROTTLE_MS, 500),
  ),
};

export default featureFlags;
