import axios, { type InternalAxiosRequestConfig } from "axios";
import { clearAuthStorage, getToken, setToken } from "../auth/authStorage";
import { queryClient } from "../lib/queryClient";

const rawBaseUrl =
  import.meta.env.VITE_API_BASE_URL ??
  import.meta.env.VITE_API_URL ??
  "http://localhost:3000/api";
const baseURL = rawBaseUrl.replace(/\/$/, "");

export const api = axios.create({
  baseURL,
  // Must be true for the HttpOnly refresh-token cookie to be sent
  withCredentials: true,
});

/* ── Request interceptor: attach JWT access token ─────────────────────────── */

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/* ── Response interceptor: transparent token refresh on 401 ──────────────── */

// Flag type so TypeScript knows about the custom _retry field
interface RetryableRequest extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

let isRefreshing = false;
let refreshQueue: Array<{ resolve: (token: string) => void; reject: (err: unknown) => void }> = [];

function processQueue(token: string) {
  refreshQueue.forEach(({ resolve }) => resolve(token));
  refreshQueue = [];
}

/** Sin esto, un request encolado durante un refresh que termina fallando se
 *  quedaba esperando para siempre: `refreshQueue = []` lo descartaba sin
 *  resolver ni rechazar su promesa. */
function rejectQueue(err: unknown) {
  refreshQueue.forEach(({ reject }) => reject(err));
  refreshQueue = [];
}

api.interceptors.response.use(
  (r) => r,
  async (err) => {
    const original: RetryableRequest = err.config;
    const status: number | undefined = err?.response?.status;

    // Only handle 401s that aren't from the refresh endpoint itself
    if (
      status === 401 &&
      !original._retry &&
      original.url !== "/auth/refresh"
    ) {
      if (isRefreshing) {
        // Another request already triggered refresh — queue this one
        return new Promise((resolve, reject) => {
          refreshQueue.push({
            resolve: (newToken) => {
              original.headers.Authorization = `Bearer ${newToken}`;
              resolve(api(original));
            },
            reject,
          });
        });
      }

      original._retry = true;
      isRefreshing = true;

      try {
        // Cookie is sent automatically (withCredentials: true)
        const { data } = await api.post<{ access_token: string }>(
          "/auth/refresh",
        );
        const newToken = data.access_token;
        setToken(newToken);
        api.defaults.headers.common.Authorization = `Bearer ${newToken}`;
        processQueue(newToken);
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch (refreshErr) {
        // Refresh failed — force logout
        rejectQueue(refreshErr);
        clearAuthStorage();
        if (window.location.pathname !== "/login") {
          sessionStorage.setItem("auth_redirect", window.location.pathname + window.location.search);
          window.location.href = "/login";
        }
        return Promise.reject(err);
      } finally {
        isRefreshing = false;
      }
    }

    // 401 on refresh itself or non-401 errors → just reject
    if (status === 401) {
      clearAuthStorage();
      if (window.location.pathname !== "/login") {
        sessionStorage.setItem("auth_redirect", window.location.pathname + window.location.search);
        window.location.href = "/login";
      }
    }

    // 403: autenticado pero sin ese permiso — típicamente porque un ADMIN/MANAGER
    // le cambió el rol, un permiso puntual o los depósitos mientras la sesión
    // seguía abierta. Se invalida `/auth/me` y los depósitos permitidos para que
    // el próximo render use lo vigente, en vez de arrastrar lo que había al
    // loguearse. No se reintenta el request: el usuario decide su próximo paso
    // con el menú/los botones ya al día.
    if (status === 403) {
      void queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      void queryClient.invalidateQueries({ queryKey: ["warehouses", "allowed"] });
    }

    return Promise.reject(err);
  },
);
