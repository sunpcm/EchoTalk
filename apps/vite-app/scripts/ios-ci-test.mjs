import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPlan,
  executeIos as executePinnedIos,
  PINNED_ARTIFACTS,
  PUBLIC_CONFIG,
  runBounded,
  safePath,
  validateInventory,
  verifyMachO,
  verifyPlist,
  xcodeArgs,
} from "./ios-ci.mjs";

const source = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(source, "../..");
const appPrefix = "apps/vite-app";
const artifactBytes = (name) => Buffer.from(`synthetic ${name} archive; never native acceptance`);
const testArtifacts = PINNED_ARTIFACTS.map((artifact) => ({
  ...artifact,
  size: artifactBytes(artifact.name).length,
  sha256: createHash("sha256").update(artifactBytes(artifact.name)).digest("hex"),
}));
// Internal test seam only; production CLI has no artifact or checksum override.
const executeIos = (plan, mode, options) =>
  executePinnedIos(plan, mode, { artifacts: testArtifacts, ...options });
const cachedArtifact = (plan, name) =>
  join(
    plan.cache,
    "package-cache/artifacts",
    `https___github_com_ionic_team_capacitor_swift_pm_releases_download_8_5_0_${name}_xcframework_zip`,
  );
const put = (path, content) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};
const rejects = (code, exitCode) => (error) => {
  assert.equal(error.code, code);
  if (exitCode !== undefined) assert.equal(error.exitCode, exitCode);
  return true;
};
function macho(platform = 7) {
  const bytes = Buffer.alloc(56);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(0x0100000c, 4);
  bytes.writeUInt32LE(2, 12);
  bytes.writeUInt32LE(1, 16);
  bytes.writeUInt32LE(24, 20);
  bytes.writeUInt32LE(0x32, 32);
  bytes.writeUInt32LE(24, 36);
  bytes.writeUInt32LE(platform, 40);
  return bytes;
}
const plist = {
  CFBundleIdentifier: "com.echotalk.app",
  CFBundleExecutable: "App",
  CFBundlePackageType: "APPL",
  DTPlatformName: "iphonesimulator",
  CFBundleSupportedPlatforms: ["iPhoneSimulator"],
  MinimumOSVersion: "15.0",
  NSMicrophoneUsageDescription: "Synthetic microphone description; never launch.",
};

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "echotalk-ios-ci-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = join(root, appPrefix);
  const cache = join(root, ".cache/ios-ci");
  const project = join(app, "ios/App/App.xcodeproj");
  const files = [
    "index.html",
    "package.json",
    "tsconfig.json",
    "postcss.config.js",
    "vite.config.ts",
    "scripts/build.mjs",
    "scripts/sync-ios.mjs",
    "scripts/config-validator.mjs",
    "src/index.ts",
    "public/fixture.txt",
    "ios/App/App.xcodeproj/project.pbxproj",
    "ios/App/CapApp-SPM/Package.swift",
    "ios/App/App/Info.plist",
    "ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved",
  ].map((file) => `${appPrefix}/${file}`);
  for (const file of files) put(join(root, file), "fixture");
  put(join(app, "package.json"), '{"name":"vite-app","type":"module"}');
  put(join(app, "src/index.ts"), "export {};\n");
  for (const script of ["build.mjs", "sync-ios.mjs", "config-validator.mjs"])
    cpSync(join(source, "scripts", script), join(app, "scripts", script));
  cpSync(
    join(source, "ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved"),
    join(project, "project.xcworkspace/xcshareddata/swiftpm/Package.resolved"),
  );
  // Poison a source dotenv. Real build.mjs must run from the clean snapshot instead.
  put(join(app, ".env.production"), "VITE_AUTH_MODE=dev\nVITE_DEV_AUTH_TOKEN=synthetic-poison\n");
  const modules = join(app, "node_modules");
  mkdirSync(modules);
  symlinkSync(join(source, "node_modules/vite"), join(modules, "vite"), "dir");
  const bin = join(root, "fake-bin");
  const pnpm = join(bin, "pnpm");
  // This executable replaces only tsc/vite/cap in tests. The existing build/sync
  // scripts themselves execute as real, bounded Node subprocesses with clean env.
  put(
    pnpm,
    `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const root = ${JSON.stringify(root)};
const stage = args[1] === "tsc" ? "tsc" : args[1] === "vite" ? "vite" : "cap";
fs.appendFileSync(path.join(root, "commands.jsonl"), JSON.stringify({args, cwd:process.cwd(), env:process.env}) + "\\n");
if (fs.existsSync(path.join(root, "fail-" + stage))) process.exit(37);
if (stage === "vite") {
  if (args.join(" ") !== "exec vite build --mode production --outDir dist/ios/production") process.exit(39);
  const dist = path.join(process.cwd(), "dist/ios/production");
  fs.mkdirSync(dist, {recursive:true});
  fs.writeFileSync(path.join(dist,"index.html"),"<html>synthetic iOS build</html>");
  fs.writeFileSync(path.join(dist,"asset.js"),"// fixture");
}
if (stage === "cap") {
  if (args.join(" ") !== "exec cap sync ios") process.exit(39);
  const dest = path.join(process.cwd(), "ios/App/App/public");
  fs.cpSync(path.join(process.cwd(), "dist/ios/production"),dest,{recursive:true});
  fs.writeFileSync(path.join(process.cwd(),"ios/App/App/capacitor.config.json"),JSON.stringify({webDir:"dist/ios/production"}));
}
`,
  );
  chmodSync(pnpm, 0o755);
  const plan = {
    root,
    app,
    cache,
    project,
    stage: join(cache, "web-input"),
    derived: join(cache, "derived-data"),
    packages: join(cache, "source-packages"),
    xcode: "/fixture/xcodebuild",
    node: process.execPath,
    env: { ...PUBLIC_CONFIG, HOME: process.env.HOME, PATH: `${bin}:/usr/bin:/bin` },
  };
  const calls = [];
  const run = async (command, args, options) => {
    calls.push({ command, args, options });
    if (command === "/usr/bin/git") return { status: 0, stdout: files.join("\0") + "\0" };
    if (command === "pnpm") return { status: 0, stdout: "10.26.0\n" };
    if (command === plan.node) return runBounded(command, args, options);
    if (command === "/usr/bin/plutil") return { status: 0, stdout: JSON.stringify(plist) };
    if (command === "/usr/bin/curl") {
      const artifact = testArtifacts.find((entry) => args.at(-1).endsWith(`/${entry.id}`));
      assert.ok(artifact);
      assert.equal(args[0], "--disable");
      assert.equal(args[args.indexOf("--retry") + 1], "3");
      assert.equal(args[args.indexOf("--retry-max-time") + 1], "240");
      assert.ok(!args.includes("--retry-all-errors"));
      assert.ok(args.includes("Accept: application/octet-stream"));
      put(args[args.indexOf("--output") + 1], artifactBytes(artifact.name));
      return { status: 0 };
    }
    assert.equal(command, plan.xcode);
    if (args.length === 1) return { status: 0, stdout: "Xcode 26.0.1\nBuild version 17A400\n" };
    if (args[0] === "-version") return { status: 0, stdout: "26.0\n" };
    if (args[0] === "-resolvePackageDependencies") {
      for (const artifact of testArtifacts)
        assert.deepEqual(
          readFileSync(cachedArtifact(plan, artifact.name)),
          artifactBytes(artifact.name),
        );
      mkdirSync(plan.packages, { recursive: true });
      return { status: 0 };
    }
    assert.equal(args[0], "build");
    const built = join(plan.derived, "Build/Products/Release-iphonesimulator/App.app");
    put(join(built, "App"), macho());
    chmodSync(join(built, "App"), 0o755);
    put(join(built, "Info.plist"), "synthetic binary plist placeholder");
    cpSync(join(plan.app, "dist/ios/production"), join(built, "public"), { recursive: true });
    return { status: 0 };
  };
  return { root, plan, files, calls, run };
}
const prepare = (f) => executeIos(f.plan, "prepare", { run: f.run });
const build = (f, run = f.run) => executeIos(f.plan, "build", { run });

