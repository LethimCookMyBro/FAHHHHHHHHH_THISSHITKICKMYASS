import { Bot, Info, MapPinned, RadioTower, ShieldCheck, Wrench } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useMemo } from "react";
import { useT } from "../../../../utils/i18n";
import { prepareMarkdownText } from "../../../../utils/markdownFormatting";

const getAlarmDisplayId = (alarmId) => {
  if (alarmId === null || alarmId === undefined || alarmId === "") return "-";
  return String(alarmId).split("-")[0];
};

const formatTimestamp = (value, t) => {
  if (!value) return t("common.noTimestamp");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const markdownComponents = {
  h1: ({ children }) => <h1 className="message-md-heading message-md-h1">{children}</h1>,
  h2: ({ children }) => <h2 className="message-md-heading message-md-h2">{children}</h2>,
  h3: ({ children }) => <h3 className="message-md-heading message-md-h3">{children}</h3>,
  p: ({ children }) => <p className="message-md-p">{children}</p>,
  ul: ({ children }) => <ul className="message-md-list message-md-list-ul">{children}</ul>,
  ol: ({ children }) => <ol className="message-md-list message-md-list-ol">{children}</ol>,
  li: ({ children }) => <li className="message-md-li">{children}</li>,
  code: ({ children, inline }) =>
    inline ? (
      <code className="message-inline-code">{children}</code>
    ) : (
      <pre className="message-code-block">
        <code className="message-code-content">{children}</code>
      </pre>
    ),
};

const MARKDOWN_SECTION_RE = /^\s*#{2,}\s+(.+?)\s*$/;

const normalizeSectionKey = (value) =>
  String(value || "").trim().toLowerCase().replace(/\s+/g, " ");

const parseMarkdownSections = (text) => {
  const sections = new Map();
  let currentSection = "__lead__";
  sections.set(currentSection, []);

  for (const line of String(text || "").split("\n")) {
    const match = line.match(MARKDOWN_SECTION_RE);
    if (match) {
      currentSection = normalizeSectionKey(match[1]);
      if (!sections.has(currentSection)) {
        sections.set(currentSection, []);
      }
      continue;
    }

    sections.get(currentSection)?.push(line);
  }

  return sections;
};

const getSectionText = (sections, ...keys) => {
  for (const key of keys) {
    const value = sections.get(normalizeSectionKey(key));
    if (!value?.length) continue;
    const joined = value.join("\n").trim();
    if (joined) return joined;
  }
  return "";
};

const toOrderedMarkdown = (items) =>
  (Array.isArray(items) ? items : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .map((item, index) => `${index + 1}. ${item}`);

const toBulletMarkdown = (items) =>
  (Array.isArray(items) ? items : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .map((item) => `- ${item}`);

const buildDiagnosisSummaryMarkdown = (text) => {
  const prepared = prepareMarkdownText(text || "");
  if (!prepared) return "";

  const sections = parseMarkdownSections(prepared);
  const notes = getSectionText(sections, "Prerequisites / Notes", "Prerequisites/Notes");
  if (notes) {
    return `### Prerequisites / Notes\n${notes}`;
  }

  return getSectionText(sections, "__lead__") || prepared;
};

const buildPlanMarkdown = (plan, fallbackRecommendation, t) => {
  const nextPlan =
    plan?.plan && typeof plan.plan === "object" && !Array.isArray(plan.plan)
      ? plan.plan
      : null;
  const sections = [];

  if (nextPlan?.title) {
    sections.push(`### ${nextPlan.title}`);
  }

  if (nextPlan?.reason) {
    sections.push(nextPlan.reason);
  }

  const steps = toOrderedMarkdown(nextPlan?.steps);
  if (steps.length) {
    sections.push(`#### ${t("alarms.executionSteps")}\n${steps.join("\n")}`);
  }

  const checklist = toBulletMarkdown(nextPlan?.checklist);
  if (checklist.length) {
    sections.push(`#### ${t("alarms.manualChecklist")}\n${checklist.join("\n")}`);
  }

  const preparedFallback = prepareMarkdownText(fallbackRecommendation || "");
  if (preparedFallback) {
    sections.push(`#### ${t("alarms.referenceGuidance")}\n${preparedFallback}`);
  }

  if (!sections.length) {
    return preparedFallback;
  }

  return sections.join("\n\n");
};

const getResultMessage = (result) =>
  result?.execution_result?.message || result?.result?.message || result?.message || "";

const buildSignalCards = (alarm, t) => {
  const sensors = alarm?.raw_data?.sensors || {};
  const entries = [
    {
      label: t("alarms.temperature"),
      value: sensors.temperature ?? alarm?.raw_data?.temperature,
      unit: "C",
    },
    {
      label: t("alarms.current"),
      value: sensors.current ?? alarm?.raw_data?.current,
      unit: "A",
    },
    {
      label: t("alarms.vibration"),
      value: sensors.vibration ?? alarm?.raw_data?.vibration,
      unit: "G",
    },
    {
      label: t("alarms.pressure"),
      value: sensors.pressure ?? alarm?.raw_data?.pressure,
      unit: "bar",
    },
  ];

  return entries.map((entry) => {
    const numeric = Number(entry.value);
    return {
      ...entry,
      text: Number.isFinite(numeric) ? `${numeric.toFixed(1)} ${entry.unit}` : t("alarms.noSignal"),
    };
  });
};

export default function DecisionPanel({
  selectedAlarm,
  diagnosis,
  plan,
  result,
  primaryAction,
  onPrimaryAction,
  primaryBusy,
  onAcknowledge,
  acknowledgeBusy,
  onIgnore,
  onOpenChat,
  onOpenMap,
}) {
  const { t } = useT();

  const diagnosisMarkdown = useMemo(
    () => buildDiagnosisSummaryMarkdown(diagnosis?.diagnosis || ""),
    [diagnosis?.diagnosis],
  );
  const recommendationMarkdown = useMemo(
    () => buildPlanMarkdown(plan, plan?.recommendation || diagnosis?.recommendation || "", t),
    [diagnosis?.recommendation, plan, t],
  );
  const signalCards = useMemo(
    () => buildSignalCards(selectedAlarm, t),
    [selectedAlarm, t],
  );
  const planStateLabel = !plan?.plan
    ? ""
    : plan.plan.allowed
      ? t("alarms.autoExecuteAvailable")
      : t("alarms.manualInterventionRequired");
  const resultMessage = getResultMessage(result);

  if (!selectedAlarm) {
    return (
      <section className="decision-panel empty">
        <div className="decision-empty-icon">
          <RadioTower size={32} />
        </div>
        <h3>{t("alarms.selectIncident")}</h3>
        <p>{t("alarms.selectHint")}</p>
      </section>
    );
  }

  return (
    <section className="decision-panel">
      <header className="decision-panel-head">
        <div>
          <h3>{selectedAlarm.error_code || t("alarms.incidentAnalysis")}</h3>
          <p>{selectedAlarm.machine_name || t("alarms.unknownMachine")}</p>
          <div className="decision-meta-pills">
            <span>{t("alarms.idLabel", { id: getAlarmDisplayId(selectedAlarm.id) })}</span>
            <span>{t(`status.${selectedAlarm.status || "active"}`)}</span>
            <span>{t(`status.${selectedAlarm.severity || "warning"}`)}</span>
            <span>{selectedAlarm.category || t("common.unknown")}</span>
          </div>
        </div>
        <span className="decision-confidence">
          {t("alarms.confidence")}:{" "}
          {Math.round((diagnosis?.confidence || 0.94) * 100)}%
          <span
            className="decision-info-icon"
            title={t("alarms.confidenceHint")}
          >
            <Info size={12} />
          </span>
        </span>
      </header>

      <div className="decision-scroll">
      <div className="decision-grid">
        <article className="decision-card">
          <h4>
            <RadioTower size={16} /> {t("alarms.liveSignalSnapshot")}
          </h4>
          <div className="decision-signal-grid">
            {signalCards.map((card) => (
              <div key={card.label} className="decision-signal-card">
                <span>{card.label}</span>
                <strong>{card.text}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="decision-card">
          <h4>
            <ShieldCheck size={16} /> {t("alarms.incidentContext")}
          </h4>
          <div className="decision-context-list">
            <div>
              <span>{t("alarms.operatorNote")}</span>
              <strong>{selectedAlarm.message || t("alarms.noOperatorNote")}</strong>
            </div>
            <div>
              <span>{t("alarms.lastUpdate")}</span>
              <strong>
                {formatTimestamp(selectedAlarm.created_at || selectedAlarm.timestamp, t)}
              </strong>
            </div>
          </div>
        </article>

        <article className="decision-card decision-card-full">
          <h4>
            <Bot size={16} /> {t("alarms.diagnosis")}
          </h4>
          <div className="decision-markdown">
            {diagnosisMarkdown ? (
              <ReactMarkdown components={markdownComponents}>
                {diagnosisMarkdown}
              </ReactMarkdown>
            ) : (
              <div className="decision-empty-cta">
                <span className="decision-empty-robot">AI</span>
                <p>{t("alarms.runDiagnoseAi")}</p>
                <button
                  type="button"
                  className="app-topbar-btn primary"
                  onClick={onPrimaryAction}
                >
                  {t("alarms.runDiagnoseButton")}
                </button>
              </div>
            )}
          </div>
        </article>

        <article className="decision-card decision-card-full">
          <div className="decision-card-title-row">
            <h4>
              <Wrench size={16} /> {t("alarms.recommendedNext")}
            </h4>
            {planStateLabel ? (
              <span
                className={`decision-plan-state${plan?.plan?.allowed ? "" : " is-manual"}`}
              >
                {planStateLabel}
              </span>
            ) : null}
          </div>
          <div className="decision-markdown">
            {recommendationMarkdown ? (
              <ReactMarkdown components={markdownComponents}>
                {recommendationMarkdown}
              </ReactMarkdown>
            ) : (
              <p>{t("alarms.runDiagnose")}</p>
            )}
            {resultMessage ? (
              <p className="decision-result-copy">
                {t("alarms.latestActionResult", {
                  message: resultMessage,
                })}
              </p>
            ) : null}
          </div>
        </article>
      </div>
      </div>

      <footer className="decision-actions">
        <button type="button" onClick={() => onOpenMap?.(selectedAlarm)}>
          <MapPinned size={14} />
          {t("nav.portMap")}
        </button>
        <button type="button" onClick={() => onOpenChat?.(selectedAlarm)}>
          <Bot size={14} />
          {t("chat.brand")}
        </button>
        <button type="button" onClick={onIgnore}>
          {t("alarms.ignore")}
        </button>
        <button type="button" onClick={onAcknowledge} disabled={acknowledgeBusy}>
          {acknowledgeBusy ? t("common.loading") : t("alarms.acknowledge")}
        </button>
        <button
          type="button"
          className="primary"
          onClick={onPrimaryAction}
          disabled={primaryAction.disabled || primaryBusy}
        >
          {primaryBusy ? t("common.loading") : primaryAction.label}
        </button>
      </footer>
    </section>
  );
}
