import { useEffect, useMemo, useState } from "react";

import { api, setAuthToken } from "../api/client.js";
import { AuthContext } from "./authContextValue.js";
import { persistAuth, readStoredAuth } from "../utils/authStorage.js";

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(() => readStoredAuth());
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    setAuthToken(auth.token);
    persistAuth(auth);
  }, [auth]);

  useEffect(() => {
    let cancelled = false;
    async function refreshSession() {
      if (!auth.token) {
        setBooting(false);
        return;
      }

      try {
        const { data } = await api.get("/auth/me");
        if (!cancelled) setAuth((current) => ({ ...current, user: data.user }));
      } catch {
        if (!cancelled) setAuth({ user: null, token: null });
      } finally {
        if (!cancelled) setBooting(false);
      }
    }

    refreshSession();
    return () => { cancelled = true; };
  }, [auth.token]);

  const value = useMemo(
    () => ({
      user: auth.user,
      token: auth.token,
      booting,
      async login(credentials) {
        const { data } = await api.post("/auth/login", credentials);
        setAuthToken(data.token);
        setAuth({ user: data.user, token: data.token });
        return data.user;
      },
      async register(payload) {
        const { data } = await api.post("/auth/register", payload);
        return data;
      },
      logout() {
        setAuthToken(null);
        setAuth({ user: null, token: null });
      }
    }),
    [auth, booting]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
