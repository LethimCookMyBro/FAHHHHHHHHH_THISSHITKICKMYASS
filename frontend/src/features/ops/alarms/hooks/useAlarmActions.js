import { useCallback, useState } from "react";
import { getApiErrorMessage } from "../../../../utils/api";
import { useT } from "../../../../utils/i18n";
import { acknowledgeAlarm, approvePlan, createPlan, diagnoseAlarm } from "./alarmApi";
import { createFallbackDiagnosis } from "./alarmUtils";

export default function useAlarmActions({ loadAlarms, setError }) {
  const { t } = useT();
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
        setPlansByAlarm((prev) => {
          if (!(alarm.id in prev)) return prev;
          const next = { ...prev };
          delete next[alarm.id];
          return next;
        });
        setResultsByAlarm((prev) => {
          if (!(alarm.id in prev)) return prev;
          const next = { ...prev };
          delete next[alarm.id];
          return next;
        });
        await loadAlarms();
        return diagnosis;
      } catch (requestError) {
        const fallbackDiagnosis = createFallbackDiagnosis(t);
        setError(getApiErrorMessage(requestError, t("alarms.failedToRunDiagnosis")));
        setDiagnosticsByAlarm((prev) => ({ ...prev, [alarm.id]: fallbackDiagnosis }));
        return fallbackDiagnosis;
      } finally {
        setDiagnosingId(null);
      }
    },
    [diagnosticsByAlarm, loadAlarms, setError, t],
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
        setResultsByAlarm((prev) => {
          if (!(alarm.id in prev)) return prev;
          const next = { ...prev };
          delete next[alarm.id];
          return next;
        });
        await loadAlarms();
        return plan;
      } catch (requestError) {
        setError(getApiErrorMessage(requestError, t("alarms.failedToCreatePlan")));
        return null;
      } finally {
        setPlanningId(null);
      }
    },
    [diagnosticsByAlarm, loadAlarms, runDiagnose, setError, t],
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
        setError(getApiErrorMessage(requestError, t("alarms.failedToApprovePlan")));
        return null;
      } finally {
        setApprovingId(null);
      }
    },
    [loadAlarms, plansByAlarm, setError, t],
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
        setError(getApiErrorMessage(requestError, t("alarms.failedToAcknowledge")));
        return null;
      } finally {
        setAcknowledgingId(null);
      }
    },
    [loadAlarms, setError, t],
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
