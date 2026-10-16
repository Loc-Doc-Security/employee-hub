const KEY = "auth_token";
export const HUB_AUTH_FAILED_KEY = "employee-hub_hub_auth_failed";

export function getAuthToken() {
  return sessionStorage.getItem(KEY) ?? localStorage.getItem(KEY);
}
export function setAuthToken(token: string, remember: boolean) {
  localStorage.removeItem(KEY);
  sessionStorage.removeItem(KEY);
  (remember ? localStorage : sessionStorage).setItem(KEY, token);
}
export function clearAuthTokens() {
  localStorage.removeItem(KEY);
  sessionStorage.removeItem(KEY);
}
export function markHubAuthFailed() {
  sessionStorage.setItem(HUB_AUTH_FAILED_KEY, "1");
}
export function clearHubAuthFailed() {
  sessionStorage.removeItem(HUB_AUTH_FAILED_KEY);
}