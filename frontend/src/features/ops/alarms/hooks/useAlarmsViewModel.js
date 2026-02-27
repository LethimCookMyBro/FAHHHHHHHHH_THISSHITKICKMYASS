import { useCallback, useEffect, useMemo, useState } from "react";
import { getApiErrorMessage } from "../../../../utils/api";
import { usePlcLiveDataContext } from "../../../plc/PlcLiveDataContext";
import { fetchAlarms } from "./alarmApi";
import {
  buildAlarmCounts,
  buildPrimaryAction,
  decorateIncidentRows,
  filterAlarms,
} from "./alarmUtils";
import useAlarmActions from "./useAlarmActions";

export default function useAlarmsViewModel() {
  const { connectionState } = usePlcLiveDataContext();

  const [alarms, setAlarms] = useState([]);
  const [ignoredAlarmIds, setIgnoredAlarmIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [selectedAlarmId, setSelectedAlarmId] = useState(null);

  const loadAlarms = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const nextAlarms = await fetchAlarms();
      setAlarms(nextAlarms);
      setIgnoredAlarmIds((prev) =>
        prev.filter((alarmId) =>
          nextAlarms.some(
            (alarm) => alarm.id === alarmId && alarm.status === "active",
          ),
        ),
      );
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Failed to load incident queue"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAlarms();
  }, [loadAlarms]);

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
      }),
    [
      acknowledgingId,
      approvingId,
      diagnosingId,
      diagnosticsByAlarm,
      planningId,
      plansByAlarm,
      selectedAlarm,
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

  const ignoreSelectedAlarm = useCallback(() => {
    if (!selectedAlarm) return;
    setIgnoredAlarmIds((prev) =>
      prev.includes(selectedAlarm.id) ? prev : [...prev, selectedAlarm.id],
    );
  }, [selectedAlarm]);

  const incidentRows = useMemo(() => decorateIncidentRows(filteredAlarms), [filteredAlarms]);

  return {
    connectionState,
    loading,
    error,
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
    acknowledgeSelectedAlarm,
    ignoreSelectedAlarm,
    isAcknowledgeBusy: Boolean(
      selectedAlarm && acknowledgingId === selectedAlarm.id,
    ),
    refresh: loadAlarms,
  };
}
