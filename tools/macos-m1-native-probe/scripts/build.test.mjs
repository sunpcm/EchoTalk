import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { BINARY, IDENTIFIER, INPUTS, NODE, createPlan } from "./policy.mjs";
import { executeBuild, runChild } from "./build.mjs";
import { executeAuthTests } from "./auth-test.mjs";

const source = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary =
  "/Users/sunpcm/code/EchoTalk/.review/reports/macos-m1-auth-media-20261101/implementer/r3/test-tmp";
const host = { platform: "darwin", arch: "arm64", version: "v22.13.1", execPath: NODE };
const env = { HOME: process.env.HOME };
const failed =
  (code, exitCode = 78) =>
  (error) => {
    assert.equal(error.code, code);
    assert.equal(error.exitCode, exitCode);
    return true;
  };

function fixture(t) {
  mkdirSync(temporary, { recursive: true });
  const root = mkdtempSync(join(temporary, "case-"));
  t.after(() => {
    assert.ok(root.startsWith(temporary + "/case-"));
    rmSync(root, { recursive: true, force: true });
  });
  const project = join(root, "lane/tools/macos-m1-native-probe");
  mkdirSync(project, { recursive: true });
  // Copy frozen inputs, excluding native build outputs (gen/permissions/target).
  // The dependency owner may have compiled this source before Node regression.
  for (const path of [...INPUTS, "scripts/build.test.mjs", "scripts/auth-ui.test.mjs"]) {
    mkdirSync(dirname(join(project, path)), { recursive: true });
    cpSync(join(source, path), join(project, path));
  }
  const cliDir = join(project, "node_modules/@tauri-apps/cli");
  mkdirSync(cliDir, { recursive: true });
  writeFileSync(
    join(cliDir, "package.json"),
    JSON.stringify({ name: "@tauri-apps/cli", version: "2.12.4" }),
  );
  writeFileSync(
    join(cliDir, "tauri.js"),
    "throw new Error('TEST substitute must never be executed');\n",
  );
  // Deliberately synthetic TEST fixtures only, not candidate dependency locks.
  writeFileSync(
    join(project, "package-lock.json"),
    JSON.stringify({
      lockfileVersion: 3,
      packages: { "node_modules/@tauri-apps/cli": { version: "2.12.4" } },
    }),
  );
  writeFileSync(
    join(project, "src-tauri/Cargo.lock"),
    "# TEST fixture, not a dependency resolution\n",
  );
  const plan = createPlan(project, env, host);
  return { root, project, plan };
}

