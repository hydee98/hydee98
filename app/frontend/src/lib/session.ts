/**
 * Client-side storage for the wallet sign-in session (see
 * app/backend/src/routes/auth.ts). Unlike the admin token, this is a real
 * per-user session issued after verifying a wallet signature - not a
 * shared secret.
 */
export interface SessionUser {
  publicKey: string;
  displayName: string | null;
}

const TOKEN_KEY = "marketai_session_token";
const USER_KEY = "marketai_session_user";

export function getSessionToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getSessionUser(): SessionUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
}

export function setSession(token: string, user: SessionUser): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    // Private browsing / storage blocked - session just won't persist
    // across reloads; the current page session still works.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    // ignore
  }
}
