import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";

export const NODE = "/Users/sunpcm/.nvm/versions/node/v22.13.1/bin/node";
export const RUST_BIN = "/Users/sunpcm/.rustup/toolchains/stable-aarch64-apple-darwin/bin";
export const BINARY = "echotalk-m1-native-probe";
export const PRODUCT = "EchoTalk M1 Native Probe";
export const IDENTIFIER = "org.echotalk.m1nativeprobe";
export const INPUTS = Object.freeze([
  "package.json",
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
  permissions: ["allow-auth-begin", "allow-auth-cancel", "allow-auth-status"],
});
export const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
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
  for (const dir of ["src-tauri/src", "web"]) {
    for (const name of readdirSync(join(projectDir, dir))) {
      if (!INPUTS.includes(`${dir}/${name}`)) throw new BuildFailure("INPUT_FORBIDDEN");
    }
  }
  validatePublicConfig(join(projectDir, "src-tauri/public-config.json"));
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
    lock.packages?.["node_modules/@tauri-apps/cli"]?.version !== "2.12.4"
  )
    throw new BuildFailure("DEPENDENCY_INVALID");
  if (
    Object.keys(pkg).some(
      (key) =>
        !["name", "version", "private", "engines", "scripts", "devDependencies"].includes(key),
    ) ||
    JSON.stringify(pkg.devDependencies) !== JSON.stringify({ "@tauri-apps/cli": "2.12.4" }) ||
    JSON.stringify(pkg.scripts) !==
      JSON.stringify({
        "probe:test":
          "node --test --test-timeout=5000 scripts/build.test.mjs scripts/auth-ui.test.mjs",
        "probe:build": "node scripts/build.mjs",
        "probe:auth-test": "node scripts/auth-test.mjs",
      })
  )
    throw new BuildFailure("COMMAND_FORBIDDEN");
  requireSafePath(plan.cli);
  if (!existsSync(plan.cli)) throw new BuildFailure("CLI_MISSING");
  const installed = jsonFile(join(projectDir, "node_modules/@tauri-apps/cli/package.json"));
  if (installed.name !== "@tauri-apps/cli" || installed.version !== "2.12.4")
    throw new BuildFailure("DEPENDENCY_INVALID");
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
              ? "ipc: http://ipc.localhost"
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
        if (!["auth_begin.toml", "auth_cancel.toml", "auth_status.toml"].includes(name))
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
