import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";

export const NODE = "/Users/sunpcm/.nvm/versions/node/v22.13.1/bin/node";
export const RUST_BIN = "/Users/sunpcm/.rustup/toolchains/stable-aarch64-apple-darwin/bin";
export const BINARY = "echotalk-m1-native-probe";
export const PRODUCT = "EchoTalk M1 Native Probe";
export const IDENTIFIER = "org.echotalk.m1nativeprobe";
export const INPUTS = Object.freeze([
  "package.json",
  "scripts/assets.mjs",
  "scripts/test-support.mjs",
  "scripts/media-build.test.mjs",
  "scripts/build.test.mjs",
  "scripts/auth-ui.test.mjs",
  "scripts/media.test.mjs",
  "scripts/livekit-media.test.mjs",
  "scripts/media-ui.test.mjs",
  "scripts/main.test.mjs",
  "src-tauri/media-config.json",
  "src-tauri/src/media_api.rs",
  "src-tauri/src/media_api_tests.rs",
  "web/media-controller.mjs",
  "web/livekit-media.mjs",
  "web/media-ui.mjs",
  "web/sdk.mjs",

  "scripts/build.mjs",
  "scripts/policy.mjs",
  "scripts/auth-test.mjs",
  "src-tauri/Cargo.toml",
  "src-tauri/build.rs",
  "src-tauri/tauri.conf.json",
  "src-tauri/public-config.json",
  "src-tauri/Info.plist",
  "src-tauri/src/main.rs",
  "src-tauri/src/config.rs",
  "src-tauri/src/auth.rs",
  "src-tauri/src/native.rs",
  "src-tauri/src/oidc.rs",
  "src-tauri/src/auth_tests.rs",
  "src-tauri/src/oidc_tests.rs",
  "src-tauri/src/oidc-fixture.json",
  "src-tauri/icons/icon.png",
  "web/index.html",
  "web/style.css",
  "web/main.mjs",
  "web/auth-ui.mjs",
]);
export const AUTH_CAPABILITY = Object.freeze({
  identifier: "native-auth",
  local: true,
  windows: ["main"],
  permissions: [
    "allow-auth-begin",
    "allow-auth-cancel",
    "allow-auth-status",
    "allow-media-prepare",
    "allow-media-dispatch",
    "allow-media-stop",
    "allow-media-status",
  ],
});
export const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>NSMicrophoneUsageDescription</key>
    <string>仅在您点击开始语音后，使用麦克风进行隔离语音验证。</string>
    <key>CFBundleURLTypes</key>
    <array>
      <dict>
        <key>CFBundleURLName</key>
        <string>org.echotalk.m1nativeprobe.auth</string>
        <key>CFBundleURLSchemes</key>
        <array><string>echotalk-m1</string></array>
      </dict>
    </array>
  </dict>
