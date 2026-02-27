import { useContext } from "react";
import { AuthContext } from "./authContextObject";

export function useSession() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useSession must be used inside AuthProvider");
  }
  return ctx;
}
