/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import {
  clearAuthStorage,
  getStoredUser,
  getToken,
  normalizeAuthUser,
  setStoredUser,
  setToken,
} from "./authStorage";

export type Role = "ADMIN" | "MANAGER" | "OPERATOR" | "AUDITOR";

export type AuthUser = {
  userId: string;
  username: string;
  role: Role;
};

type AuthState = {
  user: AuthUser | null;
  isReady: boolean;
  login: (payload: { access_token: string; user?: Partial<AuthUser> & { id?: string } }) => void;
  logout: () => void;
};

const initialUser = getStoredUser();
const initialReady = !getToken() || !!initialUser;
const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(initialUser);
  const [isReady, setIsReady] = useState(initialReady);

  const logout = () => {
    clearAuthStorage();
    setUser(null);
    setIsReady(true);
  };

  const login = (payload: { access_token: string; user?: Partial<AuthUser> & { id?: string } }) => {
    setToken(payload.access_token);

    const normalizedUser = normalizeAuthUser(payload.user);
    if (normalizedUser) {
      setStoredUser(normalizedUser);
      setUser(normalizedUser);
    }

    setIsReady(true);
  };

  useEffect(() => {
    const token = getToken();
    if (!token || user) {
      return;
    }

    api
      .get("/auth/me")
      .then((response) => {
        const normalizedUser = normalizeAuthUser(response.data);
        if (!normalizedUser) {
          throw new Error("Invalid /auth/me response");
        }
        setStoredUser(normalizedUser);
        setUser(normalizedUser);
      })
      .catch(() => {
        clearAuthStorage();
        setUser(null);
      })
      .finally(() => setIsReady(true));
  }, [user]);

  const value = useMemo<AuthState>(() => ({ user, isReady, login, logout }), [isReady, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
