import { useState } from "react";
import { LoaderCircle, Mail, Lock, Sparkles } from "lucide-react";
import { getApiErrorMessage } from "../utils/api";
import { useT } from "../utils/i18n";

const LOCALHOST_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);
const metaEnv = import.meta.env || {};
const LOCAL_DEMO_CREDENTIALS = {
  email: String(metaEnv.VITE_DEV_DEMO_EMAIL || "").trim(),
  password: String(metaEnv.VITE_DEV_DEMO_PASSWORD || ""),
};
const APP_LOGO_SRC = "/assets/panya-mark-v1.svg";

function Login({ onLogin, onGoRegister }) {
  const { t } = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const hasLocalDemoCredentials =
    LOCAL_DEMO_CREDENTIALS.email && LOCAL_DEMO_CREDENTIALS.password;
  const canUseLocalDemo =
    typeof window !== "undefined" &&
    LOCALHOST_HOSTNAMES.has(window.location.hostname) &&
    hasLocalDemoCredentials;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await onLogin({ email, password });
    } catch (err) {
      setError(getApiErrorMessage(err, t("auth.invalidCredentials")));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen auth-shell flex items-center justify-center p-4 relative overflow-hidden">
      <div className="fixed inset-0 animated-gradient" />

      <div className="fixed top-1/4 left-1/4 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl" />
      <div className="fixed bottom-1/4 right-1/4 w-80 h-80 bg-cyan-500/15 rounded-full blur-3xl" />
      <div className="fixed top-1/2 right-1/3 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl" />

      <div className="w-full max-w-sm relative z-10 fade-in-up">
        <div className="flex flex-col items-center mb-8">
          <div className="relative mb-4">
            <img
              src={APP_LOGO_SRC}
              alt="Panya logo"
              width="56"
              height="56"
              className="w-14 h-14 object-contain"
            />
            <div className="absolute -top-1 -right-1">
              <Sparkles className="w-5 h-5 text-cyan-400" />
            </div>
          </div>
          <h1 className="auth-brand-title text-3xl font-bold tracking-tight">
            {t("brand.title")}
          </h1>
          <p className="auth-brand-subtitle text-sm mt-1 font-medium">
            {t("brand.subtitle")}
          </p>
        </div>

        <form
          className="auth-card rounded-2xl p-6 sm:p-8 glass-noise"
          onSubmit={handleSubmit}
        >
          <h2 className="auth-card-title text-xl font-semibold mb-6 text-center">
            {t("auth.welcomeBack")}
          </h2>

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm text-center">
              {error}
            </div>
          )}

          {canUseLocalDemo ? (
            <div className="mb-4 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-left text-sm text-cyan-100">
              <p className="font-medium text-cyan-200">{t("auth.localDemoAccount")}</p>
              <p className="mt-1 text-cyan-100/90">
                {LOCAL_DEMO_CREDENTIALS.email} / {LOCAL_DEMO_CREDENTIALS.password}
              </p>
              <button
                type="button"
                className="mt-3 text-cyan-300 transition-colors hover:text-cyan-200 hover:underline"
                onClick={() => {
                  setEmail(LOCAL_DEMO_CREDENTIALS.email);
                  setPassword(LOCAL_DEMO_CREDENTIALS.password);
                  setError("");
                }}
              >
                {t("auth.useDemoCredentials")}
              </button>
            </div>
          ) : null}

          <div className="space-y-4">
            <div>
              <label className="auth-label block text-sm font-medium mb-1.5">
                {t("auth.email")}
              </label>
              <div className="relative">
                <Mail
                  size={16}
                  className="auth-icon absolute left-3.5 top-1/2 -translate-y-1/2"
                />
                <input
                  type="email"
                  placeholder={t("auth.emailPlaceholder")}
                  className="auth-input w-full pl-10 pr-4 py-2.5 rounded-xl focus:outline-none text-white placeholder-[color:var(--text-muted)]"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <label className="auth-label block text-sm font-medium mb-1.5">
                {t("auth.password")}
              </label>
              <div className="relative">
                <Lock
                  size={16}
                  className="auth-icon absolute left-3.5 top-1/2 -translate-y-1/2"
                />
                <input
                  type="password"
                  placeholder={t("auth.passwordPlaceholder")}
                  className="auth-input w-full pl-10 pr-4 py-2.5 rounded-xl focus:outline-none text-white placeholder-[color:var(--text-muted)]"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="auth-button w-full mt-6 text-white py-2.5 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all font-semibold flex items-center justify-center gap-2 glass-interactive"
          >
            {loading ? (
              <>
                <LoaderCircle size={18} className="animate-spin" />
                {t("auth.signingIn")}
              </>
            ) : (
              t("auth.signIn")
            )}
          </button>

          <p className="auth-body mt-6 text-sm text-center">
            {t("auth.noAccount")}{" "}
            <button
              type="button"
              onClick={onGoRegister}
              className="auth-link font-medium hover:underline transition-colors"
            >
              {t("auth.createOne")}
            </button>
          </p>
        </form>

        <p className="auth-footer text-center text-[11px] mt-6">
          {t("auth.powered")}
        </p>
      </div>
    </div>
  );
}

export default Login;
