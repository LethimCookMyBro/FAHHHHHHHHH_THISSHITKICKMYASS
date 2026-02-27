import {
  Maximize2,
  X as CloseIcon,
  TrendingUp,
  Cpu,
  Bot,
  Settings,
  Wrench,
  ListChecks,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { useT } from "../../../../utils/i18n";
import { useMemo } from "react";
import {
  looksLikeDiagnosticMarkdown,
  prepareMarkdownText,
} from "../../../../utils/markdownFormatting";
import ReactMarkdown from "react-markdown";

// Dummy chart data from HTML spec
const generateTrendData = () => {
  const data = [];
  for (let i = 0; i < 60; i++) {
    let val = 2 + Math.random() * 0.5;
    if (i > 40 && i < 45) {
      val = 11 + Math.random() * 2; // Spike
    } else if (i >= 45) {
      val = 4 + Math.random(); // Recovery
    }
    data.push({ time: i, amps: val });
  }
  return data;
};

const CustomTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[rgba(15,23,42,0.9)] border border-white/10 p-2 rounded shadow-xl">
        <p className="text-[#e2e8f0] text-xs font-mono">{`${payload[0].value.toFixed(1)} Amps`}</p>
      </div>
    );
  }
  return null;
};

const getAlarmDisplayId = (alarmId) => {
  if (alarmId === null || alarmId === undefined || alarmId === "") return "-";
  const normalized = String(alarmId);
  return normalized.split("-")[0];
};

