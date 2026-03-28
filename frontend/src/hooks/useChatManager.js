import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { usePlcLiveDataContext } from "../features/plc/PlcLiveDataContext";
import { useOpsSyncContext } from "../features/ops/OpsSyncContext";
import {
  buildMockZoneAssistantReply,
  buildMockZonePrompt,
  buildMockZoneRuntimeContext,
  createMockZoneReplyChunks,
  getMockZoneRouteContext,
  shouldUseMockZoneSend,
} from "../features/ops/mockZoneChat";
import { chatService } from "../services/chatService";
import { getApiErrorMessage } from "../utils/api";
import {
  appendAssistantToMockSession,
  isMockZoneSessionId,
  mergeSessionsWithMock,
  persistMockZoneSessions,
  readStoredMockZoneSessions,
  upsertMockZoneSession,
} from "../pages/chat/mockZoneSessions";
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
} from "../pages/chat/utils";

const COMPACT_CHAT_BREAKPOINT = 980;
const DEFAULT_USER = { full_name: "User" };
const FOCUS_INPUT_DELAY_MS = 50;
const AUTO_DIAGNOSIS_DELAY_MS = 800;
const AUTO_MOCK_ZONE_DELAY_MS = 180;
const COPY_FEEDBACK_RESET_MS = 2000;
const SOURCE_URL_REVOKE_DELAY_MS = 10 * 60 * 1000;
const SESSION_TITLE_MAX_LENGTH = 50;

const messagesOrEmpty = (chat) => toArray(chat?.messages);
const buildSessionTitle = (text) =>
  String(text || "").slice(0, SESSION_TITLE_MAX_LENGTH);
const findChatById = (history, chatId) =>
  history.find((chat) => chat.id === chatId) || null;

const readPinnedChatIds = () => {
  if (typeof localStorage === "undefined") return [];

  try {
    return toArray(JSON.parse(localStorage.getItem("pinnedChats") || "[]"))
      .map((id) => normalizeChatId(id))
      .filter((id) => id != null);
  } catch {
    return [];
  }
};

const persistPinnedChatIds = (ids) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem("pinnedChats", JSON.stringify(ids));
};

const bumpChatToFront = (history, chatId, updater) => {
  const existingChat = findChatById(history, chatId);
  if (!existingChat) return history;

  const updatedChat = updater(existingChat);
  return [
    updatedChat,
    ...history.filter((chat) => chat.id !== chatId),
  ];
};

const replaceChatMessages = (history, chatId, messages) =>
  bumpChatToFront(history, chatId, (chat) => ({
    ...chat,
    messages,
  }));

const appendMessageToChat = (history, chatId, message, extraFields = {}) =>
  bumpChatToFront(history, chatId, (chat) => ({
    ...chat,
    ...extraFields,
    messages: [...messagesOrEmpty(chat), message],
  }));

const markMessageAsFailed = (history, chatId, messageId) =>
  bumpChatToFront(history, chatId, (chat) => ({
    ...chat,
    messages: messagesOrEmpty(chat).map((message) =>
      message?.id === messageId ? { ...message, status: "failed" } : message,
    ),
  }));

const upsertCreatedSession = (history, sessionId, userMessage, timestamp) => {
  const existingChat = findChatById(history, sessionId);
  const title = existingChat?.title || buildSessionTitle(userMessage.text);

  if (existingChat) {
    return appendMessageToChat(history, sessionId, userMessage, {
      title,
      updated_at: timestamp,
    });
  }

  return [
    {
      id: sessionId,
      title,
      messages: [userMessage],
      created_at: timestamp,
      updated_at: timestamp,
    },
    ...history,
  ];
};

const filterAndSortChats = (history, searchQuery, pinnedChatIds) => {
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const pinnedIdSet = new Set(pinnedChatIds);

  return [...history]
    .filter((chat) => {
      if (!normalizedSearchQuery) return true;
      return (chat.title || "").toLowerCase().includes(normalizedSearchQuery);
    })
    .sort((left, right) => {
      const leftPinned = pinnedIdSet.has(left.id);
      const rightPinned = pinnedIdSet.has(right.id);
      if (leftPinned !== rightPinned) {
        return leftPinned ? -1 : 1;
      }

      const leftUpdatedAt = Date.parse(left.updated_at || left.created_at || "") || 0;
      const rightUpdatedAt = Date.parse(right.updated_at || right.created_at || "") || 0;
      return rightUpdatedAt - leftUpdatedAt;
    });
};

