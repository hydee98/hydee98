import { useState, type ReactNode } from "react";
import { clearAdminToken, getAdminToken, setAdminToken } from "../lib/adminAuth";

/**
 * Gates arbitrator/authority-only actions behind the shared admin token.
 * Renders `children` once a token is stored; a wrong or missing token
 * still surfaces as a 401 from the API itself (see api/client.ts, which
 * clears the stored token on 401 so the user is re-prompted here).
 */
export function AdminGate({
  children,
  prompt = "This is an arbitrator/admin action - enter the admin key to continue.",
}: {
  children: ReactNode;
  prompt?: string;
}) {
  const [token, setToken] = useState(() => getAdminToken());
  const [input, setInput] = useState("");

  if (token) {
    return (
      <div>
        {children}
        <button
          className="admin-logout"
          onClick={() => {
            clearAdminToken();
            setToken(null);
          }}
        >
          Forget admin key
        </button>
      </div>
    );
  }

  return (
    <div className="admin-gate">
      <p className="muted">{prompt}</p>
      <div className="chat-input-row">
        <input
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Admin key"
          onKeyDown={(e) => {
            if (e.key === "Enter" && input.trim()) {
              setAdminToken(input.trim());
              setToken(input.trim());
            }
          }}
        />
        <button
          disabled={!input.trim()}
          onClick={() => {
            setAdminToken(input.trim());
            setToken(input.trim());
          }}
        >
          Unlock
        </button>
      </div>
    </div>
  );
}
