import axios, { type InternalAxiosRequestConfig } from "axios";
import { clearAuthStorage, getToken, setToken } from "../auth/authStorage";

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
let refreshQueue: Array<(token: string) => void> = [];

function processQueue(token: string) {
  refreshQueue.forEach((cb) => cb(token));
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
          refreshQueue.push((newToken) => {
            original.headers.Authorization = `Bearer ${newToken}`;
            resolve(api(original));
          });
          // On failure the outer catch will call flushFail, handled below
          void err; reject; // keep lint happy
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
      } catch {
        // Refresh failed — force logout
        refreshQueue = [];
        clearAuthStorage();
        if (window.location.pathname !== "/login") {
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
        window.location.href = "/login";
      }
    }

    return Promise.reject(err);
  },
);
