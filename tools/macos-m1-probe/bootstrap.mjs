import { createAuthProbe } from "./auth.mjs";
import { createMediaProbe } from "./media.mjs";
import { ProbeError } from "./ports.mjs";

function httpsUrl(value, originOnly = false) {
  try {
    const url = new URL(value);
    if (
      typeof value !== "string" ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (originOnly && url.origin !== value) ||
      (!originOnly && url.href !== value)
    ) {
      throw new Error();
    }
    return url;
  } catch {
    throw new ProbeError("CONFIG_INVALID");
  }
}

// Explicit public configuration only. Never read process.env, dotenv or credentials.
export function validateConfig(input) {
  try {
    const apiOrigin = httpsUrl(input.apiOrigin, true).origin;
    if (!Array.isArray(input.mediaOrigins) || input.mediaOrigins.length === 0) {
      throw new Error();
    }
    const mediaOrigins = input.mediaOrigins.map((value) => {
      const url = new URL(value);
      if (url.protocol !== "wss:" || url.origin !== value) throw new Error();
      return value;
    });
    const auth = input.auth;
    const issuer = httpsUrl(auth.issuer);
    const authorizationEndpoint = httpsUrl(auth.authorizationEndpoint);
    const tokenEndpoint = httpsUrl(auth.tokenEndpoint);
    const redirect = new URL(auth.redirectUri);
    if (
      authorizationEndpoint.origin !== issuer.origin ||
      tokenEndpoint.origin !== issuer.origin ||
      typeof auth.clientId !== "string" ||
      !auth.clientId.trim() ||
      auth.clientId.length > 256 ||
      !redirect.hostname ||
      !redirect.pathname.startsWith("/") ||
      redirect.username ||
      redirect.password ||
      redirect.port ||
      redirect.search ||
      redirect.hash ||
      redirect.href !== auth.redirectUri ||
      !/^[a-z][a-z0-9+.-]*:$/u.test(redirect.protocol) ||
      ["https:", "http:", "file:", "data:", "javascript:", "ws:", "wss:", "about:"].includes(
        redirect.protocol,
      ) ||
      !Number.isSafeInteger(auth.transactionTtlMs) ||
      auth.transactionTtlMs < 1000 ||
      auth.transactionTtlMs > 600000
    ) {
      throw new Error();
    }
    return Object.freeze({
      apiOrigin,
      mediaOrigins: Object.freeze(mediaOrigins),
      auth: Object.freeze({
        issuer: auth.issuer,
        clientId: auth.clientId,
        authorizationEndpoint: authorizationEndpoint.href,
        tokenEndpoint: tokenEndpoint.href,
        redirectUri: auth.redirectUri,
        transactionTtlMs: auth.transactionTtlMs,
      }),
    });
  } catch {
    throw new ProbeError("CONFIG_INVALID");
  }
}

export function bootstrap(config, ports) {
  const validated = validateConfig(config);
  // No implicit mocks; all production implementations are deliberately absent.
  const auth = createAuthProbe(validated.auth, ports?.auth);
  const media = createMediaProbe(validated, ports?.media);
  return Object.freeze({ auth, media });
}
