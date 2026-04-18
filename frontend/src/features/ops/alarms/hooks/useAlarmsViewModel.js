import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "../../../../utils/i18n";
import { useOpsSyncAlarms, useOpsSyncMeta } from "../../OpsSyncContext";
import {
  buildAlarmCounts,
  buildPrimaryAction,
  decorateIncidentRows,
  filterAlarms,
} from "./alarmUtils";
import useAlarmActions from "./useAlarmActions";

export default function useAlarmsViewModel() {
  const { t } = useT();
  const {
    connectionState,
    loading: opsLoading,
    error: opsError,
    liveError,
    refreshSyncedOps,
  } = useOpsSyncMeta();
  const { alarms } = useOpsSyncAlarms();

  const [ignoredAlarmIds, setIgnoredAlarmIds] = useState([]);
  const [error, setError] = useState("");

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [selectedAlarmId, setSelectedAlarmId] = useState(null);

  const loadAlarms = useCallback(async () => {
    setError("");
    return refreshSyncedOps({ force: true }).catch(() => {});
  }, [refreshSyncedOps]);

  useEffect(() => {
    setIgnoredAlarmIds((prev) =>
      prev.filter((alarmId) =>
        alarms.some(
          (alarm) => alarm.id === alarmId && alarm.status === "active",
        ),
      ),
    );
  }, [alarms]);

  const visibleAlarms = useMemo(
    () =>
      alarms.filter(
        (alarm) =>
          !(
            alarm.status === "active" && ignoredAlarmIds.includes(alarm.id)
          ),
      ),
    [alarms, ignoredAlarmIds],
  );

  const filteredAlarms = useMemo(
    () => filterAlarms({ alarms: visibleAlarms, searchQuery, statusFilter }),
    [searchQuery, statusFilter, visibleAlarms],
  );

  useEffect(() => {
    if (!filteredAlarms.length) {
      setSelectedAlarmId(null);
      return;
    }
    const selectedStillVisible = filteredAlarms.some((alarm) => alarm.id === selectedAlarmId);
    if (!selectedAlarmId || !selectedStillVisible) {
      setSelectedAlarmId(filteredAlarms[0].id);
    }
  }, [filteredAlarms, selectedAlarmId]);

  const selectedAlarm = useMemo(
    () => filteredAlarms.find((alarm) => alarm.id === selectedAlarmId) || null,
    [filteredAlarms, selectedAlarmId],
  );

  const counts = useMemo(() => buildAlarmCounts(alarms), [alarms]);
  const {
    diagnosticsByAlarm,
    plansByAlarm,
    resultsByAlarm,
    diagnosingId,
    planningId,
    approvingId,
    acknowledgingId,
    runDiagnose,
    runPlan,
    runApprove,
    runAcknowledge,
  } = useAlarmActions({ loadAlarms, setError });

  const selectedDiagnosis = selectedAlarm ? diagnosticsByAlarm[selectedAlarm.id] || null : null;
  const selectedPlan = selectedAlarm ? plansByAlarm[selectedAlarm.id] || null : null;
  const selectedResult = selectedAlarm ? resultsByAlarm[selectedAlarm.id] || null : null;

  const primaryAction = useMemo(
    () =>
      buildPrimaryAction({
        selectedAlarm,
        diagnosticsByAlarm,
        plansByAlarm,
        diagnosingId,
        planningId,
        approvingId,
        acknowledgingId,
        t,
      }),
    [
      acknowledgingId,
      approvingId,
      diagnosingId,
      diagnosticsByAlarm,
      planningId,
      plansByAlarm,
      selectedAlarm,
      t,
    ],
  );

  const triggerPrimaryAction = useCallback(async () => {
    if (!selectedAlarm || primaryAction.kind === "none") return;
    const actionHandlers = {
      diagnose: runDiagnose,
      plan: runPlan,
      acknowledge: runAcknowledge,
      approve: runApprove,
    };
    const handler = actionHandlers[primaryAction.kind];
    if (handler) {
      await handler(selectedAlarm);
    }
  }, [primaryAction.kind, runAcknowledge, runApprove, runDiagnose, runPlan, selectedAlarm]);

  const isPrimaryBusy = Boolean(
    selectedAlarm &&
      [diagnosingId, planningId, approvingId, acknowledgingId].some((busyId) => busyId === selectedAlarm.id),
  );

  const acknowledgeSelectedAlarm = useCallback(async () => {
    if (!selectedAlarm) return;
    await runAcknowledge(selectedAlarm);
  }, [runAcknowledge, selectedAlarm]);

  const acknowledgeAlarm = useCallback(
    async (alarm) => {
      if (!alarm) return;
      await runAcknowledge(alarm);
    },
    [runAcknowledge],
  );

  const ignoreSelectedAlarm = useCallback(() => {
    if (!selectedAlarm) return;
    setIgnoredAlarmIds((prev) =>
      prev.includes(selectedAlarm.id) ? prev : [...prev, selectedAlarm.id],
    );
  }, [selectedAlarm]);

  const incidentRows = useMemo(() => decorateIncidentRows(filteredAlarms), [filteredAlarms]);

  return {
    connectionState,
    alarms,
    loading: opsLoading,
    error: error || opsError || liveError,
    counts,
    statusFilter,
    setStatusFilter,
    searchQuery,
    setSearchQuery,
    incidentRows,
    selectedAlarm,
    setSelectedAlarmId,
    selectedDiagnosis,
    selectedPlan,
    selectedResult,
    primaryAction,
    triggerPrimaryAction,
    isPrimaryBusy,
    acknowledgeAlarm,
    acknowledgeSelectedAlarm,
    ignoreSelectedAlarm,
    isAcknowledgeBusy: Boolean(
      selectedAlarm && acknowledgingId === selectedAlarm.id,
    ),
    refresh: loadAlarms,
  };
}
