import { useState, useCallback, useRef, useEffect } from "react";
import { readResponseErrorMessage, streamApiRequest } from "../utils/api";
import { useT } from "../utils/i18n";

// Strict state machine transitions to prevent state leaks
const ALLOWED_TRANSITIONS = {
  idle: ["confirming", "executing", "streaming"],
  confirming: ["executing", "idle"], // idle if cancelled
  executing: ["streaming", "completed", "failed", "cancelled"],
  streaming: ["completed", "failed", "cancelled"],
  completed: ["idle"],
  failed: ["idle"],
  cancelled: ["idle"],
};

const generateIdempotencyKey = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const buildProgressProfiles = (t) => ({
  predictive_analysis: [
    { step: t("agent.initializingRequest"), percent: 6, delayMs: 280 },
    { step: t("agent.loadingTelemetryWindows"), percent: 18, delayMs: 900 },
    { step: t("agent.validatingSensorIntegrity"), percent: 34, delayMs: 1900 },
    { step: t("agent.runningAnomalyInference"), percent: 58, delayMs: 3600 },
    { step: t("agent.correlatingSignals"), percent: 76, delayMs: 5400 },
    { step: t("agent.draftingRationale"), percent: 91, delayMs: 7600 },
  ],
  system_scan: [
    { step: t("agent.initializingRequest"), percent: 8, delayMs: 260 },
    { step: t("agent.discoveringControllers"), percent: 20, delayMs: 820 },
    { step: t("agent.pollingRoutes"), percent: 38, delayMs: 1700 },
    { step: t("agent.tracingPaths"), percent: 56, delayMs: 3100 },
    { step: t("agent.resolvingDependencies"), percent: 73, delayMs: 4800 },
    { step: t("agent.composingFindings"), percent: 89, delayMs: 6700 },
  ],
  default: [
    { step: t("agent.initializingRequest"), percent: 8, delayMs: 250 },
    { step: t("agent.preparingContext"), percent: 24, delayMs: 900 },
    { step: t("agent.runningReasoning"), percent: 52, delayMs: 2500 },
    { step: t("agent.formattingOutput"), percent: 76, delayMs: 4300 },
    { step: t("agent.finalizingResponse"), percent: 92, delayMs: 6200 },
  ],
});

const clampPercent = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return null;
  }

  return Math.min(100, Math.max(0, Math.round(numericValue)));
};

