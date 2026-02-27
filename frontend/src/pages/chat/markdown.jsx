import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { ListChecks, Wrench, AlertTriangle, FileSearch } from "lucide-react";
import { toArray } from "./utils";
import featureFlags from "../../utils/featureFlags";
export {
  fixMarkdownTable,
  looksLikeDiagnosticMarkdown,
  normalizeDiagnosticMarkdown,
  prepareMarkdownText,
} from "../../utils/markdownFormatting";

export const markdownComponents = {
  code({ inline, className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || "");
    const codeText = String(children).replace(/\n$/, "");
    const shouldRenderHighlighted =
      !featureFlags.disableChatSyntaxHighlight && !inline && match;

    if (shouldRenderHighlighted) {
      return (
        <SyntaxHighlighter
          style={oneDark}
          language={match[1]}
          PreTag="div"
          className="rounded-lg text-sm my-2"
          {...props}
        >
          {codeText}
        </SyntaxHighlighter>
      );
    }

    if (!inline) {
      return (
        <pre className="message-code-block">
          <code className="message-code-content">{codeText}</code>
        </pre>
      );
    }

    return (
      <code className="message-inline-code" {...props}>
        {children}
      </code>
    );
  },
  h1: ({ children }) => (
    <h1 className="message-md-heading message-md-h1">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="message-md-heading message-md-h2">{children}</h2>
  ),
  h3: ({ children }) => {
    let Icon = null;
    let label = "";

    const textContent = Array.isArray(children)
      ? children.join("").toLowerCase()
      : String(children || "").toLowerCase();

    if (textContent.includes("prerequisite") || textContent.includes("note")) {
      Icon = AlertTriangle;
      label = "diag-prereq";
    } else if (textContent.includes("step")) {
      Icon = ListChecks;
      label = "diag-step";
    } else if (textContent.includes("troubleshoot")) {
      Icon = Wrench;
      label = "diag-troubleshoot";
    } else if (textContent.includes("root cause")) {
      Icon = FileSearch;
      label = "diag-rootcause";
    }

    if (Icon) {
      return (
        <h3
          className={`message-md-heading message-md-h3 flex items-center gap-2 ${label}`}
        >
          <Icon size={18} className="text-[color:var(--accent)]" />
          <span>{children}</span>
        </h3>
      );
    }

    return <h3 className="message-md-heading message-md-h3">{children}</h3>;
  },
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
    <strong className="font-semibold">{children}</strong>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-sky-400 hover:underline"
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
  table: ({ children }) => (
    <div className="my-3 space-y-1 message-md-table">{children}</div>
  ),
  thead: () => null,
  tbody: ({ children }) => (
    <ul className="message-md-list message-md-list-ul space-y-2">{children}</ul>
  ),
  tr: ({ children }) => {
    const cells = [];
    toArray(children).forEach((cell) => {
      if (cell?.props?.children) cells.push(cell.props.children);
    });
    if (!cells.length) return null;

    return (
      <li className="text-sm message-md-li">
        <span className="font-semibold">{cells[0]}</span>
        {cells.length > 1 && `: ${cells.slice(1).join(" | ")}`}
      </li>
    );
  },
  th: ({ children }) => <span className="font-semibold">{children}</span>,
  td: ({ children }) => <span>{children}</span>,
};
