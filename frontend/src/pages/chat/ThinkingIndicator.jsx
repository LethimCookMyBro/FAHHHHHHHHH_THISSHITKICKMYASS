import { Bot } from "lucide-react";

export default function ThinkingIndicator() {
  return (
    <div className="msg-row assistant fade-in-up">
      <span className="msg-avatar">
        <Bot size={14} />
      </span>
      <div className="flex flex-col items-start">
        <div
          className="msg-bubble assistant typing-bubble"
          aria-label="Assistant is thinking"
        >
          <span className="typing-dot" />
          <span className="typing-dot" />
          <span className="typing-dot" />
        </div>
      </div>
    </div>
  );
}
