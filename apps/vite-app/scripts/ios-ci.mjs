/** CP-06: build a real unsigned Simulator app; never boot or launch it. */
import {
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateManifestSchema } from "./config-validator.mjs";
import { getAllRelativeFiles, verifyCopiedPublicAssets } from "./sync-ios.mjs";

export const PUBLIC_CONFIG = Object.freeze({
  NODE_ENV: "production",
  ECHOTALK_BUILD_PLATFORM: "ios",
  ECHOTALK_BUILD_MODE: "production",
  VITE_API_BASE_URL: "https://api.echotalk.invalid",
  VITE_AUTH_MODE: "oidc",
  VITE_OIDC_AUTHORITY: "https://idp.echotalk.invalid",
  VITE_OIDC_CLIENT_ID: "echotalk-simulator-ci-public",
  VITE_OIDC_REDIRECT_URI: "https://client.echotalk.invalid/callback",
  VITE_OIDC_POST_LOGOUT_REDIRECT_URI: "https://client.echotalk.invalid/",
  VITE_OIDC_SCOPE: "openid profile email",
  VITE_LIVEKIT_URL: "wss://livekit.echotalk.invalid",
});
const APP = "apps/vite-app";
const GENERATED = [`${APP}/ios/App/App/capacitor.config.json`, `${APP}/ios/App/App/config.xml`];
const WEB_FILES = [
  "index.html",
  "package.json",
  "tsconfig.json",
  "postcss.config.js",
  "vite.config.ts",
  "scripts/build.mjs",
  "scripts/sync-ios.mjs",
  "scripts/config-validator.mjs",
];
const fail = (code, exitCode = 78) => Object.assign(new Error(code), { code, exitCode });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Check every ancestor, including dangling symlinks. All writes stay below this lane.
export function safePath(root, path) {
  const rel = relative(root, path);
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`))
    throw fail("PATH_OUTSIDE_LANE");
  let current = root;
  for (const part of rel.split(sep)) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) throw fail("SYMLINK_FORBIDDEN");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return path;
}
function regular(root, path) {
  safePath(root, path);
  if (!lstatSync(path).isFile()) throw fail("INPUT_NOT_FILE");
  return readFileSync(path);
}
function freshDirectory(plan, path) {
  safePath(plan.root, path);
  if (existsSync(path)) throw fail("OUTPUT_ALREADY_EXISTS");
  mkdirSync(path, { recursive: true });
}

export function createPlan(root, env = process.env, host = process) {
  if (host.platform !== "darwin" || host.version !== "v22.13.1")
    throw fail("HOST_REQUIRES_MACOS_NODE_22_13_1");
  root = realpathSync(root);
  // Resolve only the pnpm installed by the host/setup action, then pin its version below.
  const pnpm = (env.PATH ?? "")
    .split(sep === "/" ? ":" : ";")
    .filter(isAbsolute)
    .map((dir) => join(dir, "pnpm"))
    .find(existsSync);
  const developer = [
    "/Applications/Xcode_26.0.1.app/Contents/Developer",
    "/Applications/Xcode.app/Contents/Developer",
  ].find(existsSync);
  if (!pnpm || !developer || !isAbsolute(env.HOME ?? "")) throw fail("TOOLS_MISSING");
  const cache = safePath(root, join(root, ".cache/ios-ci"));
  return Object.freeze({
    root,
    app: join(root, APP),
    cache,
    stage: join(cache, "web-input"),
    derived: join(cache, "derived-data"),
    packages: join(cache, "source-packages"),
    project: join(root, APP, "ios/App/App.xcodeproj"),
    xcode: join(developer, "usr/bin/xcodebuild"),
    node: host.execPath,
    env: Object.freeze({
      HOME: env.HOME,
      PATH: [dirname(host.execPath), dirname(pnpm), "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(
        ":",
      ),
      DEVELOPER_DIR: developer,
      TMPDIR: join(cache, "tmp"),
      CLANG_MODULE_CACHE_PATH: join(cache, "clang-cache"),
      SWIFTPM_MODULECACHE_OVERRIDE: join(cache, "swift-cache"),
      LANG: "en_US.UTF-8",
      CI: "true",
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      npm_config_userconfig: "/dev/null",
      npm_config_globalconfig: "/dev/null",
      ...PUBLIC_CONFIG,
    }),
  });
}

// Complete separate stdout/stderr files; no spawnSync maxBuffer truncation. POSIX process
// groups also bound the nested pnpm/tsc/vite/cap/xcodebuild children on macOS.
export function runBounded(
  command,
  args,
  { cwd, env, timeout, log, capture = false, echoOutput = true },
) {
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 20 * 60_000)
    throw fail("TIMEOUT_INVALID");
  if (typeof echoOutput !== "boolean") throw fail("OUTPUT_OPTION_INVALID");
  const out = openSync(`${log}.stdout.log`, "wx");
  let err;
  try {
    err = openSync(`${log}.stderr.log`, "wx");
  } catch (error) {
    closeSync(out);
    throw error;
  }
  return new Promise((done) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const captured = [];
    let capturedBytes = 0;
    let errorCode;
    let timedOut = false;
    let wasInterrupted = false;
    let ioFailed = false;
    const kill = () => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") ioFailed = true;
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeout);
    const interrupted = () => {
      wasInterrupted = true;
      kill();
    };
    process.once("SIGINT", interrupted);
    process.once("SIGTERM", interrupted);
    const stream = (fd, chunk, output) => {
      try {
        let offset = 0;
        while (offset < chunk.length) offset += writeSync(fd, chunk, offset);
        if (echoOutput) output.write(chunk);
      } catch {
        ioFailed = true;
        kill();
      }
    };
    child.stdout.on("data", (chunk) => {
      stream(out, chunk, process.stdout);
      if (capture) {
        captured.push(chunk);
        capturedBytes += chunk.length;
        if (capturedBytes > 4 * 1024 * 1024) {
          ioFailed = true;
          kill();
        }
      }
    });
    child.stderr.on("data", (chunk) => stream(err, chunk, process.stderr));
    child.on("error", (error) => {
      errorCode = error.code;
    });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      process.removeListener("SIGINT", interrupted);
      process.removeListener("SIGTERM", interrupted);
      closeSync(out);
      closeSync(err);
      done({
        status,
        signal,
        errorCode: timedOut ? "ETIMEDOUT" : wasInterrupted ? "EINTR" : errorCode,
        ioFailed,
        stdout: Buffer.concat(captured).toString("utf8"),
      });
    });
  });
}

export function xcodeArgs(plan, prepare = false) {
  return [
    ...(prepare ? ["-resolvePackageDependencies"] : ["build"]),
    "-project",
    plan.project,
    "-scheme",
    "App",
    "-configuration",
    "Release",
    "-sdk",
    "iphonesimulator",
    "-destination",
    "generic/platform=iOS Simulator",
    "-destination-timeout",
    "30",
    "-derivedDataPath",
    prepare ? join(plan.cache, "prepare-derived-data") : plan.derived,
    "-clonedSourcePackagesDirPath",
    plan.packages,
    "-packageCachePath",
    join(plan.cache, "package-cache"),
    "-disableAutomaticPackageResolution",
    "-onlyUsePackageVersionsFromResolvedFile",
    "-skipPackageUpdates",
    "ARCHS=arm64",
    "ONLY_ACTIVE_ARCH=NO",
    "CODE_SIGNING_ALLOWED=NO",
    "CODE_SIGNING_REQUIRED=NO",
    "CODE_SIGN_IDENTITY=",
  ];
}

export function validateInventory(files) {
  if (!files.length || new Set(files).size !== files.length) throw fail("INVENTORY_INVALID");
  for (const file of files) {
    if (
      isAbsolute(file) ||
      file.split("/").some((part) => ["..", ".", ""].includes(part)) ||
      /(^|\/)(\.env[^/]*|xcuserdata|public)(\/|$)/u.test(
        file.replace(`${APP}/public/`, `${APP}/assets/`),
      ) ||
      !(
        file.startsWith(`${APP}/src/`) ||
        file.startsWith(`${APP}/public/`) ||
        file.startsWith(`${APP}/ios/`) ||
        file.startsWith("packages/configs/") ||
        WEB_FILES.map((name) => `${APP}/${name}`).includes(file) ||
        ["pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json"].includes(file)
      )
    )
      throw fail("INVENTORY_INVALID");
  }
  for (const name of [
    ...WEB_FILES,
    "ios/App/App.xcodeproj/project.pbxproj",
    "ios/App/CapApp-SPM/Package.swift",
    "ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved",
  ])
    if (!files.includes(`${APP}/${name}`)) throw fail("INVENTORY_MISSING");
  return files;
}
function fingerprint(plan, files) {
  return Object.fromEntries(
    files
      .filter((file) => !GENERATED.includes(file))
      .sort()
      .map((file) => [file, hash(regular(plan.root, join(plan.root, file)))]),
  );
}
function sameInputs(plan, files, before) {
  if (JSON.stringify(fingerprint(plan, files)) !== JSON.stringify(before))
    throw fail("SOURCE_OR_LOCK_CHANGED");
}
function validateLock(plan) {
  const lock = JSON.parse(
    regular(
      plan.root,
      join(plan.project, "project.xcworkspace/xcshareddata/swiftpm/Package.resolved"),
    ),
  );
  const pin = lock.pins?.[0];
  if (
    lock.version !== 3 ||
    lock.pins.length !== 1 ||
    pin.identity !== "capacitor-swift-pm" ||
    pin.location !== "https://github.com/ionic-team/capacitor-swift-pm.git" ||
    pin.state?.version !== "8.5.0" ||
    pin.state?.revision !== "4f71d0b979f2f957326f04353eca7604ee937e1e"
  )
    throw fail("SPM_LOCK_INVALID");
}

export function verifyMachO(bytes) {
  if (
    bytes.length < 32 ||
    bytes.readUInt32LE(0) !== 0xfeedfacf ||
    bytes.readUInt32LE(4) !== 0x0100000c ||
    bytes.readUInt32LE(12) !== 2
  )
    throw fail("MACHO_INVALID");
  let offset = 32;
  let simulator = false;
  const end = 32 + bytes.readUInt32LE(20);
  if (end > bytes.length) throw fail("MACHO_INVALID");
  for (let i = 0; i < bytes.readUInt32LE(16); i++) {
    if (offset + 8 > end) throw fail("MACHO_INVALID");
    const size = bytes.readUInt32LE(offset + 4);
    if (size < 8 || offset + size > end) throw fail("MACHO_INVALID");
    if (bytes.readUInt32LE(offset) === 0x32 && size >= 24 && bytes.readUInt32LE(offset + 8) === 7)
      simulator = true;
    offset += size;
  }
  if (!simulator || offset !== end) throw fail("MACHO_NOT_IOS_SIMULATOR");
}
export function verifyPlist(plist) {
  if (
    plist.CFBundleIdentifier !== "com.echotalk.app" ||
    plist.CFBundleExecutable !== "App" ||
    plist.CFBundlePackageType !== "APPL" ||
    plist.DTPlatformName !== "iphonesimulator" ||
    !Array.isArray(plist.CFBundleSupportedPlatforms) ||
    !plist.CFBundleSupportedPlatforms.includes("iPhoneSimulator") ||
    typeof plist.MinimumOSVersion !== "string" ||
    !/^\d+(\.\d+)*$/u.test(plist.MinimumOSVersion ?? "") ||
    !plist.NSMicrophoneUsageDescription?.trim()
  )
    throw fail("PLIST_INVALID");
}

// run is an internal test seam, never selectable through argv or the environment.
export async function executeIos(plan, mode = "build", { run = runBounded } = {}) {
  if (!["prepare", "build"].includes(mode)) throw fail("ARGUMENTS_FORBIDDEN", 64);
  for (const dir of ["logs", "tmp", "clang-cache", "swift-cache"])
    mkdirSync(safePath(plan.root, join(plan.cache, dir)), { recursive: true });
  const command = async (name, executable, args, timeout, cwd = plan.root, capture = false) => {
    const log = safePath(plan.root, join(plan.cache, "logs", `${mode}-${name}`));
    const result = await run(executable, args, { cwd, env: plan.env, timeout, log, capture });
    writeFileSync(
      `${log}.json`,
      JSON.stringify({
        executable,
        args,
        status: result.status,
        signal: result.signal ?? null,
        errorCode: result.errorCode ?? null,
        ioFailed: result.ioFailed ?? false,
      }),
    );
    if (result.errorCode === "ETIMEDOUT") throw fail("CHILD_TIMEOUT", 124);
    if (result.ioFailed || result.errorCode || result.signal || !Number.isInteger(result.status))
      throw fail("CHILD_INCOMPLETE", 70);
    if (result.status !== 0) throw fail("CHILD_FAILED", result.status);
    return result.stdout;
  };
  const version = await command("xcode", plan.xcode, ["-version"], 30_000, plan.root, true);
  if (!/^Xcode 26\.0\.1\r?\nBuild version 17A400\s*$/u.test(version))
    throw fail("XCODE_UNSUPPORTED");
  const sdk = await command(
    "sdk",
    plan.xcode,
    ["-version", "-sdk", "iphonesimulator", "SDKVersion"],
    30_000,
    plan.root,
    true,
  );
  if (!/^26\.0(?:\.1)?\s*$/u.test(sdk)) throw fail("SIMULATOR_SDK_UNSUPPORTED");
  const pnpmVersion = await command("pnpm", "pnpm", ["--version"], 30_000, plan.root, true);
  if (pnpmVersion.trim() !== "10.26.0") throw fail("PNPM_UNSUPPORTED");
  const listing = await command(
    "inputs",
    "/usr/bin/git",
    [
      "ls-files",
      "-z",
      "--",
      ...WEB_FILES.map((file) => `${APP}/${file}`),
      `${APP}/src`,
      `${APP}/public`,
      `${APP}/ios`,
      "packages/configs",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "package.json",
    ],
    30_000,
    plan.root,
    true,
  );
  const files = validateInventory(listing.split("\0").filter(Boolean));
  validateLock(plan);
  const inputs = fingerprint(plan, files);
  const receipt = safePath(plan.root, join(plan.cache, "prepared.json"));
  if (mode === "prepare") {
    if (existsSync(receipt) || existsSync(plan.packages)) throw fail("PREPARATION_ALREADY_EXISTS");
    await command("spm", plan.xcode, xcodeArgs(plan, true), 10 * 60_000);
    sameInputs(plan, files, inputs);
    writeFileSync(receipt, JSON.stringify(inputs, null, 2), { flag: "wx" });
    return { stage: "ios-dependencies-prepared", inputs };
  }
  if (
    !existsSync(receipt) ||
    JSON.stringify(JSON.parse(regular(plan.root, receipt))) !== JSON.stringify(inputs)
  )
    throw fail("PREPARATION_MISSING_OR_STALE");
  freshDirectory(plan, plan.stage);
  freshDirectory(plan, plan.derived);
  // A clean source snapshot is necessary: the source app has tracked dotenv files.
  // Copy only named public build inputs, without ever opening a dotenv or backend template.
  for (const file of files.filter(
    (file) => file.startsWith(`${APP}/`) && !file.startsWith(`${APP}/ios/`),
  )) {
    const target = safePath(plan.root, join(plan.stage, relative(APP, file)));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, regular(plan.root, join(plan.root, file)));
  }
  const modules = join(plan.app, "node_modules");
  if (!lstatSync(modules).isDirectory() || realpathSync(modules) !== modules)
    throw fail("DEPENDENCIES_MISSING");
  symlinkSync(modules, join(plan.stage, "node_modules"), "dir");
  await command(
    "web",
    plan.node,
    [join(plan.stage, "scripts/build.mjs"), "--platform", "ios", "--mode", "production"],
    5 * 60_000,
    plan.stage,
  );
  const dist = join(plan.stage, "dist/ios/production");
  const manifest = JSON.parse(regular(plan.root, join(dist, "build-manifest.json")));
  validateManifestSchema(manifest, "production");
  if (manifest.apiOrigin !== PUBLIC_CONFIG.VITE_API_BASE_URL) throw fail("MANIFEST_INVALID");
  // Use the existing file inventory and copy verifier; no custom sync implementation.
  const targetDist = safePath(plan.root, join(plan.app, "dist/ios/production"));
  if (existsSync(targetDist)) throw fail("OUTPUT_ALREADY_EXISTS");
  for (const file of getAllRelativeFiles(dist)) {
    const target = safePath(plan.root, join(targetDist, file));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(safePath(plan.root, join(dist, file)), target);
  }
  safePath(plan.root, join(plan.app, "ios/App/App/public"));
  await command(
    "sync",
    plan.node,
    [join(plan.app, "scripts/sync-ios.mjs"), "--mode", "production"],
    3 * 60_000,
    plan.app,
  );
  sameInputs(plan, files, inputs);
  verifyCopiedPublicAssets(targetDist, join(plan.app, "ios/App/App/public"));
  const config = JSON.parse(
    regular(plan.root, join(plan.app, "ios/App/App/capacitor.config.json")),
  );
  if (config.webDir !== "dist/ios/production" || config.server?.url)
    throw fail("NATIVE_CONFIG_INVALID");
  await command("compile", plan.xcode, xcodeArgs(plan), 20 * 60_000);
  sameInputs(plan, files, inputs);
  const app = safePath(
    plan.root,
    join(plan.derived, "Build/Products/Release-iphonesimulator/App.app"),
  );
  const binary = regular(plan.root, join(app, "App"));
  if (!(statSync(join(app, "App")).mode & 0o111)) throw fail("MACHO_NOT_EXECUTABLE");
  verifyMachO(binary);
  const plistPath = join(app, "Info.plist");
  const plistBytes = regular(plan.root, plistPath);
  const plist = JSON.parse(
    await command(
      "plist",
      "/usr/bin/plutil",
      ["-convert", "json", "-o", "-", plistPath],
      30_000,
      plan.root,
      true,
    ),
  );
  verifyPlist(plist);
  if (existsSync(join(app, "_CodeSignature")) || existsSync(join(app, "embedded.mobileprovision")))
    throw fail("SIGNED_ARTIFACT_FORBIDDEN");
  verifyCopiedPublicAssets(targetDist, join(app, "public"));
  const result = {
    stage: "ios-simulator-built-not-run",
    app,
    binarySha256: hash(binary),
    plistSha256: hash(plistBytes),
    inputs,
  };
  writeFileSync(join(plan.cache, "logs/built-not-run.json"), JSON.stringify(result, null, 2), {
    flag: "wx",
  });
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== "prepare"))
      throw fail("ARGUMENTS_FORBIDDEN", 64);
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const result = await executeIos(createPlan(root), args[0] ?? "build");
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(
      JSON.stringify({ stage: "ios-ci-failed", code: error.code ?? "INPUT_OR_OUTPUT_INVALID" }),
    );
    process.exitCode = error.exitCode ?? 78;
  }
}
