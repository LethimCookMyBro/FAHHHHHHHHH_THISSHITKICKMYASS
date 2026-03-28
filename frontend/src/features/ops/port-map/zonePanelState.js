const PANEL_QUERY_KEYS = ["zoneId", "machineId", "machineName", "errorCode"];

const normalizeSearch = (search = "") =>
  String(search || "").replace(/^\?/, "");

const createParams = (search = "") => new URLSearchParams(normalizeSearch(search));

export const getZonePanelContextFromSearch = (search = "") => {
  const params = createParams(search);

  return {
    zoneId: params.get("zoneId") || "",
    machineId: params.get("machineId") || "",
    machineName: params.get("machineName") || "",
    errorCode: params.get("errorCode") || "",
  };
};

export const buildZonePanelSearch = (search = "", zoneId = "") => {
  const params = createParams(search);

  PANEL_QUERY_KEYS.forEach((key) => params.delete(key));

  if (!zoneId) {
    return params.toString();
  }

  params.set("zoneId", String(zoneId));
  return params.toString();
};

export const clearZonePanelSearch = (search = "") =>
  buildZonePanelSearch(search, "");

export const getZoneIdFromSearch = (search = "") =>
  createParams(search).get("zoneId") || "";

export const buildZoneChatInput = (zone, search = "") => {
  if (!zone) return zone;

  const { zoneId, machineId, machineName, errorCode } =
    getZonePanelContextFromSearch(search);

  if (zoneId !== zone.id) {
    return zone;
  }

  if (!machineId && !machineName && !errorCode) {
    return zone;
  }

  return {
    ...zone,
    ...(machineId ? { machineId } : {}),
    ...(machineName ? { machineName } : {}),
    ...(errorCode ? { errorCode } : {}),
  };
};

export { PANEL_QUERY_KEYS };
