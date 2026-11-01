import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";

export const NODE = "/Users/sunpcm/.nvm/versions/node/v22.13.1/bin/node";
export const RUST_BIN = "/Users/sunpcm/.rustup/toolchains/stable-aarch64-apple-darwin/bin";
export const BINARY = "echotalk-m1-native-probe";
export const PRODUCT = "EchoTalk M1 Native Probe";
export const IDENTIFIER = "org.echotalk.m1nativeprobe";

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
  for (const path of [
    "package.json",
    "src-tauri/Cargo.toml",
    "src-tauri/build.rs",
    "src-tauri/src/main.rs",
    "src-tauri/icons/icon.png",
    "web/index.html",
    "web/style.css",
  ]) {
    const full = join(projectDir, path);
    requireSafePath(full);
    if (!existsSync(full) || !lstatSync(full).isFile()) throw new BuildFailure("INPUT_INVALID");
  }
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
  requireSafePath(plan.cli);
  if (!existsSync(plan.cli)) throw new BuildFailure("CLI_MISSING");
  const installed = jsonFile(join(projectDir, "node_modules/@tauri-apps/cli/package.json"));
  if (installed.name !== "@tauri-apps/cli" || installed.version !== "2.12.4")
    throw new BuildFailure("DEPENDENCY_INVALID");
  const config = jsonFile(join(projectDir, "src-tauri/tauri.conf.json"));
  const allowedKeys = (object, keys) =>
    object && Object.keys(object).every((key) => keys.includes(key));
  if (
    !allowedKeys(config, ["productName", "version", "identifier", "build", "app", "bundle"]) ||
    !allowedKeys(config.app, ["withGlobalTauri", "windows", "security"]) ||
    !allowedKeys(config.app?.security, ["csp", "capabilities"]) ||
    !allowedKeys(config.app?.windows?.[0], [
      "label",
      "title",
      "width",
      "height",
      "resizable",
      "devtools",
    ]) ||
    !allowedKeys(config.bundle, ["active", "targets", "createUpdaterArtifacts", "macOS"]) ||
    !allowedKeys(config.bundle?.macOS, ["minimumSystemVersion"]) ||
    config.bundle?.active !== true
  )
    throw new BuildFailure("CONFIG_FORBIDDEN");
  if (
    config.productName !== PRODUCT ||
    config.identifier !== IDENTIFIER ||
    config.version !== "0.0.0" ||
    JSON.stringify(config.build) !== JSON.stringify({ frontendDist: "../web" }) ||
    config.app?.withGlobalTauri !== false ||
    config.app?.windows?.length !== 1 ||
    config.app.windows[0].label !== "main" ||
    config.app.windows[0].devtools !== false ||
    JSON.stringify(config.app.security?.capabilities) !==
      JSON.stringify([{ identifier: "build-probe", windows: ["main"], permissions: [] }]) ||
    config.bundle?.macOS?.minimumSystemVersion !== "14.0" ||
    config.bundle?.targets?.join() !== "app" ||
    config.bundle?.createUpdaterArtifacts !== false ||
    Object.keys(config.plugins ?? {}).length !== 0
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
    ["default-src", "connect-src", "script-src", "style-src"].some((key) => !directives.has(key)) ||
    [...directives].some(
      ([key, value]) =>
        !allowedDirectives.includes(key) || value !== (key === "style-src" ? "'self'" : "'none'"),
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
  const cargo = readFileSync(join(nativeDir, "Cargo.toml"), "utf8");
  if (
    !cargo.includes('version = "=2.12.5"') ||
    !cargo.includes('version = "=2.7.4"') ||
    !cargo.includes("[workspace]") ||
    !cargo.includes("debug = 0") ||
    !cargo.includes("incremental = false")
  )
    throw new BuildFailure("CARGO_POLICY_INVALID");
}
