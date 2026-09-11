/**
 * Client-side storage for the shared arbitrator/admin token (see
 * app/backend/src/middleware/adminAuth.ts). This is a single shared
 * secret entered once and kept in localStorage - appropriate for this
 * project's small admin surface, not a real accounts/roles system.
 */
const STORAGE_KEY = "marketai_admin_token";

export function getAdminToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setAdminToken(token: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Private browsing / storage blocked - the token just won't persist
    // across reloads; the current page session still works.
  }
}

export function clearAdminToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
