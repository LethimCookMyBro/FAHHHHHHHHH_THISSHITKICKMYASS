import {
  ChevronDown,
  ChevronUp,
  User,
  Cpu,
  Sparkles,
  Database,
  AlertCircle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { EmptyState, StatusPill } from "../../../../components/ui";
import { useT } from "../../../../utils/i18n";
import {
  looksLikeDiagnosticMarkdown,
  prepareMarkdownText,
} from "../../../../utils/markdownFormatting";

const actionDetailMarkdownComponents = {
  h1: ({ children }) => (
    <h1 className="message-md-heading message-md-h1">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="message-md-heading message-md-h2">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="message-md-heading message-md-h3">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="message-md-heading message-md-h4">{children}</h4>
  ),
  p: ({ children }) => <p className="message-md-p">{children}</p>,
  ul: ({ children }) => (
    <ul className="message-md-list message-md-list-ul">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="message-md-list message-md-list-ol">{children}</ol>
  ),
  li: ({ children }) => <li className="message-md-li">{children}</li>,
  strong: ({ children }) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
  a: ({ href, children }) => (
    <a
      href={href}
      style={{ color: "var(--primary)" }}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="message-md-quote">{children}</blockquote>
  ),
  hr: () => <hr className="message-md-hr" />,
  code: ({ children, inline }) =>
    inline ? (
      <code className="message-inline-code">{children}</code>
    ) : (
      <pre className="message-code-block">
        <code className="message-code-content">{children}</code>
      </pre>
    ),
};

const SOURCE_CONFIG = {
  ai: {
    icon: Sparkles,
    color: "var(--accent)",
  },
  system: {
    icon: Cpu,
    color: "var(--text-secondary)",
  },
  operator: {
    icon: User,
    color: "var(--warning)",
  },
  task: {
    icon: Database,
    color: "var(--ok)",
  },
  failure: {
    icon: AlertCircle,
    color: "var(--error)",
  },
};

function MarkdownDetail({ text, emptyText }) {
  const formatted = prepareMarkdownText(text || "");
  const hasContent = Boolean(formatted.trim());
  const isDiagnostic = looksLikeDiagnosticMarkdown(formatted);

  if (!hasContent) {
    return <p className="timeline-detail-text">{emptyText}</p>;
  }

  return (
    <div
      className={`timeline-detail-md message-markdown ${isDiagnostic ? "is-diagnostic" : ""}`}
    >
      <ReactMarkdown components={actionDetailMarkdownComponents}>
        {formatted}
      </ReactMarkdown>
    </div>
  );
}

export default function ActionTimeline({ rows, expandedId, onToggleExpand }) {
  const { t } = useT();

  if (!rows.length) {
    return (
      <EmptyState
        title={t("actions.noRecords")}
        message={t("actions.noRecordsFilter")}
      />
    );
  }

  return (
    <div className="action-timeline">
      <div className="timeline-spine" />

      {rows.map((row, index) => {
        const expanded = expandedId === row.id;
        const isFailed = row.execution_status === "failed";

        let configKey = row.source?.toLowerCase();
        if (isFailed) configKey = "failure";
        else if (row.action_type === "backup" || row.action_type === "task") {
          configKey = "task";
        }

        const config = SOURCE_CONFIG[configKey] || SOURCE_CONFIG.system;
        const SourceIcon = config.icon;

        return (
          <article
            key={row.id}
            className="timeline-item"
            style={{ "--timeline-delay": `${index * 0.05}s` }}
          >
            <div className="timeline-node" style={{ color: config.color }}>
              <SourceIcon size={19} strokeWidth={2.2} />
            </div>

            <div className="timeline-content">
              <button
                type="button"
                className={`timeline-head ${expanded ? "is-expanded" : ""}`}
                onClick={() => onToggleExpand(expanded ? null : row.id)}
              >
                <div className="timeline-head-main">
                  <span className="timeline-type">{row.action_type || "action"}</span>
                  <span className="timeline-machine">{row.machineText}</span>
                </div>
                <div className="timeline-head-right">
                  <StatusPill status={row.execution_status || "planned"} />
                  <span className="timeline-time">{row.createdText}</span>
                  {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </div>
              </button>

              {expanded ? (
                <div className="timeline-body">
                  <div className="timeline-detail-grid">
                    <div className="timeline-detail-block">
                      <h4 className="timeline-detail-label">{t("actions.decisionReason")}</h4>
                      <p className="timeline-detail-text">{row.reasonText}</p>
                    </div>
                    <div className="timeline-detail-block">
                      <h4 className="timeline-detail-label">{t("actions.result")}</h4>
                      <p className="timeline-detail-text">
                        {row.execution_result?.message ||
                          row.execution_status ||
                          t("actions.noExecutionSummary")}
                      </p>
                    </div>
                    <div className="timeline-detail-block">
                      <h4 className="timeline-detail-label">{t("actions.diagnosisLabel")}</h4>
                      <MarkdownDetail
                        text={row.diagnosis}
                        emptyText={t("actions.noDiagnosis")}
                      />
                    </div>
                    <div className="timeline-detail-block">
                      <h4 className="timeline-detail-label">
                        {t("actions.recommendation")}
                      </h4>
                      <MarkdownDetail
                        text={row.recommendation}
                        emptyText={t("actions.noRecommendation")}
                      />
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
