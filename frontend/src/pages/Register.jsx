import { useState } from "react";
import { LoaderCircle, Mail, Lock, User, Sparkles } from "lucide-react";
import { authAPI, getApiErrorMessage } from "../utils/api";
import { GlassSurface } from "../components/ui";

export default function Register({ onRegisterSuccess, onBackToLogin }) {
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
      setError(getApiErrorMessage(err, "Register failed"));
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
              src="/panya-logo.png"
              alt="Panya logo"
              className="w-14 h-14 object-contain"
            />
            <div className="absolute -top-1 -right-1">
              <Sparkles className="w-5 h-5 text-cyan-400" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-[color:var(--text-primary)] tracking-tight">
            Panya
          </h1>
          <p className="text-sm text-[color:var(--text-secondary)] mt-1 font-medium">
            Create your account
          </p>
        </div>

        {/* Card */}
        <GlassSurface
          as="form"
          onSubmit={handleSubmit}
          className="auth-card rounded-2xl p-6 sm:p-8 glass-noise"
          borderRadius={20}
          blur={13}
          displace={0.62}
          brightness={56}
          opacity={0.9}
          saturation={1.18}
          backgroundOpacity={0.14}
        >
          <h2 className="text-xl font-semibold mb-6 text-center text-[color:var(--text-primary)]">
            Get started
          </h2>

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm text-center">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[color:var(--text-secondary)] mb-1.5">
                Username
              </label>
              <div className="relative">
                <User
                  size={16}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500"
                />
                <input
                  type="text"
                  placeholder="Your Username"
                  className="auth-input w-full pl-10 pr-4 py-2.5 rounded-xl focus:outline-none text-[color:var(--text-primary)] placeholder-[color:var(--text-muted)]"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[color:var(--text-secondary)] mb-1.5">
                Email
              </label>
              <div className="relative">
                <Mail
                  size={16}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500"
                />
                <input
                  type="email"
                  placeholder="you@company.com"
                  className="auth-input w-full pl-10 pr-4 py-2.5 rounded-xl focus:outline-none text-[color:var(--text-primary)] placeholder-[color:var(--text-muted)]"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[color:var(--text-secondary)] mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock
                  size={16}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500"
                />
                <input
                  type="password"
                  placeholder="••••••••"
                  className="auth-input w-full pl-10 pr-4 py-2.5 rounded-xl focus:outline-none text-[color:var(--text-primary)] placeholder-[color:var(--text-muted)]"
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
            className="w-full mt-6 bg-gradient-to-r from-blue-500 to-cyan-500 text-white py-2.5 rounded-xl hover:from-blue-600 hover:to-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-semibold shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 flex items-center justify-center gap-2 glass-interactive"
          >
            {loading ? (
              <>
                <LoaderCircle size={18} className="animate-spin" />
                Creating account...
              </>
            ) : (
              "Create account"
            )}
          </button>

          <p className="mt-6 text-sm text-center text-[color:var(--text-secondary)]">
            Already have an account?{" "}
            <button
              type="button"
              className="text-cyan-400 hover:text-cyan-300 font-medium hover:underline transition-colors"
              onClick={onBackToLogin}
            >
              Sign in
            </button>
          </p>
        </GlassSurface>

        <p className="text-center text-[11px] text-[color:var(--text-muted)] mt-6">
          Powered by Panya • Industrial Automation
        </p>
      </div>
    </div>
  );
}
