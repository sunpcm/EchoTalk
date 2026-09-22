/** 前端唯一认证边界：标准 OIDC Authorization Code + PKCE，或显式 dev token。 */

import { UserManager, WebStorageStateStore } from "oidc-client-ts";

export type AccessTokenProvider = () => string | null | Promise<string | null>;

const explicitDevToken =
  import.meta.env.DEV && import.meta.env.VITE_AUTH_MODE === "dev"
    ? import.meta.env.VITE_DEV_AUTH_TOKEN || null
    : null;

let accessTokenProvider: AccessTokenProvider = () => explicitDevToken;
let oidcManager: UserManager | null = null;

export type AuthState = "loading" | "authenticated" | "anonymous" | "misconfigured";

export function getAuthMode(): "dev" | "oidc" | "invalid" {
  if (import.meta.env.VITE_AUTH_MODE === "dev") return "dev";
  if (import.meta.env.VITE_AUTH_MODE === "oidc") return "oidc";
  return "invalid";
}

function getOidcManager(): UserManager | null {
  if (oidcManager) return oidcManager;
  const authority = import.meta.env.VITE_OIDC_AUTHORITY;
  const clientId = import.meta.env.VITE_OIDC_CLIENT_ID;
  const redirectUri = import.meta.env.VITE_OIDC_REDIRECT_URI;
  if (!authority || !clientId || !redirectUri) return null;
  oidcManager = new UserManager({
    authority,
    client_id: clientId,
    redirect_uri: redirectUri,
    post_logout_redirect_uri: import.meta.env.VITE_OIDC_POST_LOGOUT_REDIRECT_URI || redirectUri,
    response_type: "code",
    scope: import.meta.env.VITE_OIDC_SCOPE || "openid profile email",
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    automaticSilentRenew: false,
  });
  accessTokenProvider = async () => {
    const user = await oidcManager?.getUser();
    return user && !user.expired ? user.access_token : null;
  };
  return oidcManager;
}

export async function initializeAuth(): Promise<AuthState> {
  const mode = getAuthMode();
  if (mode === "dev") return explicitDevToken ? "authenticated" : "misconfigured";
  if (mode !== "oidc") return "misconfigured";
  const manager = getOidcManager();
  if (!manager) return "misconfigured";

  const callback = new URL(window.location.href);
  if (callback.searchParams.has("code") && callback.searchParams.has("state")) {
    await manager.signinRedirectCallback();
    window.history.replaceState({}, document.title, callback.pathname);
  }
  const user = await manager.getUser();
  return user && !user.expired ? "authenticated" : "anonymous";
}

export function subscribeAuth(listener: (state: AuthState) => void): () => void {
  const manager = getAuthMode() === "oidc" ? getOidcManager() : null;
  if (!manager) return () => undefined;
  const authenticated = () => listener("authenticated");
  const anonymous = () => listener("anonymous");
  manager.events.addUserLoaded(authenticated);
  manager.events.addUserUnloaded(anonymous);
  manager.events.addAccessTokenExpired(anonymous);
  return () => {
    manager.events.removeUserLoaded(authenticated);
    manager.events.removeUserUnloaded(anonymous);
    manager.events.removeAccessTokenExpired(anonymous);
  };
}

export async function beginLogin(): Promise<void> {
  const manager = getOidcManager();
  if (!manager) throw new Error("OIDC configuration is incomplete");
  await manager.signinRedirect();
}

export async function beginLogout(): Promise<void> {
  const manager = getOidcManager();
  if (!manager) return;
  await manager.signoutRedirect();
}

export function setAccessTokenProvider(provider: AccessTokenProvider): () => void {
  const previous = accessTokenProvider;
  accessTokenProvider = provider;
  return () => {
    accessTokenProvider = previous;
  };
}

export async function getAccessToken(): Promise<string | null> {
  return accessTokenProvider();
}
