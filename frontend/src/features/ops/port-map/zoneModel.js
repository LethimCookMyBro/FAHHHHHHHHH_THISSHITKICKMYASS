import { resolveMachineState } from "../dashboard/helpers.js";

const ZONE_LAYOUT = [
  {
    id: "zone-a",
    name: "Zone A",
    title: "Berthing & Logistics",
    path: "M50,50 L250,50 L250,350 L50,350 Z",
    center: { x: 150, y: 200 },
    keywords: ["conveyor", "line", "edge", "berth", "logistics", "dock"],
  },
  {
    id: "zone-b",
    name: "Zone B",
    title: "Core Assembly",
    path: "M280,50 L600,50 L600,200 L280,200 Z",
    center: { x: 440, y: 125 },
    keywords: ["robot", "assembly", "plc", "core", "panel", "controller"],
  },
  {
    id: "zone-c",
    name: "Zone C",
    title: "Packaging & QA",
    path: "M280,220 L600,220 L600,450 L280,450 Z",
    center: { x: 440, y: 335 },
    keywords: ["pack", "qa", "quality", "monitor", "cnc", "vision"],
  },
  {
    id: "zone-d",
    name: "Zone D",
    title: "Power & Utilities",
    path: "M50,380 L250,380 L250,450 L50,450 Z",
    center: { x: 150, y: 415 },
    keywords: ["power", "utility", "air", "compressor", "substation", "hvac"],
  },
];

const FALLBACK_ZONE_ID = "zone-b";

const asArray = (value) => (Array.isArray(value) ? value : []);
const asString = (value) => String(value ?? "").trim();

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const oneDecimal = (value, fallback = 0) =>
  toNumber(value, fallback).toFixed(1);

const buildSearchText = (item = {}) =>
  [
    item.id,
    item.name,
    item.machine_name,
    item.location,
    item.model,
    item.category,
    item.message,
    item.error_code,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

export const resolveZoneIdForMachine = (item = {}) => {
  const haystack = buildSearchText(item);
  const match = ZONE_LAYOUT.find((zone) =>
    zone.keywords.some((keyword) => haystack.includes(keyword)),
  );
  return match?.id || FALLBACK_ZONE_ID;
};

export const buildZoneRouteSearch = (item = {}) => {
  const params = new URLSearchParams();
  params.set("zoneId", resolveZoneIdForMachine(item));

  if (item.machine_id != null && item.machine_id !== "") {
    params.set("machineId", String(item.machine_id));
  } else if (item.id != null && item.id !== "") {
    params.set("machineId", String(item.id));
  }

  if (item.machine_name || item.name) {
    params.set("machineName", String(item.machine_name || item.name));
  }

  if (item.error_code) {
    params.set("errorCode", String(item.error_code));
  }

  return params.toString();
};

export const buildZoneSummaries = ({
  machines = [],
  alarms = [],
  actions = [],
  resolutions = [],
} = {}) => {
  const zones = ZONE_LAYOUT.map((zone) => ({
    ...zone,
    machines: [],
    alarms: [],
    actions: [],
    warningCount: 0,
    criticalCount: 0,
    activeIncidentCount: 0,
    avgTemp: 0,
    runningCount: 0,
  }));

  const zoneMap = new Map(zones.map((zone) => [zone.id, zone]));

  asArray(machines).forEach((machine) => {
    const zoneId = resolveZoneIdForMachine(machine);
    zoneMap.get(zoneId)?.machines.push(machine);
  });

  asArray(alarms).forEach((alarm) => {
    const zoneId = resolveZoneIdForMachine(alarm);
    zoneMap.get(zoneId)?.alarms.push({
      ...alarm,
      resolvedZoneId: zoneId,
    });
  });

  asArray(actions).forEach((action) => {
    const zoneId = resolveZoneIdForMachine(action);
    zoneMap.get(zoneId)?.actions.push(action);
  });

  return zones.map((zone) => {
    const hasZoneWideResolution = asArray(resolutions).some((entry) => {
      if (entry.zoneId !== zone.id) {
        return false;
      }

      return !entry.machineId && !entry.machineName && !entry.errorCode;
    });
    const temperatures = zone.machines.map((machine) =>
      toNumber(machine.temp ?? machine.sensors?.temperature, 0),
    );
    const visibleAlarms = zone.alarms.filter((alarm) => {
      const machineId = asString(alarm.machine_id ?? alarm.id);
      const machineName = asString(alarm.machine_name || alarm.name).toLowerCase();
      const errorCode = asString(alarm.error_code).toLowerCase();
      const alarmStatus = String(alarm.status || "active").toLowerCase();

      if (alarmStatus !== "active") {
        return false;
      }

      return !asArray(resolutions).some((entry) => {
        if (entry.zoneId && entry.zoneId !== zone.id) {
          return false;
        }
        if (entry.machineId && machineId && entry.machineId !== machineId) {
          return false;
        }
        if (
          entry.machineName &&
          machineName &&
          entry.machineName.toLowerCase() !== machineName
        ) {
          return false;
        }
        if (entry.errorCode && errorCode && entry.errorCode.toLowerCase() !== errorCode) {
          return false;
        }
        if (!entry.machineId && !entry.machineName && !entry.errorCode) {
          return entry.zoneId === zone.id;
        }

        return true;
      });
    });
    const avgTemp = temperatures.length
      ? temperatures.reduce((sum, value) => sum + value, 0) / temperatures.length
      : 0;
    const criticalCount = visibleAlarms.filter(
      (alarm) =>
        String(alarm.status || "active").toLowerCase() === "active" &&
        String(alarm.severity || "").toLowerCase() === "critical",
    ).length;
    const warningCount = zone.machines.filter(
      (machine) => (machine.machineState || resolveMachineState(machine)) === "warning",
    ).length;
    const runningCount = zone.machines.filter(
      (machine) => (machine.machineState || resolveMachineState(machine)) === "running",
    ).length;
    const activeIncidentCount = visibleAlarms.filter(
      (alarm) => String(alarm.status || "active").toLowerCase() === "active",
    ).length;
    const effectiveWarningCount =
      hasZoneWideResolution && activeIncidentCount === 0 ? 0 : warningCount;

    const status =
      criticalCount > 0
        ? "critical"
        : effectiveWarningCount > 0 || activeIncidentCount > 0
          ? "warning"
          : runningCount > 0 || (hasZoneWideResolution && zone.machines.length > 0)
            ? "running"
            : "idle";

    return {
      ...zone,
      alarms: visibleAlarms,
      avgTemp,
      tempLabel: `${oneDecimal(avgTemp, 0)} C`,
      criticalCount,
      warningCount: effectiveWarningCount,
      runningCount,
      activeIncidentCount,
      machineCount: zone.machines.length,
      actionCount: zone.actions.length,
      status,
      headline:
        criticalCount > 0
          ? "Immediate incident triage required"
          : activeIncidentCount > 0
            ? "Operator review recommended"
            : runningCount > 0 || (hasZoneWideResolution && zone.machines.length > 0)
              ? "Production flow is active"
              : "No active production load",
    };
  });
};

export default ZONE_LAYOUT;
