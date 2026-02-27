import { memo } from "react";
import ReactMarkdown from "react-markdown";
import { Bot, Check, Copy, CornerDownLeft, FileText } from "lucide-react";
import {
  looksLikeDiagnosticMarkdown,
  markdownComponents,
  prepareMarkdownText,
} from "./markdown";
import ThinkingIndicator from "./ThinkingIndicator";
import { formatSourceItemLabel, formatTime, toArray } from "./utils";

function ChatMessages({
  messagesContainerRef,
  activeMessages,
  pendingMessage,
  activeChat,
  autoStickToBottom,
  isLoading,
  copiedId,
  onCopyMessage,
  onReuseMessage,
  onOpenSourceDocument,
  apiError,
}) {
  return (
    <div
      ref={messagesContainerRef}
      className={`chat-message-scroll ${apiError ? "pt-4" : ""}`}
      data-stick-bottom={autoStickToBottom ? "1" : "0"}
    >
      <div className="chat-message-stack">
        {activeMessages.map((message, index) => {
          const processingTime = Number(message?.processingTime);
          const hasProcessingTime = Number.isFinite(processingTime) && processingTime > 0;
          const isUser = message.sender === "user";
          const preparedAssistantText = !isUser ? prepareMarkdownText(message.text) : "";
          const isDiagnosticAssistantText =
            !isUser && looksLikeDiagnosticMarkdown(preparedAssistantText);

          return (
            <div
              key={message?.id ?? index}
              className={`msg-row ${isUser ? "user" : "assistant"} fade-in-up`}
            >
              {!isUser ? (
                <span className="msg-avatar">
                  <Bot size={14} />
                </span>
              ) : null}

              <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
                <div
                  className={`msg-bubble ${
                    isUser ? "user" : "assistant"
                  } ${message.status === "failed" ? "failed" : ""} ${
                    isDiagnosticAssistantText ? "is-diagnostic" : ""
                  }`}
                >
                  {!isUser ? (
                    <div className="message-markdown">
                      <ReactMarkdown components={markdownComponents}>
                        {preparedAssistantText}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    message.text
                  )}
                </div>

                {!isUser && hasProcessingTime ? (
                  <div className="msg-meta">
                    <span>{processingTime.toFixed(2)}s</span>
                    {message.ragas?.scores?.faithfulness != null ? (
                      <span>
                        Faithfulness {(message.ragas.scores.faithfulness * 100).toFixed(0)}%
                      </span>
                    ) : null}
                  </div>
                ) : null}

                {!isUser && toArray(message.sources).length > 0 ? (
                  <div className="source-chip-wrap">
                    {toArray(message.sources).map((sourceItem, sourceIndex) => {
                      const label = formatSourceItemLabel(sourceItem);
                      if (!label) return null;

                      return (
                        <button
                          type="button"
                          key={`${message.id || index}-src-${sourceIndex}`}
                          className="source-chip glass-interactive"
                          title="Open source document"
                          onClick={() => onOpenSourceDocument(sourceItem)}
                        >
                          <FileText size={12} />
                          {label}
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                <div className="msg-meta">
                  {message.timestamp ? <span>{formatTime(message.timestamp)}</span> : null}

                  <div className="msg-tools">
                    <button
                      type="button"
                      onClick={() => onCopyMessage(message.text, index)}
                      className="msg-tool-btn glass-interactive"
                      title="Copy"
                    >
                      {copiedId === index ? <Check size={12} /> : <Copy size={12} />}
                    </button>

                    <button
                      type="button"
                      onClick={() => onReuseMessage(message.text)}
                      className="msg-tool-btn glass-interactive"
                      title="Reuse"
                    >
                      <CornerDownLeft size={12} />
                    </button>
                  </div>
                </div>

                {isUser && message.status === "failed" ? (
                  <span className="text-[11px] text-[color:var(--error)] mt-1">
                    Message failed to send. Edit and resend.
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}

        {pendingMessage && !activeChat ? (
          <div className="msg-row user fade-in-up">
            <div className="flex flex-col items-end">
              <div className={`msg-bubble user ${pendingMessage.status === "failed" ? "failed" : ""}`}>
                {pendingMessage.text}
              </div>

              {pendingMessage?.status === "failed" ? (
                <span className="text-[11px] text-[color:var(--error)] mt-1">
                  Message failed to send. Edit and resend.
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        {isLoading ? <ThinkingIndicator /> : null}
      </div>
    </div>
  );
}

export default memo(ChatMessages);
