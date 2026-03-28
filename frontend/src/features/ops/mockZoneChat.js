import {
  buildZoneSummaries,
  resolveZoneIdForMachine,
} from "./port-map/zoneModel.js";
import {
  buildMockZoneSessionId,
  createMockZoneSessionToken,
  isMockZoneSessionId,
} from "../../pages/chat/mockZoneSessions.js";

const DEFAULT_ZONE_ID = "zone-b";
const MOCK_STREAM_TOTAL_MS = 5000;

const asArray = (value) => (Array.isArray(value) ? value : []);
const asString = (value) => String(value ?? "").trim();
const mergeMatchedItems = (primary, secondary) => {
  const seen = new Set();
  return [...asArray(primary), ...asArray(secondary)].filter((item) => {
    const key = JSON.stringify([
      item?.id ?? "",
      item?.machine_id ?? "",
      item?.machine_name ?? item?.name ?? "",
      item?.error_code ?? "",
      item?.message ?? "",
      item?.recommendation ?? "",
    ]);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

export const MOCK_ZONE_PROFILES = {
  "zone-a": {
    zoneId: "zone-a",
    zoneName: "Zone A",
    zoneTitle: "Berthing & Logistics",
    plcModel: "Mitsubishi MELSEC iQ-F FX5U-32MR/ES",
    defaultMachineName: "Zone A Infeed PLC",
    primaryErrorCode: "F800H",
    likelyCause:
      "The iQ-F controller is seeing a parameter or communication mismatch on the field side after a remote I/O timeout.",
    immediateActions: [
      "Verify the CC-Link IE Field or Ethernet segment between the iQ-F rack and Zone A remote I/O.",
      "Open GX Works and confirm the smart-function parameter block still matches the deployed hardware.",
      "Clear the active alarm only after the remote station heartbeat returns stable for at least one scan cycle.",
    ],
    logLines: [
      "08:14:22 | iQ-F CPU switched to error-stop after field network retry limit was reached.",
      "08:14:24 | F800H detected while validating the smart-function parameter block.",
      "08:14:27 | Remote I/O station 03 heartbeat dropped below the expected scan threshold.",
    ],
  },
  "zone-b": {
    zoneId: "zone-b",
    zoneName: "Zone B",
    zoneTitle: "Core Assembly",
    plcModel: "Siemens S7-1200 CPU 1215C",
    defaultMachineName: "Zone B Cell Controller",
    primaryErrorCode: "A051",
    likelyCause:
      "The cell controller lost confirmation from a motion axis or interlock chain during the last automatic sequence.",
    immediateActions: [
      "Inspect the interlock chain and servo-ready feedback before restarting automatic mode.",
      "Check whether the last recipe download completed successfully on the Zone B cell controller.",
      "Review the last operator override in the alarm log before issuing a reset.",
    ],
    logLines: [
      "10:03:12 | Sequence watchdog exceeded the allowed handshake window on robot cell 02.",
      "10:03:15 | A051 latched after servo-ready feedback remained low for 480 ms.",
      "10:03:18 | Last batch recipe change was acknowledged with warning state.",
    ],
  },
  "zone-c": {
    zoneId: "zone-c",
    zoneName: "Zone C",
    zoneTitle: "Packaging & QA",
    plcModel: "Omron NX1P2-9024DT",
    defaultMachineName: "Zone C QA PLC",
    primaryErrorCode: "QX210",
    likelyCause:
      "The packaging line is seeing unstable sensor confirmation, causing the QA state machine to pause and stack validation faults.",
    immediateActions: [
      "Verify the photoeye and barcode confirmation pair on the QA station.",
      "Check for intermittent I/O updates before re-enabling automatic reject logic.",
      "Inspect the last carton-tracking offset change applied on the controller.",
    ],
    logLines: [
      "13:41:08 | Carton verification timeout exceeded the QA state-machine limit.",
      "13:41:11 | QX210 raised after barcode verification missed two consecutive frames.",
      "13:41:13 | Reject diverter remained active longer than the configured recovery window.",
    ],
  },
  "zone-d": {
    zoneId: "zone-d",
    zoneName: "Zone D",
    zoneTitle: "Power & Utilities",
    plcModel: "Schneider Modicon M221 TM221CE24R",
    defaultMachineName: "Zone D Utility PLC",
    primaryErrorCode: "UTL-17",
    likelyCause:
      "A utility permissive dropped long enough to interrupt the power-support sequence, leaving the PLC in a degraded standby state.",
    immediateActions: [
      "Confirm the compressor and HVAC permissives are healthy before resetting the utility PLC.",
      "Review the last brownout or undervoltage event in the utility log.",
      "Re-arm the standby sequence only after all upstream safety inputs are normal.",
    ],
    logLines: [
      "06:52:40 | Utility standby sequence paused after a compressor permissive dropout.",
      "06:52:44 | UTL-17 latched while reconciling the backup power handshake.",
      "06:52:48 | Brownout event counter incremented on the utility PLC power monitor.",
    ],
  },
};

const formatAlarmLog = (alarm, fallbackMachineName, fallbackErrorCode) => {
  if (!alarm) return "";
  return [
    "Live alarm",
    alarm.machine_name || fallbackMachineName,
    alarm.error_code || fallbackErrorCode,
    alarm.message || alarm.error_message || "No alarm detail supplied",
  ]
    .filter(Boolean)
    .join(" | ");
};

const formatActionLog = (action, fallbackMachineName) => {
  if (!action) return "";
  return [
    "Action log",
    action.machine_name || fallbackMachineName,
    action.execution_status || action.action_type || "planned",
    action.execution_result?.message ||
      action.recommendation ||
      action.message ||
      "No action detail supplied",
  ]
    .filter(Boolean)
    .join(" | ");
};

const uniqueLines = (lines) => [...new Set(lines.filter(Boolean))];

const matchesRouteMachine = (item, routeContext) => {
  if (!item || !routeContext) return false;

  if (
    routeContext.machineId &&
    String(item.machine_id ?? item.id ?? "") === String(routeContext.machineId)
  ) {
    return true;
  }

  if (
    routeContext.machineName &&
    asString(item.machine_name || item.name) === routeContext.machineName
  ) {
    return true;
  }

  if (
    routeContext.errorCode &&
    asString(item.error_code) === routeContext.errorCode
  ) {
    return true;
  }

  return false;
};

const pickMatchingAlarm = (zoneSummary, routeContext) =>
  asArray(zoneSummary?.alarms).find((alarm) => {
    if (routeContext?.machineId && String(alarm.machine_id) === String(routeContext.machineId)) {
      return true;
    }
    if (routeContext?.errorCode && alarm.error_code === routeContext.errorCode) {
      return true;
    }
    return String(alarm.status || "active").toLowerCase() === "active";
  }) || asArray(zoneSummary?.alarms)[0] || null;

const pickMatchingAction = (zoneSummary, machineName) =>
  asArray(zoneSummary?.actions).find((action) =>
    machineName ? action.machine_name === machineName : true,
  ) || asArray(zoneSummary?.actions)[0] || null;

const pickMatchingMachine = (zoneSummary, routeContext) =>
  asArray(zoneSummary?.machines).find((machine) => {
    if (routeContext?.machineId && String(machine.id) === String(routeContext.machineId)) {
      return true;
    }
    if (routeContext?.machineName && machine.name === routeContext.machineName) {
      return true;
    }
    return false;
  }) || asArray(zoneSummary?.machines)[0] || null;

const resolveZoneId = (input = {}) => {
  const directZoneId = asString(input.zoneId || input.id).toLowerCase();
  if (MOCK_ZONE_PROFILES[directZoneId]) {
    return directZoneId;
  }

  return resolveZoneIdForMachine(input) || DEFAULT_ZONE_ID;
};

export const getMockZoneProfile = (zoneId) =>
  MOCK_ZONE_PROFILES[asString(zoneId).toLowerCase()] ||
  MOCK_ZONE_PROFILES[DEFAULT_ZONE_ID];

export const buildMockZoneChatSearch = (input = {}, source = "portmap") => {
  const zoneId = resolveZoneId(input);
  const profile = getMockZoneProfile(zoneId);
  const leadMachine = asArray(input.machines)[0] || {};
  const leadAlarm =
    asArray(input.alarms).find((alarm) => String(alarm.status || "active").toLowerCase() === "active") ||
    asArray(input.alarms)[0] ||
    {};
  const machineId =
    input.machine_id ??
    input.machineId ??
    leadMachine.id ??
    `${zoneId}-plc`;
  const machineName =
    asString(input.machine_name || input.machineName) ||
    asString(leadMachine.name) ||
    profile.defaultMachineName;
  const zoneName = asString(input.zoneName || input.name) || profile.zoneName;
  const errorCode =
    asString(input.error_code || input.errorCode) ||
    asString(leadAlarm.error_code || leadMachine.error_code) ||
    profile.primaryErrorCode;
  const mockSessionToken =
    asString(input.mockSession || input.mockSessionToken) ||
    createMockZoneSessionToken();
  const params = new URLSearchParams({
    mockZone: "1",
    mockSession: mockSessionToken,
    zoneId,
    zoneName,
    machineId: String(machineId),
    machineName,
    errorCode,
    source,
  });

  return params.toString();
};

export const buildMockZoneChatUrl = (input = {}, source = "portmap") =>
  `/chat?${buildMockZoneChatSearch(input, source)}`;

export const getMockZoneRouteContext = (search) => {
  const params = new URLSearchParams(search || "");
  if (params.get("mockZone") !== "1") return null;

  const zoneId = resolveZoneId({ zoneId: params.get("zoneId") || DEFAULT_ZONE_ID });
  const profile = getMockZoneProfile(zoneId);

  return {
    sessionId: buildMockZoneSessionId(
      zoneId,
      asString(params.get("mockSession")),
    ),
    zoneId,
    zoneName: asString(params.get("zoneName")) || profile.zoneName,
    machineId: asString(params.get("machineId")) || `${zoneId}-plc`,
    machineName:
      asString(params.get("machineName")) || profile.defaultMachineName,
    errorCode:
      asString(params.get("errorCode")) || profile.primaryErrorCode,
    source: asString(params.get("source")) || "portmap",
  };
};

export const buildMockZoneRuntimeContext = ({
  routeContext,
  dashboard,
  zoneSummaries: providedZoneSummaries,
  machines: providedMachines,
  alarms: providedAlarms,
  actions: providedActions,
}) => {
  if (!routeContext) return null;

  const profile = getMockZoneProfile(routeContext.zoneId);
  const machines = providedMachines || dashboard?.machines || [];
  const alarms = providedAlarms || dashboard?.recent_alarms || [];
  const actions = providedActions || dashboard?.recent_actions || [];
  const zoneSummaries =
    providedZoneSummaries ||
    buildZoneSummaries({
    machines,
    alarms,
    actions,
  });
  const mappedZoneSummary =
    zoneSummaries.find((zone) => zone.id === routeContext.zoneId) || null;
  const routeMatchedMachines = asArray(machines).filter((machine) =>
    matchesRouteMachine(machine, routeContext),
  );
  const routeMatchedAlarms = asArray(alarms).filter((alarm) =>
    matchesRouteMachine(alarm, routeContext),
  );
  const routeMatchedActions = asArray(actions).filter((action) =>
    matchesRouteMachine(action, routeContext),
  );
  const mergedMachines = mergeMatchedItems(
    mappedZoneSummary?.machines,
    routeMatchedMachines,
  );
  const mergedAlarms = mergeMatchedItems(
    mappedZoneSummary?.alarms,
    routeMatchedAlarms,
  );
  const mergedActions = mergeMatchedItems(
    mappedZoneSummary?.actions,
    routeMatchedActions,
  );
  const zoneSummary = {
    ...mappedZoneSummary,
    id: routeContext.zoneId,
    name: routeContext.zoneName || mappedZoneSummary?.name || profile.zoneName,
    title: mappedZoneSummary?.title || profile.zoneTitle,
    machines: mergedMachines,
    alarms: mergedAlarms,
    actions: mergedActions,
    activeIncidentCount: mergedAlarms.filter(
      (alarm) => String(alarm.status || "active").toLowerCase() === "active",
    ).length,
    criticalCount: mergedAlarms.filter(
      (alarm) =>
        String(alarm.status || "active").toLowerCase() === "active" &&
        String(alarm.severity || "").toLowerCase() === "critical",
    ).length,
    machineCount: mergedMachines.length,
  };

  const machine = pickMatchingMachine(zoneSummary, routeContext);
  const alarm = pickMatchingAlarm(zoneSummary, routeContext);
  const machineName =
    routeContext.machineName ||
    machine?.name ||
    alarm?.machine_name ||
    profile.defaultMachineName;
  const action = pickMatchingAction(zoneSummary, machineName);
  const plcModel =
    machine?.model && machine.model !== "Unknown"
      ? machine.model
      : profile.plcModel;
  const errorCode =
    routeContext.errorCode ||
    alarm?.error_code ||
    action?.error_code ||
    machine?.error_code ||
    profile.primaryErrorCode;
  const logLines = uniqueLines([
    formatAlarmLog(alarm, machineName, errorCode),
    formatActionLog(action, machineName),
    ...profile.logLines,
  ]).slice(0, 4);

  return {
    sessionId:
      routeContext.sessionId || buildMockZoneSessionId(routeContext.zoneId),
    zoneId: routeContext.zoneId,
    zoneName: routeContext.zoneName || zoneSummary?.name || profile.zoneName,
    zoneTitle: zoneSummary?.title || profile.zoneTitle,
    source: routeContext.source || "portmap",
    sessionTitle: `${routeContext.zoneName || profile.zoneName} diagnostics`,
    machineId: routeContext.machineId || machine?.id || `${routeContext.zoneId}-plc`,
    machineName,
    plcModel,
    errorCode,
    activeIncidentCount: zoneSummary?.activeIncidentCount || (alarm ? 1 : 0),
    criticalCount:
      zoneSummary?.criticalCount ||
      (String(alarm?.severity || "").toLowerCase() === "critical" ? 1 : 0),
    machineCount: zoneSummary?.machineCount || (machine ? 1 : 0),
    likelyCause: profile.likelyCause,
    immediateActions: profile.immediateActions,
    latestRelevantLog:
      logLines[0] ||
      `${machineName} reported ${errorCode} in ${routeContext.zoneName || profile.zoneName}.`,
    logLines,
    liveEnrichment: {
      machineName: machine?.name || alarm?.machine_name || "",
      alarmMessage: alarm?.message || "",
      actionMessage:
        action?.execution_result?.message || action?.message || "",
    },
  };
};

export const buildMockZonePrompt = (context) => {
  const recentLogs = asArray(context?.logLines).slice(0, 3);

  return [
    `${context.plcModel} + ${context.errorCode}`,
    "",
    `Please review ${context.zoneName}.`,
    `Zone ${context.zoneName} is using PLC model ${context.plcModel}.`,
    `The affected machine is ${context.machineName} (ID: ${context.machineId}).`,
    `We found error code ${context.errorCode} in the latest logs.`,
    `Current incidents in this zone: ${context.activeIncidentCount} active and ${context.criticalCount} critical.`,
    "",
    "Recent zone logs:",
    ...recentLogs.map((line, index) => `${index + 1}. ${line}`),
    "",
    "Can you diagnose the issue, explain the likely cause, and suggest safe recovery steps?",
  ].join("\n");
};

export const buildMockZoneAssistantReply = (context, userText = "") => {
  const requestSummary = asString(userText);
  const requestLine = requestSummary
    ? `- **Latest operator request**: ${requestSummary}`
    : null;

  return [
    `## ${context.zoneName} mock diagnostics`,
    "",
    "- **PLC model**: " + context.plcModel,
    "- **Machine**: " + context.machineName,
    "- **Detected error code**: " + context.errorCode,
    "- **Zone incidents**: " + `${context.activeIncidentCount} active / ${context.criticalCount} critical`,
    requestLine,
    "",
    "### What the log suggests",
    `- ${context.latestRelevantLog}`,
    ...context.logLines.slice(1).map((line) => `- ${line}`),
    "",
    "### Likely cause",
    `- ${context.likelyCause}`,
    "",
    "### Immediate next actions",
    ...context.immediateActions.map((step, index) => `${index + 1}. ${step}`),
  ]
    .filter(Boolean)
    .join("\n");
};

export const createMockZoneReplyChunks = (
  text,
  totalDurationMs = MOCK_STREAM_TOTAL_MS,
) => {
  const tokens = String(text || "").match(/\S+\s*/g) || [];
  if (tokens.length === 0) {
    return [{ text: "", delayMs: totalDurationMs }];
  }

  const chunkCount = Math.min(tokens.length, Math.max(12, Math.ceil(tokens.length / 8)));
  const tokensPerChunk = Math.max(1, Math.ceil(tokens.length / chunkCount));
  const delayMs = Math.max(80, Math.round(totalDurationMs / chunkCount));
  const chunks = [];

  for (let index = 0; index < tokens.length; index += tokensPerChunk) {
    chunks.push({
      text: tokens.slice(index, index + tokensPerChunk).join(""),
      delayMs,
    });
  }

  return chunks;
};

export const shouldUseMockZoneSend = ({
  routeContext,
  activeChatId,
  activeChat,
}) =>
  Boolean(routeContext) ||
  isMockZoneSessionId(activeChatId) ||
  Boolean(activeChat?.isMockZone);

export default {
  MOCK_ZONE_PROFILES,
  getMockZoneProfile,
  buildMockZoneChatSearch,
  buildMockZoneChatUrl,
  getMockZoneRouteContext,
  buildMockZoneRuntimeContext,
  buildMockZonePrompt,
  buildMockZoneAssistantReply,
  createMockZoneReplyChunks,
  shouldUseMockZoneSend,
};
