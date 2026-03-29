import { Fragment, memo, useEffect, useMemo } from "react";
import {
  MessageSquareText,
  Pin,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useT } from "../../utils/i18n";
import { formatTimeAgo } from "./utils";

const groupChatsByDate = (items) => {
  const now = new Date();
  const today = now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayKey = yesterday.toDateString();

  return items.reduce(
    (groups, chat) => {
      const date = chat.updated_at ? new Date(chat.updated_at) : null;
      const bucket = !date
        ? "thisWeek"
        : date.toDateString() === today
          ? "today"
          : date.toDateString() === yesterdayKey
            ? "yesterday"
            : "thisWeek";
      groups[bucket].push(chat);
      return groups;
    },
    { today: [], yesterday: [], thisWeek: [] },
  );
};

const MARKDOWN_BOLD_RE = /\*\*([^*]+)\*\*/g;

const getSessionPreviewText = (chat) => {
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  const lastMessage = [...messages]
    .reverse()
    .find((message) => typeof message?.text === "string" && message.text.trim());

  return String(lastMessage?.text || "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const renderInlineMarkdownPreview = (text) => {
  const content = String(text || "");
  if (!content) return null;

  const parts = [];
  let lastIndex = 0;
  let match;
  MARKDOWN_BOLD_RE.lastIndex = 0;

  while ((match = MARKDOWN_BOLD_RE.exec(content))) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }

    parts.push(
      <strong key={`${match.index}-${match[1]}`} className="chat-session-preview-strong">
        {match[1]}
      </strong>,
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  return parts.map((part, index) =>
    typeof part === "string" ? <Fragment key={index}>{part}</Fragment> : part,
  );
};

function ChatSidebar({
  hasAppSidebar = false,
  isCompactLayout,
  sidebarCollapsed,
  setSidebarCollapsed,
  overlayEnabled = true,
  sortedChats,
  activeChatId,
  onSelectChat,
  pinnedChats,
  onTogglePin,
  onDeleteChat,
  searchQuery,
  onSearchQueryChange,
  onNewChat,
}) {
  const { t, locale } = useT();
  const isDesktopCollapsed = !isCompactLayout && sidebarCollapsed;
  const isOverlayOpen = overlayEnabled && isCompactLayout && !sidebarCollapsed;
  const showBrand = !hasAppSidebar || isCompactLayout;
  const groupedChats = useMemo(
    () => groupChatsByDate(sortedChats),
    [sortedChats],
  );

  useEffect(() => {
    if (!isOverlayOpen) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setSidebarCollapsed(true);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOverlayOpen, setSidebarCollapsed]);

  return (
    <>
      {isOverlayOpen ? (
        <div
          className="chat-sidebar-overlay"
          onClick={() => setSidebarCollapsed(true)}
          aria-hidden="true"
        />
      ) : null}

      <aside
        className={`chat-panel glass-panel-strong glass-noise ${isOverlayOpen ? "mobile-open" : ""} ${isCompactLayout && sidebarCollapsed ? "is-hidden-mobile" : ""} ${isDesktopCollapsed ? "desktop-collapsed" : ""} ${hasAppSidebar ? "with-app-sidebar" : ""}`}
        aria-hidden={isCompactLayout ? sidebarCollapsed : false}
      >
        <div className="chat-panel-header">
          {!isDesktopCollapsed && showBrand ? (
            <div className="chat-brand">
              <span className="chat-brand-logo">
                <MessageSquareText size={16} />
              </span>
              <div>
                <p className="chat-brand-title">{t("chat.brand")}</p>
                <p className="chat-brand-sub">{t("chat.brandSub")}</p>
              </div>
            </div>
          ) : null}

          {isCompactLayout ? (
            <button
              type="button"
              className="control-btn glass-interactive"
              onClick={() => setSidebarCollapsed((current) => !current)}
              title={t("chat.closePanel")}
            >
              <X size={16} />
            </button>
          ) : null}
        </div>

        <button
          type="button"
          className="chat-new-btn glass-interactive"
          onClick={onNewChat}
        >
          <Plus size={16} />
          {!isDesktopCollapsed ? t("chat.newChat") : null}
        </button>

        {!isDesktopCollapsed ? (
          <label className="relative block">
            <Search size={14} className="chat-search-icon" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              placeholder={t("chat.searchChats")}
              className="chat-search-input"
            />
          </label>
        ) : null}

        {!isDesktopCollapsed ? (
          <p className="mt-3 text-[11px] uppercase tracking-[0.1em] font-semibold text-[color:var(--text-muted)] px-1">
            {searchQuery
              ? t("chat.results", { count: sortedChats.length })
              : t("chat.recent")}
          </p>
        ) : null}

        <div className="chat-panel-list">
          {Object.entries(groupedChats).map(([label, chats]) =>
            chats.length ? (
              <div key={label} className="chat-session-group">
                <p className="chat-session-group-label">{t(`chat.group.${label}`)}</p>
                {chats.map((chat, index) => {
                  const isPinned = pinnedChats.includes(chat.id);
                  const isActive = chat.id === activeChatId;
                  const previewText = getSessionPreviewText(chat);

                  return (
                    <div
                      key={chat.id}
                      className={`chat-session-item glass-interactive group ${isActive ? "active" : ""}`}
                      style={{ "--session-index": index }}
                      data-active={isActive ? "1" : "0"}
                      onClick={() => onSelectChat(chat.id)}
                    >
                      <div className="relative">
                        <MessageSquareText
                          size={15}
                          className="text-[color:var(--text-secondary)]"
                        />
                        {isPinned ? (
                          <Pin
                            size={8}
                            className="absolute -top-1 -right-1 text-amber-400 fill-amber-400"
                          />
                        ) : null}
                      </div>

                      {!isDesktopCollapsed ? (
                        <div className="flex-1 min-w-0">
                          <p className="chat-session-title">
                            {chat.title || t("chat.newChat")}
                          </p>
                          {previewText ? (
                            <p className="chat-session-preview">
                              {renderInlineMarkdownPreview(previewText)}
                            </p>
                          ) : null}
                          {chat.updated_at ? (
                            <p className="chat-session-time">
                              {formatTimeAgo(chat.updated_at, locale)}
                            </p>
                          ) : null}
                        </div>
                      ) : null}

                      {!isDesktopCollapsed ? (
                        <div className="chat-session-actions">
                          <button
                            type="button"
                            onClick={(event) => onTogglePin(event, chat.id)}
                            className="chat-icon-btn chat-sidebar-icon-btn glass-interactive"
                            title={isPinned ? t("chat.unpin") : t("chat.pin")}
                            aria-label={isPinned ? t("chat.unpin") : t("chat.pin")}
                          >
                            <Pin
                              size={14}
                              className={isPinned ? "fill-amber-400 text-amber-400" : ""}
                            />
                          </button>

                          <button
                            type="button"
                            onClick={(event) => onDeleteChat(event, chat.id)}
                            className="chat-icon-btn chat-sidebar-icon-btn glass-interactive"
                            title={t("chat.delete")}
                            aria-label={t("chat.delete")}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null,
          )}
        </div>
      </aside>
    </>
  );
}

export default memo(ChatSidebar);
