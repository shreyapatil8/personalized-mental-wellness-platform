const storageKey = "wellness_auth";
const emptySession = () => ({ user: null, token: null });

export function readStoredAuth(storage) {
  try {
    const stored = JSON.parse((storage || window.localStorage).getItem(storageKey));
    if (typeof stored?.token !== "string" || !stored.token.trim() ||
        !stored.user || typeof stored.user !== "object" || Array.isArray(stored.user)) {
      return emptySession();
    }
    return { user: stored.user, token: stored.token };
  } catch {
    return emptySession();
  }
}

export function persistAuth(auth, storage) {
  try {
    const target = storage || window.localStorage;
    if (auth.token) target.setItem(storageKey, JSON.stringify(auth));
    else target.removeItem(storageKey);
  } catch {
    // Storage may be blocked or full; the current in-memory session still works.
  }
}