function assertSimulatorArchitecture(args) {
  assert.equal(
    args.some((arg) => arg === "-arch" || arg.startsWith("-arch=")),
    false,
    "generic Simulator destination must not also specify -arch",
  );
  assert.deepEqual(
    args.filter((arg) => arg.startsWith("ARCHS=")),
    ["ARCHS=arm64"],
  );
  assert.deepEqual(
    args.filter((arg) => arg.startsWith("ONLY_ACTIVE_ARCH=")),
    ["ONLY_ACTIVE_ARCH=NO"],
  );
}

function assertPackageCachePolicy(plan, args) {
  assert.equal(args.includes("-disablePackageRepositoryCache"), false);
  assert.equal(args[args.indexOf("-packageCachePath") + 1], join(plan.cache, "package-cache"));
  assert.equal(args[args.indexOf("-clonedSourcePackagesDirPath") + 1], plan.packages);
}

test("fixed public assets bind the exact 8.5.0 manifest hashes and cache keys", () => {
  assert.deepEqual(
    PINNED_ARTIFACTS.map(({ name, id, size, sha256 }) => [name, id, size, sha256]),
    [
      [
        "Capacitor",
        496864201,
        6605675,
        "357220fe6dad73cb78bc1dc83e16e89d59c3d7dac8f9b17545a5be64bba25130",
      ],
      [
        "Cordova",
        496864200,
        1842453,
        "a3dc72b5a559948d548f0ee2926b989492acc1023a0c86a1bf85477587f83a10",
      ],
    ],
  );
});

