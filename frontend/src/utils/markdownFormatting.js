const DIAGNOSTIC_SECTION_LABELS = [
  "Root Cause Analysis",
  "Issue Type",
  "Recommended Actions",
  "Safety Warnings",
  "Estimated Repair Time",
  "Prerequisites / Notes",
  "Prerequisites/Notes",
  "Steps",
  "Troubleshooting",
  "Common failure patterns",
  "Likely diagnostic checks",
  "Relevant LEDs",
];

const DIAGNOSTIC_CONTENT_HINT_RE =
  /(root cause analysis|issue type|recommended actions|prerequisites\s*\/?\s*notes|troubleshooting|common failure patterns|likely diagnostic checks)/i;

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const LEGACY_DIAG_HEADING_RE = /^#{2,}\s*(root cause analysis|issue type|recommended actions|safety warnings|estimated repair time)\s*$/im;
const TARGET_TEMPLATE_HEADING_RE = /^#{2,}\s*(prerequisites\s*\/?\s*notes|steps|troubleshooting)\s*$/im;

export const fixMarkdownTable = (text) => {
  if (!text?.includes("|")) return text;
  return text
    .split("\n")
    .map((line) => {
      const pipes = (line.match(/\|/g) || []).length;
      if (pipes < 4) return line;

      const parts = line
        .split("|")
        .map((part) => part.trim())
        .filter((part) => part && !/^-+$/.test(part));

      if (parts.length < 2) return line;
      if (parts.every((part) => part.length < 30 && /^[A-Z][a-zA-Z\s()]*$/.test(part))) {
        return null;
      }

      const bullets = parts
        .filter((part) => part.length > 5)
        .map((part) => {
          const colonIndex = part.indexOf(":");
          return colonIndex > 0 && colonIndex < 50
            ? `• **${part.slice(0, colonIndex).trim()}**: ${part.slice(colonIndex + 1).trim()}`
            : `• ${part}`;
        });

      return bullets.length ? bullets.join("\n") : line;
    })
    .filter(Boolean)
    .join("\n");
};

export const normalizeDiagnosticMarkdown = (text) => {
  if (typeof text !== "string" || !text.trim()) return text;

  let normalized = text.replace(/\r\n?/g, "\n");

  if (!DIAGNOSTIC_CONTENT_HINT_RE.test(normalized)) {
    return normalized;
  }

  normalized = normalized
    .replace(/[ \t]+\n/g, "\n")
    .replace(/([^\n])\s*(###\s+)/g, "$1\n\n$2");

  for (const label of DIAGNOSTIC_SECTION_LABELS) {
    const headingWithContent = new RegExp(
      `(###\\s*${escapeRegExp(label)})\\s+(?=\\S)`,
      "gi",
    );
    normalized = normalized.replace(headingWithContent, "$1\n");
  }

  normalized = normalized
    .replace(
      /^(Prerequisites\s*\/?\s*Notes)\s*:?\s*$/gim,
      "### Prerequisites / Notes",
    )
    .replace(/^Steps\s*:?\s*$/gim, "### Steps")
    .replace(/^Troubleshooting\s*:?\s*$/gim, "### Troubleshooting")
    .replace(
      /^Common failure patterns\s*:?\s*$/gim,
      "#### Common failure patterns",
    )
    .replace(/^Likely diagnostic checks\s*:?\s*$/gim, "#### Likely diagnostic checks")
    .replace(/^Relevant LEDs\s*:?\s*$/gim, "#### Relevant LEDs");

  normalized = normalized
    .replace(/(###\s*Recommended Actions)\s*(\d+\.\s+)/gi, "$1\n$2")
    .replace(/([a-z)])\s+([1-9]\.\s+[A-Z])/g, "$1\n$2")
    .replace(/([.!?])\s+([1-9]\.\s+)/g, "$1\n$2");

  normalized = normalized
    .replace(/\s*•\s+/g, "\n- ")
    .replace(/^\-\s+/gm, "- ");

  normalized = normalized
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return normalized;
};

const parseMarkdownSections = (text) => {
  const lines = String(text || "").split("\n");
  const sections = {};
  let current = "__lead__";
  sections[current] = [];

  for (const line of lines) {
    const match = line.match(/^\s*#{2,}\s+(.+?)\s*$/);
    if (match) {
      current = match[1].trim().toLowerCase();
      if (!sections[current]) sections[current] = [];
      continue;
    }
    sections[current].push(line);
  }

  const joined = {};
  for (const [key, values] of Object.entries(sections)) {
    joined[key] = values.join("\n").trim();
  }
  return joined;
};

const toBulletLines = (text, prefix) =>
  String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (/^[-*•]\s+/.test(line)) return `- ${line.replace(/^[-*•]\s+/, "")}`;
      if (/^\d+[.)]\s+/.test(line)) return `- ${line}`;
      return prefix ? `- ${prefix}${line}` : `- ${line}`;
    });

const toStepLines = (text) => {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return [];

  const normalized = lines.map((line) =>
    line
      .replace(/^[-*•]\s+/, "")
      .replace(/^\d+[.)]\s+/, ""),
  );

  return normalized.map((line, idx) => `${idx + 1}. ${line}`);
};

const buildFallbackTroubleshootingBullets = (issueTypeText) => {
  const issue = String(issueTypeText || "").toLowerCase();
  const bullets = [];

  if (issue.includes("hardware")) {
    bullets.push("Common failure patterns: trip repeats after reset, overheating module, loose connector.");
  } else if (issue.includes("software")) {
    bullets.push("Common failure patterns: parameter mismatch, I/O assignment mismatch, startup configuration error.");
  } else {
    bullets.push("Common failure patterns: repeated fault after reset, fault after recent configuration change.");
  }

  bullets.push("Relevant LEDs: RUN/ERR/LINK (or module-specific error LED).");
  bullets.push("Likely diagnostic checks: verify each step one by one and confirm the original symptom clears.");
  return bullets;
};

export const reshapeLegacyDiagnosticTemplate = (text) => {
  const value = String(text || "").trim();
  if (!value) return value;
  if (TARGET_TEMPLATE_HEADING_RE.test(value)) return value;
  if (!LEGACY_DIAG_HEADING_RE.test(value)) return value;

  const sections = parseMarkdownSections(value);
  const rootCause = sections["root cause analysis"] || "";
  const issueType = sections["issue type"] || "";
  const recommended = sections["recommended actions"] || "";
  const safety = sections["safety warnings"] || "";
  const eta = sections["estimated repair time"] || "";

  const noteBullets = [
    ...toBulletLines(rootCause),
    ...toBulletLines(issueType, "Issue type: "),
    ...toBulletLines(safety, "Safety: "),
    ...toBulletLines(eta, "Estimated repair time: "),
  ];

  const stepLines = toStepLines(recommended);
  const troubleshootingBullets = buildFallbackTroubleshootingBullets(issueType);

  if (!noteBullets.length || !stepLines.length) {
    return value;
  }

  return [
    "### Prerequisites / Notes",
    ...noteBullets,
    "",
    "### Steps",
    ...stepLines,
    "",
    "### Troubleshooting",
    ...troubleshootingBullets.map((line) => `- ${line.replace(/^-\s+/, "")}`),
  ].join("\n");
};

export const prepareMarkdownText = (text) =>
  reshapeLegacyDiagnosticTemplate(normalizeDiagnosticMarkdown(fixMarkdownTable(text)));

export const looksLikeDiagnosticMarkdown = (text) =>
  DIAGNOSTIC_CONTENT_HINT_RE.test(String(text || ""));
