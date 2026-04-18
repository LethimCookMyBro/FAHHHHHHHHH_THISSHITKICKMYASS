import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import Sidebar from "../Sidebar";
import AppTopbar from "./AppTopbar";
import {
  PlcLiveDataProvider,
  usePlcLiveDataContext,
} from "../../features/plc/PlcLiveDataContext";
import {
  OpsSyncProvider,
  useOpsSyncContext,
} from "../../features/ops/OpsSyncContext";
import { useUserUiPreferencesSync } from "../../hooks/useUserUiPreferencesSync";
import { AppTopbarProvider } from "../../layout/AppTopbarContext";
import useMediaQuery from "../../hooks/useMediaQuery";
import featureFlags from "../../utils/featureFlags";
import { isChatRoute } from "../../utils/routes";
import "../../styles/layout.css";
import "../../styles/ops-ui.css";
import "../../styles/chat/markdown.css";

function AuthenticatedLayoutContent({
  children,
  onLogout,
  user,
  userName,
  userRole,
}) {
  const location = useLocation();
  const { connectionState } = usePlcLiveDataContext();
  const { alarms } = useOpsSyncContext();
  const chatRouteActive = isChatRoute(location.pathname);
  const isCompactLayout = useMediaQuery("(max-width: 980px)");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const activeAlarmCount = alarms.filter(
    (alarm) => String(alarm?.status || "active").toLowerCase() === "active",
  ).length;
  const shellClass = featureFlags.uiV2
    ? "plc-shell app-shell-ambience"
    : "min-h-screen flex bg-slate-950 text-slate-100";

  useUserUiPreferencesSync({ user });

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className={shellClass}>
      <Sidebar
        alarmCount={activeAlarmCount}
        onLogout={onLogout}
        connectionState={connectionState}
        userName={userName}
        userRole={userRole}
        mobileOpen={mobileSidebarOpen}
        onMobileOpenChange={setMobileSidebarOpen}
      />

      <main className={`plc-main ${chatRouteActive ? "is-chat-route" : ""}`}>
        {!chatRouteActive || isCompactLayout ? (
          <AppTopbar
            onOpenSidebar={() => setMobileSidebarOpen(true)}
            showSidebarToggle={isCompactLayout}
            userName={userName}
            userRole={userRole}
            notificationCount={activeAlarmCount}
          />
        ) : null}

        <div className={`plc-route-body ${chatRouteActive ? "is-chat-route" : ""}`}>
          {children}
        </div>
      </main>
    </div>
  );
}

export default function AuthenticatedLayout(props) {
  return (
    <PlcLiveDataProvider>
      <OpsSyncProvider>
        <AppTopbarProvider>
          <AuthenticatedLayoutContent {...props} />
        </AppTopbarProvider>
      </OpsSyncProvider>
    </PlcLiveDataProvider>
  );
}
