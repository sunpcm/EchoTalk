export function buildApiRequestHeaders(
  inputHeaders: HeadersInit | undefined,
  accessToken: string | null,
): Headers {
  const headers = new Headers(inputHeaders);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  return headers;
}
