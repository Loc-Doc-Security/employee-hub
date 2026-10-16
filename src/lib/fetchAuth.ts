import { getAuthToken } from "./authToken";
const orig = window.fetch.bind(window);
window.fetch = (input, init) => {
  const token = getAuthToken();
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (!token || !url.includes("/api")) return orig(input, init);
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  return orig(input, { ...init, headers });
};