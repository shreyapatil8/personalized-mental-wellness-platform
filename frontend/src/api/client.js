import axios from "axios";

export const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN || "").replace(/\/$/, "");

export const api = axios.create({
  baseURL: API_ORIGIN ? `${API_ORIGIN}/api` : "/api",
  timeout: 45000
});

export function setAuthToken(token) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
    return;
  }

  delete api.defaults.headers.common.Authorization;
}
