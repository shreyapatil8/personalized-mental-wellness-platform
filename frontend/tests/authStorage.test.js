import assert from "node:assert/strict";
import test from "node:test";
import { persistAuth, readStoredAuth } from "../src/utils/authStorage.js";

test("corrupted and obsolete stored sessions recover as signed out", () => {
  for (const value of [null, "{broken", "null", "[]", "42", '{}', '{"token":123,"user":{}}', '{"token":"t","user":null}']) {
    assert.deepEqual(readStoredAuth({ getItem: () => value }), { user: null, token: null });
  }
});

test("blocked storage never prevents rendering, signing in or signing out", () => {
  const denied = () => { throw new Error("Storage access denied"); };
  const storage = { getItem: denied, setItem: denied, removeItem: denied };
  assert.deepEqual(readStoredAuth(storage), { user: null, token: null });
  assert.doesNotThrow(() => persistAuth({ token: "session", user: { id: "student" } }, storage));
  assert.doesNotThrow(() => persistAuth({ token: null, user: null }, storage));
});

test("valid sessions persist and sign-out removes the saved credentials", () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  const session = { token: "session", user: { id: "student", role: "student" } };
  persistAuth(session, storage);
  assert.deepEqual(readStoredAuth(storage), session);
  persistAuth({ token: null, user: null }, storage);
  assert.equal(data.size, 0);
  assert.deepEqual(readStoredAuth(storage), { user: null, token: null });
});