for (const defect of ["http", "checksum", "size", "missing"])
  test(`artifact ${defect} failure blocks SPM and preparation receipt`, async (t) => {
    const f = fixture(t);
    const run = async (command, args, options) => {
      if (command !== "/usr/bin/curl") return f.run(command, args, options);
      if (defect === "http") return { status: 22 };
      if (defect === "missing") return { status: 0 };
      const result = await f.run(command, args, options);
      const path = args[args.indexOf("--output") + 1];
      put(
        path,
        defect === "size" ? "HTTP error body" : Buffer.alloc(artifactBytes("Capacitor").length),
      );
      return result;
    };
    await assert.rejects(
      executeIos(f.plan, "prepare", { run }),
      defect === "http" ? rejects("CHILD_FAILED", 22) : undefined,
    );
    assert.equal(
      f.calls.some((call) => call.args[0] === "-resolvePackageDependencies"),
      false,
    );
    assert.equal(existsSync(join(f.plan.cache, "prepared.json")), false);
    assert.equal(existsSync(join(f.plan.cache, "logs/built-not-run.json")), false);
    for (const artifact of testArtifacts)
      assert.equal(existsSync(cachedArtifact(f.plan, artifact.name)), false);
  });

for (const defect of ["existing", "symlink"])
  test(`${defect} artifact cache is refused without downloads or overwrites`, async (t) => {
    const f = fixture(t);
    const directory = join(f.plan.cache, "package-cache/artifacts");
    mkdirSync(dirname(directory), { recursive: true });
    if (defect === "symlink") symlinkSync(tmpdir(), directory, "dir");
    else put(join(directory, "owner.txt"), "retain existing data");
    await assert.rejects(
      prepare(f),
      rejects(defect === "symlink" ? "SYMLINK_FORBIDDEN" : "OUTPUT_ALREADY_EXISTS"),
    );
    assert.equal(
      f.calls.some((call) => call.command === "/usr/bin/curl"),
      false,
    );
    assert.equal(existsSync(join(f.plan.cache, "prepared.json")), false);
    if (defect === "existing")
      assert.equal(readFileSync(join(directory, "owner.txt"), "utf8"), "retain existing data");
  });

