import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { getToken, setToken, clearAuthStorage, getStoredUser, setStoredUser } from "./authStorage";

export type Role = "ADMIN" | "MANAGER" | "OPERATOR" | "AUDITOR";

export type AuthUser = {
  userId: string;
  username: string;
  role: Role;
};

type AuthState = {
  user: AuthUser | null;
  isReady: boolean; // para no parpadear rutas hasta verificar
  login: (payload: { access_token: string; user?: AuthUser }) => void;
  logout: () => void;
  canRead: () => boolean;
  canWrite: () => boolean;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(getStoredUser());
  const [isReady, setIsReady] = useState(false);

  const logout = () => {
    clearAuthStorage();
    setUser(null);
  };

  const login = (payload: { access_token: string; user?: AuthUser }) => {
    setToken(payload.access_token);
    if (payload.user) {
      setStoredUser(payload.user);
      setUser(payload.user);
    }
  };

  useEffect(() => {
    // Rehidratar: si hay token pero no user, pedir /auth/me
    const token = getToken();
    if (!token) {
      setIsReady(true);
      return;
    }

    if (user) {
      setIsReady(true);
      return;
    }

    api
      .get<AuthUser>("/auth/me")
      .then((res) => {
        setStoredUser(res.data);
        setUser(res.data);
      })
      .catch(() => {
        // token inválido/expirado
        logout();
      })
      .finally(() => setIsReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<AuthState>(() => {
    const role = user?.role;

    const canRead = () => !!role; // cualquiera logueado lee
    const canWrite = () => role === "ADMIN" || role === "MANAGER";
    return { user, isReady, login, logout, canRead, canWrite };
  }, [user, isReady]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}