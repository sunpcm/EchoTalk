import test from "node:test";
import assert from "node:assert/strict";
import { bootstrap, validateConfig } from "../bootstrap.mjs";
import { config, authFixture, mediaFixture, code } from "./support.mjs";

test("bootstrap requires explicit config and every auth/media port before any side effect", () => {
  const auth = authFixture();
  const media = mediaFixture();
  assert.throws(() => bootstrap(), code("CONFIG_INVALID"));
  assert.throws(() => bootstrap(config()), code("PORT_UNAVAILABLE"));
  for (const name of ["openAuthorization", "exchangeCode", "validateIdentity", "discardTokens"]) {
    assert.throws(
      () => bootstrap(config(), { auth: { ...auth.ports, [name]: undefined }, media: media.ports }),
      code("PORT_UNAVAILABLE"),
    );
  }
  for (const name of ["save", "consume", "revoke"]) {
    assert.throws(
      () =>
        bootstrap(config(), {
          auth: { ...auth.ports, transactions: { ...auth.ports.transactions, [name]: undefined } },
          media: media.ports,
        }),
      code("PORT_UNAVAILABLE"),
    );
  }
  for (const name of ["prepare", "acquireMicrophone", "connect"]) {
    assert.throws(
      () => bootstrap(config(), { auth: auth.ports, media: { ...media.ports, [name]: undefined } }),
      code("PORT_UNAVAILABLE"),
    );
  }
  const probe = bootstrap(config(), { auth: auth.ports, media: media.ports });
  assert.equal(probe.media.getSnapshot().state, "waiting");
  assert.deepEqual(auth.calls.opened, []);
  assert.deepEqual(media.calls.prepared, []);
});

test("reject insecure, ambiguous or missing configuration; copy/freeze the public allowlist", () => {
  const good = config();
  const invalid = [
    { ...good, apiOrigin: "http://api.example.test" },
    { ...good, apiOrigin: "https://api.example.test/path" },
    { ...good, apiOrigin: "https://user:secret@api.example.test" },
    { ...good, mediaOrigins: [] },
    { ...good, mediaOrigins: ["ws://media.example.test"] },
    { ...good, mediaOrigins: ["wss://media.example.test/path"] },
    ...[
      { clientId: "" },
      { issuer: "https://id.example.test/#fragment" },
      { redirectUri: "javascript:alert(1)" },
      { redirectUri: "https://app.example.test/callback" },
      { redirectUri: "org.example.echotalk://oauth/callback?extra=1" },
      { authorizationEndpoint: "https://evil.example.test/authorize" },
      { tokenEndpoint: "http://id.example.test/token" },
      { transactionTtlMs: 0 },
      { transactionTtlMs: 600001 },
    ].map((patch) => ({ ...good, auth: { ...good.auth, ...patch } })),
  ];
  for (const input of invalid) assert.throws(() => validateConfig(input), code("CONFIG_INVALID"));
  const input = structuredClone(good);
  const frozen = validateConfig(input);
  input.mediaOrigins.push("wss://evil.example.test");
  input.auth.clientId = "replaced";
  assert.deepEqual(frozen.mediaOrigins, ["wss://media.example.test"]);
  assert.equal(frozen.auth.clientId, good.auth.clientId);
  assert.throws(() => frozen.mediaOrigins.push("wss://evil.example.test"), TypeError);
});
