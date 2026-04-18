const LANGUAGE_ALIASES = new Map([
  ["js", "javascript"],
  ["ts", "typescript"],
  ["tsx-jsx", "jsx"],
  ["shell", "bash"],
  ["sh", "bash"],
  ["zsh", "bash"],
  ["console", "bash"],
  ["html", "markup"],
  ["xml", "markup"],
  ["svg", "markup"],
  ["yml", "yaml"],
  ["ps1", "powershell"],
  ["c++", "cpp"],
  ["cs", "csharp"],
  ["dotnet", "csharp"],
  ["md", "markdown"],
]);

const SUPPORTED_LANGUAGES = new Set([
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "diff",
  "java",
  "javascript",
  "json",
  "jsx",
  "markdown",
  "markup",
  "powershell",
  "python",
  "sql",
  "tsx",
  "typescript",
  "yaml",
]);

const resolveLanguage = (language) => {
  const normalized = String(language || "")
    .trim()
    .toLowerCase();

  if (!normalized) return "";
  const aliased = LANGUAGE_ALIASES.get(normalized) || normalized;
  return SUPPORTED_LANGUAGES.has(aliased) ? aliased : "";
};

const formatLanguageLabel = (language) =>
  language === "markup" ? "html/xml" : language;

export default function CodeHighlighter({ language, children }) {
  const resolvedLanguage = resolveLanguage(language);
  const codeText = String(children || "").replace(/\n$/, "");

  return (
    <div className="message-code-shell">
      {resolvedLanguage ? (
        <div className="message-code-meta">
          <span className="message-code-language">
            {formatLanguageLabel(resolvedLanguage)}
          </span>
        </div>
      ) : null}
      <pre className="message-code-block">
        <code className="message-code-content">{codeText}</code>
      </pre>
    </div>
  );
}
