/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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

/** módulo → acciones efectivas ("read"/"create"/"update"/"remove"/"approve"). */
export type EffectivePermissions = Record<string, string[]>;

export type AuthUser = {
  userId: string;
  username: string;
  fullName: string | null;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
  /**
   * `undefined` = todavía no llegó una respuesta real de `/auth/me` (ej. un
   * `user` cacheado de antes de esta migración). Un objeto — aunque esté
   * vacío — significa que el backend ya contestó: `can()` en `permissions.ts`
   * usa esta diferencia para decidir si confía en esto o cae a `rbac.ts`.
   */
  permissions?: EffectivePermissions;
};

type AuthState = {
  user: AuthUser | null;
  isReady: boolean;
  login: (payload: { access_token: string }) => void;
  logout: () => void;
};

/** Query key de `/auth/me` — el interceptor de axios la invalida ante un 403 (ver api/client.ts). */
export const AUTH_ME_QUERY_KEY = ["auth", "me"] as const;

const AuthContext = createContext<AuthState | null>(null);

async function fetchMe(): Promise<AuthUser> {
  const { data } = await api.get("/auth/me");
  const normalized = normalizeAuthUser(data);
  if (!normalized) {
    throw new Error("Respuesta de /auth/me inválida");
  }
  setStoredUser(normalized);
  return normalized;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [hasToken, setHasToken] = useState(() => !!getToken());
  /**
   * Refresco silencioso al arrancar (RL-M-01).
   *
   * El token de acceso vive en memoria, así que una recarga o una pestaña nueva
   * empiezan sin él. La sesión se recupera con el refresh token, que va en una
   * cookie HttpOnly: el navegador la manda solo y el script nunca la ve.
   *
   * Mientras esto corre la app no puede decidir si hay sesión, así que
   * `isReady` espera — sin esto se vería un parpadeo del login en cada recarga
   * de alguien que sí tenía la sesión abierta.
   */
  const [bootstrapping, setBootstrapping] = useState(true);

  useEffect(() => {
    let cancelado = false;
    void api
      .post<{ access_token: string }>("/auth/refresh")
      .then(({ data }) => {
        if (cancelado || !data?.access_token) return;
        setToken(data.access_token);
        setHasToken(true);
      })
      .catch(() => {
        // Sin cookie válida no hay sesión que recuperar: no es un error, es el
        // caso de alguien que no inició sesión o cuyo refresh venció.
        clearAuthStorage();
      })
      .finally(() => {
        if (!cancelado) setBootstrapping(false);
      });
    return () => { cancelado = true; };
  }, []);

  const meQuery = useQuery({
    queryKey: AUTH_ME_QUERY_KEY,
    queryFn: fetchMe,
    enabled: hasToken,
    retry: false,
    staleTime: 60_000,
    // Semilla optimista desde localStorage: una recarga de página no muestra
    // una pantalla en blanco mientras se confirma contra el backend — y si el
    // rol/los permisos cambiaron mientras tanto, el fetch real los corrige
    // solo, sin que nadie lo note salvo por un re-render.
    placeholderData: hasToken ? (getStoredUser() ?? undefined) : undefined,
  });

  const user = hasToken ? (meQuery.data ?? null) : null;
  // Listo para pintar: sin token no hay nada que esperar; con token alcanza
  // con tener ALGÚN usuario (real o el placeholder de localStorage); y si
  // `/auth/me` terminó en error (token inválido, o cualquier otra falla que el
  // interceptor de axios no haya resuelto con un hard-redirect antes) también
  // se considera resuelto — `user` queda `null` y `RequireRole` manda a
  // `/login`, sin necesitar un efecto que apague `hasToken` por su cuenta.
  const isReady = !bootstrapping && (!hasToken || !!user || meQuery.isError);

  const login = useCallback((payload: { access_token: string }) => {
    setToken(payload.access_token);
    setHasToken(true);
    void queryClient.invalidateQueries({ queryKey: AUTH_ME_QUERY_KEY });
  }, [queryClient]);

  const logout = useCallback(() => {
    // El refresco silencioso ya terminó o no importa: cerrar sesión no debe
    // quedar esperándolo.
    setBootstrapping(false);
    // Best-effort: le pedimos al server que invalide la cookie HttpOnly del
    // refresh token. No se espera — el estado local se limpia igual.
    void api.post("/auth/logout").catch(() => {});
    clearAuthStorage();
    setHasToken(false);
    queryClient.removeQueries({ queryKey: AUTH_ME_QUERY_KEY });
  }, [queryClient]);

  const value = useMemo<AuthState>(() => ({ user, isReady, login, logout }), [user, isReady, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