function writeBundle(
  plan,
  {
    identifier = IDENTIFIER,
    executable = BINARY,
    minimum = "14.0",
    magic = 0xfeedfacf,
    architecture = 0x0100000c,
  } = {},
) {
  mkdirSync(join(plan.bundle, "Contents/MacOS"), { recursive: true });
  writeFileSync(
    join(plan.bundle, "Contents/Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${identifier}</string><key>CFBundleExecutable</key><string>${executable}</string><key>CFBundleShortVersionString</key><string>0.0.0</string><key>LSMinimumSystemVersion</key><string>${minimum}</string><key>CFBundleURLTypes</key><array><dict><key>CFBundleURLSchemes</key><array><string>echotalk-m1</string></array></dict></array></dict></plist>`,
  );
  const header = Buffer.alloc(32);
  header.writeUInt32LE(magic, 0);
  header.writeUInt32LE(architecture, 4);
  header.writeUInt32LE(2, 12);
  // A synthetic header for STRUCTURE tests, not a runnable Mach-O program.
  writeFileSync(join(plan.bundle, "Contents/MacOS", BINARY), header, { mode: 0o755 });
}

function runner(f, build = () => writeBundle(f.plan)) {
  const calls = [];
  const records = [];
  const run = (command, args, options) => {
    calls.push({ command, args, options });
    if (command === "/usr/bin/plutil") return runChild(command, args, options);
    assert.equal(command, NODE);
    assert.equal(args[0], f.plan.cli);
    if (args[1] === "--version") return { status: 0, stdout: "tauri-cli 2.12.4\n" };
    if (args.includes("--help"))
      return {
        status: 0,
        stdout:
          "--debug --target --bundles --no-sign --ci\n[ARGS]... Additional args for cargo runner",
      };
    const result = build();
    return result ?? { status: 0, stdout: "" };
  };
  return { calls, records, run, emit: (record) => records.push(record) };
}

test("fixed build really advances through CLI contract, build, plist and artifact checks without executing app", (t) => {
  const f = fixture(t);
  const r = runner(f);
  const result = executeBuild(f.plan, r);
  assert.equal(result.stage, "built-not-run");
  assert.match(result.executableSha256, /^[a-f0-9]{64}$/u);
  assert.equal(r.calls.length, 4);
  assert.deepEqual(r.calls[2].args.slice(1), [
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
  ]);
  assert.equal(r.calls[2].options.capture, false);
  assert.ok(r.calls.every((call) => call.command === NODE || call.command === "/usr/bin/plutil"));
  assert.equal(r.calls[2].options.env.CARGO_TARGET_DIR, f.plan.target);
  assert.equal(existsSync(f.plan.env.CARGO_HOME), true);
  assert.equal(existsSync(f.plan.env.npm_config_cache), true);
  assert.equal(readFileSync(f.plan.env.npm_config_userconfig, "utf8"), "");
  assert.equal(readFileSync(f.plan.env.npm_config_globalconfig, "utf8"), "");
});

test("child environment keeps HOME but drops credentials, proxy, sign, compiler and npm global input", (t) => {
  const f = fixture(t);
  const hostile = {
    ...env,
    PRIVATE_TOKEN: "do-not-log",
    APPLE_ID: "do-not-log",
    APPLE_SIGNING_IDENTITY: "do-not-log",
    TAURI_SIGNING_PRIVATE_KEY: "do-not-log",
    HTTPS_PROXY: "do-not-log",
    DYLD_LIBRARY_PATH: "do-not-log",
    CC: "do-not-log",
    LDFLAGS: "do-not-log",
    NPM_CONFIG_USERCONFIG: "/private/user/npmrc",
    npm_config_registry: "https://private.invalid",
    PATH: "/evil",
    RUSTUP_HOME: "/private/rustup",
  };
  const plan = createPlan(f.project, hostile, host);
  const r = runner({ ...f, plan });
  executeBuild(plan, r);
  for (const call of r.calls) {
    assert.equal(call.options.env.HOME, env.HOME);
    assert.equal(call.options.env.CARGO_BUILD_JOBS, "2");
    assert.equal(call.options.env.CARGO_NET_OFFLINE, "true");
    assert.equal(call.options.env.CARGO_INCREMENTAL, "0");
    assert.equal(call.options.env.npm_config_userconfig, join(plan.cache, "empty-user.npmrc"));
    assert.equal(call.options.env.npm_config_globalconfig, join(plan.cache, "empty-global.npmrc"));
    assert.notEqual(
      call.options.env.npm_config_userconfig,
      call.options.env.npm_config_globalconfig,
    );
    for (const key of Object.keys(hostile).filter((key) => !["HOME", "PATH"].includes(key)))
      assert.equal(call.options.env[key], undefined, key);
    assert.equal(Object.values(call.options.env).includes("do-not-log"), false);
  }
  assert.equal(JSON.stringify(r.records).includes("do-not-log"), false);
});

for (const key of [
  "TAURI_CONFIG",
  "CARGO_HOME",
  "CARGO_TARGET_DIR",
  "CARGO_BUILD_TARGET",
  "RUSTFLAGS",
  "NODE_OPTIONS",
  "RUSTC_WRAPPER",
]) {
  test(`${key} override is rejected before any child or directory creation`, (t) => {
    const f = fixture(t);
    assert.throws(
      () => createPlan(f.project, { ...env, [key]: "/not-authorized" }, host),
      failed("ENV_OVERRIDE_FORBIDDEN"),
    );
    assert.equal(existsSync(f.plan.cache), false);
  });
}

for (const stage of [0, 1, 2]) {
  test(`nonzero from child stage ${stage} propagates exactly and blocks all later stages`, (t) => {
    const f = fixture(t);
    const r = runner(f);
    const run = r.run;
    let count = 0;
    r.run = (...args) =>
      count++ === stage
        ? { status: 23, stdout: "private-token must not be printed" }
        : run(...args);
    assert.throws(() => executeBuild(f.plan, r), failed("CHILD_FAILED", 23));
    assert.equal(count, stage + 1);
    assert.equal(
      r.records.some((record) => record.stage === "built-not-run"),
      false,
    );
    assert.equal(JSON.stringify(r.records).includes("private-token"), false);
    assert.equal(existsSync(f.plan.bundle), false);
  });
}

for (const response of [
  { status: null, signal: "SIGKILL", errorCode: "ETIMEDOUT" },
  { status: null, errorCode: "ENOENT" },
  { status: null, signal: "SIGTERM" },
]) {
  test(`incomplete child ${response.errorCode ?? response.signal} never becomes a successful exit`, (t) => {
    const f = fixture(t);
    let calls = 0;
    assert.throws(
      () =>
        executeBuild(f.plan, {
          run: () => {
            calls++;
            return response;
          },
          emit() {},
        }),
      failed("CHILD_INCOMPLETE", response.errorCode === "ETIMEDOUT" ? 124 : 70),
    );
    assert.equal(calls, 1);
  });
}

test("missing locks refuse build before CLI, with no install fallback", (t) => {
  const f = fixture(t);
  rmSync(join(f.project, "src-tauri/Cargo.lock"));
  let calls = 0;
  assert.throws(
    () =>
      executeBuild(f.plan, {
        run() {
          calls++;
        },
        emit() {},
      }),
    failed("LOCKS_MISSING"),
  );
  assert.equal(calls, 0);
  assert.equal(existsSync(f.plan.cache), false);
});

test("mismatched installed CLI or unsupported actual help prevents build", (t) => {
  const f = fixture(t);
  const r = runner(f);
  writeFileSync(
    join(f.project, "node_modules/@tauri-apps/cli/package.json"),
    JSON.stringify({ name: "@tauri-apps/cli", version: "3.0.0" }),
  );
  assert.throws(() => executeBuild(f.plan, r), failed("DEPENDENCY_INVALID"));
  assert.equal(r.calls.length, 0);
  writeFileSync(
    join(f.project, "node_modules/@tauri-apps/cli/package.json"),
    JSON.stringify({ name: "@tauri-apps/cli", version: "2.12.4" }),
  );
  const run = r.run;
  r.run = (command, args, options) =>
    args.includes("--help")
      ? { status: 0, stdout: "--debug --bundles app; no unsigned support" }
      : run(command, args, options);
  assert.throws(() => executeBuild(f.plan, r), failed("CLI_HELP_INVALID"));
  assert.equal(existsSync(f.plan.cache), false);
});

test("preexisting nonempty isolated npm config is not read, overwritten or passed to build", (t) => {
  const f = fixture(t);
  mkdirSync(f.plan.cache, { recursive: true });
  writeFileSync(f.plan.env.npm_config_userconfig, "private marker");
  const r = runner(f);
  assert.throws(() => executeBuild(f.plan, r), failed("NPM_CONFIG_NOT_EMPTY"));
  assert.equal(r.calls.length, 2);
  assert.equal(readFileSync(f.plan.env.npm_config_userconfig, "utf8"), "private marker");
  assert.equal(JSON.stringify(r.records).includes("private marker"), false);
});

test("version response drift stops before help/build", (t) => {
  const f = fixture(t);
  let calls = 0;
  assert.throws(
    () =>
      executeBuild(f.plan, {
        run() {
          calls++;
          return { status: 0, stdout: "tauri-cli 3.0.0" };
        },
        emit() {},
      }),
    failed("CLI_VERSION_INVALID"),
  );
  assert.equal(calls, 1);
});

test("symlinked cache or artifact never writes outside the fixed probe tree", (t) => {
  const f = fixture(t);
  const outside = join(f.root, "outside");
  mkdirSync(outside);
  mkdirSync(dirname(f.plan.cache), { recursive: true });
  symlinkSync(outside, f.plan.cache);
  assert.throws(() => createPlan(f.project, env, host), failed("PATH_SYMLINK"));
  assert.deepEqual(readdirSync(outside), []);
  rmSync(f.plan.cache);
  mkdirSync(dirname(f.plan.bundle), { recursive: true });
  symlinkSync(outside, f.plan.bundle);
  const r = runner(f);
  assert.throws(() => executeBuild(f.plan, r), failed("PATH_SYMLINK"));
  assert.equal(r.calls.length, 2);
  assert.deepEqual(readdirSync(outside), []);
});

test("non-canonical project path and unsupported hosts fail before execution", (t) => {
  const f = fixture(t);
  assert.throws(
    () => createPlan(f.project + "/../macos-m1-native-probe", env, host),
    failed("PATH_INVALID"),
  );
  for (const patch of [
    { platform: "linux" },
    { arch: "x64" },
    { version: "v26.0.0" },
    { execPath: "/usr/bin/node" },
  ])
    assert.throws(
      () => createPlan(f.project, env, { ...host, ...patch }),
      failed("HOST_UNSUPPORTED"),
    );
});

test("ancestor Cargo config and alternate Tauri config are rejected without running hooks", (t) => {
  const f = fixture(t);
  mkdirSync(join(f.root, "lane/.cargo"));
  writeFileSync(join(f.root, "lane/.cargo/config.toml"), "DO NOT READ private settings");
  assert.throws(() => createPlan(f.project, env, host), failed("CARGO_CONFIG_FORBIDDEN"));
  rmSync(join(f.root, "lane/.cargo"), { recursive: true });
  writeFileSync(
    join(f.project, "src-tauri/tauri.macos.conf.json"),
    JSON.stringify({ build: { beforeBuildCommand: "not allowed" } }),
  );
  const r = runner(f);
  assert.throws(() => executeBuild(f.plan, r), failed("CONFIG_OVERLAY_FORBIDDEN"));
  assert.equal(r.calls.length, 0);
});

for (const mutate of [
  (c) => {
    c.build.beforeBuildCommand = "do-not-execute";
  },
  (c) => {
    c.app.windows[0].url = "https://remote.invalid";
  },
  (c) => {
    c.app.security.capabilities[0].permissions = ["core:default"];
  },
  (c) => {
    c.app.security.csp = "default-src *; connect-src *";
  },
  (c) => {
    c.app.security.csp = "connect-src *; " + c.app.security.csp;
  },
  (c) => {
    c.app.security.csp += "; script-src-elem *";
  },
]) {
  test("unsafe hooks, remote window, IPC permission or CSP prevents every child side effect", (t) => {
    const f = fixture(t);
    const path = join(f.project, "src-tauri/tauri.conf.json");
    const c = JSON.parse(readFileSync(path));
    mutate(c);
    writeFileSync(path, JSON.stringify(c));
    const r = runner(f);
    assert.throws(() => executeBuild(f.plan, r), failed("CONFIG_FORBIDDEN"));
    assert.equal(r.calls.length, 0);
  });
}

test("an old app is preserved but never counted when build returns zero without new output", (t) => {
  const f = fixture(t);
  writeBundle(f.plan);
  const old = readFileSync(join(f.plan.bundle, "Contents/MacOS", BINARY));
  const r = runner(f, () => ({ status: 0, stdout: "" }));
  assert.throws(() => executeBuild(f.plan, r), failed("ARTIFACT_INVALID"));
  assert.equal(existsSync(f.plan.bundle), false);
  const previous = readdirSync(dirname(f.plan.bundle));
  assert.equal(previous.length, 1);
  assert.match(previous[0], /^\.previous-.*\.app$/u);
  assert.deepEqual(
    readFileSync(join(dirname(f.plan.bundle), previous[0], "Contents/MacOS", BINARY)),
    old,
  );
  assert.equal(
    r.records.some((record) => record.stage === "built-not-run"),
    false,
  );
});

test("symlinked frontend assets are rejected before the CLI can read an outside tree", (t) => {
  const f = fixture(t);
  const outside = join(f.root, "outside-web");
  mkdirSync(outside);
  writeFileSync(join(outside, "index.html"), "outside marker");
  rmSync(join(f.project, "web"), { recursive: true });
  symlinkSync(outside, join(f.project, "web"));
  const r = runner(f);
  assert.throws(() => executeBuild(f.plan, r), failed("PATH_SYMLINK"));
  assert.equal(r.calls.length, 0);
  assert.equal(readFileSync(join(outside, "index.html"), "utf8"), "outside marker");
});

for (const artifact of [
  { identifier: "org.other" },
  { executable: "other" },
  { minimum: "13.0" },
  { magic: 0 },
  { architecture: 0x01000007 },
]) {
  test("fresh malformed bundle metadata or binary is rejected instead of claiming build success", (t) => {
    const f = fixture(t);
    const r = runner(f, () => writeBundle(f.plan, artifact));
    assert.throws(() => executeBuild(f.plan, r), failed("ARTIFACT_INVALID"));
    assert.equal(
      r.records.some((record) => record.stage === "built-not-run"),
      false,
    );
  });
}

test("a fresh non-executable artifact is rejected", (t) => {
  const f = fixture(t);
  const r = runner(f, () => {
    writeBundle(f.plan);
    chmodSync(join(f.plan.bundle, "Contents/MacOS", BINARY), 0o644);
  });
  assert.throws(() => executeBuild(f.plan, r), failed("ARTIFACT_INVALID"));
});

test("real Node subprocess status is preserved by the runner without native CLI execution", () => {
  const result = runChild(NODE, ["-e", "process.exitCode = 37"], {
    cwd: source,
    env: { HOME: env.HOME, PATH: "/usr/bin:/bin" },
    capture: true,
    timeout: 1000,
  });
  assert.equal(result.status, 37);
  assert.equal(result.signal, null);
});

test("real entry rejects arbitrary arguments before locks or a builder can run", () => {
  const child = spawnSync(
    NODE,
    [join(source, "scripts/build.mjs"), "--config", "/not-authorized"],
    { env: { HOME: env.HOME, PATH: "/usr/bin:/bin" }, encoding: "utf8", timeout: 2000 },
  );
  assert.equal(child.status, 64);
  assert.equal(child.stdout, "");
  assert.deepEqual(JSON.parse(child.stderr), {
    stage: "failed",
    code: "ARGUMENTS_FORBIDDEN",
    exit: 64,
  });
});

test("real runner bounds a Node-only timeout and records the signal rather than a fabricated child exit", () => {
  const result = runChild(NODE, ["-e", "setInterval(() => {}, 1000)"], {
    cwd: source,
    env: { HOME: env.HOME, PATH: "/usr/bin:/bin" },
    capture: false,
    timeout: 150,
  });
  assert.equal(result.status, null);
  assert.equal(result.signal, "SIGKILL");
  assert.equal(result.errorCode, "ETIMEDOUT");
});

test("real entry in an isolated fixture with missing locks fails closed, never executing its throwing CLI substitute", (t) => {
  const f = fixture(t);
  mkdirSync(join(f.project, "scripts"), { recursive: true });
  for (const name of ["build.mjs", "policy.mjs"])
    cpSync(join(source, "scripts", name), join(f.project, "scripts", name));
  rmSync(join(f.project, "package-lock.json"));
  const child = spawnSync(NODE, [join(f.project, "scripts/build.mjs")], {
    env: { HOME: env.HOME, PATH: "/usr/bin:/bin" },
    encoding: "utf8",
    timeout: 2000,
  });
  assert.equal(child.status, 78);
  assert.equal(child.stdout, "");
  assert.deepEqual(JSON.parse(child.stderr), { stage: "failed", code: "LOCKS_MISSING", exit: 78 });
  assert.equal(existsSync(f.plan.cache), false);
});

test("r1 real build branch preserves both complete large streams and exit37, with no post-build stage", (t) => {
  const f = fixture(t);
  mkdirSync(join(f.project, "scripts"), { recursive: true });
  for (const name of ["build.mjs", "policy.mjs"])
    cpSync(join(source, "scripts", name), join(f.project, "scripts", name));
  const stdout = "R1_BUILD_OUT_BEGIN\n" + "O".repeat(1024 * 1024 + 123) + "R1_BUILD_OUT_END";
  const stderr = "R1_BUILD_ERR_BEGIN\n" + "E".repeat(1024 * 1024 + 231) + "R1_BUILD_ERR_END";
  writeFileSync(
    f.plan.cli,
    `
    const args = process.argv.slice(2);
    if (args.includes('--version')) process.stdout.write('tauri-cli 2.12.4\\n');
    else if (args.includes('--help')) process.stdout.write('--debug --target --bundles --no-sign --ci [ARGS] cargo runner\\n');
    else {
      process.stdout.write('R1_BUILD_OUT_BEGIN\\n' + 'O'.repeat(1024 * 1024 + 123) + 'R1_BUILD_OUT_END');
      process.stderr.write('R1_BUILD_ERR_BEGIN\\n' + 'E'.repeat(1024 * 1024 + 231) + 'R1_BUILD_ERR_END');
      process.exitCode = 37;
    }
  `,
  );
  const child = spawnSync(NODE, [join(f.project, "scripts/build.mjs")], {
    env: { HOME: env.HOME, PATH: "/usr/bin:/bin" },
    encoding: "utf8",
    timeout: 3000,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(child.status, 37);
  assert.equal(
    child.stdout.includes(stdout),
    true,
    "complete build stdout reaches outer pipe above 1MiB",
  );
  assert.equal(
    child.stderr.includes(stderr),
    true,
    "complete build stderr reaches outer pipe above 1MiB",
  );
  const records = child.stdout
    .split("\n")
    .filter((line) => line.startsWith('{"stage":'))
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    records.map((record) => record.stage),
    ["cli-version", "cli-help", "tauri-build"],
  );
  assert.deepEqual(records.at(-1), {
    stage: "tauri-build",
    childExit: 37,
    signal: null,
    timedOut: false,
  });
  const failure = child.stderr.split("\n").find((line) => line.startsWith('{"stage":'));
  assert.deepEqual(JSON.parse(failure), { stage: "failed", code: "CHILD_FAILED", exit: 37 });
  assert.equal(existsSync(f.plan.bundle), false);
});

test("r1 real captured control-step failure forwards complete stdout/stderr without maxBuffer loss", () => {
  const output = "R1_CAPTURE_OUT_BEGIN\n" + "C".repeat(1024 * 1024 + 17) + "R1_CAPTURE_OUT_END";
  const diagnostic = "R1_CAPTURE_ERR_BEGIN\n" + "D".repeat(1024 * 1024 + 19) + "R1_CAPTURE_ERR_END";
  const code = `
    import { runChild } from ${JSON.stringify(new URL("./build.mjs", import.meta.url).href)};
    const result = runChild(${JSON.stringify(NODE)}, ['-e', ${JSON.stringify("process.stdout.write('R1_CAPTURE_OUT_BEGIN\\n' + 'C'.repeat(1024 * 1024 + 17) + 'R1_CAPTURE_OUT_END'); process.stderr.write('R1_CAPTURE_ERR_BEGIN\\n' + 'D'.repeat(1024 * 1024 + 19) + 'R1_CAPTURE_ERR_END'); process.exitCode = 37;")}], {cwd:${JSON.stringify(source)}, env:{HOME:${JSON.stringify(env.HOME)}, PATH:'/usr/bin:/bin'}, capture:true, timeout:2000});
    process.exitCode = result.status ?? 72;
  `;
  const child = spawnSync(NODE, ["--input-type=module", "-e", code], {
    env: { HOME: env.HOME, PATH: "/usr/bin:/bin" },
    encoding: "utf8",
    timeout: 3000,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(child.status, 37);
  assert.equal(
    child.stdout.includes(output),
    true,
    "captured diagnostic stdout is preserved locally",
  );
  assert.equal(
    child.stderr.includes(diagnostic),
    true,
    "captured diagnostic stderr is preserved locally",
  );
});

for (const stage of ["version", "help"]) {
  test(`r1 real ${stage} failure retains both diagnostic streams and blocks build`, (t) => {
    const f = fixture(t);
    mkdirSync(join(f.project, "scripts"), { recursive: true });
    for (const name of ["build.mjs", "policy.mjs"])
      cpSync(join(source, "scripts", name), join(f.project, "scripts", name));
    const stdout = `R1_${stage}_STDOUT`;
    const stderr = `R1_${stage}_STDERR`;
    writeFileSync(
      f.plan.cli,
      `
      const args = process.argv.slice(2);
      if (${JSON.stringify(stage)} === 'help' && args.includes('--version')) process.stdout.write('tauri-cli 2.12.4\\n');
      else { process.stdout.write(${JSON.stringify(stdout)}); process.stderr.write(${JSON.stringify(stderr)}); process.exitCode = 29; }
    `,
    );
    const child = spawnSync(NODE, [join(f.project, "scripts/build.mjs")], {
      env: { HOME: env.HOME, PATH: "/usr/bin:/bin" },
      encoding: "utf8",
      timeout: 3000,
    });
    assert.equal(child.status, 29);
    assert.equal(child.stdout.includes(stdout), true);
    assert.equal(child.stderr.includes(stderr), true);
    const records = child.stdout
      .split("\n")
      .filter((line) => line.startsWith('{"stage":'))
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      records.map((record) => record.stage),
      stage === "version" ? ["cli-version"] : ["cli-version", "cli-help"],
    );
    assert.equal(records.at(-1).childExit, 29);
    assert.equal(existsSync(f.plan.cache), false);
  });
}

test("r1 a malformed successful version response still has complete local diagnostics", (t) => {
  const f = fixture(t);
  mkdirSync(join(f.project, "scripts"), { recursive: true });
  for (const name of ["build.mjs", "policy.mjs"])
    cpSync(join(source, "scripts", name), join(f.project, "scripts", name));
  writeFileSync(
    f.plan.cli,
    "process.stdout.write('R1_MALFORMED_VERSION'); process.stderr.write('R1_VERSION_WARNING');",
  );
  const child = spawnSync(NODE, [join(f.project, "scripts/build.mjs")], {
    env: { HOME: env.HOME, PATH: "/usr/bin:/bin" },
    encoding: "utf8",
    timeout: 3000,
  });
  assert.equal(child.status, 78);
  assert.equal(child.stdout.includes("R1_MALFORMED_VERSION"), true);
  assert.equal(child.stderr.includes("R1_VERSION_WARNING"), true);
  assert.equal(child.stderr.includes('"code":"CLI_VERSION_INVALID"'), true);
  assert.equal(existsSync(f.plan.cache), false);
});

test("r1 real Node build substitute writes compiler and XDG cache only under fixed created directories", (t) => {
  const f = fixture(t);
  const r = runner(f, () => {
    const result = runChild(
      NODE,
      [
        "-e",
        "const fs=require('node:fs'); for(const key of ['CLANG_MODULE_CACHE_PATH','XDG_CACHE_HOME']) fs.writeFileSync(require('node:path').join(process.env[key], 'marker'), key);",
      ],
      { cwd: f.project, env: f.plan.env, capture: false, timeout: 1000 },
    );
    assert.equal(result.status, 0);
    writeBundle(f.plan);
  });
  executeBuild(f.plan, r);
  assert.equal(
    readFileSync(join(f.plan.cache, "clang-module-cache/marker"), "utf8"),
    "CLANG_MODULE_CACHE_PATH",
  );
  assert.equal(readFileSync(join(f.plan.cache, "xdg-cache/marker"), "utf8"), "XDG_CACHE_HOME");
  for (const call of r.calls) {
    assert.equal(
      call.options.env.CLANG_MODULE_CACHE_PATH,
      join(f.plan.cache, "clang-module-cache"),
    );
    assert.equal(call.options.env.XDG_CACHE_HOME, join(f.plan.cache, "xdg-cache"));
  }
});

for (const [key, directory] of [
  ["CLANG_MODULE_CACHE_PATH", "clang-module-cache"],
  ["XDG_CACHE_HOME", "xdg-cache"],
]) {
  test(`r1 caller cannot override ${key}`, (t) => {
    const f = fixture(t);
    assert.throws(
      () => createPlan(f.project, { ...env, [key]: "/outside" }, host),
      failed("ENV_OVERRIDE_FORBIDDEN"),
    );
    assert.equal(existsSync(f.plan.cache), false);
  });
  test(`r1 ${directory} symlink is rejected during planning and again before build`, (t) => {
    const f = fixture(t);
    const outside = join(f.root, "outside-cache");
    mkdirSync(outside);
    mkdirSync(f.plan.cache, { recursive: true });
    symlinkSync(outside, join(f.plan.cache, directory));
    assert.throws(() => createPlan(f.project, env, host), failed("PATH_SYMLINK"));
    const r = runner(f);
    assert.throws(() => executeBuild(f.plan, r), failed("PATH_SYMLINK"));
    assert.equal(r.calls.length, 2);
    assert.deepEqual(readdirSync(outside), []);
  });
}

test("r2 fixture copies real default icon; missing icon is rejected before any CLI side effect", (t) => {
  const f = fixture(t);
  const path = "src-tauri/icons/icon.png";
  assert.deepEqual(readFileSync(join(f.project, path)), readFileSync(join(source, path)));
  rmSync(join(f.project, path));
  const r = runner(f);
  assert.throws(() => executeBuild(f.plan, r), failed("INPUT_INVALID"));
  assert.equal(r.calls.length, 0);
  assert.equal(existsSync(f.plan.cache), false);
});

test("r2 symlinked default icon is rejected before any CLI side effect", (t) => {
  const f = fixture(t);
  const icon = join(f.project, "src-tauri/icons/icon.png");
  const outside = join(f.root, "outside-icon.png");
  const original = readFileSync(icon);
  writeFileSync(outside, original);
  rmSync(icon);
  symlinkSync(outside, icon);
  const r = runner(f);
  assert.throws(() => executeBuild(f.plan, r), failed("PATH_SYMLINK"));
  assert.equal(r.calls.length, 0);
  assert.deepEqual(readFileSync(outside), original);
});

test("r3 independently observed vendor macOS layout passes complete artifact validation", (t) => {
  const f = fixture(t);
  // From the actual Tauri 2.12.4 bundler receipt, independent of plan.bundle.
  const vendorBundle = join(
    f.plan.target,
    "aarch64-apple-darwin/debug/bundle/macos/EchoTalk M1 Native Probe.app",
  );
  const r = runner(f, () => writeBundle({ ...f.plan, bundle: vendorBundle }));
  const result = executeBuild(f.plan, r);
  assert.equal(result.stage, "built-not-run");
  assert.equal(r.calls.length, 4);
  assert.equal(r.calls.at(-1).command, "/usr/bin/plutil");
  assert.equal(r.calls.at(-1).args.at(-1), join(vendorBundle, "Contents/Info.plist"));
  assert.match(result.executableSha256, /^[a-f0-9]{64}$/u);
  assert.equal(existsSync(join(vendorBundle, "Contents/MacOS", BINARY)), true);
});

for (const mutate of [
  (c) => {
    c.oidc.issuer = "http://localhost:19444/realm";
  },
  (c) => {
    c.oidc.token_endpoint += "?injection=true";
  },
  (c) => {
    c.oidc.jwks_uri += "#fragment";
  },
  (c) => {
    c.oidc.authorization_endpoint = "https://user@localhost/auth";
  },
  (c) => {
    c.oidc.redirect_uri = "echotalk-m1://other/callback";
  },
  (c) => {
    c.oidc.client_secret = "SYNTHETIC forbidden field";
  },
  (c) => {
    c.environment = "not-schema";
  },
  (c) => {
    c.version = 2;
  },
]) {
  test("auth public-config rejects unsafe endpoint/schema before child or cache effects", (t) => {
    const f = fixture(t);
    const path = join(f.project, "src-tauri/public-config.json");
    const config = JSON.parse(readFileSync(path));
    mutate(config);
    writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
    const r = runner(f);
    assert.throws(() => executeBuild(f.plan, r), failed("PUBLIC_CONFIG_INVALID"));
    assert.equal(r.calls.length, 0);
    assert.equal(existsSync(f.plan.cache), false);
  });
}

test("null OIDC public config is a supported fail-closed candidate; duplicate keys fail pre-side-effect", (t) => {
  const f = fixture(t);
  const path = join(f.project, "src-tauri/public-config.json");
  writeFileSync(path, JSON.stringify({ version: 1, oidc: null }, null, 2) + "\n");
  assert.equal(executeBuild(f.plan, runner(f)).stage, "built-not-run");
  const r = runner(f);
  writeFileSync(path, '{"version":1,"oidc":null,"oidc":null}\n');
  assert.throws(() => executeBuild(f.plan, r), failed("PUBLIC_CONFIG_INVALID"));
  assert.equal(r.calls.length, 0);
});

for (const mutate of [
  (c) => {
    c.app.security.capabilities[0].remote = { urls: ["https://localhost:19444/*"] };
  },
  (c) => {
    c.app.security.capabilities[0].windows = ["*"];
  },
  (c) => {
    c.app.security.capabilities[0].permissions.push("deep-link:default");
  },
  (c) => {
    c.plugins["deep-link"].desktop.schemes.push("http");
  },
  (c) => {
    c.plugins.opener = {};
  },
  (c) => {
    c.app.security.csp = c.app.security.csp.replace(
      "script-src 'self'",
      "script-src 'self' 'unsafe-inline'",
    );
  },
  (c) => {
    c.app.security.csp = c.app.security.csp.replace(
      "connect-src ipc: http://ipc.localhost",
      "connect-src https: ipc:",
    );
  },
  (c) => {
    c.bundle.macOS.infoPlist = "../../outside.plist";
  },
]) {
  test("auth ACL/CSP/plugin/path expansion refuses all child effects", (t) => {
    const f = fixture(t);
    const path = join(f.project, "src-tauri/tauri.conf.json");
    const config = JSON.parse(readFileSync(path));
    mutate(config);
    writeFileSync(path, JSON.stringify(config));
    const r = runner(f);
    assert.throws(() => executeBuild(f.plan, r), failed("CONFIG_FORBIDDEN"));
    assert.equal(r.calls.length, 0);
    assert.equal(existsSync(f.plan.cache), false);
  });
}

for (const path of ["src-tauri/src/auth.rs", "src-tauri/public-config.json", "web/main.mjs"]) {
  test(`auth source hash detects ${path} changing during build`, (t) => {
    const f = fixture(t);
    const r = runner(f, () => {
      const full = join(f.project, path);
      if (path.endsWith(".json")) {
        const c = JSON.parse(readFileSync(full));
        c.oidc.client_id += "-changed";
        writeFileSync(full, JSON.stringify(c, null, 2) + "\n");
      } else writeFileSync(full, readFileSync(full, "utf8") + "\n// changed in test\n");
      writeBundle(f.plan);
    });
    assert.throws(() => executeBuild(f.plan, r), failed("INPUT_CHANGED"));
    assert.equal(r.calls.length, 3);
    assert.equal(
      r.records.some((record) => record.stage === "built-not-run"),
      false,
    );
  });
}

for (const path of ["src-tauri/Info.plist", "src-tauri/public-config.json", "web/auth-ui.mjs"]) {
  test(`auth new input ${path} rejects symlink before child effects`, (t) => {
    const f = fixture(t);
    const full = join(f.project, path);
    const outside = join(f.root, "outside-input");
    cpSync(full, outside);
    rmSync(full);
    symlinkSync(outside, full);
    const r = runner(f);
    assert.throws(() => executeBuild(f.plan, r), failed("PATH_SYMLINK"));
    assert.equal(r.calls.length, 0);
  });
}

test("unknown Rust input, command, permissions file and plist injection fail closed", (t) => {
  const f = fixture(t);
  const r = runner(f);
  const unknown = join(f.project, "src-tauri/src/unknown.rs");
  writeFileSync(unknown, "// not allowed\n");
  assert.throws(() => executeBuild(f.plan, r), failed("INPUT_FORBIDDEN"));
  rmSync(unknown);
  const path = join(f.project, "package.json");
  const original = readFileSync(path);
  const pkg = JSON.parse(original);
  pkg.scripts["probe:arbitrary"] = "unknown";
  writeFileSync(path, JSON.stringify(pkg));
  assert.throws(() => executeBuild(f.plan, r), failed("COMMAND_FORBIDDEN"));
  writeFileSync(path, original);
  const permission = join(f.project, "src-tauri/permissions");
  mkdirSync(permission);
  writeFileSync(join(permission, "evil.toml"), "unknown");
  assert.throws(() => executeBuild(f.plan, r), failed("CONFIG_OVERLAY_FORBIDDEN"));
  rmSync(permission, { recursive: true });
  const plist = join(f.project, "src-tauri/Info.plist");
  writeFileSync(plist, readFileSync(plist, "utf8").replace("echotalk-m1", "other-scheme"));
  assert.throws(() => executeBuild(f.plan, r), failed("CONFIG_FORBIDDEN"));
  assert.equal(r.calls.length, 0);
});

test("all Rust and static auth inputs are represented in the successful build receipt", (t) => {
  const f = fixture(t);
  const result = executeBuild(f.plan, runner(f));
  for (const path of [
    "src-tauri/src/auth.rs",
    "src-tauri/src/config.rs",
    "src-tauri/src/native.rs",
    "src-tauri/src/oidc.rs",
    "src-tauri/src/auth_tests.rs",
    "src-tauri/src/oidc_tests.rs",
    "src-tauri/src/oidc-fixture.json",
    "src-tauri/public-config.json",
    "src-tauri/Info.plist",
    "web/main.mjs",
    "web/auth-ui.mjs",
  ])
    assert.match(result.inputHashes[path], /^[a-f0-9]{64}$/u, path);
});

test("Rust test entry rejects arbitrary argv without launching Cargo", () => {
  const child = spawnSync(NODE, [join(source, "scripts/auth-test.mjs"), "--online"], {
    env: { HOME: env.HOME, PATH: "/usr/bin:/bin" },
    encoding: "utf8",
    timeout: 2000,
  });
  assert.equal(child.status, 64);
  assert.equal(child.stdout, "");
  assert.equal(JSON.parse(child.stderr).code, "ARGUMENTS_FORBIDDEN");
});

test("fixed Rust-test wrapper uses isolated locked offline target and propagates the actual exit", (t) => {
  const f = fixture(t);
  let called = 0;
  const run = (command, args, options) => {
    called++;
    assert.equal(command, "/Users/sunpcm/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo");
    assert.deepEqual(args, [
      "test",
      "--manifest-path",
      join(f.project, "src-tauri/Cargo.toml"),
      "--locked",
      "--offline",
      "--target",
      "aarch64-apple-darwin",
      "--jobs",
      "2",
    ]);
    assert.equal(options.env.CARGO_HOME, f.plan.env.CARGO_HOME);
    assert.equal(options.capture, false);
    return { status: 37 };
  };
  assert.throws(() => executeAuthTests(f.plan, run), failed("CHILD_FAILED", 37));
  assert.equal(called, 1);
});

test("fixed Rust-test wrapper refuses missing locks before child or cache creation", (t) => {
  const f = fixture(t);
  rmSync(join(f.project, "src-tauri/Cargo.lock"));
  let calls = 0;
  assert.throws(
    () =>
      executeAuthTests(f.plan, () => {
        calls++;
      }),
    failed("LOCKS_MISSING"),
  );
  assert.equal(calls, 0);
  assert.equal(existsSync(f.plan.cache), false);
});
