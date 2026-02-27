import { Bot, Zap, Search, Shield } from "lucide-react";

const promptIcons = [Search, Zap, Shield, Bot];

export default function ChatWelcome({ user, onPromptSelect, composer }) {
  const firstName = user?.full_name ? user.full_name.split(" ")[0] : "Operator";

  const prompts = [
    "Explain error code F800H and first field checks",
    "How to configure CC-Link IE Field network",
    "Give safe recovery steps for communication timeout",
    "Summarize root cause for serial communication alarm",
  ];

  return (
    <div className="chat-welcome">
      <div className="chat-hero fade-in-up">
        <section className="flex flex-col items-center text-center pb-6">
          <div className="chat-hero-badge">
            <Bot size={14} />
            <span>Knowledge Assistant</span>
          </div>

          <h2 className="chat-hero-title mt-6">Welcome, {firstName}</h2>
          <p className="chat-hero-sub max-w-lg">
            Ask for PLC diagnostics, root cause analysis, action planning, and
            safe execution guidance.
          </p>
        </section>

        <section className="chat-hero-card glass-panel-strong glass-noise">
          {composer}
        </section>

        <section className="prompt-grid">
          {prompts.map((prompt, index) => {
            const Icon = promptIcons[index] || Zap;
            return (
              <button
                key={prompt}
                type="button"
                className="prompt-card glass-panel-lite glass-interactive"
                onClick={() => onPromptSelect(prompt)}
              >
                <span className="prompt-card-icon">
                  <Icon size={15} />
                </span>
                <span>{prompt}</span>
              </button>
            );
          })}
        </section>
      </div>
    </div>
  );
}
