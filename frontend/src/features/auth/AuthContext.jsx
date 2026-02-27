import { useCallback, useEffect, useMemo, useState } from "react";
import { authAPI } from "../../utils/api";
import { AuthContext } from "./authContextObject";

const ANON_STATE = {
  status: "anonymous",
  user: null,
  error: "",
};

export function AuthProvider({ children }) {
  const [state, setState] = useState({
    status: "loading",
    user: null,
    error: "",
  });

  const refreshSession = useCallback(async () => {
    setState((prev) => ({ ...prev, status: "loading", error: "" }));
    try {
      const response = await authAPI.me();
      const user = response?.data || null;
      setState({
        status: user ? "authenticated" : "anonymous",
        user,
        error: "",
      });
      return user;
    } catch (error) {
      if (error?.response?.status === 401) {
        setState({ ...ANON_STATE });
        return null;
      }
      setState({
        status: "anonymous",
        user: null,
        error: "Failed to load session",
      });
      return null;
    }
  }, []);

  const login = useCallback(
    async ({ email, password }) => {
      await authAPI.login(email, password);
      await refreshSession();
    },
    [refreshSession],
  );

  const logout = useCallback(async () => {
    try {
      await authAPI.logout();
    } catch {
      // Best effort, still clear local session state.
    } finally {
      setState({ ...ANON_STATE });
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    const onExpired = () => setState({ ...ANON_STATE });
    window.addEventListener("auth:expired", onExpired);
    return () => window.removeEventListener("auth:expired", onExpired);
  }, []);

  const value = useMemo(
    () => ({
      sessionStatus: state.status,
      isAuthenticated: state.status === "authenticated",
      user: state.user,
      error: state.error,
      login,
      logout,
      refreshSession,
    }),
    [state, login, logout, refreshSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
