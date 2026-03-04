import axios from "axios";
import { getToken, clearAuthStorage } from "../auth/authStorage";

const rawBaseUrl = import.meta.env.VITE_API_BASE_URL ?? import.meta.env.VITE_API_URL ?? "http://localhost:3000/api";
const baseURL = rawBaseUrl.replace(/\/$/, "");

export const api = axios.create({
  baseURL,
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const status = err?.response?.status;
    if (status === 401) {
      // token inválido/expirado
      clearAuthStorage();
      // opcional: forzar vuelta a login
      if (window.location.pathname !== "/login") window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);
