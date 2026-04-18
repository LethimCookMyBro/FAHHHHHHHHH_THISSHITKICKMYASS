import { useState } from "react";
import { LoaderCircle, Mail, Lock, User, Sparkles } from "lucide-react";
import { authAPI, getApiErrorMessage } from "../utils/api";
import { useT } from "../utils/i18n";

const APP_LOGO_SRC = "/assets/panya-mark-v1.svg";

export default function Register({ onRegisterSuccess, onBackToLogin }) {
  const { t } = useT();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await authAPI.register(fullName, email, password);
      onRegisterSuccess();
    } catch (err) {
      setError(getApiErrorMessage(err, t("auth.registerFailed")));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen auth-shell flex items-center justify-center p-4 relative overflow-hidden">
      {/* Animated gradient background */}
      <div className="fixed inset-0 animated-gradient" />

      {/* Decorative orbs */}
      <div className="fixed top-1/3 right-1/4 w-96 h-96 bg-cyan-500/20 rounded-full blur-3xl" />
      <div className="fixed bottom-1/3 left-1/4 w-80 h-80 bg-blue-500/15 rounded-full blur-3xl" />

      <div className="w-full max-w-sm relative z-10 fade-in-up">
        {/* Logo */}
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
            {t("auth.createAccountSubtitle")}
          </p>
        </div>

        {/* Card */}
        <form
          onSubmit={handleSubmit}
          className="auth-card rounded-2xl p-6 sm:p-8 glass-noise"
        >
          <h2 className="auth-card-title text-xl font-semibold mb-6 text-center">
            {t("auth.getStarted")}
          </h2>

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm text-center">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="auth-label block text-sm font-medium mb-1.5">
                {t("auth.username")}
              </label>
              <div className="relative">
                <User
                  size={16}
                  className="auth-icon absolute left-3.5 top-1/2 -translate-y-1/2"
                />
                <input
                  type="text"
                  placeholder={t("auth.usernamePlaceholder")}
                  className="auth-input w-full pl-10 pr-4 py-2.5 rounded-xl focus:outline-none text-white placeholder-[color:var(--text-muted)]"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>
            </div>

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
                {t("auth.creatingAccount")}
              </>
            ) : (
              t("auth.createAccount")
            )}
          </button>

          <p className="auth-body mt-6 text-sm text-center">
            {t("auth.alreadyHaveAccount")}{" "}
            <button
              type="button"
              className="auth-link font-medium hover:underline transition-colors"
              onClick={onBackToLogin}
            >
              {t("auth.signIn")}
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