</plist>
`;

export function validatePublicConfig(path) {
  const config = jsonFile(path);
  const exact = (value, keys) =>
    value && !Array.isArray(value) && Object.keys(value).sort().join() === [...keys].sort().join();
  // Canonical JSON also rejects duplicate-key ambiguity before any builder runs.
  if (
    readFileSync(path, "utf8") !== JSON.stringify(config, null, 2) + "\n" ||
    !exact(config, ["version", "oidc"]) ||
    config.version !== 1
  )
    throw new BuildFailure("PUBLIC_CONFIG_INVALID");
  if (config.oidc === null) return;
  const c = config.oidc;
  if (
    !exact(c, [
      "issuer",
      "client_id",
      "redirect_uri",
      "authorization_endpoint",
      "token_endpoint",
      "jwks_uri",
    ]) ||
    typeof c.client_id !== "string" ||
    !/^[\x21-\x7e]{1,256}$/u.test(c.client_id) ||
    c.redirect_uri !== "echotalk-m1://oauth/callback"
  )
    throw new BuildFailure("PUBLIC_CONFIG_INVALID");
  for (const key of ["issuer", "authorization_endpoint", "token_endpoint", "jwks_uri"]) {
    try {
      const raw = c[key];
      if (typeof raw !== "string" || raw.length > 2048 || /[^\x20-\x7e]|[%\\]/u.test(raw))
        throw new Error();
      const url = new URL(raw);
      if (
        url.protocol !== "https:" ||
        !url.hostname ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        raw.includes("?") ||
        raw.includes("#") ||
        url.href !== raw
      )
        throw new Error();
    } catch {
      throw new BuildFailure("PUBLIC_CONFIG_INVALID");
    }
  }
  if (c.authorization_endpoint === c.token_endpoint || c.token_endpoint === c.jwks_uri)
    throw new BuildFailure("PUBLIC_CONFIG_INVALID");
}

export class BuildFailure extends Error {
  constructor(code, exitCode = 78) {
    super(code);
    this.code = code;
    this.exitCode = exitCode;
  }
}

export function requireSafePath(path) {
  if (!isAbsolute(path) || resolve(path) !== path) throw new BuildFailure("PATH_INVALID");
  let current = parse(path).root;
  for (const part of path.slice(current.length).split("/")) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new BuildFailure("PATH_SYMLINK");
    } catch (error) {
      if (error.code === "ENOENT") break;
      throw error;
    }
  }
}

export function jsonFile(path) {
  requireSafePath(path);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new BuildFailure("INPUT_INVALID");
  }
}

// An internal test seam; the CLI always derives projectDir from its own file.
// No argv/env input can choose any of these locations or child commands.
export function createPlan(projectDir, parentEnv, host = process) {
  if (
    host.platform !== "darwin" ||
    host.arch !== "arm64" ||
    !host.version.startsWith("v22.") ||
    host.execPath !== NODE
  ) {
    throw new BuildFailure("HOST_UNSUPPORTED");
  }
  requireSafePath(projectDir);
  const lane = resolve(projectDir, "../..");
  if (join(lane, "tools/macos-m1-native-probe") !== projectDir)
    throw new BuildFailure("PATH_INVALID");
  if (!isAbsolute(parentEnv.HOME ?? "")) throw new BuildFailure("HOME_MISSING");
  const blocked = [
    "TAURI_CONFIG",
    "TAURI_CLI_CONFIG_DEPTH",
    "CARGO_HOME",
    "CARGO_TARGET_DIR",
    "CARGO_BUILD_TARGET",
    "RUSTFLAGS",
    "CARGO_ENCODED_RUSTFLAGS",
    "CARGO_BUILD_RUSTFLAGS",
    "RUSTC_WRAPPER",
    "RUSTC_WORKSPACE_WRAPPER",
    "NODE_OPTIONS",
    "CLANG_MODULE_CACHE_PATH",
    "XDG_CACHE_HOME",
  ];
  if (blocked.some((key) => parentEnv[key] !== undefined))
    throw new BuildFailure("ENV_OVERRIDE_FORBIDDEN");
  const cache = join(lane, ".review/m1-native-host");
  const target = join(cache, "target");
  for (const path of [
    cache,
    target,
    join(cache, "cargo-home"),
    join(cache, "npm-cache"),
    join(cache, "tmp"),
    join(cache, "clang-module-cache"),
    join(cache, "xdg-cache"),
  ])
    requireSafePath(path);
  // Cargo also reads ancestor config files. Refuse their presence without reading
  // potentially private contents, including the isolated Cargo home's config.
  for (let path = projectDir; ; path = dirname(path)) {
    if (["config", "config.toml"].some((name) => existsSync(join(path, ".cargo", name))))
      throw new BuildFailure("CARGO_CONFIG_FORBIDDEN");
    if (dirname(path) === path) break;
  }
  if (["config", "config.toml"].some((name) => existsSync(join(cache, "cargo-home", name))))
    throw new BuildFailure("CARGO_CONFIG_FORBIDDEN");
  const env = Object.freeze({
    HOME: parentEnv.HOME,
    PATH: `${dirname(NODE)}:${RUST_BIN}:/usr/bin:/bin:/usr/sbin:/sbin`,
    CARGO_HOME: join(cache, "cargo-home"),
    CARGO_TARGET_DIR: target,
    CARGO_NET_OFFLINE: "true",
    CARGO_BUILD_JOBS: "2",
    CARGO_INCREMENTAL: "0",
    npm_config_cache: join(cache, "npm-cache"),
    npm_config_userconfig: join(cache, "empty-user.npmrc"),
    npm_config_globalconfig: join(cache, "empty-global.npmrc"),
    TMPDIR: join(cache, "tmp"),
    CLANG_MODULE_CACHE_PATH: join(cache, "clang-module-cache"),
    XDG_CACHE_HOME: join(cache, "xdg-cache"),
    CI: "true",
    LANG: "en_US.UTF-8",
    LC_ALL: "C",
    MACOSX_DEPLOYMENT_TARGET: "14.0",
  });
  return Object.freeze({
    projectDir,
    cache,
    target,
    env,
    cli: join(projectDir, "node_modules/@tauri-apps/cli/tauri.js"),
    bundle: join(target, "aarch64-apple-darwin/debug/bundle/macos", `${PRODUCT}.app`),
    args: Object.freeze([
      "build",
      "--debug",
      "--target",
      "aarch64-apple-darwin",
      "--bundles",
      "app",
      "--no-sign",
      "--ci",
      "--",
      "--locked",
      "--offline",
      "--jobs",
      "2",
    ]),
  });
}

export function validateInputs(plan) {
  const { projectDir } = plan;
  for (const path of INPUTS) {
    const full = join(projectDir, path);
    requireSafePath(full);
    if (!existsSync(full) || !lstatSync(full).isFile()) throw new BuildFailure("INPUT_INVALID");
  }
  for (const dir of ["src-tauri/src", "web", "scripts"]) {
    for (const name of readdirSync(join(projectDir, dir))) {
      if (!(dir === "web" && name === "vendor") && !INPUTS.includes(`${dir}/${name}`))
        throw new BuildFailure("INPUT_FORBIDDEN");
    }
  }
  validatePublicConfig(join(projectDir, "src-tauri/public-config.json"));
  const media = validateMediaConfig(join(projectDir, "src-tauri/media-config.json"));
  for (const path of ["package-lock.json", "src-tauri/Cargo.lock"]) {
    const full = join(projectDir, path);
    requireSafePath(full);
    if (!existsSync(full) || !lstatSync(full).isFile() || lstatSync(full).size === 0)
      throw new BuildFailure("LOCKS_MISSING");
  }
  const pkg = jsonFile(join(projectDir, "package.json"));
  const lock = jsonFile(join(projectDir, "package-lock.json"));
  if (
    pkg.private !== true ||
    pkg.devDependencies?.["@tauri-apps/cli"] !== "2.12.4" ||
    pkg.dependencies?.["livekit-client"] !== "2.17.2" ||
    lock.packages?.["node_modules/@tauri-apps/cli"]?.version !== "2.12.4" ||
    lock.packages?.["node_modules/livekit-client"]?.version !== "2.17.2" ||
    lock.packages?.[""]?.dependencies?.["livekit-client"] !== "2.17.2"
  )
    throw new BuildFailure("DEPENDENCY_INVALID");
  if (
    Object.keys(pkg).some(
      (key) =>
        ![
          "name",
          "version",
          "private",
          "engines",
          "scripts",
          "devDependencies",
          "dependencies",
        ].includes(key),
    ) ||
    JSON.stringify(pkg.devDependencies) !== JSON.stringify({ "@tauri-apps/cli": "2.12.4" }) ||
    JSON.stringify(pkg.dependencies) !== JSON.stringify({ "livekit-client": "2.17.2" }) ||
    JSON.stringify(pkg.scripts) !== JSON.stringify(PROBE_SCRIPTS)
  )
    throw new BuildFailure("COMMAND_FORBIDDEN");
  requireSafePath(plan.cli);
  if (!existsSync(plan.cli)) throw new BuildFailure("CLI_MISSING");
  const installed = jsonFile(join(projectDir, "node_modules/@tauri-apps/cli/package.json"));
  if (installed.name !== "@tauri-apps/cli" || installed.version !== "2.12.4")
    throw new BuildFailure("DEPENDENCY_INVALID");
  sdkSources(plan);
  validateGenerated(plan);
  const config = jsonFile(join(projectDir, "src-tauri/tauri.conf.json"));
  const allowedKeys = (object, keys) =>
    object && Object.keys(object).every((key) => keys.includes(key));
  if (
    !allowedKeys(config, [
      "productName",
      "version",
      "identifier",
      "build",
      "app",
      "bundle",
      "plugins",
    ]) ||
    !allowedKeys(config.app, ["withGlobalTauri", "windows", "security"]) ||
    !allowedKeys(config.app?.security, ["csp", "capabilities"]) ||
    !allowedKeys(config.app?.windows?.[0], [
      "label",
      "create",
      "title",
      "width",
      "height",
      "resizable",
      "devtools",
    ]) ||
    !allowedKeys(config.bundle, ["active", "targets", "createUpdaterArtifacts", "macOS"]) ||
    !allowedKeys(config.bundle?.macOS, ["minimumSystemVersion", "infoPlist"]) ||
    config.bundle?.active !== true
  )
    throw new BuildFailure("CONFIG_FORBIDDEN");
  if (
    config.productName !== PRODUCT ||
    config.identifier !== IDENTIFIER ||
    config.version !== "0.0.0" ||
    JSON.stringify(config.build) !== JSON.stringify({ frontendDist: "../web" }) ||
    config.app?.withGlobalTauri !== true ||
    config.app?.windows?.length !== 1 ||
    config.app.windows[0].label !== "main" ||
    config.app.windows[0].create !== false ||
    config.app.windows[0].devtools !== false ||
    JSON.stringify(config.app.security?.capabilities) !== JSON.stringify([AUTH_CAPABILITY]) ||
    config.bundle?.macOS?.minimumSystemVersion !== "14.0" ||
    config.bundle?.macOS?.infoPlist !== "Info.plist" ||
    config.bundle?.targets?.join() !== "app" ||
    config.bundle?.createUpdaterArtifacts !== false ||
    JSON.stringify(config.plugins) !==
      JSON.stringify({ "deep-link": { desktop: { schemes: ["echotalk-m1"] } } })
  )
    throw new BuildFailure("CONFIG_FORBIDDEN");
  const parts = (config.app.security.csp ?? "")
    .split(";")
    .map((part) => part.trim().split(/\s+/u))
    .filter(([key]) => key);
  const directives = new Map(parts.map(([key, ...values]) => [key, values.join(" ")]));
  const allowedDirectives = [
    "default-src",
    "connect-src",
    "script-src",
    "style-src",
    "img-src",
    "font-src",
    "media-src",
    "object-src",
    "base-uri",
    "form-action",
    "frame-src",
    "frame-ancestors",
  ];
  if (
    directives.size !== parts.length ||
    directives.size !== allowedDirectives.length ||
    ["default-src", "connect-src", "script-src", "style-src"].some((key) => !directives.has(key)) ||
    [...directives].some(
      ([key, value]) =>
        !allowedDirectives.includes(key) ||
        value !==
          (["style-src", "script-src"].includes(key)
            ? "'self'"
            : key === "connect-src"
              ? mediaConnectSources(media).join(" ")
              : key === "media-src"
                ? "'self' blob:"
                : "'none'"),
    )
  )
    throw new BuildFailure("CONFIG_FORBIDDEN");
  const nativeDir = join(projectDir, "src-tauri");
  for (const name of [
    "tauri.macos.conf.json",
    "tauri.conf.json5",
    "tauri.macos.conf.json5",
    "Tauri.toml",
    "Tauri.macos.toml",
    "capabilities",
  ]) {
    if (existsSync(join(nativeDir, name))) throw new BuildFailure("CONFIG_OVERLAY_FORBIDDEN");
  }
  const permissions = join(nativeDir, "permissions");
  if (existsSync(permissions)) {
    requireSafePath(permissions);
    if (readdirSync(permissions).some((name) => name !== "autogenerated"))
      throw new BuildFailure("CONFIG_OVERLAY_FORBIDDEN");
    const generated = join(permissions, "autogenerated");
    requireSafePath(generated);
    if (existsSync(generated))
      for (const name of readdirSync(generated)) {
        if (!COMMANDS.map((command) => `${command}.toml`).includes(name))
          throw new BuildFailure("CONFIG_OVERLAY_FORBIDDEN");
        requireSafePath(join(generated, name));
      }
  }
  const plist = readFileSync(join(nativeDir, "Info.plist"), "utf8");
  if (plist !== INFO_PLIST) throw new BuildFailure("CONFIG_FORBIDDEN");
  const cargo = readFileSync(join(nativeDir, "Cargo.toml"), "utf8");
  if (
    !cargo.includes('version = "=2.12.5"') ||
    !cargo.includes('version = "=2.7.4"') ||
    !cargo.includes("[workspace]") ||
    !cargo.includes("debug = 0") ||
    !cargo.includes("incremental = false")
  )
    throw new BuildFailure("CARGO_POLICY_INVALID");
  const allowedSections = [
    "package",
    "workspace",
    "build-dependencies",
    "dependencies",
    "features",
    "profile.dev",
  ];
  const sections = [...cargo.matchAll(/^\[([^\n]+)\]$/gmu)].map((m) => m[1]);
  const expected = {
    tauri: '{ version = "=2.12.5", default-features = false, features = ["wry"] }',
    "tauri-plugin-deep-link": '"=2.6.3"',
    openidconnect:
      '{ version = "=4.1.0", default-features = false, features = ["timing-resistant-secret-traits"] }',
    reqwest:
      '{ version = "=0.12.24", default-features = false, features = ["blocking", "native-tls"] }',
    serde: '{ version = "=1.0.228", features = ["derive"] }',
    serde_json: '"=1.0.145"',
    url: '"=2.5.7"',
    keyring: '{ version = "=3.6.3", default-features = false, features = ["apple-native"] }',
    zeroize: '{ version = "=1.8.2", features = ["derive"] }',
  };
  const dependencies = cargo.split("[dependencies]\n")[1]?.split("\n[")[0]?.trim().split("\n");
  if (
    JSON.stringify(sections) !== JSON.stringify(allowedSections) ||
    dependencies?.length !== Object.keys(expected).length ||
    dependencies.some(
      (line) => !Object.entries(expected).some(([name, value]) => line === `${name} = ${value}`),
    )
  )
    throw new BuildFailure("DEPENDENCY_INVALID");
}

export const COMMANDS = Object.freeze([
  "auth_begin",
  "auth_cancel",
  "auth_status",
  "media_prepare",
  "media_dispatch",
  "media_stop",
  "media_status",
]);
export const PROBE_SCRIPTS = Object.freeze({
  "probe:test":
    "node --test --test-timeout=5000 scripts/build.test.mjs scripts/media-build.test.mjs scripts/auth-ui.test.mjs scripts/media.test.mjs scripts/livekit-media.test.mjs scripts/media-ui.test.mjs scripts/main.test.mjs",
  "probe:build": "node scripts/build.mjs",
  "probe:auth-test": "node scripts/auth-test.mjs",
  "probe:assets": "node scripts/assets.mjs",
});
export const SDK_SHA256 = "800b013b0a0c9f8b8194d76225bf3dc9837028739fa641215068b112627edd15";
export const LICENSE_SHA256 = "09e8a9bcec8067104652c168685ab0931e7868f9c8284b66f5ae6edae5f1130b";
export const SDK_INPUTS = Object.freeze([
  "node_modules/livekit-client/package.json",
  "node_modules/livekit-client/dist/livekit-client.umd.js",
  "node_modules/livekit-client/LICENSE",
]);
export const GENERATED = Object.freeze([
  "web/vendor/livekit-client.umd.js",
  "web/vendor/LICENSE.livekit-client",
  ...COMMANDS.map((command) => `src-tauri/permissions/autogenerated/${command}.toml`),
]);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function validateMediaConfig(path) {
  const config = jsonFile(path);
  const raw = readFileSync(path, "utf8");
  // Ignore formatting whitespace only outside JSON strings. This keeps duplicate
  // keys/noncanonical escapes rejected while accepting Prettier's compact arrays.
  const compact = raw.replace(/"(?:[^"\\]|\\.)*"|\s+/gu, (part) =>
    part.startsWith('"') ? part : "",
  );
  const exact =
    config &&
    !Array.isArray(config) &&
    Object.keys(config).sort().join() === "api_origin,media_origins,version";
  if (
    Buffer.byteLength(raw) > 16384 ||
    compact !== JSON.stringify(config) ||
    !exact ||
    config.version !== 1 ||
    !Array.isArray(config.media_origins) ||
    config.media_origins.length > 8 ||
    new Set(config.media_origins).size !== config.media_origins.length
  )
    throw new BuildFailure("MEDIA_CONFIG_INVALID");
  const validOrigin = (raw, scheme) => {
    try {
      if (typeof raw !== "string" || raw.length > 2048 || /[^\x21-\x7e]|[%\\]/u.test(raw))
        return false;
      const url = new URL(raw);
      return (
        url.protocol === scheme &&
        !!url.hostname &&
        !url.username &&
        !url.password &&
        url.origin === raw
      );
    } catch {
      return false;
    }
  };
  if (
    !config.media_origins.every((raw) => validOrigin(raw, "wss:")) ||
    (config.api_origin === null
      ? config.media_origins.length !== 0
      : !validOrigin(config.api_origin, "https:") || config.media_origins.length === 0)
  )
    throw new BuildFailure("MEDIA_CONFIG_INVALID");
  return config;
}

export function mediaConnectSources(config) {
  return [
    "ipc:",
    "http://ipc.localhost",
    ...config.media_origins,
    ...config.media_origins.map((raw) => raw.replace(/^wss:/u, "https:")),
  ];
}

export function sdkSources(plan) {
  const paths = SDK_INPUTS.map((path) => join(plan.projectDir, path));
  for (const path of paths) {
    requireSafePath(path);
    if (!existsSync(path) || !lstatSync(path).isFile()) throw new BuildFailure("SDK_MISSING");
  }
  const pkg = jsonFile(paths[0]);
  if (pkg.name !== "livekit-client" || pkg.version !== "2.17.2" || pkg.license !== "Apache-2.0")
    throw new BuildFailure("SDK_VERSION_INVALID");
  const sdk = readFileSync(paths[1]),
    license = readFileSync(paths[2]);
  if (sdk.length !== 479042 || digest(sdk) !== SDK_SHA256 || digest(license) !== LICENSE_SHA256)
    throw new BuildFailure("SDK_INTEGRITY_INVALID");
  return { sdk, license };
}

// Exact tauri-utils 2.10.2 / tauri-build 2.7.4 auto-command template, no schema/header.
export function permissionText(command) {
  const slug = command.replaceAll("_", "-");
  return `# Automatically generated - DO NOT EDIT!\n\n[[permission]]\nidentifier = "allow-${slug}"\ndescription = "Enables the ${command} command without any pre-configured scope."\ncommands.allow = ["${command}"]\n\n[[permission]]\nidentifier = "deny-${slug}"\ndescription = "Denies the ${command} command without any pre-configured scope."\ncommands.deny = ["${command}"]\n`;
}

export function generatedBytes(plan) {
  const { sdk, license } = sdkSources(plan);
  return new Map([
    [GENERATED[0], sdk],
    [GENERATED[1], license],
    ...COMMANDS.map((command) => [
      `src-tauri/permissions/autogenerated/${command}.toml`,
      Buffer.from(permissionText(command)),
    ]),
  ]);
}

export function validateGenerated(plan) {
  const expected = generatedBytes(plan);
  for (const [path, bytes] of expected) {
    const full = join(plan.projectDir, path);
    requireSafePath(full);
    if (existsSync(full) && (!lstatSync(full).isFile() || !readFileSync(full).equals(bytes)))
      throw new BuildFailure("GENERATED_INVALID");
  }
  const vendor = join(plan.projectDir, "web/vendor");
  requireSafePath(vendor);
  if (
    existsSync(vendor) &&
    (!lstatSync(vendor).isDirectory() ||
      readdirSync(vendor).some(
        (name) => !["livekit-client.umd.js", "LICENSE.livekit-client"].includes(name),
      ))
  )
    throw new BuildFailure("INPUT_FORBIDDEN");
}