const createUserMessage = (text) => ({
  id: makeLocalMessageId(),
  text,
  sender: "user",
  timestamp: new Date().toISOString(),
  status: "sent",
});

const createAssistantMessage = (payload) => {
  const normalizedPayload = unwrapResponsePayload(payload);

  return {
    id: makeLocalMessageId(),
    text: getReplyText(payload),
    sender: "bot",
    timestamp: new Date().toISOString(),
    processingTime:
      normalizedPayload.processing_time ?? payload?.processing_time,
    ragas: normalizedPayload.ragas ?? payload?.ragas,
    sources: normalizeSourceItems(
      normalizedPayload?.sources ?? payload?.sources,
    ),
    status: "sent",
  };
};

const readSearchParams = (search) => new URLSearchParams(search || "");

const getRequestedChatIdFromSearch = (search) =>
  normalizeChatId(readSearchParams(search).get("chatId"));

const hasAutoContextPrompt = (search) => {
  const params = readSearchParams(search);
  return params.has("machineId") && params.has("machineName");
};

const focusComposerLater = (inputRef) => {
  window.setTimeout(() => inputRef.current?.focus(), FOCUS_INPUT_DELAY_MS);
};

const closeCompactSidebar = (isCompactLayout, setSidebarCollapsed) => {
  if (isCompactLayout) {
    setSidebarCollapsed(true);
  }
};

const resolveSessionIdFromResponse = async (
  payload,
  { requestStartsNewChat, activeChatId, userText },
) => {
  const responseSessionId = getResponseSessionId(payload);
  if (responseSessionId != null) {
    return responseSessionId;
  }

  if (!requestStartsNewChat) {
    return normalizeChatId(activeChatId);
  }

  try {
    const sessionsRes = await chatService.fetchFallbackSessions();
    return findFallbackSessionId(sessionsRes?.data, userText);
  } catch (lookupError) {
    console.warn("Session fallback lookup failed:", lookupError);
    return null;
  }
};

