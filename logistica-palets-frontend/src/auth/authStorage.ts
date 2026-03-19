import type { AuthUser } from "./AuthContext";

const TOKEN_KEY = "access_token";
const USER_KEY = "user";

type RawAuthUser = Partial<AuthUser> & {
  id?: string;
  userId?: string;
  username?: string;
  role?: AuthUser["role"];
};

export function normalizeAuthUser(user: RawAuthUser | null | undefined): AuthUser | null {
  if (!user) {
    return null;
  }

  const userId = user.userId ?? user.id;
  if (!userId || !user.username || !user.role) {
    return null;
  }

  return {
    userId,
    username: user.username,
    role: user.role,
  };
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function setStoredUser(user: AuthUser) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) {
    return null;
  }

  try {
    return normalizeAuthUser(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearAuthStorage() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
