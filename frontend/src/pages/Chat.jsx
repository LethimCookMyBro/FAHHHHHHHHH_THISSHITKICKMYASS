import { Suspense, lazy, useCallback, useMemo } from "react";
import {
  AlertTriangle,
  Plus,
  RefreshCw,
  Save,
} from "lucide-react";
import { useVoiceRecording } from "../hooks/useVoiceRecording";
import { useT } from "../utils/i18n";
import { GlassSurface } from "../components/ui";
import ChatComposer from "./chat/ChatComposer";
import DeleteChatDialog from "./chat/DeleteChatDialog";
import ChatSidebar from "./chat/ChatSidebar";
import ChatWelcome from "./chat/ChatWelcome";
import { useChatManager } from "../hooks/useChatManager";
import { useConfigureTopbar } from "../layout/AppTopbarContext";
import { downloadText } from "../utils/exporters";
import "../styles/chat.css";

const ChatMessages = lazy(() => import("./chat/ChatMessages"));

export default function Chat({ hasAppSidebar = false }) {
  const { t } = useT();

  const {
    user,
    apiError,
    isRecovering,
    handleRetryConnection,

    deleteCandidate,
    activeChat,
    activeChatId,
    activeMessages,
    hasMessages,
    sortedChats,
    pinnedChats,
    handleNewChat,
    handleSelectChat,
    togglePin,
    requestDeleteChat,
    confirmDeleteChat,
    cancelDeleteChat,

    input,
    setInput,
    isLoading,
    submitMessage,
    inputRef,
    messagesContainerRef,
    pendingMessage,
    streamingAssistant,
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
  const hasWideAppSidebar = hasAppSidebar && !isCompactLayout;

  const {
    isRecording,
    isTranscribing,
    startRecording,
    stopRecording,
    cancelTranscription,
  } = useVoiceRecording(
    (text) => {
      setInput((prev) => prev + (prev ? " " : "") + text);
      inputRef.current?.focus();
    },
    "en",
  );

  const activeTitle = activeChat
    ? activeChat.title?.length > 56
      ? `${activeChat.title.slice(0, 56)}...`
      : activeChat.title || t("chat.newSession")
    : t("chat.newSession");

  const exportChatTranscript = useCallback(() => {
    const lines = activeMessages.map((message) => {
      const role = message.sender === "user" ? "USER" : "ASSISTANT";
      const text = String(message.text || "").replace(/\n+/g, " ").trim();
      return `${role}: ${text}`;
    });

    downloadText(
      `chat_${String(activeChatId || "session")}_${new Date().toISOString().slice(0, 10)}`,
      lines.join("\n\n"),
    );
  }, [activeChatId, activeMessages]);

  useConfigureTopbar(
    {
      title: isCompactLayout ? "" : activeTitle,
      subtitle: isCompactLayout ? "" : t("chat.headerSub"),
      search: {
        enabled: false,
      },
      statusPill: {
        label: t("chat.ready"),
        tone: "live",
      },
      secondaryAction: isCompactLayout
        ? null
        : {
            label: t("topbar.exportChat"),
            icon: Save,
            onClick: exportChatTranscript,
            disabled: !activeMessages.length,
          },
      primaryAction: isCompactLayout
        ? null
        : {
            label: t("chat.newChat"),
            icon: Plus,
            onClick: handleNewChat,
          },
    },
    [
      activeMessages.length,
      activeTitle,
      exportChatTranscript,
      handleNewChat,
      isCompactLayout,
      t,
    ],
  );

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

  const composerProps = useMemo(
    () => ({
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
    }),
    [
      cancelTranscription,
      handleComposerKeyDown,
      handleSend,
      input,
      inputRef,
      isLoading,
      isRecording,
      isTranscribing,
      setInput,
      startRecording,
      stopRecording,
    ],
  );

  return (
    <div className={`chat-shell-height chat-page ${hasWideAppSidebar ? "has-app-sidebar" : ""}`}>
      <ChatSidebar
        hasAppSidebar={hasWideAppSidebar}
        isCompactLayout={isCompactLayout}
        sidebarCollapsed={sidebarCollapsed}
        setSidebarCollapsed={setSidebarCollapsed}
        overlayEnabled={isCompactLayout}
        sortedChats={sortedChats}
        activeChatId={activeChatId}
        onSelectChat={handleSelectChat}
        pinnedChats={pinnedChats}
        onTogglePin={togglePin}
        onDeleteChat={requestDeleteChat}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        onNewChat={handleNewChat}
      />

      <GlassSurface
        as="section"
        className={`chat-main-shell glass-noise ${hasMessages ? "is-conversation" : "is-welcome"}`}
        borderRadius={18}
        blur={14}
        displace={0.65}
        brightness={58}
        opacity={0.92}
        saturation={1.2}
        backgroundOpacity={0.22}
      >
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
              <RefreshCw size={13} className={isRecovering ? "animate-spin" : ""} />
              {t("chat.retry")}
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
            <Suspense fallback={<div className="chat-messages-loading" />}>
              <ChatMessages
                messagesContainerRef={messagesContainerRef}
                activeMessages={activeMessages}
                pendingMessage={pendingMessage}
                streamingAssistant={streamingAssistant}
                activeChat={activeChat}
                autoStickToBottom={autoStickToBottom}
                isLoading={isLoading}
                copiedId={copiedId}
                onCopyMessage={copyMessage}
                onReuseMessage={handleReuseMessage}
                onOpenSourceDocument={openSourceDocument}
                apiError={apiError}
              />
            </Suspense>

            <div className="chat-compose-dock">
              <div className="chat-compose-dock-inner">
                <ChatComposer centered={false} {...composerProps} />
                <p className="text-center text-[11px] text-[color:var(--text-muted)] mt-2">
                  {t("chat.footerNote")}
                </p>
              </div>
            </div>
          </>
        )}
      </GlassSurface>

      <DeleteChatDialog
        isOpen={Boolean(deleteCandidate)}
        chatTitle={deleteCandidate?.title || ""}
        onCancel={cancelDeleteChat}
        onConfirm={confirmDeleteChat}
      />
    </div>
  );
}
