import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-light";
import oneDark from "react-syntax-highlighter/dist/esm/styles/prism/one-dark";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import c from "react-syntax-highlighter/dist/esm/languages/prism/c";
import cpp from "react-syntax-highlighter/dist/esm/languages/prism/cpp";
import csharp from "react-syntax-highlighter/dist/esm/languages/prism/csharp";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import diff from "react-syntax-highlighter/dist/esm/languages/prism/diff";
import java from "react-syntax-highlighter/dist/esm/languages/prism/java";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import powershell from "react-syntax-highlighter/dist/esm/languages/prism/powershell";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";

const REGISTERED_LANGUAGES = [
  ["bash", bash],
  ["c", c],
  ["cpp", cpp],
  ["csharp", csharp],
  ["css", css],
  ["diff", diff],
  ["java", java],
  ["javascript", javascript],
  ["json", json],
  ["jsx", jsx],
  ["markdown", markdown],
  ["markup", markup],
  ["powershell", powershell],
  ["python", python],
  ["sql", sql],
  ["tsx", tsx],
  ["typescript", typescript],
  ["yaml", yaml],
];

REGISTERED_LANGUAGES.forEach(([name, language]) => {
  SyntaxHighlighter.registerLanguage(name, language);
});

SyntaxHighlighter.alias("javascript", ["js"]);
SyntaxHighlighter.alias("jsx", ["tsx-jsx"]);
SyntaxHighlighter.alias("typescript", ["ts"]);
SyntaxHighlighter.alias("tsx", ["tsx"]);
SyntaxHighlighter.alias("bash", ["shell", "sh", "zsh", "console"]);
SyntaxHighlighter.alias("markup", ["html", "xml", "svg"]);
SyntaxHighlighter.alias("yaml", ["yml"]);
SyntaxHighlighter.alias("powershell", ["ps1"]);
SyntaxHighlighter.alias("cpp", ["c++"]);
SyntaxHighlighter.alias("csharp", ["cs", "dotnet"]);
SyntaxHighlighter.alias("markdown", ["md"]);

const SUPPORTED_LANGUAGES = new Set(
  REGISTERED_LANGUAGES.map(([name]) => name).concat([
    "js",
    "ts",
    "shell",
    "sh",
    "zsh",
    "console",
    "html",
    "xml",
    "svg",
    "yml",
    "ps1",
    "c++",
    "cs",
    "dotnet",
    "md",
  ]),
);

const resolveLanguage = (language) => {
  const normalized = String(language || "")
    .trim()
    .toLowerCase();

  if (!normalized) return "";
  return SUPPORTED_LANGUAGES.has(normalized) ? normalized : "";
};

export default function CodeHighlighter({ language, children, ...props }) {
  const resolvedLanguage = resolveLanguage(language);

  if (!resolvedLanguage) {
    return (
      <pre className="message-code-block">
        <code className="message-code-content">{children}</code>
      </pre>
    );
  }

  return (
    <SyntaxHighlighter
      style={oneDark}
      language={resolvedLanguage}
      PreTag="div"
      wrapLongLines
      className="rounded-lg text-sm my-2"
      {...props}
    >
      {children}
    </SyntaxHighlighter>
  );
}