const diagnosticMarkdownComponents = {
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
  strong: ({ children }) => (
    <strong style={{ fontWeight: 600 }}>{children}</strong>
  ),
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

export default function DecisionPanel({
  selectedAlarm,
  diagnosis,
  plan,
  primaryAction,
  onPrimaryAction,
  primaryBusy,
  onAcknowledge,
  acknowledgeBusy,
  onIgnore,
}) {
  const { t } = useT();
  const trendData = useMemo(() => generateTrendData(), [selectedAlarm]);
  const diagnosisMarkdown = useMemo(
    () => prepareMarkdownText(diagnosis?.diagnosis || ""),
    [diagnosis?.diagnosis],
  );
  const recommendationMarkdown = useMemo(
    () => prepareMarkdownText(plan?.recommendation || diagnosis?.recommendation || ""),
    [diagnosis?.recommendation, plan?.recommendation],
  );
  const planSteps = useMemo(() => {
    const rawSteps = plan?.plan?.checklist || plan?.plan?.steps;
    if (!Array.isArray(rawSteps)) return [];
    return rawSteps.map((step) => String(step || "").trim()).filter(Boolean);
  }, [plan?.plan?.checklist, plan?.plan?.steps]);

  if (!selectedAlarm) {
    return (
      <div className="flex-1 lg:flex-[7] h-full flex flex-col z-10 w-full min-h-[500px]">
        <div className="glass-panel rounded-xl flex flex-col h-full shadow-2xl shadow-black/40 overflow-hidden relative items-center justify-center text-center p-8 bg-[color:var(--surface-dark)]/50 border border-white/5">
          <div className="w-16 h-16 rounded-full bg-slate-800/50 border border-slate-700/50 flex items-center justify-center text-slate-500 mb-4">
            <TrendingUp size={32} />
          </div>
          <h3 className="text-xl font-bold text-slate-200 mb-2">
            {t("alarms.selectIncident")}
          </h3>
          <p className="text-sm text-slate-400 max-w-sm">
            {t("alarms.selectHint")}
          </p>
        </div>
      </div>
    );
  }

  const confidence = diagnosis?.confidence || 0.94;
  const confidenceStr = `${Math.round(confidence * 100)}%`;
  const hasDiagnosisMarkdown = Boolean(diagnosisMarkdown.trim());
  const hasRecommendationMarkdown = Boolean(recommendationMarkdown.trim());
  const isDiagnosticMarkdown = looksLikeDiagnosticMarkdown(diagnosisMarkdown);

  return (
    <div className="flex-[7] h-full flex flex-col z-10 min-w-0">
      <div className="glass-panel rounded-xl flex flex-col h-full shadow-2xl shadow-black/40 overflow-hidden relative bg-[color:var(--surface-dark)]/90 backdrop-blur-xl">
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-white/20 to-transparent"></div>

        {/* Header */}
        <div className="p-5 border-b border-white/5 flex justify-between items-center bg-white/5 shrink-0">
          <div className="flex items-center gap-3 min-w-0 pr-4">
            <div className="bg-[color:var(--primary)]/20 p-2 rounded-lg border border-[color:var(--primary)]/30 shrink-0">
              <TrendingUp
                size={20}
                className="text-[color:var(--primary-light)]"
              />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-white text-lg leading-tight truncate">
                {selectedAlarm.error_code || "Incident Analysis"}
              </h3>
              <p className="text-xs text-slate-400 font-mono truncate">
                ID: {getAlarmDisplayId(selectedAlarm.id)} • Device:{" "}
                {selectedAlarm.machine_name}
              </p>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button className="p-2 hover:bg-white/10 rounded-lg transition-colors text-slate-400 hover:text-white">
              <Maximize2 size={16} />
            </button>
            <button className="p-2 hover:bg-white/10 rounded-lg transition-colors text-slate-400 hover:text-white">
              <CloseIcon size={16} />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 flex-1 overflow-y-auto space-y-6 scrollbar-hide flex flex-col min-h-0">
          {/* PLC Register State - Assuming static representation per design */}
          <div className="shrink-0">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs uppercase tracking-wider font-bold text-slate-400 flex items-center gap-2">
                <Cpu size={16} />
                PLC Register State
              </h4>
              <span className="text-[10px] text-slate-500 font-mono">
                Last update: 2ms ago
              </span>
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-700/50 bg-[color:var(--background-dark)]/50">
              <table className="w-full text-left text-sm font-mono whitespace-nowrap min-w-full">
                <thead className="bg-slate-800/50 text-slate-400 border-b border-slate-700/50">
                  <tr>
                    <th className="px-4 py-2 font-medium">Register</th>
                    <th className="px-4 py-2 font-medium">Value</th>
                    <th className="px-4 py-2 font-medium w-full">
                      Description
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/30">
                  <tr className="hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3 text-slate-300">R100</td>
                    <td className="px-4 py-3 text-emerald-400">0x0001</td>
                    <td className="px-4 py-3 text-slate-400">STOP_ACTIVE</td>
                  </tr>
                  <tr className="hover:bg-white/5 transition-colors bg-red-500/5">
                    <td className="px-4 py-3 text-slate-300">R102</td>
                    <td className="px-4 py-3 text-red-400 font-bold flex items-center gap-2">
                      0x800F{" "}
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      SAFETY_GATE_OPEN
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Trend Chart */}
          <div className="flex-1 min-h-[220px] flex flex-col">
            <div className="flex items-center justify-between mb-3 shrink-0">
              <h4 className="text-xs uppercase tracking-wider font-bold text-slate-400 flex items-center gap-2">
                <TrendingUp size={16} />
                5-Minute Pre-Alarm Trend
              </h4>
              <div className="flex gap-2 items-center text-xs bg-slate-800/50 px-2 py-1 rounded border border-slate-700/50">
                <span className="w-2 h-2 rounded-full bg-[color:var(--primary)]"></span>
                <span className="text-slate-300 hidden sm:inline">
                  Motor Current (Amps)
                </span>
                <span className="text-slate-300 sm:hidden">Amps</span>
              </div>
            </div>

            <div className="flex-1 w-full bg-[color:var(--background-dark)]/30 rounded-xl border border-slate-700/50 p-4 relative backdrop-blur-sm min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData}>
                  <defs>
                    <linearGradient id="colorAmps" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="var(--primary)"
                        stopOpacity={0.5}
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--primary)"
                        stopOpacity={0.05}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="5 5"
                    stroke="rgba(255,255,255,0.08)"
                    vertical={false}
                  />
                  <XAxis dataKey="time" hide />
                  <YAxis
                    tick={{
                      fill: "#94a3b8",
                      fontSize: 10,
                      fontFamily: "monospace",
                    }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="amps"
                    stroke="#60a5fa"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorAmps)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
              <div className="absolute top-[22%] right-[25%] bg-red-500/20 border border-red-500/40 text-red-400 text-[10px] px-2 py-1 rounded shadow-lg backdrop-blur-md pointer-events-none items-center gap-1 hidden sm:flex">
                <TrendingUp size={12} />
                Spike (11.2A)
              </div>
            </div>
          </div>

          {/* AI RCA */}
          <div className="bg-gradient-to-br from-[color:var(--primary)]/10 to-blue-900/10 border border-[color:var(--primary)]/20 rounded-xl p-5 flex gap-5 relative overflow-hidden group shrink-0">
            <div className="absolute top-0 right-0 p-3 opacity-20 hidden sm:block">
              <Settings
                size={64}
                className="text-[color:var(--primary)] -rotate-45"
              />
            </div>

            <div className="w-12 h-12 rounded-lg bg-[color:var(--primary)]/20 border border-[color:var(--primary)]/30 flex items-center justify-center text-[color:var(--primary-light)] flex-shrink-0 shadow-[0_0_15px_rgba(33,106,190,0.3)]">
              <Bot size={24} />
            </div>

            <div className="relative z-10 flex-1 min-w-0 flex flex-col">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-2">
                <h4 className="font-bold text-blue-100 flex items-center gap-2 truncate">
                  AI Root Cause Analysis
                </h4>
                <span className="text-[10px] font-mono bg-[color:var(--primary)]/20 border border-[color:var(--primary)]/30 px-1.5 py-0.5 rounded text-[color:var(--primary-light)] self-start sm:self-auto shrink-0">
                  Confidence: {confidenceStr}
                </span>
              </div>

              <div className="text-sm text-slate-300 leading-relaxed font-light">
                {hasDiagnosisMarkdown ? (
                  <div
                    className={`message-markdown ${isDiagnosticMarkdown ? "is-diagnostic" : ""}`}
                  >
                    <ReactMarkdown components={diagnosticMarkdownComponents}>
                      {diagnosisMarkdown}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <>
                    <p className="mb-2">
                      Based on register timing, the{" "}
                      <span className="font-mono text-xs bg-slate-800 border border-slate-600 px-1 py-0.5 rounded text-white mx-0.5">
                        Safety gate (R102)
                      </span>{" "}
                      was tripped 50ms before motor spin-down.
                    </p>
                    <p>
                      <span className="text-[color:var(--primary-light)] font-medium">
                        Recommendation:
                      </span>{" "}
                      Verify physical barrier integrity on conveyor segment B.
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>

          {plan ? (
            <div className="rounded-xl border border-[color:var(--primary)]/25 bg-[color:var(--primary)]/8 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h4 className="text-sm font-semibold text-blue-100 flex items-center gap-2">
                  <ListChecks size={16} />
                  Generated Plan
                </h4>
                <span className="text-[11px] font-mono px-2 py-1 rounded border border-[color:var(--primary)]/35 text-[color:var(--primary-light)] bg-[color:var(--primary)]/12 uppercase">
                  {plan.execution_status || "planned"}
                </span>
              </div>

              {plan?.plan?.reason ? (
                <p className="text-sm text-slate-300 leading-relaxed">
                  {plan.plan.reason}
                </p>
              ) : null}

              {planSteps.length ? (
                <ol className="text-sm text-slate-200 space-y-1 pl-5 list-decimal">
                  {planSteps.map((step, index) => (
                    <li key={`plan-step-${index}`}>{step}</li>
                  ))}
                </ol>
              ) : null}

              {hasRecommendationMarkdown ? (
                <div className="message-markdown">
                  <ReactMarkdown components={diagnosticMarkdownComponents}>
                    {recommendationMarkdown}
                  </ReactMarkdown>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Footer Actions */}
        <div className="p-5 border-t border-white/5 bg-white/5 flex justify-end gap-3 flex-wrap backdrop-blur-md shrink-0">
          <button
            type="button"
            onClick={onIgnore}
            disabled={!selectedAlarm}
            className="px-4 py-2.5 rounded-lg border border-slate-600 text-slate-300 text-sm font-medium hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Ignore
          </button>
          <button
            type="button"
            onClick={onAcknowledge}
            disabled={!selectedAlarm || acknowledgeBusy}
            className="px-4 py-2.5 rounded-lg border border-slate-600 text-slate-300 text-sm font-medium hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {acknowledgeBusy ? "Acknowledging..." : "Acknowledge"}
          </button>
          <button
            type="button"
            onClick={onPrimaryAction}
            disabled={primaryBusy || Boolean(primaryAction?.disabled)}
            className="px-5 py-2.5 rounded-lg bg-[color:var(--primary)] hover:bg-[color:var(--primary-dark)] text-white text-sm font-medium shadow-[0_0_20px_rgba(33,106,190,0.4)] hover:shadow-[0_0_25px_rgba(33,106,190,0.6)] flex items-center gap-2 transition-all border border-[color:var(--primary)]/50 disabled:opacity-50"
          >
            <Wrench size={18} />
            {primaryAction?.label || "Initiate Repair Workflow"}
          </button>
        </div>
      </div>
    </div>
  );
}
