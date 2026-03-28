import { memo } from "react";
import { Bell, Boxes, Download, Menu, Moon, Search, Sun } from "lucide-react";
import { useT } from "../../utils/i18n";
import { useAppTopbar } from "../../layout/AppTopbarContext";
import { useTheme } from "../../features/theme/themeContext";

const getInitials = (name) => {
  const value = String(name || "Operator").trim();
  if (!value) return "OP";
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
};

function AppTopbar({
  onOpenSidebar,
  showSidebarToggle = false,
  userName = "Operator",
  userRole = "",
  notificationCount = 0,
}) {
  const { t } = useT();
  const { config } = useAppTopbar();
  const { theme, toggleTheme } = useTheme();

  const {
    title,
    subtitle,
    search,
    statusPill,
    primaryAction,
    secondaryAction,
  } = config;
  const activeNotificationCount = Math.max(0, Number(notificationCount) || 0);
  const insightCount =
    activeNotificationCount > 0
      ? Math.max(1, Math.floor(activeNotificationCount / 2))
      : 0;
  const avatarLabel = getInitials(userName);
  const isDark = theme === "dark";

  return (
    <header className="app-topbar">
      <div className="app-topbar-utility-row">
        <div className="app-topbar-main">
          <div className="app-topbar-left">
            {showSidebarToggle ? (
              <button
                type="button"
                className="app-topbar-menu-btn"
                onClick={onOpenSidebar}
                title={t("sidebar.expand")}
              >
                <Menu size={18} />
              </button>
            ) : null}
            {search?.enabled ? (
              <label
                className="app-topbar-search"
                aria-label={search.placeholder || t("nav.search")}
              >
                <Search size={16} className="app-topbar-search-icon" />
                <input
                  type="text"
                  value={search.value || ""}
                  placeholder={search.placeholder || t("nav.search")}
                  onChange={(event) => search.onChange?.(event.target.value)}
                />
                <span className="app-topbar-kbd">Ctrl + K</span>
              </label>
            ) : null}
          </div>
        </div>

        <div className="app-topbar-actions">
          {statusPill?.label ? (
            <span className={`app-topbar-status tone-${statusPill.tone || "neutral"}`}>
              <span className="status-dot" />
              {statusPill.label}
            </span>
          ) : null}

          {secondaryAction ? (
            <button
              type="button"
              className="app-topbar-btn secondary"
              onClick={secondaryAction.onClick}
              disabled={secondaryAction.disabled}
            >
              {secondaryAction.icon ? <secondaryAction.icon size={16} /> : <Download size={16} />}
              {secondaryAction.label}
            </button>
          ) : null}

          {primaryAction ? (
            <button
              type="button"
              className="app-topbar-btn primary"
              onClick={primaryAction.onClick}
              disabled={primaryAction.disabled}
            >
              {primaryAction.icon ? <primaryAction.icon size={16} /> : null}
              {primaryAction.label}
            </button>
          ) : null}

          {insightCount > 0 ? (
            <button
              type="button"
              className="app-topbar-icon-btn"
              title={t("topbar.insights")}
            >
              <Boxes size={16} />
              <span className="app-topbar-icon-badge">{insightCount}</span>
            </button>
          ) : null}

          <button
            type="button"
            className="app-topbar-icon-btn"
            title={t("topbar.notifications")}
          >
            <Bell size={16} />
            {activeNotificationCount > 0 ? (
              <span className="app-topbar-icon-badge">
                {Math.min(99, activeNotificationCount)}
              </span>
            ) : null}
          </button>

          <button
            type="button"
            className="app-theme-toggle"
            data-mode={theme}
            onClick={toggleTheme}
            title={isDark ? t("topbar.switchToLight") : t("topbar.switchToDark")}
            aria-label={isDark ? t("topbar.switchToLight") : t("topbar.switchToDark")}
          >
            <span className="app-theme-toggle-track">
              <span className="app-theme-toggle-knob">
                {isDark ? <Moon size={15} /> : <Sun size={15} />}
              </span>
            </span>
          </button>

          <div className="app-topbar-profile">
            <span className="app-topbar-avatar">{avatarLabel}</span>
            <div className="app-topbar-user-copy">
              <p className="app-topbar-user-name">{userName}</p>
              <p className="app-topbar-user-role">{userRole || t("topbar.operator")}</p>
            </div>
          </div>
        </div>
      </div>

      {(title || subtitle) ? (
        <div className="app-topbar-heading">
          {title ? <h1 className="app-topbar-title">{title}</h1> : null}
          {subtitle ? <p className="app-topbar-subtitle">{subtitle}</p> : null}
        </div>
      ) : null}
    </header>
  );
}

export default memo(AppTopbar);
