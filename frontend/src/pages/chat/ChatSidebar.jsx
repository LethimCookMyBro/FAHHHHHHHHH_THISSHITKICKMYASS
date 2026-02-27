import { memo, useEffect } from "react";
import {
  MessageSquareText,
  PanelLeft,
  PanelLeftClose,
  Pin,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useT } from "../../utils/i18n";
import { formatTimeAgo } from "./utils";

function ChatSidebar({
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
  const { t } = useT();
  const isDesktopCollapsed = !isCompactLayout && sidebarCollapsed;
  const isOverlayOpen = overlayEnabled && isCompactLayout && !sidebarCollapsed;

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
        className={`chat-panel glass-panel-strong glass-noise ${isOverlayOpen ? "mobile-open" : ""} ${isCompactLayout && sidebarCollapsed ? "is-hidden-mobile" : ""} ${isDesktopCollapsed ? "desktop-collapsed" : ""}`}
        aria-hidden={isCompactLayout ? sidebarCollapsed : false}
      >
        <div className="chat-panel-header">
          {!isDesktopCollapsed ? (
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

          <button
            type="button"
            className="control-btn glass-interactive"
            onClick={() => setSidebarCollapsed((current) => !current)}
            title={
              isCompactLayout
                ? "Close panel"
                : isDesktopCollapsed
                  ? "Expand panel"
                  : "Collapse panel"
            }
          >
            {isCompactLayout ? (
              <X size={16} />
            ) : isDesktopCollapsed ? (
              <PanelLeft size={16} />
            ) : (
              <PanelLeftClose size={16} />
            )}
          </button>
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
          {sortedChats.map((chat) => {
            const isPinned = pinnedChats.includes(chat.id);
            const isActive = chat.id === activeChatId;

            return (
              <div
                key={chat.id}
                className={`chat-session-item glass-interactive group ${isActive ? "active" : ""}`}
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
                      {chat.title || "New Chat"}
                    </p>
                    {chat.updated_at ? (
                      <p className="chat-session-time">
                        {formatTimeAgo(chat.updated_at)}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {!isDesktopCollapsed ? (
                  <div className="flex items-center gap-1 opacity-90 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={(event) => onTogglePin(event, chat.id)}
                      className="chat-icon-btn glass-interactive"
                      title={isPinned ? "Unpin" : "Pin"}
                    >
                      <Pin
                        size={12}
                        className={
                          isPinned ? "fill-amber-400 text-amber-400" : ""
                        }
                      />
                    </button>

                    <button
                      type="button"
                      onClick={(event) => onDeleteChat(event, chat.id)}
                      className="chat-icon-btn glass-interactive"
                      title="Delete"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </aside>
    </>
  );
}

export default memo(ChatSidebar);
