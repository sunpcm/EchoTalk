/// <reference types="vite/client" />

interface ImportMetaEnv {
  VITE_API_BASE_URL?: string;
  VITE_AUTH_MODE?: "dev" | "oidc";
  VITE_DEV_AUTH_TOKEN?: string;
  VITE_OIDC_AUTHORITY?: string;
  VITE_OIDC_CLIENT_ID?: string;
  VITE_OIDC_REDIRECT_URI?: string;
  VITE_OIDC_POST_LOGOUT_REDIRECT_URI?: string;
  VITE_OIDC_SCOPE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