test("changed artifact cache blocks build before web or native compilation", async (t) => {
  const f = fixture(t);
  await prepare(f);
  put(cachedArtifact(f.plan, "Cordova"), Buffer.alloc(artifactBytes("Cordova").length));
  await assert.rejects(build(f), rejects("ARTIFACT_CHECKSUM_INVALID"));
  assert.equal(
    f.calls.some((call) => call.command === f.plan.node || call.args[0] === "build"),
    false,
  );
  assert.equal(existsSync(join(f.plan.cache, "logs/built-not-run.json")), false);
});

test("production checksum defaults reject synthetic archives", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    executePinnedIos(f.plan, "prepare", { run: f.run }),
    rejects("ARTIFACT_SIZE_INVALID"),
  );
  assert.equal(existsSync(join(f.plan.cache, "prepared.json")), false);
});

test("real build/sync entrypoints consume fixed production configuration before native compile", async (t) => {
  const f = fixture(t);
  await prepare(f);
  const result = await build(f);
  assert.equal(result.stage, "ios-simulator-built-not-run");
  assert.match(result.binarySha256, /^[0-9a-f]{64}$/u);
  assert.equal(existsSync(join(f.plan.stage, ".env.production")), false);
  assert.equal(existsSync(join(f.plan.app, "dist/web")), false);
  const actual = readFileSync(join(f.root, "commands.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.deepEqual(
    actual.map((call) => call.args),
    [
      ["exec", "tsc", "-p", "tsconfig.json", "--noEmit"],
      ["exec", "vite", "build", "--mode", "production", "--outDir", "dist/ios/production"],
      ["exec", "cap", "sync", "ios"],
    ],
  );
  for (const call of actual) {
    assert.equal(call.env.VITE_DEV_AUTH_TOKEN, undefined);
    for (const [key, value] of Object.entries(PUBLIC_CONFIG)) assert.equal(call.env[key], value);
  }
  const sync = f.calls.findIndex(
    (call) => call.args[0] === join(f.plan.app, "scripts/sync-ios.mjs"),
  );
  assert.ok(sync > 0);
  assert.ok(f.calls.findIndex((call) => call.args[0] === "build") > sync);
  for (const action of ["-resolvePackageDependencies", "build"]) {
    const call = f.calls.find((call) => call.command === f.plan.xcode && call.args[0] === action);
    assert.ok(call, `${action} must execute with the planned architecture settings`);
    assertSimulatorArchitecture(call.args);
    assertPackageCachePolicy(f.plan, call.args);
  }
  const manifest = JSON.parse(
    readFileSync(join(f.plan.app, "dist/ios/production/build-manifest.json")),
  );
  assert.equal(manifest.platform, "ios");
  assert.equal(manifest.mode, "production");
  assert.equal(manifest.authMode, "oidc");
  assert.equal(manifest.apiOrigin, PUBLIC_CONFIG.VITE_API_BASE_URL);
  assert.equal(manifest.success, true);
});

test("Xcode plans pin project, generic simulator, isolated caches, lock policy and no signing", () => {
  const plan = {
    project: "/lane/project",
    cache: "/lane/cache",
    derived: "/lane/dd",
    packages: "/lane/spm",
  };
  for (const prepare of [false, true]) {
    const args = xcodeArgs(plan, prepare);
    for (const value of [
      "App",
      "Release",
      "generic/platform=iOS Simulator",
      "iphonesimulator",
      "ARCHS=arm64",
      "ONLY_ACTIVE_ARCH=NO",
      "-disableAutomaticPackageResolution",
      "-onlyUsePackageVersionsFromResolvedFile",
      "-skipPackageUpdates",
      "CODE_SIGNING_ALLOWED=NO",
      "CODE_SIGNING_REQUIRED=NO",
      "CODE_SIGN_IDENTITY=",
    ])
      assert.ok(args.includes(value), value);
    assertSimulatorArchitecture(args);
    assertPackageCachePolicy(plan, args);
    assert.equal(
      args[args.indexOf("-derivedDataPath") + 1],
      prepare ? "/lane/cache/prepare-derived-data" : plan.derived,
    );
    assert.equal(args[args.indexOf("-clonedSourcePackagesDirPath") + 1], plan.packages);
    assert.doesNotMatch(
      args.join(" "),
      /allowProvisioning|archive|test-without-building|launch|boot/u,
    );
  }
});

for (const stage of ["tsc", "vite", "cap"])
  test(`real ${stage} failure prevents compile and success receipt`, async (t) => {
    const f = fixture(t);
    await prepare(f);
    put(join(f.root, `fail-${stage}`), "");
    await assert.rejects(build(f), rejects("CHILD_FAILED", 1));
    // Existing build/sync CLIs return 1 for their failed nested command; do not invent 37.
    assert.equal(
      f.calls.some((call) => call.args[0] === "build"),
      false,
    );
    assert.equal(existsSync(join(f.plan.cache, "logs/built-not-run.json")), false);
  });

for (const stage of ["spm", "compile"])
  test(`actual exit 37 at ${stage} is preserved`, async (t) => {
    const f = fixture(t);
    if (stage === "compile") await prepare(f);
    const run = (command, args, options) =>
      args[0] === (stage === "spm" ? "-resolvePackageDependencies" : "build")
        ? runBounded(
            process.execPath,
            [
              "-e",
              "process.stdout.write('before failure');process.stderr.write('stderr failure');process.exitCode=37",
            ],
            options,
          )
        : f.run(command, args, options);
    await assert.rejects(
      executeIos(f.plan, stage === "spm" ? "prepare" : "build", { run }),
      rejects("CHILD_FAILED", 37),
    );
    const log = join(f.plan.cache, "logs", stage === "spm" ? "prepare-spm" : "build-compile");
    assert.equal(readFileSync(`${log}.stdout.log`, "utf8"), "before failure");
    assert.equal(readFileSync(`${log}.stderr.log`, "utf8"), "stderr failure");
    assert.equal(existsSync(join(f.plan.cache, "logs/built-not-run.json")), false);
  });

test("bounded child preserves large dual streams and kills a real timed out child", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "ios-bound-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const options = { cwd: root, env: {}, timeout: 5000, log: join(root, "large") };
  // Isolate console observation from node:test's reporter. A regression that echoes
  // the large streams exceeds this small outer buffer instead of flooding CI logs.
  const isolatedRun = (args, childOptions) =>
    spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { runBounded } from ${JSON.stringify(new URL("./ios-ci.mjs", import.meta.url).href)};
const result = await runBounded(process.execPath, ${JSON.stringify(args)}, ${JSON.stringify(childOptions)});
if (result.status !== 0 || result.errorCode || result.signal || result.ioFailed) process.exitCode = 1;`,
      ],
      { cwd: root, env: {}, encoding: "utf8", timeout: 10000, maxBuffer: 64 * 1024 },
    );
  const result = isolatedRun(
    ["-e", "process.stdout.write('a'.repeat(1200000));process.stderr.write('b'.repeat(1200000))"],
    { ...options, echoOutput: false },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  const stdout = readFileSync(`${options.log}.stdout.log`);
  const stderr = readFileSync(`${options.log}.stderr.log`);
  assert.equal(stdout.length, 1200000);
  assert.equal(stderr.length, 1200000);
  assert.ok(stdout.equals(Buffer.alloc(1200000, "a")));
  assert.ok(stderr.equals(Buffer.alloc(1200000, "b")));
  // Omitting echoOutput must preserve the normal build's console and file streams.
  const defaultLog = join(root, "default-echo");
  const defaultEcho = isolatedRun(
    ["-e", "process.stdout.write('default stdout');process.stderr.write('default stderr')"],
    { ...options, log: defaultLog },
  );
  assert.ifError(defaultEcho.error);
  assert.equal(defaultEcho.status, 0);
  assert.equal(defaultEcho.stdout, "default stdout");
  assert.equal(defaultEcho.stderr, "default stderr");
  assert.equal(readFileSync(`${defaultLog}.stdout.log`, "utf8"), defaultEcho.stdout);
  assert.equal(readFileSync(`${defaultLog}.stderr.log`, "utf8"), defaultEcho.stderr);
  const timeout = await runBounded(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    ...options,
    log: join(root, "timeout"),
    timeout: 100,
  });
  assert.equal(timeout.errorCode, "ETIMEDOUT");
  assert.equal(timeout.signal, "SIGKILL");
  const missing = await runBounded(join(root, "missing"), [], {
    ...options,
    log: join(root, "missing"),
  });
  assert.equal(missing.errorCode, "ENOENT");
});

for (const response of [
  { status: null, errorCode: "ETIMEDOUT" },
  { status: null, signal: "SIGTERM" },
  { status: null },
  { status: 0, ioFailed: true },
])
  test(`incomplete compile fails closed: ${JSON.stringify(response)}`, async (t) => {
    const f = fixture(t);
    await prepare(f);
    await assert.rejects(
      build(f, (command, args, options) =>
        args[0] === "build" ? response : f.run(command, args, options),
      ),
      rejects(
        response.errorCode ? "CHILD_TIMEOUT" : "CHILD_INCOMPLETE",
        response.errorCode ? 124 : 70,
      ),
    );
  });

test("zero exit without a new app cannot pass; an old DerivedData tree is refused", async (t) => {
  const f = fixture(t);
  await prepare(f);
  await assert.rejects(
    build(f, (command, args, options) =>
      args[0] === "build" ? { status: 0 } : f.run(command, args, options),
    ),
  );
  assert.equal(existsSync(join(f.plan.cache, "logs/built-not-run.json")), false);
  const g = fixture(t);
  await prepare(g);
  mkdirSync(g.plan.derived);
  await assert.rejects(build(g), rejects("OUTPUT_ALREADY_EXISTS"));
  assert.equal(
    g.calls.some((call) => call.args[0] === "build"),
    false,
  );
});

for (const defect of [
  "manifest",
  "index",
  "web-platform",
  "synced-public",
  "native-config",
  "app-public",
  "app-plist",
  "signed-app",
])
  test(`zero-exit commands with invalid ${defect} never produce success`, async (t) => {
    const f = fixture(t);
    await prepare(f);
    const run = async (command, args, options) => {
      const result = await f.run(command, args, options);
      const dist = join(f.plan.stage, "dist/ios/production");
      if (args[0] === join(f.plan.stage, "scripts/build.mjs")) {
        if (defect === "manifest") rmSync(join(dist, "build-manifest.json"));
        if (defect === "index") rmSync(join(dist, "index.html"));
        if (defect === "web-platform") {
          const path = join(dist, "build-manifest.json");
          const manifest = JSON.parse(readFileSync(path));
          put(path, JSON.stringify({ ...manifest, platform: "web" }));
        }
      }
      if (args[0] === join(f.plan.app, "scripts/sync-ios.mjs")) {
        if (defect === "synced-public")
          put(join(f.plan.app, "ios/App/App/public/index.html"), "bad copy");
        if (defect === "native-config")
          put(
            join(f.plan.app, "ios/App/App/capacitor.config.json"),
            '{"webDir":"dist/web/production"}',
          );
      }
      if (args[0] === "build") {
        const app = join(f.plan.derived, "Build/Products/Release-iphonesimulator/App.app");
        if (defect === "app-public") rmSync(join(app, "public/index.html"));
        if (defect === "app-plist") rmSync(join(app, "Info.plist"));
        if (defect === "signed-app") mkdirSync(join(app, "_CodeSignature"));
      }
      return result;
    };
    await assert.rejects(build(f, run));
    assert.equal(existsSync(join(f.plan.cache, "logs/built-not-run.json")), false);
  });

test("missing preparation, source drift and SPM lock changes block native work", async (t) => {
  const f = fixture(t);
  await assert.rejects(build(f), rejects("PREPARATION_MISSING_OR_STALE"));
  await prepare(f);
  put(join(f.plan.app, "src/index.ts"), "// changed after prepare");
  await assert.rejects(build(f), rejects("PREPARATION_MISSING_OR_STALE"));
  const g = fixture(t);
  await assert.rejects(
    executeIos(g.plan, "prepare", {
      run: (command, args, options) => {
        if (args[0] === "-resolvePackageDependencies")
          put(join(g.plan.app, "ios/App/CapApp-SPM/Package.swift"), "unexpected sync edit");
        return g.run(command, args, options);
      },
    }),
    rejects("SOURCE_OR_LOCK_CHANGED"),
  );
  assert.equal(existsSync(join(g.plan.cache, "prepared.json")), false);
});

test("reject wrong Xcode/SDK/pnpm and unpinned SPM before preparation", async (t) => {
  for (const [match, stdout, code] of [
    [(args) => args.length === 1 && args[0] === "-version", "Xcode 16.4\n", "XCODE_UNSUPPORTED"],
    [(args) => args.includes("SDKVersion"), "18.5\n", "SIMULATOR_SDK_UNSUPPORTED"],
    [(args) => args[0] === "--version", "10.27.0", "PNPM_UNSUPPORTED"],
  ]) {
    const f = fixture(t);
    await assert.rejects(
      executeIos(f.plan, "prepare", {
        run: (command, args, options) =>
          match(args) ? { status: 0, stdout } : f.run(command, args, options),
      }),
      rejects(code),
    );
    assert.equal(
      f.calls.some((call) => call.args[0] === "-resolvePackageDependencies"),
      false,
    );
  }
  const f = fixture(t);
  put(
    join(f.plan.project, "project.xcworkspace/xcshareddata/swiftpm/Package.resolved"),
    '{"version":3,"pins":[]}',
  );
  await assert.rejects(prepare(f), rejects("SPM_LOCK_INVALID"));
});

test("inventory and paths reject dotenv, traversal and symlinked outputs without reading them", (t) => {
  const f = fixture(t);
  for (const path of [
    "apps/vite-app/.env.production",
    "../secret",
    "apps/vite-app/../secret",
    "/tmp/secret",
    "backend/templates/private.json",
  ])
    assert.throws(() => validateInventory([...f.files, path]), rejects("INVENTORY_INVALID"));
  symlinkSync(tmpdir(), join(f.root, "outside"), "dir");
  assert.throws(
    () => safePath(f.root, join(f.root, "outside/result")),
    rejects("SYMLINK_FORBIDDEN"),
  );
  assert.throws(() => safePath(f.root, resolve(f.root, "../escape")), rejects("PATH_OUTSIDE_LANE"));
  assert.throws(() => runBounded(process.execPath, [], { timeout: 0 }), rejects("TIMEOUT_INVALID"));
  assert.throws(
    () => runBounded(process.execPath, [], { timeout: 1, echoOutput: "false" }),
    rejects("OUTPUT_OPTION_INVALID"),
  );
});

test("artifact validators reject device Mach-O, malformed commands and wrong plist identity/platform", () => {
  verifyMachO(macho());
  verifyPlist(plist);
  for (const bytes of [Buffer.alloc(0), Buffer.from("not an executable"), macho(2)])
    assert.throws(() => verifyMachO(bytes));
  const malformed = macho();
  malformed.writeUInt32LE(0xffffffff, 36);
  assert.throws(() => verifyMachO(malformed));
  for (const patch of [
    { CFBundleIdentifier: "other" },
    { CFBundleExecutable: "../other" },
    { DTPlatformName: "iphoneos" },
    { CFBundleSupportedPlatforms: [] },
    { CFBundleSupportedPlatforms: "iPhoneSimulator" },
    { NSMicrophoneUsageDescription: "" },
  ])
    assert.throws(() => verifyPlist({ ...plist, ...patch }), rejects("PLIST_INVALID"));
});

test("CLI rejects arbitrary args before host checks; host never inherits arbitrary env", () => {
  const result = spawnSync(
    process.execPath,
    [join(source, "scripts/ios-ci.mjs"), "--command", "anything"],
    { encoding: "utf8", timeout: 5000, env: {} },
  );
  assert.equal(result.status, 64);
  assert.equal(JSON.parse(result.stderr).code, "ARGUMENTS_FORBIDDEN");
  assert.throws(
    () => createPlan(repo, {}, { platform: "linux", version: "v22.13.1" }),
    rejects("HOST_REQUIRES_MACOS_NODE_22_13_1"),
  );
  if (process.platform === "darwin" && existsSync("/Applications/Xcode.app/Contents/Developer")) {
    const plan = createPlan(
      repo,
      {
        ...process.env,
        VITE_DEV_AUTH_TOKEN: "synthetic",
        NODE_OPTIONS: "--inspect",
        PRIVATE_TOKEN: "synthetic",
        DEVELOPER_DIR: "/untrusted",
      },
      { platform: "darwin", version: "v22.13.1", execPath: process.execPath },
    );
    for (const key of ["NODE_OPTIONS", "PRIVATE_TOKEN", "VITE_DEV_AUTH_TOKEN"])
      assert.equal(plan.env[key], undefined);
    assert.notEqual(plan.env.DEVELOPER_DIR, "/untrusted");
  }
});

test("workflow preserves original jobs, fixed eight macOS Node files and required iOS gate", () => {
  const workflow = readFileSync(join(repo, ".github/workflows/ci.yml"), "utf8");
  for (const name of ["test-frontend", "test-backend", "test-macos-probe", "test-ios-build"])
    assert.ok(workflow.includes(`    name: ${name}\n`));
  const job = workflow.split("\n  test-ios-build:\n")[1].split("\n  ci:\n")[0];
  for (const text of [
    "runs-on: macos-15",
    "contents: read",
    'node-version: "22.13.1"',
    "version: 10.26.0",
    "persist-credentials: false",
    "timeout-minutes: 45",
    "pnpm install --frozen-lockfile",
    "node apps/vite-app/scripts/ios-ci.mjs prepare",
    "node apps/vite-app/scripts/ios-ci.mjs\n",
    "node --test --test-timeout=30000 apps/vite-app/scripts/ios-ci-test.mjs",
  ])
    assert.ok(job.includes(text), text);
  assert.doesNotMatch(
    job,
    /continue-on-error|secrets\.|contents: write|id-token: write|provisioning/iu,
  );
  const ci = readFileSync(join(repo, "tools/macos-m1-native-probe/scripts/ci.mjs"), "utf8");
  for (const file of [
    "build",
    "media-build",
    "auth-ui",
    "media",
    "livekit-media",
    "media-ui",
    "main",
    "ci",
  ])
    assert.ok(ci.includes(`scripts/${file}.test.mjs`));
  assert.match(
    workflow,
    /needs: \[test-frontend, test-backend, test-macos-probe, test-ios-build\]/u,
  );
});

test("real aggregate shell requires all four successes including iOS", () => {
  const workflow = readFileSync(join(repo, ".github/workflows/ci.yml"), "utf8");
  const aggregate = workflow.split("\n  ci:\n")[1];
  assert.ok(aggregate.includes("if: always()"));
  const keys = ["FRONTEND_RESULT", "BACKEND_RESULT", "MACOS_PROBE_RESULT", "IOS_BUILD_RESULT"];
  for (const [index, name] of [
    "test-frontend",
    "test-backend",
    "test-macos-probe",
    "test-ios-build",
  ].entries())
    assert.ok(aggregate.includes(`${keys[index]}: \u0024{{ needs.${name}.result }}`));
  const script = aggregate
    .split("        run: |\n")[1]
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
  for (const key of keys)
    for (const status of ["success", "failure", "skipped", "cancelled", ""]) {
      const result = spawnSync("/bin/bash", ["-e", "-c", script], {
        encoding: "utf8",
        timeout: 1000,
        env: { ...Object.fromEntries(keys.map((name) => [name, "success"])), [key]: status },
      });
      assert.equal(result.status, status === "success" ? 0 : 1, `${key}=${status}`);
    }
});
