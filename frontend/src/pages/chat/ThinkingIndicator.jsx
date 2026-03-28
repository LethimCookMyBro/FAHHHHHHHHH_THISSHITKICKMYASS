import { Bot } from "lucide-react";
import { useT } from "../../utils/i18n";

export default function ThinkingIndicator() {
  const { t } = useT();

  return (
    <div className="msg-row assistant fade-in-up">
      <span className="msg-avatar typing-avatar">
        <Bot size={14} />
      </span>
      <div className="flex flex-col items-start">
        <div
          className="msg-bubble assistant typing-bubble"
          aria-label={t("chat.assistantThinking")}
        >
          <span className="typing-dot" />
          <span className="typing-dot" />
          <span className="typing-dot" />
        </div>
      </div>
    </div>
  );
}
