import { useCallback, useState } from "react";
import { getApiErrorMessage } from "../../../../utils/api";
import { acknowledgeAlarm, approvePlan, createPlan, diagnoseAlarm } from "./alarmApi";
import { FALLBACK_DIAGNOSIS } from "./alarmUtils";

export default function useAlarmActions({ loadAlarms, setError }) {
  const [diagnosticsByAlarm, setDiagnosticsByAlarm] = useState({});
  const [plansByAlarm, setPlansByAlarm] = useState({});
  const [resultsByAlarm, setResultsByAlarm] = useState({});

  const [diagnosingId, setDiagnosingId] = useState(null);
  const [planningId, setPlanningId] = useState(null);
  const [approvingId, setApprovingId] = useState(null);
  const [acknowledgingId, setAcknowledgingId] = useState(null);

  const runDiagnose = useCallback(
    async (alarm) => {
      if (!alarm) return null;
      const cached = diagnosticsByAlarm[alarm.id];
      if (cached) return cached;

      setDiagnosingId(alarm.id);
      setError("");
      try {
        const diagnosis = await diagnoseAlarm(alarm);
        setDiagnosticsByAlarm((prev) => ({ ...prev, [alarm.id]: diagnosis }));
        return diagnosis;
      } catch (requestError) {
        setError(getApiErrorMessage(requestError, "Failed to run diagnosis"));
        setDiagnosticsByAlarm((prev) => ({ ...prev, [alarm.id]: FALLBACK_DIAGNOSIS }));
        return FALLBACK_DIAGNOSIS;
      } finally {
        setDiagnosingId(null);
      }
    },
    [diagnosticsByAlarm, setError],
  );

  const runPlan = useCallback(
    async (alarm) => {
      if (!alarm) return null;
      setPlanningId(alarm.id);
      setError("");
      try {
        const diagnosis = diagnosticsByAlarm[alarm.id] || (await runDiagnose(alarm));
        const plan = await createPlan(alarm, diagnosis);
        setPlansByAlarm((prev) => ({ ...prev, [alarm.id]: plan }));
        return plan;
      } catch (requestError) {
        setError(getApiErrorMessage(requestError, "Failed to create action plan"));
        return null;
      } finally {
        setPlanningId(null);
      }
    },
    [diagnosticsByAlarm, runDiagnose, setError],
  );

  const runApprove = useCallback(
    async (alarm) => {
      if (!alarm) return null;
      const actionId = plansByAlarm[alarm.id]?.action_id;
      if (!actionId) return null;

      setApprovingId(alarm.id);
      setError("");
      try {
        const result = await approvePlan(actionId);
        setResultsByAlarm((prev) => ({ ...prev, [alarm.id]: result }));
        await loadAlarms();
        return result;
      } catch (requestError) {
        setError(getApiErrorMessage(requestError, "Failed to approve planned action"));
        return null;
      } finally {
        setApprovingId(null);
      }
    },
    [loadAlarms, plansByAlarm, setError],
  );

  const runAcknowledge = useCallback(
    async (alarm) => {
      if (!alarm) return null;
      setAcknowledgingId(alarm.id);
      setError("");
      try {
        await acknowledgeAlarm(alarm.id);
        await loadAlarms();
        return { ok: true };
      } catch (requestError) {
        setError(getApiErrorMessage(requestError, "Failed to acknowledge incident"));
        return null;
      } finally {
        setAcknowledgingId(null);
      }
    },
    [loadAlarms, setError],
  );

  return {
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
  };
}
