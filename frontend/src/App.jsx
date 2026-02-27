import { Suspense, lazy, useEffect, useState } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import Sidebar from "./components/Sidebar";
import { AuthProvider } from "./features/auth/AuthContext";
import { useSession } from "./features/auth/useSession";
import {
  PlcLiveDataProvider,
  usePlcLiveDataContext,
} from "./features/plc/PlcLiveDataContext";
import { I18nProvider } from "./utils/i18n";
import featureFlags from "./utils/featureFlags";
import { LoaderCircle } from "lucide-react";
import { useUserUiPreferencesSync } from "./hooks/useUserUiPreferencesSync";

const Dashboard = lazy(() => import("./features/ops/dashboard/DashboardPage"));
const Alarms = lazy(() => import("./features/ops/alarms/AlarmsPage"));
const Chat = lazy(() => import("./pages/Chat"));
const ActionLog = lazy(() => import("./features/ops/actions/ActionLogPage"));
const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));

const THEME_STORAGE_KEY = "panya_theme_mode";

const resolveInitialTheme = () => {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === "dark" || saved === "light") return saved;
  return "dark";
};

function PageLoader() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "16px",
        background:
          "radial-gradient(1200px 800px at 12% -8%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 58%), var(--bg-primary, #0c1219)",
        color: "var(--text-secondary, #94a3b8)",
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
            color: "var(--accent, #2ea7e0)",
          }}
        />
        <span style={{ fontWeight: 500 }}>Loading...</span>
      </div>
    </div>
  );
}

function AppShell() {
  const navigate = useNavigate();
  const { sessionStatus, isAuthenticated, login, logout, user } = useSession();
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    setTheme(resolveInitialTheme());
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

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

  const handleToggleTheme = () => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  };

  useUserUiPreferencesSync({
    user,
    theme,
    setTheme,
  });

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
      <AuthenticatedLayout
        onLogout={async () => {
          await logout();
          navigate("/login");
        }}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        userName={user?.full_name || user?.email || "Operator"}
        userRole={user?.role || ""}
      />
    </PlcLiveDataProvider>
  );
}

function AuthenticatedLayout({
  onLogout,
  theme,
  onToggleTheme,
  userName,
  userRole,
}) {
  const location = useLocation();
  const { derived, connectionState } = usePlcLiveDataContext();
  const isChatRoute = location.pathname.startsWith("/chat");
  const shellClass = featureFlags.uiV2
    ? "plc-shell app-shell-ambience"
    : "min-h-screen flex bg-slate-950 text-slate-100";

  return (
    <div className={shellClass}>
      <Sidebar
        alarmCount={derived.alarmCount}
        onLogout={onLogout}
        theme={theme}
        onToggleTheme={onToggleTheme}
        connectionState={connectionState}
        userName={userName}
        userRole={userRole}
      />

      <main className={`plc-main ${isChatRoute ? "is-chat-route" : ""}`}>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/alarms" element={<Alarms />} />
            <Route path="/chat" element={<Chat onLogout={onLogout} />} />
            <Route path="/actions" element={<ActionLog />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
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