export function useChatManager() {
  const location = useLocation();
  const navigate = useNavigate();
  const { dashboard } = usePlcLiveDataContext();
  const {
    alarms: opsAlarms,
    actions: opsActions,
    machines: opsMachines,
    zoneSummaries,
    resolveZoneIncidents,
  } = useOpsSyncContext();
  const [user, setUser] = useState(DEFAULT_USER);
  const [chatHistory, setChatHistory] = useState(readStoredMockZoneSessions);
  const [activeChatId, setActiveChatId] = useState(null);
  const [isNewChat, setIsNewChat] = useState(true);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isCompactLayout, setIsCompactLayout] = useState(false);
  const [pinnedChats, setPinnedChats] = useState(readPinnedChatIds);
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedId, setCopiedId] = useState(null);
  const [pendingMessage, setPendingMessage] = useState(null);
  const [streamingAssistant, setStreamingAssistant] = useState(null);
  const [apiError, setApiError] = useState("");
  const [isRecovering, setIsRecovering] = useState(false);
  const [autoStickToBottom, setAutoStickToBottom] = useState(true);
  const [isBootstrapReady, setIsBootstrapReady] = useState(false);

  const messagesContainerRef = useRef(null);
  const inputRef = useRef(null);
  const compactModeRef = useRef(null);
  const mockContextKeyRef = useRef(null);
  const machineContextKeyRef = useRef(null);
  const mockTimerEntriesRef = useRef([]);
  const submitRunIdRef = useRef(0);

  const rawMockRouteContext = useMemo(
    () => getMockZoneRouteContext(location.search),
    [location.search],
  );
  const mockRouteContext = useMemo(
    () =>
      buildMockZoneRuntimeContext({
        routeContext: rawMockRouteContext,
        dashboard,
        zoneSummaries,
        machines: opsMachines,
        alarms: opsAlarms,
        actions: opsActions,
      }),
    [dashboard, opsActions, opsAlarms, opsMachines, rawMockRouteContext, zoneSummaries],
  );

  const activeChat = useMemo(
    () => findChatById(chatHistory, activeChatId),
    [activeChatId, chatHistory],
  );
  const activeMessages = useMemo(() => messagesOrEmpty(activeChat), [activeChat]);
  const hasMessages =
    activeMessages.length > 0 ||
    !!pendingMessage ||
    Boolean(streamingAssistant);

  const sortedChats = useMemo(
    () => filterAndSortChats(chatHistory, searchQuery, pinnedChats),
    [chatHistory, pinnedChats, searchQuery],
  );

  const clearMockTimers = useCallback(() => {
    mockTimerEntriesRef.current.forEach(({ timerId, resolve }) => {
      window.clearTimeout(timerId);
      resolve(false);
    });
    mockTimerEntriesRef.current = [];
  }, []);

  const waitForMockTick = useCallback(
    (delayMs, runId) =>
      new Promise((resolve) => {
        if (runId !== submitRunIdRef.current) {
          resolve(false);
          return;
        }

        const timerId = window.setTimeout(() => {
          mockTimerEntriesRef.current = mockTimerEntriesRef.current.filter(
            (entry) => entry.timerId !== timerId,
          );
          resolve(runId === submitRunIdRef.current);
        }, delayMs);
        mockTimerEntriesRef.current.push({ timerId, resolve });
      }),
    [],
  );

  const resetScrollStickiness = useCallback(() => {
    setAutoStickToBottom(true);
  }, []);

  const resetDraftState = useCallback(
    ({ clearError = false } = {}) => {
      submitRunIdRef.current += 1;
      clearMockTimers();
      resetScrollStickiness();
      setActiveChatId(null);
      setIsNewChat(true);
      setInput("");
      setPendingMessage(null);
      setStreamingAssistant(null);
      setIsLoading(false);
      if (clearError) {
        setApiError("");
      }
    },
    [clearMockTimers, resetScrollStickiness],
  );

  const handleApiFailure = useCallback((error, fallbackMessage) => {
    console.error(error);
    setApiError(getApiErrorMessage(error, fallbackMessage));
  }, []);

  const loadBootstrapData = useCallback(async () => {
    const storedMockSessions = readStoredMockZoneSessions();
    const [profileRes, sessionsRes] = await chatService.fetchProfileAndSessions();
    const remoteSessions = mapSessionsFromPayload(sessionsRes?.data);
    const sessions = mergeSessionsWithMock(remoteSessions, storedMockSessions);
    const requestedChatId = getRequestedChatIdFromSearch(location.search);
    const preservedChatId =
      activeChatId != null &&
      sessions.some((session) => session.id === activeChatId)
        ? activeChatId
        : null;
    const requestedSessionExists =
      requestedChatId != null &&
      sessions.some((session) => session.id === requestedChatId);
    const nextActiveChatId =
      preservedChatId ?? (requestedSessionExists ? requestedChatId : null);

    setUser(profileRes?.data || DEFAULT_USER);
    setChatHistory(sessions);
    setActiveChatId(nextActiveChatId);
    setIsNewChat(nextActiveChatId == null || hasAutoContextPrompt(location.search));
    setApiError("");

    return sessions;
  }, [activeChatId, location.search]);

  const loadMessagesForSession = useCallback(
    async (sessionId) => {
      if (isMockZoneSessionId(sessionId)) {
        return messagesOrEmpty(findChatById(chatHistory, sessionId));
      }

      const response = await chatService.fetchSessionMessages(sessionId);
      const messages = mapMessagesFromPayload(response?.data);
      setChatHistory((prev) => replaceChatMessages(prev, sessionId, messages));
      setApiError("");
      return messages;
    },
    [chatHistory],
  );

  const resizeComposer = useCallback(() => {
    const element = inputRef.current;
    if (!element) return;

    element.style.height = "0px";
    const nextHeight = Math.min(184, Math.max(52, element.scrollHeight));
    element.style.height = `${nextHeight}px`;
  }, []);

  const scrollMessagesToBottom = useCallback((behavior = "smooth") => {
    const container = messagesContainerRef.current;
    if (!container) return;

    if (typeof container.scrollTo === "function") {
      container.scrollTo({ top: container.scrollHeight, behavior });
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, []);

  const handleNewChat = useCallback(() => {
    resetDraftState({ clearError: true });
    closeCompactSidebar(isCompactLayout, setSidebarCollapsed);
    if (location.search) {
      navigate("/chat", { replace: true });
    }
    focusComposerLater(inputRef);
  }, [isCompactLayout, location.search, navigate, resetDraftState]);

  const handleRetryConnection = useCallback(async () => {
    if (isRecovering) return;

    setIsRecovering(true);
    setApiError("");

    try {
      const sessions = await loadBootstrapData();
      const hasCurrentSession =
        activeChatId != null &&
        sessions.some((session) => session.id === activeChatId);
      const requestedChatId = getRequestedChatIdFromSearch(location.search);
      const targetSessionId = hasCurrentSession
        ? activeChatId
        : requestedChatId != null &&
            sessions.some((session) => session.id === requestedChatId)
          ? requestedChatId
          : null;

      if (targetSessionId != null) {
        await loadMessagesForSession(targetSessionId);
      }
    } catch (error) {
      handleApiFailure(error, "Failed to reconnect backend");
    } finally {
      setIsRecovering(false);
    }
  }, [
    activeChatId,
    handleApiFailure,
    isRecovering,
    location.search,
    loadBootstrapData,
    loadMessagesForSession,
  ]);

  const streamMockAssistantMessage = useCallback(
    async ({ sessionId, userText, mockContext, runId }) => {
      const assistantReply = buildMockZoneAssistantReply(mockContext, userText);
      const chunks = createMockZoneReplyChunks(assistantReply);
      const draftId = makeLocalMessageId();
      const timestamp = new Date().toISOString();
      let accumulatedText = "";

      if (runId !== submitRunIdRef.current) {
        return null;
      }

      setStreamingAssistant({
        id: draftId,
        sessionId,
        text: "",
        sender: "bot",
        timestamp,
        status: "streaming",
      });

      for (const chunk of chunks) {
        const didWait = await waitForMockTick(chunk.delayMs, runId);
        if (!didWait || runId !== submitRunIdRef.current) {
          return null;
        }
        accumulatedText += chunk.text;
        setStreamingAssistant((current) =>
          current?.id === draftId && runId === submitRunIdRef.current
            ? { ...current, text: accumulatedText }
            : current,
        );
      }

      return {
        id: draftId,
        text: assistantReply,
        sender: "bot",
        timestamp: new Date().toISOString(),
        status: "sent",
      };
    },
    [waitForMockTick],
  );

  const submitMockMessage = useCallback(
    async (trimmedInput, mockContext) => {
      if (!mockContext) return;

      const runId = submitRunIdRef.current + 1;
      submitRunIdRef.current = runId;
      const userMessage = createUserMessage(trimmedInput);
      const sessionId = mockContext.sessionId;
      const nowIso = new Date().toISOString();

      clearMockTimers();
      resetScrollStickiness();
      setApiError("");
      setInput("");
      setPendingMessage(null);
      setStreamingAssistant(null);
      setIsLoading(true);
      setActiveChatId(sessionId);
      setIsNewChat(false);

      setChatHistory((prev) =>
        upsertMockZoneSession(prev, {
          sessionId,
          title: mockContext.sessionTitle,
          userMessage,
          mockContext,
          timestamp: nowIso,
        }),
      );

      try {
        const assistantMessage = await streamMockAssistantMessage({
          sessionId,
          userText: trimmedInput,
          mockContext,
          runId,
        });

        if (!assistantMessage || runId !== submitRunIdRef.current) {
          return;
        }

        setChatHistory((prev) =>
          appendAssistantToMockSession(prev, {
            sessionId,
            assistantMessage,
            timestamp: assistantMessage.timestamp,
          }),
        );
        await resolveZoneIncidents({
          zoneId: mockContext.zoneId,
          machineId: mockContext.machineId,
          machineName: mockContext.machineName,
          errorCode: mockContext.errorCode,
          source: "mock_chat",
          note: `Resolved after AI guidance for ${mockContext.zoneName}.`,
        });
        setChatHistory((prev) =>
          prev.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  mockContext: {
                    ...session.mockContext,
                    activeIncidentCount: 0,
                    criticalCount: 0,
                  },
                }
              : session,
          ),
        );
      } catch (error) {
        if (runId !== submitRunIdRef.current) {
          return;
        }
        console.error("Mock chat error:", error);
        setApiError(getApiErrorMessage(error, "Failed to stream mock reply"));
      } finally {
        if (runId === submitRunIdRef.current) {
          setStreamingAssistant(null);
          setIsLoading(false);
        }
      }
    },
    [
      clearMockTimers,
      resetScrollStickiness,
      resolveZoneIncidents,
      streamMockAssistantMessage,
    ],
  );

  const submitMessage = useCallback(
    async (trimmedInput, options = {}) => {
      const nextInput = String(trimmedInput || "").trim();
      if (!nextInput) return;

      const requestedMockContext = options.mockContext || null;
      const derivedMockContext =
        requestedMockContext ||
        (activeChat?.isMockZone ? activeChat.mockContext : mockRouteContext);
      const shouldUseMock = shouldUseMockZoneSend({
        routeContext: requestedMockContext || mockRouteContext,
        activeChatId,
        activeChat,
      });

      if (shouldUseMock) {
        await submitMockMessage(nextInput, derivedMockContext);
        return;
      }

      if (isLoading) return;

      const runId = submitRunIdRef.current + 1;
      submitRunIdRef.current = runId;
      const userMessage = createUserMessage(nextInput);
      const requestStartsNewChat = activeChatId == null || isNewChat;

      clearMockTimers();
      resetScrollStickiness();
      setApiError("");
      setInput("");
      setIsLoading(true);
      setStreamingAssistant(null);

      if (activeChatId != null) {
        setChatHistory((prev) =>
          appendMessageToChat(prev, activeChatId, userMessage),
        );
      } else {
        setPendingMessage(userMessage);
      }

      try {
        const response = await chatService.sendMessage(
          userMessage.text,
          requestStartsNewChat ? null : activeChatId,
        );
        const payload = response?.data || {};
        const sessionId = await resolveSessionIdFromResponse(payload, {
          requestStartsNewChat,
          activeChatId,
          userText: userMessage.text,
        });

        if (runId !== submitRunIdRef.current) {
          return;
        }

        if (sessionId == null) {
          throw new Error(
            "Chat response is missing session_id (check API response format/config)",
          );
        }

        const botMessage = createAssistantMessage(payload);
        const nowIso = new Date().toISOString();

        if (requestStartsNewChat) {
          setChatHistory((prev) =>
            upsertCreatedSession(prev, sessionId, userMessage, nowIso),
          );
          setActiveChatId(sessionId);
          setIsNewChat(false);
          setPendingMessage(null);
        }

        setChatHistory((prev) =>
          appendMessageToChat(prev, sessionId, botMessage, {
            updated_at: nowIso,
          }),
        );
      } catch (error) {
        if (runId !== submitRunIdRef.current) {
          return;
        }
        console.error("Chat error:", error);
        setApiError(getApiErrorMessage(error, "Failed to send message"));

        if (!requestStartsNewChat && activeChatId != null) {
          setChatHistory((prev) =>
            markMessageAsFailed(prev, activeChatId, userMessage.id),
          );
        }

        setInput((current) => current || userMessage.text);
        if (requestStartsNewChat) {
          setPendingMessage({ ...userMessage, status: "failed" });
        }
      } finally {
        if (runId === submitRunIdRef.current) {
          setIsLoading(false);
        }
      }
    },
    [
      activeChat,
      activeChatId,
      clearMockTimers,
      isLoading,
      isNewChat,
      mockRouteContext,
      resetScrollStickiness,
      submitMockMessage,
    ],
  );

  const handleSelectChat = useCallback(
    (chatId) => {
      resetScrollStickiness();
      setActiveChatId(chatId);
      setIsNewChat(false);
      setPendingMessage(null);
      setStreamingAssistant(null);
      closeCompactSidebar(isCompactLayout, setSidebarCollapsed);
      navigate(`/chat?chatId=${encodeURIComponent(String(chatId))}`);
    },
    [isCompactLayout, navigate, resetScrollStickiness],
  );

  const togglePin = useCallback((event, id) => {
    event.stopPropagation();
    const normalizedId = normalizeChatId(id);
    if (normalizedId == null) return;

    setPinnedChats((prev) => {
      const next = prev.includes(normalizedId)
        ? prev.filter((value) => value !== normalizedId)
        : [...prev, normalizedId];
      persistPinnedChatIds(next);
      return next;
    });
  }, []);

  const handleDelete = useCallback(
    async (event, id) => {
      event.stopPropagation();
      const normalizedId = normalizeChatId(id);
      if (normalizedId == null) return;

      const removeSessionLocally = () => {
        setChatHistory((prev) =>
          prev.filter((chat) => chat.id !== normalizedId),
        );
        if (normalizeChatId(activeChatId) === normalizedId) {
          handleNewChat();
        }
      };

      if (isMockZoneSessionId(normalizedId)) {
        removeSessionLocally();
        return;
      }

      try {
        await chatService.deleteSession(normalizedId);
        removeSessionLocally();
      } catch (error) {
        if (error?.response?.status === 404) {
          removeSessionLocally();
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
      window.setTimeout(() => setCopiedId(null), COPY_FEEDBACK_RESET_MS);
    } catch (error) {
      console.error("Copy failed:", error);
    }
  }, []);

  const openSourceDocument = useCallback(async (sourceItem) => {
    const source = String(sourceItem?.source || "").trim();
    if (!source) return;

    const page = normalizePageNumber(sourceItem?.page);
    const isPdf = source.toLowerCase().endsWith(".pdf");

    try {
      const response = await chatService.getSourceDocument(source);
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

      window.setTimeout(
        () => URL.revokeObjectURL(objectUrl),
        SOURCE_URL_REVOKE_DELAY_MS,
      );
    } catch (error) {
      console.error("Open source failed", error);
      setApiError(getApiErrorMessage(error, "Failed to open source document"));
    }
  }, []);

  useEffect(() => {
    persistMockZoneSessions(
      chatHistory.filter(
        (session) => session.isMockZone || isMockZoneSessionId(session.id),
      ),
    );
  }, [chatHistory]);

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
        if (!cancelled) {
          handleApiFailure(error, "Failed to load chat data");
        }
      } finally {
        if (!cancelled) {
          setIsBootstrapReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [handleApiFailure, loadBootstrapData]);

  useEffect(() => {
    if (activeChatId == null || isMockZoneSessionId(activeChatId)) return;

    const chat = findChatById(chatHistory, activeChatId);
    if (messagesOrEmpty(chat).length > 0) return;

    let cancelled = false;
    loadMessagesForSession(activeChatId).catch((error) => {
      if (!cancelled) {
        handleApiFailure(error, "Failed to load chat messages");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeChatId, chatHistory, handleApiFailure, loadMessagesForSession]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [activeChatId, isNewChat]);

  useEffect(() => {
    resizeComposer();
  }, [hasMessages, input, resizeComposer]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const onScroll = () => {
      const distanceFromBottom =
        container.scrollHeight - (container.scrollTop + container.clientHeight);
      const nextShouldStick = distanceFromBottom < 72;
      setAutoStickToBottom((current) =>
        current === nextShouldStick ? current : nextShouldStick,
      );
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => container.removeEventListener("scroll", onScroll);
  }, [activeChatId, hasMessages]);

  useEffect(() => {
    if (!hasMessages || !autoStickToBottom) return;

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
    streamingAssistant?.text,
  ]);

  useEffect(() => {
    if (!mockRouteContext) {
      mockContextKeyRef.current = null;
      return undefined;
    }

    if (!isBootstrapReady) return undefined;

    const contextKey = [
      mockRouteContext.sessionId,
      mockRouteContext.machineId,
      mockRouteContext.errorCode,
      mockRouteContext.source,
    ].join("::");

    if (mockContextKeyRef.current === contextKey) return undefined;

    mockContextKeyRef.current = contextKey;

    const timerId = window.setTimeout(() => {
      submitMessage(buildMockZonePrompt(mockRouteContext), {
        mockContext: mockRouteContext,
      });

      navigate(
        `/chat?chatId=${encodeURIComponent(String(mockRouteContext.sessionId))}`,
        {
          replace: true,
        },
      );
    }, AUTO_MOCK_ZONE_DELAY_MS);

    return () => window.clearTimeout(timerId);
  }, [isBootstrapReady, mockRouteContext, navigate, submitMessage]);

  useEffect(() => {
    if (mockRouteContext) {
      machineContextKeyRef.current = null;
      return undefined;
    }

    const params = new URLSearchParams(location.search);
    const machineId = params.get("machineId");
    const machineName = params.get("machineName");
    const errorCode = params.get("errorCode");

    if (!machineId || !machineName || !isBootstrapReady) {
      machineContextKeyRef.current = null;
      return undefined;
    }

    const contextKey = [machineId, machineName, errorCode || "FAULT"].join("::");
    if (machineContextKeyRef.current === contextKey) return undefined;

    machineContextKeyRef.current = contextKey;
    navigate("/chat", { replace: true });

    const timer = window.setTimeout(() => {
      const prompt = `Machine "${machineName}" (ID: ${machineId}) has error status ${errorCode || "FAULT"}. Please diagnose the issue, identify the root cause, and suggest recovery steps.`;
      resetDraftState();
      submitMessage(prompt);
    }, AUTO_DIAGNOSIS_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [
    isBootstrapReady,
    location.search,
    mockRouteContext,
    navigate,
    resetDraftState,
    submitMessage,
  ]);

  useEffect(
    () => () => {
      clearMockTimers();
    },
    [clearMockTimers],
  );

  return {
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
  };
}
