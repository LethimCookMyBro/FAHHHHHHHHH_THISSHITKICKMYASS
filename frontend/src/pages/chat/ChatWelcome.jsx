import { Bot, Search, Zap } from "lucide-react";
import { useT } from "../../utils/i18n";

const promptIcons = [Search, Zap, Bot];

export default function ChatWelcome({ user, onPromptSelect, composer }) {
  const { t } = useT();
  const firstName = user?.full_name
    ? user.full_name.split(" ")[0]
    : t("chat.defaultUser");

  const prompts = [
    t("chat.promptExplainF800h"),
    t("chat.promptCcLink"),
    t("chat.promptRecoveryTimeout"),
    t("chat.promptSummarizeSerial"),
  ];
  const visiblePrompts = prompts.slice(0, 2);

  return (
    <div className="chat-welcome">
      <div className="chat-hero fade-in-up">
        <section className="chat-center-stage">
          <div className="chat-hero-badge">
            <Bot size={14} />
            <span>{t("chat.welcomeBadge")}</span>
          </div>

          <h2 className="chat-hero-title">
            {t("chat.welcomeTitle", { name: firstName })}
          </h2>
          <p className="chat-hero-sub">{t("chat.welcomeSub")}</p>

          <section className="chat-hero-card chat-hero-composer">
            {composer}
          </section>
        </section>

        <section className="chat-prompt-stage">
          <div className="prompt-grid">
            {visiblePrompts.map((prompt, index) => {
              const Icon = promptIcons[index] || Zap;
              return (
                <button
                  key={prompt}
                  type="button"
                  className="prompt-card glass-panel-lite glass-interactive"
                  style={{ "--prompt-index": index }}
                  onClick={() => onPromptSelect(prompt)}
                >
                  <span className="prompt-card-icon">
                    <Icon size={15} />
                  </span>
                  <span>{prompt}</span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
