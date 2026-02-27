import { useCallback } from "react";
import { AlertTriangle, Menu, RefreshCw } from "lucide-react";
import { useVoiceRecording } from "../hooks/useVoiceRecording";
import { useT } from "../utils/i18n";
import { GlassSurface } from "../components/ui";
import ChatComposer from "./chat/ChatComposer";
import ChatMessages from "./chat/ChatMessages";
import ChatSidebar from "./chat/ChatSidebar";
import ChatWelcome from "./chat/ChatWelcome";
import { useChatManager } from "../hooks/useChatManager";

export default function Chat({ onLogout }) {
  const { locale } = useT();

  const {
    user,
    apiError,
    isRecovering,
    handleRetryConnection,

    chatHistory,
    activeChat,
    activeChatId,
    activeMessages,
    hasMessages,
    sortedChats,
    pinnedChats,
    handleNewChat,
    handleSelectChat,
    togglePin,
    handleDelete,

    input,
    setInput,
    isLoading,
    submitMessage,
    inputRef,
    messagesContainerRef,
    pendingMessage,
    searchQuery,
    setSearchQuery,

    sidebarCollapsed,
    setSidebarCollapsed,
    isCompactLayout,
    autoStickToBottom,

    copiedId,
    copyMessage,
    openSourceDocument,
  } = useChatManager();

  const {
    isRecording,
    isTranscribing,
    startRecording,
    stopRecording,
    cancelTranscription,
  } = useVoiceRecording((text) => {
    setInput((prev) => prev + (prev ? " " : "") + text);
    inputRef.current?.focus();
  }, locale);

  const handleSend = useCallback(
    async (event) => {
      event?.preventDefault?.();
      const trimmedInput = input.trim();
      if (!trimmedInput || isLoading) return;
      await submitMessage(trimmedInput);
    },
    [input, isLoading, submitMessage],
  );

  const handleComposerKeyDown = useCallback(
    (event) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      if (isLoading || isRecording || isTranscribing || !input.trim()) return;
      handleSend();
    },
    [handleSend, input, isLoading, isRecording, isTranscribing],
  );

  const handlePromptSelect = useCallback(
    (prompt) => {
      setInput(prompt);
      inputRef.current?.focus();
    },
    [setInput, inputRef],
  );

  const handleReuseMessage = useCallback(
    (messageText) => {
      setInput(messageText || "");
      inputRef.current?.focus();
    },
    [setInput, inputRef],
  );

  const composerProps = {
    input,
    inputRef,
    onInputChange: setInput,
    onKeyDown: handleComposerKeyDown,
    onSubmit: handleSend,
    isLoading,
    isRecording,
    isTranscribing,
    startRecording,
    stopRecording,
    cancelTranscription,
  };

  const activeTitle = activeChat
    ? activeChat.title?.length > 56
      ? `${activeChat.title.slice(0, 56)}...`
      : activeChat.title || "New Session"
    : "New Session";

  return (
    <div className="chat-shell-height chat-page">
      <ChatSidebar
        isCompactLayout={isCompactLayout}
        sidebarCollapsed={sidebarCollapsed}
        setSidebarCollapsed={setSidebarCollapsed}
        overlayEnabled={isCompactLayout}
        sortedChats={sortedChats}
        activeChatId={activeChatId}
        onSelectChat={handleSelectChat}
        pinnedChats={pinnedChats}
        onTogglePin={togglePin}
        onDeleteChat={handleDelete}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        onLogout={onLogout}
        onNewChat={handleNewChat}
      />

      <GlassSurface
        as="section"
        className="chat-main-shell glass-noise"
        borderRadius={18}
        blur={14}
        displace={0.65}
        brightness={58}
        opacity={0.92}
        saturation={1.2}
        backgroundOpacity={0.22}
      >
        <header className="chat-header">
          <div className="flex items-center gap-3 min-w-0">
            {isCompactLayout ? (
              <button
                type="button"
                className="control-btn glass-interactive"
                onClick={() => setSidebarCollapsed(false)}
                title="Open chat sessions"
              >
                <Menu size={15} />
              </button>
            ) : null}

            <div className="min-w-0">
              <p className="chat-header-title">{activeTitle}</p>
              <p className="chat-header-sub">
                Operational guidance for PLC troubleshooting and safe actions
              </p>
            </div>
          </div>

          <span className="live-indicator">
            <span className="live-dot" />
            Ready
          </span>
        </header>

        {apiError ? (
          <div className="chat-banner">
            <AlertTriangle
              size={15}
              className="mt-[2px] text-[color:var(--error)]"
            />
            <p className="flex-1">{apiError}</p>
            <button
              type="button"
              onClick={handleRetryConnection}
              disabled={isRecovering}
              className="action-btn glass-interactive"
            >
              <RefreshCw
                size={13}
                className={isRecovering ? "animate-spin" : ""}
              />
              Retry
            </button>
          </div>
        ) : null}

        {!hasMessages ? (
          <ChatWelcome
            user={user}
            onPromptSelect={handlePromptSelect}
            composer={<ChatComposer centered {...composerProps} />}
          />
        ) : (
          <>
            <ChatMessages
              messagesContainerRef={messagesContainerRef}
              activeMessages={activeMessages}
              pendingMessage={pendingMessage}
              activeChat={activeChat}
              autoStickToBottom={autoStickToBottom}
              isLoading={isLoading}
              copiedId={copiedId}
              onCopyMessage={copyMessage}
              onReuseMessage={handleReuseMessage}
              onOpenSourceDocument={openSourceDocument}
              apiError={apiError}
            />

            <div className="chat-compose-dock">
              <ChatComposer centered={false} {...composerProps} />
              <p className="text-center text-[11px] text-[color:var(--text-muted)] mt-2">
                Validate critical operations with on-site safety procedures.
              </p>
            </div>
          </>
        )}
      </GlassSurface>
    </div>
  );
}