export default function useAgentAction({
  deviceId,
  actionName,
  endpoint = "/api/agent/action",
}) {
  const { t } = useT();
  const stateRef = useRef("idle");
  const [state, setState] = useState("idle");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [partialText, setPartialText] = useState("");
  const [progress, setProgress] = useState({ step: "", percent: 0 });

  const abortControllerRef = useRef(null);
  const progressAnimationRef = useRef(null);
  const progressStageTimeoutRef = useRef([]);
  const progressTargetRef = useRef(0);
  const progressStepRef = useRef("");
  const progressProfilesRef = useRef(buildProgressProfiles(t));

  useEffect(() => {
    progressProfilesRef.current = buildProgressProfiles(t);
  }, [t]);

  // Safe state transition guard (Synchronous via Ref)
  const transitionTo = useCallback((nextState) => {
    const currentState = stateRef.current;
    const allowed = ALLOWED_TRANSITIONS[currentState] || [];

    if (allowed.includes(nextState)) {
      stateRef.current = nextState;
      setState(nextState);
      return true;
    }

    console.error(
      `[useAgentAction] Illegal transition from ${currentState} to ${nextState}. You must reset() the state first.`,
    );
    return false;
  }, []);

  const clearProgressSimulation = useCallback(() => {
    if (progressAnimationRef.current) {
      clearInterval(progressAnimationRef.current);
      progressAnimationRef.current = null;
    }

    progressStageTimeoutRef.current.forEach((timeoutId) => {
      clearTimeout(timeoutId);
    });
    progressStageTimeoutRef.current = [];
  }, []);

  const queueProgressUpdate = useCallback((step, percent, forcePercent = false) => {
    if (typeof step === "string" && step.trim()) {
      progressStepRef.current = step.trim();
    }

    const nextTarget = clampPercent(percent);
    if (nextTarget !== null) {
      progressTargetRef.current = Math.max(progressTargetRef.current, nextTarget);
    }

    setProgress((current) => {
      const nextStep = progressStepRef.current || current.step;
      const nextPercent = forcePercent
        ? Math.max(current.percent, progressTargetRef.current)
        : current.percent;

      if (nextStep === current.step && nextPercent === current.percent) {
        return current;
      }

      return {
        step: nextStep,
        percent: nextPercent,
      };
    });
  }, []);

  const startProgressSimulation = useCallback(() => {
    const profiles = progressProfilesRef.current;
    const profile = profiles[actionName] || profiles.default;

    clearProgressSimulation();
    progressTargetRef.current = 0;
    progressStepRef.current = t("agent.initializingRequest");
    setProgress({ step: progressStepRef.current, percent: 0 });

    progressAnimationRef.current = setInterval(() => {
      setProgress((current) => {
        const targetPercent = Math.max(current.percent, progressTargetRef.current);
        const step = progressStepRef.current || current.step;

        if (current.percent >= targetPercent && current.step === step) {
          return current;
        }

        const remaining = targetPercent - current.percent;
        const increment =
          remaining <= 0 ? 0 : Math.max(1, Math.ceil(remaining / (targetPercent >= 90 ? 10 : 6)));

        return {
          step,
          percent: remaining <= 0 ? current.percent : Math.min(targetPercent, current.percent + increment),
        };
      });
    }, 140);

    progressStageTimeoutRef.current = profile.map((stage) =>
      setTimeout(() => {
        queueProgressUpdate(stage.step, stage.percent);
      }, stage.delayMs),
    );
  }, [actionName, clearProgressSimulation, queueProgressUpdate, t]);

  const reset = useCallback(() => {
    if (transitionTo("idle") || stateRef.current === "idle") {
      clearProgressSimulation();
      progressTargetRef.current = 0;
      progressStepRef.current = "";
      setData(null);
      setError(null);
      setPartialText("");
      setProgress({ step: "", percent: 0 });

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    }
  }, [clearProgressSimulation, transitionTo]);

  const cancel = useCallback(() => {
    if (stateRef.current === "idle") {
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    clearProgressSimulation();
    progressTargetRef.current = 0;
    progressStepRef.current = "";
    transitionTo("cancelled");
  }, [clearProgressSimulation, transitionTo]);

  const execute = useCallback(
    async (payload = {}, mode = "execute") => {
      // 1. Guard check: Only begin execution if state transitions successfully
      if (!transitionTo("executing")) {
        return;
      }

      setData(null);
      setError(null);
      setPartialText("");
      startProgressSimulation();

      const idempotencyKey = generateIdempotencyKey();
      abortControllerRef.current = new AbortController();

      try {
        const response = await streamApiRequest(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Idempotency-Key": idempotencyKey,
            Accept: "text/event-stream",
          },
          body: JSON.stringify({
            deviceId,
            actionName,
            mode,
            ...payload,
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(
            await readResponseErrorMessage(
              response,
              t("agent.executionFailed", { status: response.status }),
            ),
          );
        }

        if (abortControllerRef.current?.signal?.aborted || stateRef.current === "cancelled") {
          return;
        }

        transitionTo("streaming");

        if (!response.body) {
          throw new Error(t("agent.streamingUnavailable"));
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        let isStreaming = true;

        while (isStreaming) {
          const { done, value } = await reader.read();
          if (done) {
            isStreaming = false;
            continue;
          }

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || ""; // keep incomplete event in buffer

          for (const part of parts) {
            if (!part.trim()) continue;

            // Very simple SSE parsing (assumes "data: {...}")
            const dataMatch = part.match(/^data:\s*(.+)$/m);
            const eventMatch = part.match(/^event:\s*(.+)$/m);

            if (dataMatch) {
              try {
                const parsed = JSON.parse(dataMatch[1]);
                const eventType = eventMatch ? eventMatch[1].trim() : "message";

                switch (eventType) {
                  case "status":
                    queueProgressUpdate(parsed.message, parsed.percent);
                    break;
                  case "reasoning":
                  case "partial":
                    queueProgressUpdate(parsed.message, 78);
                    setPartialText((prev) => prev + (parsed.text || ""));
                    break;
                  case "partial-structured":
                    // Handle streaming updates to the final schema if backend supports it
                    queueProgressUpdate(t("agent.consolidatingResults"), 88);
                    setData((prev) => ({ ...(prev || {}), ...parsed }));
                    break;
                  case "completed":
                    clearProgressSimulation();
                    queueProgressUpdate(t("agent.completed"), 100, true);
                    setData(parsed.result || parsed);
                    break;
                  case "error":
                    throw new Error(
                      parsed.message || t("agent.streamingError"),
                    );
                  default:
                    setPartialText((prev) => prev + (parsed.text || ""));
                }
              } catch (e) {
                // Not JSON, might be raw text fallback
                setPartialText((prev) => prev + dataMatch[1]);
              }
            }
          }
        }

        clearProgressSimulation();
        queueProgressUpdate(t("agent.completed"), 100, true);
        transitionTo("completed");
      } catch (err) {
        clearProgressSimulation();
        if (err?.name === "AbortError") {
          if (stateRef.current !== "cancelled") {
            transitionTo("cancelled");
          }
        } else {
          setError(String(err?.message || t("agent.requestFailed")));
          transitionTo("failed");
        }
      } finally {
        clearProgressSimulation();
        abortControllerRef.current = null;
      }
    },
    [
      actionName,
      clearProgressSimulation,
      deviceId,
      endpoint,
      queueProgressUpdate,
      startProgressSimulation,
      t,
      transitionTo,
    ],
  );

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      clearProgressSimulation();
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [clearProgressSimulation]);

  return {
    state,
    execute,
    cancel,
    reset,
    requestConfirm: () => transitionTo("confirming"),
    data,
    partialText,
    error,
    progress,
    isIdle: state === "idle",
    isConfirming: state === "confirming",
    isExecuting: state === "executing",
    isStreaming: state === "streaming",
    isCompleted: state === "completed",
    isFailed: state === "failed",
    isCancelled: state === "cancelled",
    isBusy: state === "executing" || state === "streaming",
  };
}
