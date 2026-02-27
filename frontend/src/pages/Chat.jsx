import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Menu, RefreshCw } from "lucide-react";
import { useLocation } from "react-router-dom";
import api, { getApiErrorMessage, retryApiRequest } from "../utils/api";
import { useVoiceRecording } from "../hooks/useVoiceRecording";
import { useT } from "../utils/i18n";
import { GlassSurface } from "../components/ui";
import ChatComposer from "./chat/ChatComposer";
import ChatMessages from "./chat/ChatMessages";
import ChatSidebar from "./chat/ChatSidebar";
import ChatWelcome from "./chat/ChatWelcome";
import {
  findFallbackSessionId,
  getReplyText,
  getResponseSessionId,
  makeLocalMessageId,
  mapMessagesFromPayload,
  mapSessionsFromPayload,
  normalizeChatId,
  normalizePageNumber,
  normalizeSourceItems,
  toArray,
  unwrapResponsePayload,
} from "./chat/utils";

const COMPACT_CHAT_BREAKPOINT = 980;

export default function Chat({ onLogout }) {
  const location = useLocation();
  const { locale } = useT();
  const [user, setUser] = useState({ full_name: "User" });
  const [chatHistory, setChatHistory] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [isNewChat, setIsNewChat] = useState(true);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isCompactLayout, setIsCompactLayout] = useState(false);
  const [pinnedChats, setPinnedChats] = useState(() => {
    try {
      return toArray(JSON.parse(localStorage.getItem("pinnedChats") || "[]"))
        .map((id) => normalizeChatId(id))
        .filter((id) => id != null);
    } catch {
      return [];
    }
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedId, setCopiedId] = useState(null);
  const [pendingMessage, setPendingMessage] = useState(null);
  const [apiError, setApiError] = useState("");
  const [isRecovering, setIsRecovering] = useState(false);
  const [autoStickToBottom, setAutoStickToBottom] = useState(true);

  const messagesContainerRef = useRef(null);
  const inputRef = useRef(null);
  const compactModeRef = useRef(null);
  const shouldStickToBottomRef = useRef(true);

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

  const activeChat = useMemo(
    () => chatHistory.find((chat) => chat.id === activeChatId),
    [activeChatId, chatHistory],
  );

  const activeMessages = useMemo(
    () => toArray(activeChat?.messages),
    [activeChat],
  );
  const hasMessages = activeMessages.length > 0 || !!pendingMessage;

  const sortedChats = useMemo(
    () =>
      [...chatHistory]
        .filter(
          (chat) =>
            !searchQuery.trim() ||
            (chat.title || "")
              .toLowerCase()
              .includes(searchQuery.toLowerCase()),
        )
        .sort((left, right) => {
          const leftPinned = pinnedChats.includes(left.id);
          const rightPinned = pinnedChats.includes(right.id);
          return leftPinned === rightPinned ? 0 : leftPinned ? -1 : 1;
        }),
    [chatHistory, pinnedChats, searchQuery],
  );

  const loadBootstrapData = useCallback(async () => {
    const [profileRes, sessionsRes] = await Promise.all([
      retryApiRequest(() => api.get("/api/auth/me"), {
        retries: 2,
        baseDelayMs: 550,
      }),
      retryApiRequest(() => api.get("/api/chat/sessions"), {
        retries: 2,
        baseDelayMs: 550,
      }),
    ]);

    setUser(profileRes?.data || { full_name: "User" });

    const sessions = mapSessionsFromPayload(sessionsRes?.data);
    setChatHistory(sessions);
    setActiveChatId((currentId) => {
      if (
        currentId != null &&
        sessions.some((session) => session.id === currentId)
      ) {
        return currentId;
      }
      return sessions[0]?.id ?? null;
    });
    setIsNewChat(sessions.length === 0);
    setApiError("");

    return sessions;
  }, []);

  const loadMessagesForSession = useCallback(async (sessionId) => {
    const response = await retryApiRequest(
      () => api.get(`/api/chat/sessions/${sessionId}`),
      {
        retries: 1,
        baseDelayMs: 500,
      },
    );

    const messages = mapMessagesFromPayload(response?.data);
    setChatHistory((prev) =>
      prev.map((chat) =>
        chat.id === sessionId ? { ...chat, messages } : chat,
      ),
    );
    setApiError("");

    return messages;
  }, []);

  useEffect(() => {
    const updateResponsiveMode = () => {
      const nextCompact = window.innerWidth <= COMPACT_CHAT_BREAKPOINT;
      setIsCompactLayout(nextCompact);

      if (
        compactModeRef.current == null ||
        compactModeRef.current !== nextCompact
      ) {
        setSidebarCollapsed(nextCompact);
        compactModeRef.current = nextCompact;
      }
    };

    updateResponsiveMode();
    window.addEventListener("resize", updateResponsiveMode);
    return () => window.removeEventListener("resize", updateResponsiveMode);
  }, []);

  useEffect(() => {
    if (isCompactLayout) {
      setSidebarCollapsed(true);
    }
  }, [isCompactLayout, location.pathname]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await loadBootstrapData();
      } catch (error) {
        if (cancelled) return;
        console.error(error);
        setApiError(getApiErrorMessage(error, "Failed to load chat data"));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadBootstrapData]);

  useEffect(() => {
    if (activeChatId == null) return;

    const chat = chatHistory.find((item) => item.id === activeChatId);
    if (toArray(chat?.messages).length > 0) return;

    let cancelled = false;
    loadMessagesForSession(activeChatId).catch((error) => {
      if (cancelled) return;
      console.error(error);
      setApiError(getApiErrorMessage(error, "Failed to load chat messages"));
    });

    return () => {
      cancelled = true;
    };
  }, [activeChatId, chatHistory, loadMessagesForSession]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [activeChatId, isNewChat]);

  const resizeComposer = useCallback(() => {
    const element = inputRef.current;
    if (!element) return;

    element.style.height = "0px";
    const nextHeight = Math.min(184, Math.max(52, element.scrollHeight));
    element.style.height = `${nextHeight}px`;
  }, []);

  useEffect(() => {
    resizeComposer();
  }, [input, resizeComposer, hasMessages]);

  const scrollMessagesToBottom = useCallback((behavior = "smooth") => {
    const container = messagesContainerRef.current;
    if (!container) return;

    if (typeof container.scrollTo === "function") {
      container.scrollTo({ top: container.scrollHeight, behavior });
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, []);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const onScroll = () => {
      const distanceFromBottom =
        container.scrollHeight - (container.scrollTop + container.clientHeight);
      const nextShouldStick = distanceFromBottom < 72;
      shouldStickToBottomRef.current = nextShouldStick;
      setAutoStickToBottom((current) =>
        current === nextShouldStick ? current : nextShouldStick,
      );
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => container.removeEventListener("scroll", onScroll);
  }, [activeChatId, hasMessages]);

  useEffect(() => {
    if (!hasMessages) return;
    if (!autoStickToBottom) return;

    const rafId = window.requestAnimationFrame(() => {
      scrollMessagesToBottom(isLoading ? "smooth" : "auto");
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [
    activeChatId,
    activeMessages.length,
    autoStickToBottom,
    hasMessages,
    isLoading,
    pendingMessage,
    scrollMessagesToBottom,
  ]);

  const handleNewChat = useCallback(() => {
    shouldStickToBottomRef.current = true;
    setAutoStickToBottom(true);
    setActiveChatId(null);
    setIsNewChat(true);
    setInput("");
    setPendingMessage(null);
    setApiError("");

    if (isCompactLayout) {
      setSidebarCollapsed(true);
    }

    setTimeout(() => inputRef.current?.focus(), 50);
  }, [isCompactLayout]);

  const handleRetryConnection = useCallback(async () => {
    if (isRecovering) return;

    setIsRecovering(true);
    setApiError("");

    try {
      const sessions = await loadBootstrapData();
      const hasCurrentSession =
        activeChatId != null &&
        sessions.some((session) => session.id === activeChatId);
      const targetSessionId = hasCurrentSession
        ? activeChatId
        : (sessions[0]?.id ?? null);

      if (targetSessionId != null) {
        await loadMessagesForSession(targetSessionId);
      }
    } catch (error) {
      console.error(error);
      setApiError(getApiErrorMessage(error, "Failed to reconnect backend"));
    } finally {
      setIsRecovering(false);
    }
  }, [activeChatId, isRecovering, loadBootstrapData, loadMessagesForSession]);

  const handleSend = useCallback(
    async (event) => {
      event?.preventDefault?.();

      const trimmedInput = input.trim();
      if (!trimmedInput || isLoading) return;

      const userMessage = {
        id: makeLocalMessageId(),
        text: trimmedInput,
        sender: "user",
        timestamp: new Date().toISOString(),
        status: "sent",
      };

      const requestStartsNewChat = activeChatId == null || isNewChat;
      shouldStickToBottomRef.current = true;
      setAutoStickToBottom(true);

      setApiError("");
      setInput("");
      setIsLoading(true);

      if (activeChatId != null) {
        setChatHistory((prev) =>
          prev.map((chat) =>
            chat.id === activeChatId
              ? { ...chat, messages: [...toArray(chat.messages), userMessage] }
              : chat,
          ),
        );
      } else {
        setPendingMessage(userMessage);
      }

      try {
        const response = await api.post("/api/chat", {
          message: userMessage.text,
          session_id: requestStartsNewChat ? null : activeChatId,
        });

        const payload = response?.data || {};
        let sessionId =
          getResponseSessionId(payload) ??
          (requestStartsNewChat ? null : normalizeChatId(activeChatId));

        if (sessionId == null && requestStartsNewChat) {
          try {
            const sessionsRes = await retryApiRequest(
              () => api.get("/api/chat/sessions"),
              {
                retries: 1,
                baseDelayMs: 500,
              },
            );
            sessionId = findFallbackSessionId(
              sessionsRes?.data,
              userMessage.text,
            );
          } catch (lookupError) {
            console.warn("Session fallback lookup failed:", lookupError);
          }
        }

        if (sessionId == null) {
          throw new Error(
            "Chat response is missing session_id (check API response format/config)",
          );
        }

        const normalizedPayload = unwrapResponsePayload(payload);
        const botMessage = {
          id: makeLocalMessageId(),
          text: getReplyText(payload),
          sender: "bot",
          timestamp: new Date().toISOString(),
          processingTime:
            normalizedPayload.processing_time ?? payload.processing_time,
          ragas: normalizedPayload.ragas ?? payload.ragas,
          sources: normalizeSourceItems(
            normalizedPayload?.sources ?? payload?.sources,
          ),
          status: "sent",
        };

        const nowIso = new Date().toISOString();

        if (requestStartsNewChat) {
          setChatHistory((prev) => {
            if (prev.some((chat) => chat.id === sessionId)) {
              return prev.map((chat) =>
                chat.id === sessionId
                  ? {
                      ...chat,
                      title: chat.title || userMessage.text.slice(0, 50),
                      messages: [...toArray(chat.messages), userMessage],
                      updated_at: nowIso,
                    }
                  : chat,
              );
            }

            const newSession = {
              id: sessionId,
              title: userMessage.text.slice(0, 50),
              messages: [userMessage],
              created_at: nowIso,
              updated_at: nowIso,
            };

            return [newSession, ...prev];
          });

          setActiveChatId(sessionId);
          setIsNewChat(false);
          setPendingMessage(null);
        }

        setChatHistory((prev) =>
          prev.map((chat) =>
            chat.id === sessionId
              ? {
                  ...chat,
                  messages: [...toArray(chat.messages), botMessage],
                  updated_at: new Date().toISOString(),
                }
              : chat,
          ),
        );
      } catch (error) {
        console.error("Chat error:", error);
        setApiError(getApiErrorMessage(error, "Failed to send message"));

        if (!requestStartsNewChat && activeChatId != null) {
          setChatHistory((prev) =>
            prev.map((chat) =>
              chat.id === activeChatId
                ? {
                    ...chat,
                    messages: toArray(chat.messages).map((message) =>
                      message?.id === userMessage.id
                        ? { ...message, status: "failed" }
                        : message,
                    ),
                  }
                : chat,
            ),
          );
        }

        setInput((current) => current || userMessage.text);
        if (requestStartsNewChat) {
          setPendingMessage({ ...userMessage, status: "failed" });
        }
      } finally {
        setIsLoading(false);
      }
    },
    [activeChatId, input, isLoading, isNewChat],
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

  const handleSelectChat = useCallback(
    (chatId) => {
      shouldStickToBottomRef.current = true;
      setAutoStickToBottom(true);
      setActiveChatId(chatId);
      setIsNewChat(false);
      setPendingMessage(null);
      if (isCompactLayout) {
        setSidebarCollapsed(true);
      }
    },
    [isCompactLayout],
  );

  const togglePin = useCallback((event, id) => {
    event.stopPropagation();

    const normalizedId = normalizeChatId(id);
    if (normalizedId == null) return;

    setPinnedChats((prev) => {
      const next = prev.includes(normalizedId)
        ? prev.filter((value) => value !== normalizedId)
        : [...prev, normalizedId];
      localStorage.setItem("pinnedChats", JSON.stringify(next));
      return next;
    });
  }, []);

  const handleDelete = useCallback(
    async (event, id) => {
      event.stopPropagation();

      const normalizedId = normalizeChatId(id);
      if (normalizedId == null) return;

      try {
        await api.delete(`/api/chat/sessions/${normalizedId}`);
        setChatHistory((prev) =>
          prev.filter((chat) => chat.id !== normalizedId),
        );

        if (normalizeChatId(activeChatId) === normalizedId) {
          handleNewChat();
        }
      } catch (error) {
        if (error?.response?.status === 404) {
          setChatHistory((prev) =>
            prev.filter((chat) => chat.id !== normalizedId),
          );
          if (normalizeChatId(activeChatId) === normalizedId) {
            handleNewChat();
          }
          return;
        }

        console.error("Delete failed", error);
        setApiError(getApiErrorMessage(error, "Failed to delete chat"));
      }
    },
    [activeChatId, handleNewChat],
  );

  const copyMessage = useCallback(async (text, id) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      console.error("Copy failed:", error);
    }
  }, []);

  const openSourceDocument = useCallback(async (sourceItem) => {
    const source = String(sourceItem?.source || "").trim();
    if (!source) return;

    const page = normalizePageNumber(sourceItem?.page);
    const isPdf = source.toLowerCase().endsWith(".pdf");
    const endpoint = `/api/chat/sources/${encodeURIComponent(source)}`;

    try {
      const response = await api.get(endpoint, { responseType: "blob" });
      const blob = response?.data;
      if (!(blob instanceof Blob)) {
        throw new Error("Invalid source response");
      }

      const objectUrl = URL.createObjectURL(blob);
      const targetUrl =
        isPdf && page > 0 ? `${objectUrl}#page=${page}` : objectUrl;
      const opened = window.open(targetUrl, "_blank", "noopener,noreferrer");
      if (!opened) {
        window.location.href = targetUrl;
      }

      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10 * 60 * 1000);
    } catch (error) {
      console.error("Open source failed", error);
      setApiError(getApiErrorMessage(error, "Failed to open source document"));
    }
  }, []);

  const handlePromptSelect = useCallback((prompt) => {
    setInput(prompt);
    inputRef.current?.focus();
  }, []);

  const handleReuseMessage = useCallback((messageText) => {
    setInput(messageText || "");
    inputRef.current?.focus();
  }, []);

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
