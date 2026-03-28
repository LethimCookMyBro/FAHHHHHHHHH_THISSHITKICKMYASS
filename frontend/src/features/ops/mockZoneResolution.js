const MOCK_ZONE_RESOLUTION_KEY = "mockZoneIncidentResolutions";
const MOCK_ZONE_RESOLUTION_EVENT = "mock-zone-resolution-change";

const asArray = (value) => (Array.isArray(value) ? value : []);
const asString = (value) => String(value ?? "").trim();

const normalizeResolutionEntry = (entry = {}) => ({
  zoneId: asString(entry.zoneId).toLowerCase(),
  machineId: asString(entry.machineId),
  machineName: asString(entry.machineName),
  errorCode: asString(entry.errorCode),
  resolvedAt: asString(entry.resolvedAt) || new Date().toISOString(),
});

const buildResolutionKey = (entry = {}) =>
  [
    asString(entry.zoneId).toLowerCase(),
    asString(entry.machineId),
    asString(entry.machineName).toLowerCase(),
    asString(entry.errorCode).toLowerCase(),
  ].join("::");

const getStorage = () =>
  typeof window !== "undefined" ? window.localStorage : null;

const emitResolutionChange = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MOCK_ZONE_RESOLUTION_EVENT));
};

export const readMockZoneIncidentResolutions = (
  storage = getStorage(),
) => {
  if (!storage) return [];

  try {
    const parsed = JSON.parse(storage.getItem(MOCK_ZONE_RESOLUTION_KEY) || "[]");
    return asArray(parsed)
      .map(normalizeResolutionEntry)
      .filter((entry) => entry.zoneId);
  } catch {
    return [];
  }
};

export const persistMockZoneIncidentResolutions = (
  resolutions,
  storage = getStorage(),
) => {
  if (!storage) return;
  storage.setItem(
    MOCK_ZONE_RESOLUTION_KEY,
    JSON.stringify(
      asArray(resolutions)
        .map(normalizeResolutionEntry)
        .filter((entry) => entry.zoneId),
    ),
  );
};

export const markMockZoneIncidentResolved = (
  context,
  storage = getStorage(),
) => {
  const nextEntry = normalizeResolutionEntry(context);
  if (!nextEntry.zoneId) return [];

  const current = readMockZoneIncidentResolutions(storage);
  const nextKey = buildResolutionKey(nextEntry);
  const deduped = current.filter(
    (entry) => buildResolutionKey(entry) !== nextKey,
  );
  const next = [nextEntry, ...deduped];
  persistMockZoneIncidentResolutions(next, storage);
  emitResolutionChange();
  return next;
};

export const isAlarmResolvedByMockChat = (alarm, resolutions = []) => {
  const zoneId = asString(alarm?.zoneId || alarm?.resolvedZoneId).toLowerCase();
  const machineId = asString(alarm?.machine_id ?? alarm?.id);
  const machineName = asString(alarm?.machine_name || alarm?.name).toLowerCase();
  const errorCode = asString(alarm?.error_code).toLowerCase();

  return asArray(resolutions).some((entry) => {
    if (zoneId && entry.zoneId && entry.zoneId !== zoneId) {
      return false;
    }

    if (entry.machineId && machineId && entry.machineId !== machineId) {
      return false;
    }

    if (entry.machineName && machineName && entry.machineName.toLowerCase() !== machineName) {
      return false;
    }

    if (entry.errorCode && errorCode && entry.errorCode.toLowerCase() !== errorCode) {
      return false;
    }

    if (!entry.machineId && !entry.machineName && !entry.errorCode) {
      return entry.zoneId === zoneId;
    }

    return true;
  });
};

export const subscribeToMockZoneResolutionChanges = (callback) => {
  if (typeof window === "undefined") return () => {};

  const handleChange = () => callback?.();
  window.addEventListener(MOCK_ZONE_RESOLUTION_EVENT, handleChange);
  window.addEventListener("storage", handleChange);

  return () => {
    window.removeEventListener(MOCK_ZONE_RESOLUTION_EVENT, handleChange);
    window.removeEventListener("storage", handleChange);
  };
};

export {
  MOCK_ZONE_RESOLUTION_EVENT,
  MOCK_ZONE_RESOLUTION_KEY,
};
