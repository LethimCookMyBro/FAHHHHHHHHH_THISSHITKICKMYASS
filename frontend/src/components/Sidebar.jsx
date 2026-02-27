import { useEffect, useState, useMemo } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  AlertTriangle,
  MessageSquare,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  Factory,
  Globe,
  LogOut,
  Moon,
  Sun,
  Wifi,
} from "lucide-react";
import { useT } from "../utils/i18n";
import GooeyNav from "./GooeyNav";

const NAV_ITEMS = [
  { to: "/", key: "nav.dashboard", icon: LayoutDashboard, end: true },
  { to: "/alarms", key: "nav.incidents", icon: AlertTriangle },
  { to: "/chat", key: "nav.chat", icon: MessageSquare },
  { to: "/actions", key: "nav.actions", icon: ClipboardList },
];

const CONNECTION_KEY = {
  live: "sidebar.live",
  reconnecting: "sidebar.reconnecting",
  rest: "sidebar.restFallback",
  connecting: "sidebar.connecting",
};

const getInitials = (name) => {
  const value = String(name || "Operator").trim();
  if (!value) return "OP";
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
};

export default function Sidebar({
  alarmCount = 0,
  onLogout,
  theme = "dark",
  onToggleTheme,
  connectionState = "connecting",
  userName = "Operator",
  userRole = "",
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [clock, setClock] = useState("");
  const location = useLocation();
  const navigate = useNavigate();
  const { t, locale, setLocale } = useT();

  const activeNavIndex = useMemo(() => {
    const path = location.pathname;
    const idx = NAV_ITEMS.findIndex((item) =>
      item.end ? path === item.to : path.startsWith(item.to),
    );
    return idx >= 0 ? idx : 0;
  }, [location.pathname]);

  const gooeyItems = useMemo(
    () =>
      NAV_ITEMS.map(({ to, key, icon: Icon, end }) => ({
        content: (
          <NavLink
            to={to}
            end={end}
            className={({ isActive }) => {
              const active = end ? location.pathname === "/" : isActive;
              return `nexus-nav-link ${active ? "is-active" : ""}`;
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <Icon size={18} />
            <span className="hide-on-collapsed">{t(key)}</span>
            {key === "nav.incidents" && alarmCount > 0 ? (
              <span className="nexus-alarm-pill hide-on-collapsed">
                {alarmCount}
              </span>
            ) : null}
          </NavLink>
        ),
        to,
      })),
    [t, alarmCount, location.pathname],
  );

  useEffect(() => {
    const tick = () => {
      setClock(
        new Date().toLocaleTimeString(locale === "th" ? "th-TH" : "en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [locale]);

  const isLive = connectionState === "live";
  const connectionLabel = t(
    CONNECTION_KEY[connectionState] || CONNECTION_KEY.connecting,
  );
  const isRoot = location.pathname === "/";

  return (
    <aside className={`nexus-sidebar ${collapsed ? "is-collapsed" : ""}`}>
      {/* ── Brand ── */}
      <div className="nexus-sidebar-brand">
        <div className="nexus-brand-row">
          <span className="nexus-brand-logo">
            <Factory size={18} />
          </span>
          <div className="hide-on-collapsed min-w-0">
            <p className="nexus-brand-title">{t("brand.title")}</p>
            <p className="nexus-brand-sub">{t("brand.subtitle")}</p>
          </div>
        </div>
      </div>

      {/* ── Status Card ── */}
      {collapsed ? (
        <div className="nexus-status-mini" title={connectionLabel}>
          <span className="nexus-status-dot-wrap">
            {isLive ? (
              <>
                <span className="nexus-status-ping" />
                <span className="nexus-status-dot is-live" />
              </>
            ) : (
              <span className="nexus-status-dot" />
            )}
          </span>
        </div>
      ) : (
        <div className="nexus-status-card">
          <div className="nexus-status-row">
            <span className="nexus-status-dot-wrap">
              {isLive ? (
                <>
                  <span className="nexus-status-ping" />
                  <span className="nexus-status-dot is-live" />
                </>
              ) : (
                <span className="nexus-status-dot" />
              )}
            </span>
            <span className="hide-on-collapsed nexus-status-label">
              {connectionLabel}
            </span>
            <Wifi size={14} className="hide-on-collapsed nexus-status-wifi" />
          </div>
          <div className="hide-on-collapsed nexus-status-meta">
            <span className="nexus-mono">{clock}</span>
          </div>
        </div>
      )}

      {/* ── Navigation ── */}
      <div className="nexus-nav-label hide-on-collapsed">
        {t("nav.navigation")}
      </div>

      <nav className="nexus-nav-list">
        <GooeyNav
          items={gooeyItems}
          activeIndex={activeNavIndex}
          onSelect={(idx) => navigate(NAV_ITEMS[idx].to)}
          particleCount={12}
          particleDistances={[70, 8]}
          particleR={80}
          animationTime={600}
          timeVariance={250}
          colors={[1, 2, 3, 1, 2, 3, 1, 4]}
        />
      </nav>

      {/* ── Bottom Section ── */}
      <div className="nexus-sidebar-bottom">
        {/* User */}
        {!collapsed ? (
          <div className="nexus-user-card">
            <div className="nexus-user-row">
              <span className="nexus-user-avatar">{getInitials(userName)}</span>
              <div className="hide-on-collapsed min-w-0">
                <p className="nexus-user-name">{userName}</p>
                {userRole ? <p className="nexus-user-role">{userRole}</p> : null}
              </div>
            </div>
          </div>
        ) : null}

        {/* Controls */}
        <div className="nexus-controls">
          <button
            type="button"
            className="nexus-ctrl-btn"
            onClick={() => setLocale(locale === "th" ? "en" : "th")}
            title={locale === "th" ? "Switch to English" : "เปลี่ยนเป็นไทย"}
          >
            <Globe size={16} />
          </button>

          <button
            type="button"
            className="nexus-ctrl-btn"
            onClick={onToggleTheme}
            title={
              theme === "dark" ? t("sidebar.lightMode") : t("sidebar.darkMode")
            }
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          <button
            type="button"
            className="nexus-ctrl-btn"
            onClick={() => setCollapsed((current) => !current)}
            title={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>

          <button
            type="button"
            className="nexus-ctrl-btn nexus-ctrl-logout"
            onClick={onLogout}
            title={t("sidebar.logout")}
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
