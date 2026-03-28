import React, { Suspense, lazy, useEffect, useState } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import Sidebar from "./components/Sidebar";
import AppTopbar from "./components/layout/AppTopbar";
import { AuthProvider } from "./features/auth/AuthContext";
import { useSession } from "./features/auth/useSession";
import {
  PlcLiveDataProvider,
  usePlcLiveDataContext,
} from "./features/plc/PlcLiveDataContext";
import { OpsSyncProvider, useOpsSyncContext } from "./features/ops/OpsSyncContext";
import { I18nProvider, useT } from "./utils/i18n";
import featureFlags from "./utils/featureFlags";
import { LoaderCircle, AlertTriangle } from "lucide-react";
import { useUserUiPreferencesSync } from "./hooks/useUserUiPreferencesSync";
import { AppTopbarProvider } from "./layout/AppTopbarContext";
import useMediaQuery from "./hooks/useMediaQuery";

const SHOW_ERROR_DETAILS = import.meta.env.DEV;

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidUpdate(prevProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      const errorMessage =
        typeof this.state.error?.message === "string"
          ? this.state.error.message.trim()
          : "";

      return (
        <div
          style={{
            padding: "2rem",
            color: "var(--error)",
            textAlign: "center",
            marginTop: "10vh",
            maxWidth: "32rem",
            marginInline: "auto",
          }}
        >
          <AlertTriangle size={48} style={{ margin: "0 auto 1rem" }} />
          <h2 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>
            {this.props.title}
          </h2>
          <p style={{ color: "var(--text-secondary)" }}>
            {this.props.message}
          </p>
          {SHOW_ERROR_DETAILS && errorMessage ? (
            <p
              style={{
                marginTop: "0.75rem",
                color: "var(--text-secondary)",
                fontSize: "0.875rem",
              }}
            >
              {errorMessage}
            </p>
          ) : null}
          <button
            onClick={() => {
              if (typeof window !== "undefined") {
                window.location.reload();
                return;
              }
              this.setState({ hasError: false, error: null });
            }}
            style={{
              marginTop: "1rem",
              padding: "0.5rem 1rem",
              background: "var(--accent)",
              color: "var(--text-on-accent)",
              borderRadius: "0.5rem",
              border: "none",
              cursor: "pointer",
            }}
          >
            {this.props.reloadLabel}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const Dashboard = lazy(() => import("./features/ops/dashboard/DashboardPage"));
const PortMap = lazy(() => import("./features/ops/port-map/PortMapPage"));
const Analytics = lazy(() => import("./features/ops/analytics/AnalyticsPage"));
const Alarms = lazy(() => import("./features/ops/alarms/AlarmsPage"));
const Equipment = lazy(() => import("./features/ops/equipment/EquipmentPage"));
const Chat = lazy(() => import("./pages/Chat"));
const ActionLog = lazy(() => import("./features/ops/actions/ActionLogPage"));
const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));

function PageLoader() {
  const { t } = useT();
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "16px",
        background: "var(--bg)",
        color: "var(--text-secondary)",
      }}
    >
      <img
        src="/panya-logo.png"
        alt="Panya logo"
        style={{ width: 56, height: 56, objectFit: "contain" }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <LoaderCircle
          size={20}
          style={{
            animation: "spin 1s linear infinite",
            color: "var(--accent)",
          }}
        />
        <span style={{ fontWeight: 500 }}>{t("common.loading")}</span>
      </div>
    </div>
  );
}

function LocalizedErrorBoundary({ resetKey, children }) {
  const { t } = useT();

  return (
    <ErrorBoundary
      resetKey={resetKey}
      title={t("app.errorTitle")}
      message={t("app.errorMessage")}
      reloadLabel={t("app.reload")}
    >
      {children}
    </ErrorBoundary>
  );
}

function AppShell() {
  const navigate = useNavigate();
  const { t } = useT();
  const { sessionStatus, isAuthenticated, login, logout, user } = useSession();

  useEffect(() => {
    document.documentElement.setAttribute(
      "data-stability-mode",
      featureFlags.stabilityMode,
    );
    document.documentElement.setAttribute(
      "data-liquid-glass",
      featureFlags.liquidGlass ? "on" : "off",
    );
  }, []);

  useUserUiPreferencesSync({ user });

  if (sessionStatus === "loading") {
    return <PageLoader />;
  }

  if (!isAuthenticated) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route
            path="/login"
            element={
              <Login
                onLogin={async ({ email, password }) => {
                  await login({ email, password });
                  navigate("/");
                }}
                onGoRegister={() => navigate("/register")}
              />
            }
          />
          <Route
            path="/register"
            element={
              <Register
                onRegisterSuccess={() => navigate("/login")}
                onBackToLogin={() => navigate("/login")}
              />
            }
          />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <PlcLiveDataProvider>
      <OpsSyncProvider>
        <AppTopbarProvider>
          <AuthenticatedLayout
            onLogout={async () => {
              await logout();
              navigate("/login");
            }}
            userName={user?.full_name || user?.email || t("chat.defaultUser")}
            userRole={user?.role || ""}
          />
        </AppTopbarProvider>
      </OpsSyncProvider>
    </PlcLiveDataProvider>
  );
}

function AuthenticatedLayout({ onLogout, userName, userRole }) {
  const location = useLocation();
  const { connectionState } = usePlcLiveDataContext();
  const { alarms } = useOpsSyncContext();
  const isChatRoute = location.pathname.startsWith("/chat");
  const isCompactLayout = useMediaQuery("(max-width: 980px)");
  const showAppSidebar = true;
  const showTopbar = !isChatRoute || isCompactLayout;
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const activeAlarmCount = alarms.filter(
    (alarm) => String(alarm?.status || "active").toLowerCase() === "active",
  ).length;
  const shellClass = featureFlags.uiV2
    ? "plc-shell app-shell-ambience"
    : "min-h-screen flex bg-slate-950 text-slate-100";

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className={shellClass}>
      {showAppSidebar ? (
        <Sidebar
          alarmCount={activeAlarmCount}
          onLogout={onLogout}
          connectionState={connectionState}
          userName={userName}
          userRole={userRole}
          mobileOpen={mobileSidebarOpen}
          onMobileOpenChange={setMobileSidebarOpen}
        />
      ) : null}

      <main className={`plc-main ${isChatRoute ? "is-chat-route" : ""}`}>
        {showTopbar ? (
          <AppTopbar
            onOpenSidebar={() => setMobileSidebarOpen(true)}
            showSidebarToggle={isCompactLayout}
            userName={userName}
            userRole={userRole}
            notificationCount={activeAlarmCount}
          />
        ) : null}

        <div className={`plc-route-body ${isChatRoute ? "is-chat-route" : ""}`}>
          <LocalizedErrorBoundary resetKey={location.pathname}>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/overview" element={<PortMap />} />
                <Route path="/equipment" element={<Equipment />} />
                <Route path="/alarms" element={<Alarms />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route
                  path="/chat"
                  element={<Chat hasAppSidebar={showAppSidebar && !isCompactLayout} />}
                />
                <Route path="/actions" element={<ActionLog />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </LocalizedErrorBoundary>
        </div>
      </main>
    </div>
  );
}

function App() {
  return (
    <div className="app-ambience">
      <I18nProvider>
        <AuthProvider>
          <AppShell />
        </AuthProvider>
      </I18nProvider>
    </div>
  );
}

export default App;
