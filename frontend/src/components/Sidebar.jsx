import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Activity,
  PieChart,
  Map,
  Briefcase,
  Lightbulb,
  MessageSquare,
  ChevronsLeft,
  ChevronsRight,
  Globe,
  LogOut,
} from "lucide-react";
import { useT } from "../utils/i18n";
import useMediaQuery from "../hooks/useMediaQuery";
import useConnectionLabel from "../hooks/useConnectionLabel";

const NAV_ITEMS = [
  { to: "/", key: "nav.overview", icon: PieChart, end: true },
  { to: "/overview", key: "nav.portMap", icon: Map },
  { to: "/equipment", key: "nav.equipment", icon: Briefcase },
  { to: "/alarms", key: "nav.alerts", icon: Lightbulb },
  { to: "/chat", key: "nav.chat", icon: MessageSquare },
];

export default function Sidebar({
  alarmCount = 0,
  onLogout,
  connectionState = "connecting",
  userName = "Operator",
  userRole = "",
  mobileOpen = false,
  onMobileOpenChange,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const isMobile = useMediaQuery("(max-width: 980px)");
  const isTablet = useMediaQuery("(min-width: 768px) and (max-width: 1220px)");
  const { t, locale, setLocale } = useT();
  const { label: connectionLabel } = useConnectionLabel(connectionState);
  const userInitials = useMemo(() => {
    const source = String(userName || "Operator").trim();
    if (!source) return "OP";
    return source
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("");
  }, [userName]);

  const activeNavIndex = useMemo(() => {
    const path = location.pathname;
    const idx = NAV_ITEMS.findIndex((item) =>
      item.end ? path === item.to : path.startsWith(item.to),
    );
    return idx >= 0 ? idx : 0;
  }, [location.pathname]);

  useEffect(() => {
    if (!isMobile) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        onMobileOpenChange?.(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isMobile, onMobileOpenChange]);

  useEffect(() => {
    if (isMobile) {
      setCollapsed(false);
      return;
    }
    if (isTablet) {
      setCollapsed(false);
    }
  }, [isMobile, isTablet]);

  return (
    <>
      {isMobile && mobileOpen ? (
        <button
          type="button"
          aria-label="Close sidebar"
          className="nexus-sidebar-backdrop"
          onClick={() => onMobileOpenChange?.(false)}
        />
      ) : null}

      <aside
        className={`nexus-sidebar ${collapsed ? "is-collapsed" : ""} ${isMobile ? "is-mobile" : ""} ${mobileOpen ? "is-mobile-open" : ""}`}
      >
        <div className="nexus-sidebar-brand" style={{ paddingBottom: "24px" }}>
          <div className="nexus-brand-row">
            <span className="nexus-brand-logo">
              <img
                src="/favicon.svg"
                alt={t("brand.title")}
                className="nexus-brand-logo-image"
              />
            </span>
            <div className="hide-on-collapsed min-w-0">
              <p className="nexus-brand-title">{t("brand.title")}</p>
              <p className="nexus-brand-sub">{t("brand.subtitle")}</p>
            </div>
          </div>
        </div>

        {!collapsed ? (
          <div className="nexus-status-card">
            <div className="nexus-status-row">
              <span className="nexus-status-dot-wrap">
                <span
                  className={`nexus-status-ping ${connectionState === "live" ? "is-live" : ""}`}
                />
                <span
                  className={`nexus-status-dot ${connectionState === "live" ? "is-live" : ""}`}
                />
              </span>
              <span className="nexus-status-label">{connectionLabel}</span>
              <Activity size={14} className="nexus-status-wifi" />
            </div>
            <p className="nexus-status-meta">
              {alarmCount > 0
                ? `${alarmCount} ${t("nav.alerts")}`
                : t("common.liveStream")}
            </p>
          </div>
        ) : null}

        {!collapsed ? (
          <p className="nexus-nav-section">{t("nav.navigation")}</p>
        ) : null}

        <nav className="nexus-nav-list">
          {NAV_ITEMS.map(({ to, key, icon: Icon, end }, navIndex) => (
            <NavLink
              key={key}
              to={to}
              end={end}
              style={{ "--nav-index": navIndex }}
              className={({ isActive }) => {
                const active = end ? location.pathname === "/" : isActive;
                return `nexus-nav-link ${active ? "is-active" : ""}`;
              }}
              onClick={() => {
                if (isMobile) onMobileOpenChange?.(false);
              }}
            >
              {activeNavIndex === navIndex ? (
                <span className="nexus-nav-active-bg" />
              ) : null}

              <span className="nexus-nav-icon">
                <Icon size={18} />
              </span>
              <span className="hide-on-collapsed nexus-nav-text">{t(key)}</span>
              {key === "nav.alerts" && alarmCount > 0 ? (
                <span className="nexus-alarm-pill hide-on-collapsed">
                  {alarmCount}
                </span>
              ) : null}
            </NavLink>
          ))}
        </nav>

        <div className="nexus-sidebar-bottom">
          <div className="nexus-user-card">
            <div className="nexus-user-row">
              <span className="nexus-user-avatar">{userInitials}</span>
              <div className="hide-on-collapsed">
                <p className="nexus-user-name">{userName}</p>
                <p className="nexus-user-role">
                  {userRole || t("topbar.operator")}
                </p>
              </div>
            </div>
          </div>

          <div className="nexus-controls">
            <button
              type="button"
              className="nexus-ctrl-btn"
              onClick={() => setLocale(locale === "th" ? "en" : "th")}
              title={
                locale === "th"
                  ? t("sidebar.switchToEnglish")
                  : t("sidebar.switchToThai")
              }
            >
              <Globe size={16} />
            </button>

            <button
              type="button"
              className="nexus-ctrl-btn hide-on-mobile"
              onClick={() => setCollapsed((current) => !current)}
              title={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
            >
              {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
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
    </>
  );
}
