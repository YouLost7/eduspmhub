import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { apiJson } from "../api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Tracks the most recent auth action, so a slow /api/auth/me response
  // from before a login/register/logout completed can't come back later
  // and overwrite the user it just set (or clear it back to null).
  const requestIdRef = useRef(0);

  const refreshMe = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    try {
      const data = await apiJson("/api/auth/me");
      if (requestIdRef.current !== requestId) return;
      setUser(data.user);
    } catch {
      if (requestIdRef.current !== requestId) return;
      setUser(null);
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  const login = useCallback(async (email, password) => {
    const data = await apiJson("/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    requestIdRef.current += 1;
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (payload) => {
    const data = await apiJson("/api/auth/register", {
      method: "POST",
      body: payload,
    });
    requestIdRef.current += 1;
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    await apiJson("/api/auth/logout", { method: "POST" });
    requestIdRef.current += 1;
    setUser(null);
  }, []);

  const updateProfile = useCallback(async (body) => {
    const data = await apiJson("/api/profile", {
      method: "PATCH",
      body,
    });
    requestIdRef.current += 1;
    setUser(data.user);
    return data.user;
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      refreshMe,
      login,
      logout,
      register,
      updateProfile,
    }),
    [user, loading, refreshMe, login, logout, register, updateProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
