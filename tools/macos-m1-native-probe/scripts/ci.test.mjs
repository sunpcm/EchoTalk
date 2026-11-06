import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createCiPlan, createPlan, INPUTS, PROBE_SCRIPTS } from "./policy.mjs";
import { executeCi, NODE_TEST_ARGS } from "./ci.mjs";
import { runChild } from "./build.mjs";
import { failed, fixture, runner, source, host, env } from "./test-support.mjs";

const workspace = "/Users/runner/work/EchoTalk/EchoTalk";
const project = `${workspace}/tools/macos-m1-native-probe`;
const ciEnv = {
  HOME: "/Users/runner",
  GITHUB_ACTIONS: "true",
  RUNNER_ENVIRONMENT: "github-hosted",
  RUNNER_OS: "macOS",
  RUNNER_ARCH: "ARM64",
  RUNNER_TOOL_CACHE: "/Users/runner/hostedtoolcache",
  GITHUB_WORKSPACE: workspace,
};
const ciHost = {
  platform: "darwin",
  arch: "arm64",
  version: "v22.13.1",
  execPath: "/Users/runner/hostedtoolcache/node/22.13.1/arm64/bin/node",
};

test("explicit CI profile pins runner, tools, offline flags and isolated child environment", () => {
  const plan = createCiPlan(
    project,
    {
      ...ciEnv,
      PRIVATE_TOKEN: "synthetic",
      PATH: "/evil",
      RUSTUP_HOME: "/evil",
      HTTPS_PROXY: "https://invalid.test",
    },
    ciHost,
  );
  assert.equal(plan.node, ciHost.execPath);
  assert.equal(plan.rustBin, "/Users/runner/.rustup/toolchains/1.93.1-aarch64-apple-darwin/bin");
  assert.equal(plan.env.CARGO_HOME, `${workspace}/.review/m1-native-host/cargo-home`);
  assert.equal(plan.env.CARGO_NET_OFFLINE, "true");
  assert.equal(plan.env.CARGO_BUILD_JOBS, "2");
  for (const key of ["PRIVATE_TOKEN", "HTTPS_PROXY", "RUSTUP_HOME", "GITHUB_ACTIONS"])
    assert.equal(plan.env[key], undefined);
  assert.throws(() => createPlan(project, ciEnv, ciHost), failed("HOST_UNSUPPORTED"));
});

for (const [key, value] of Object.entries({
  GITHUB_ACTIONS: "false",
  RUNNER_ENVIRONMENT: "self-hosted",
  RUNNER_OS: "Linux",
  RUNNER_ARCH: "X64",
  RUNNER_TOOL_CACHE: "/tmp/tools",
  HOME: "/tmp/user",
  GITHUB_WORKSPACE: "/tmp/project",
}))
  test(`CI rejects unsupported ${key} without creating output`, () => {
    assert.throws(
      () => createCiPlan(project, { ...ciEnv, [key]: value }, ciHost),
      failed("CI_RUNNER_UNSUPPORTED"),
    );
  });
for (const patch of [
  { version: "v22.14.0" },
  { platform: "linux" },
  { arch: "x64" },
  { execPath: "/usr/bin/node" },
])
  test(`CI rejects host drift ${JSON.stringify(patch)}`, () => {
    assert.throws(
      () => createCiPlan(project, ciEnv, { ...ciHost, ...patch }),
      failed(patch.version ? "CI_RUNNER_UNSUPPORTED" : "HOST_UNSUPPORTED"),
    );
  });
for (const key of [
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
])
  test(`CI preserves rejection of ${key}`, () => {
    assert.throws(
      () => createCiPlan(project, { ...ciEnv, [key]: "synthetic" }, ciHost),
      failed("ENV_OVERRIDE_FORBIDDEN"),
    );
  });

test("CI marker never relaxes the strict local host requirement", (t) => {
  const f = fixture(t);
  assert.throws(
    () => createPlan(f.project, { ...env, CI: "true", ...ciEnv }, ciHost),
    failed("HOST_UNSUPPORTED"),
  );
  assert.equal(createPlan(f.project, { ...env, CI: "true" }, host).profile, "local");
});

function ciFixture(t) {
  const f = fixture(t);
  // Internal test seam only; production always obtains its plan from createCiPlan.
  f.plan = Object.freeze({ ...f.plan, profile: "github" });
  const build = runner(f);
  const calls = [];
  const records = [];
  const run = (command, args, options) => {
    calls.push({ command, args, options });
    if (command === join(f.plan.rustBin, "rustc"))
      return { status: 0, stdout: "rustc 1.93.1 (fixture 2026-01-01)\n" };
    if (command === join(f.plan.rustBin, "cargo"))
      return {
        status: 0,
        stdout: args[0] === "--version" ? "cargo 1.93.1 (fixture 2026-01-01)\n" : "",
      };
    if (args[0] === "--test" || args[1] === "ci") return { status: 0 };
    return build.run(command, args, options);
  };
  return { ...f, calls, records, run, emit: (record) => records.push(record) };
}
const receipt = (f) => join(f.plan.cache, "ci-prepared.json");
const prepare = (f) => executeCi(f.plan, "prepare", f);

test("CI prepares locked dependencies then executes full Node, native Rust and verified app in order", (t) => {
  const f = ciFixture(t);
  assert.equal(prepare(f), 0);
  assert.equal(executeCi(f.plan, "check", f), 0);
  const install = f.calls.find((call) => call.args[1] === "ci");
  assert.equal(install.command, f.plan.node);
  assert.deepEqual(install.args.slice(1), [
    "ci",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--registry=https://registry.npmjs.org",
  ]);
  assert.equal(install.options.env.npm_config_cache, join(f.plan.cache, "npm-cache"));
  const fetch = f.calls.find((call) => call.args[0] === "fetch");
  assert.deepEqual(fetch.args, [
    "fetch",
    "--manifest-path",
    join(f.project, "src-tauri/Cargo.toml"),
    "--locked",
    "--target",
    "aarch64-apple-darwin",
  ]);
  assert.equal(fetch.options.env.CARGO_NET_OFFLINE, "false");
  assert.equal(fetch.options.env.CARGO_HOME, f.plan.env.CARGO_HOME);
  assert.equal(f.plan.env.CARGO_NET_OFFLINE, "true");
  const node = f.calls.find((call) => call.args[0] === "--test");
  assert.equal(node.command, f.plan.node);
  assert.deepEqual(node.args, [
    "--test",
    "--test-timeout=30000",
    "scripts/build.test.mjs",
    "scripts/media-build.test.mjs",
    "scripts/auth-ui.test.mjs",
    "scripts/media.test.mjs",
    "scripts/livekit-media.test.mjs",
    "scripts/media-ui.test.mjs",
    "scripts/main.test.mjs",
    "scripts/ci.test.mjs",
  ]);
  assert.equal(node.options.timeout, 120000);
  const rust = f.calls.find((call) => call.args[0] === "test");
  assert.equal(rust.command, join(f.plan.rustBin, "cargo"));
  assert.deepEqual(rust.args, [
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
  const build = f.calls.find((call) => call.args[1] === "build" && !call.args.includes("--help"));
  assert.deepEqual(build.args, [f.plan.cli, ...f.plan.args]);
  assert.ok(f.calls.indexOf(fetch) < f.calls.indexOf(node));
  assert.ok(f.calls.indexOf(node) < f.calls.indexOf(rust));
  assert.ok(f.calls.indexOf(rust) < f.calls.indexOf(build));
  for (const call of f.calls.filter((call) => call !== fetch))
    assert.equal(call.options.env.CARGO_NET_OFFLINE, "true");
  assert.equal(f.records.at(-1).stage, "ci-passed-built-not-run");
});

for (const stage of ["install", "fetch", "node", "rust", "build"])
  test(`CI propagates actual child exit 37 at ${stage} and stops later work`, (t) => {
    const f = ciFixture(t);
    const matches = (args) =>
      ({
        install: args[1] === "ci",
        fetch: args[0] === "fetch",
        node: args[0] === "--test",
        rust: args[0] === "test",
        build: args[1] === "build" && !args.includes("--help"),
      })[stage];
    const original = f.run;
    let failedAt = false;
    f.run = (command, args, options) => {
      assert.equal(failedAt, false, "no later child after failure");
      if (!matches(args)) return original(command, args, options);
      failedAt = true;
      return runChild(process.execPath, ["-e", "process.exitCode=37"], {
        ...options,
        capture: true,
        timeout: 1000,
      });
    };
    assert.throws(
      () => {
        prepare(f);
        executeCi(f.plan, "check", f);
      },
      failed("CHILD_FAILED", 37),
    );
    assert.equal(failedAt, true);
    assert.equal(
      f.records.some((r) => r.stage === "ci-passed-built-not-run"),
      false,
    );
    if (["install", "fetch"].includes(stage)) assert.equal(existsSync(receipt(f)), false);
  });

for (const response of [
  { status: null, errorCode: "ETIMEDOUT", signal: "SIGKILL" },
  { status: null, signal: "SIGTERM" },
  { status: null, errorCode: "ENOENT" },
])
  test(`CI incomplete Node child fails closed: ${response.errorCode ?? response.signal}`, (t) => {
    const f = ciFixture(t);
    prepare(f);
    const run = f.run;
    f.run = (command, args, options) =>
      args[0] === "--test" ? response : run(command, args, options);
    assert.throws(
      () => executeCi(f.plan, "check", f),
      failed("CHILD_INCOMPLETE", response.errorCode === "ETIMEDOUT" ? 124 : 70),
    );
    assert.equal(
      f.calls.some((call) => call.args[0] === "test"),
      false,
    );
  });

test("CI rejects preparation drift, missing receipt and duplicate preparation", (t) => {
  const f = ciFixture(t);
  assert.throws(() => executeCi(f.plan, "check", f), failed("INPUT_INVALID"));
  assert.equal(f.calls.length, 0);
  prepare(f);
  assert.throws(() => prepare(f), failed("CI_PREPARATION_EXISTS"));
  const path = join(f.project, "web/main.mjs");
  writeFileSync(path, readFileSync(path, "utf8") + "\n// synthetic drift\n");
  assert.throws(() => executeCi(f.plan, "check", f), failed("CI_PREPARATION_MISMATCH"));
});

test("CI install/fetch cannot silently rewrite source locks", (t) => {
  const f = ciFixture(t);
  const run = f.run;
  f.run = (command, args, options) => {
    if (args[0] === "fetch") writeFileSync(join(f.project, "src-tauri/Cargo.lock"), "changed");
    return run(command, args, options);
  };
  assert.throws(() => prepare(f), failed("INPUT_CHANGED"));
  assert.equal(existsSync(receipt(f)), false);
});

test("CI refuses npm config, dependency hooks, wrong Rust version and unknown scripts", (t) => {
  const f = ciFixture(t);
  const npmrc = join(f.project, ".npmrc");
  writeFileSync(npmrc, "synthetic");
  assert.throws(() => prepare(f), failed("NPM_CONFIG_FORBIDDEN"));
  rmSync(npmrc);
  const packagePath = join(f.project, "package.json");
  const original = readFileSync(packagePath);
  const pkg = JSON.parse(original);
  pkg.scripts.preinstall = "do-not-run";
  writeFileSync(packagePath, JSON.stringify(pkg));
  assert.throws(() => prepare(f), failed("DEPENDENCY_INVALID"));
  writeFileSync(packagePath, original);
  assert.equal(f.calls.length, 0);
  const run = f.run;
  f.run = (command, args, options) =>
    command.endsWith("/rustc")
      ? { status: 0, stdout: "rustc 1.94.0 (drift)" }
      : run(command, args, options);
  assert.throws(() => prepare(f), failed("RUST_VERSION_INVALID"));
  assert.equal(
    f.calls.some((call) => call.args[1] === "ci"),
    false,
  );
});

test("production CI CLI rejects arbitrary argv before host or command execution", () => {
  const result = spawnSync(
    process.execPath,
    [join(source, "scripts/ci.mjs"), "--config", "/tmp/no"],
    { env: { HOME: env.HOME }, encoding: "utf8", timeout: 2000 },
  );
  assert.equal(result.status, 64);
  assert.equal(result.stdout, "");
  assert.equal(JSON.parse(result.stderr).code, "ARGUMENTS_FORBIDDEN");
});

test("Node list, package commands and strict build input inventory include CI files", () => {
  assert.equal(PROBE_SCRIPTS["probe:test"], `node ${NODE_TEST_ARGS.join(" ")}`);
  const pkg = JSON.parse(readFileSync(join(source, "package.json")));
  assert.deepEqual(pkg.scripts, PROBE_SCRIPTS);
  for (const path of ["scripts/ci.mjs", "scripts/ci.test.mjs"])
    assert.equal(INPUTS.includes(path), true);
});

const workflow = readFileSync(resolve(source, "../../.github/workflows/ci.yml"), "utf8");
test("workflow pins arm64 tools and real CI entry with bounded read-only job", () => {
  const job = workflow.split("  test-macos-probe:\n")[1]?.split("\n  ci:\n")[0];
  assert.ok(job);
  for (const text of [
    "runs-on: macos-15",
    "contents: read",
    "timeout-minutes: 60",
    'node-version: "22.13.1"',
    "architecture: arm64",
    "persist-credentials: false",
    "rustup toolchain install 1.93.1 --profile minimal --target aarch64-apple-darwin --no-self-update",
    "run: node scripts/ci.mjs prepare",
    "run: node scripts/ci.mjs\n",
  ])
    assert.ok(job.includes(text), text);
  assert.doesNotMatch(
    job,
    /continue-on-error|secrets\.|contents: write|id-token: write|--config|--sign|notari/iu,
  );
  assert.match(
    workflow,
    /needs: \[test-frontend, test-backend, test-macos-probe, test-ios-build\]/u,
  );
});

test("real aggregate shell rejects failure, skip or cancellation and requires all four successes", () => {
  const aggregate = workflow.split("\n  ci:\n")[1];
  assert.ok(aggregate.includes("if: always()"));
  assert.ok(aggregate.includes("MACOS_PROBE_RESULT: ${{ needs.test-macos-probe.result }}"));
  assert.ok(aggregate.includes("IOS_BUILD_RESULT: ${{ needs.test-ios-build.result }}"));
  const script = aggregate
    .split("        run: |\n")[1]
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
  for (const key of [
    "FRONTEND_RESULT",
    "BACKEND_RESULT",
    "MACOS_PROBE_RESULT",
    "IOS_BUILD_RESULT",
  ]) {
    for (const status of ["success", "failure", "skipped", "cancelled", ""]) {
      const result = spawnSync("/bin/bash", ["-e", "-c", script], {
        encoding: "utf8",
        timeout: 1000,
        env: {
          FRONTEND_RESULT: "success",
          BACKEND_RESULT: "success",
          MACOS_PROBE_RESULT: "success",
          IOS_BUILD_RESULT: "success",
          [key]: status,
        },
      });
      assert.equal(result.status, status === "success" ? 0 : 1, `${key}=${status}`);
    }
  }
});

test("successful native command without a new artifact never passes CI", (t) => {
  const f = ciFixture(t);
  prepare(f);
  const run = f.run;
  f.run = (command, args, options) =>
    args[1] === "build" && !args.includes("--help") ? { status: 0 } : run(command, args, options);
  assert.throws(() => executeCi(f.plan, "check", f), failed("ARTIFACT_INVALID"));
  assert.equal(
    f.records.some((record) => record.stage === "ci-passed-built-not-run"),
    false,
  );
});

test("Node-stage source mutation and unknown input block native work", (t) => {
  const f = ciFixture(t);
  prepare(f);
  const run = f.run;
  f.run = (command, args, options) => {
    if (args[0] === "--test") {
      const path = join(f.project, "web/main.mjs");
      writeFileSync(path, readFileSync(path, "utf8") + "\n// test-only mutation\n");
    }
    return run(command, args, options);
  };
  assert.throws(() => executeCi(f.plan, "check", f), failed("INPUT_CHANGED"));
  assert.equal(
    f.calls.some((call) => call.args[0] === "test"),
    false,
  );
  writeFileSync(join(f.project, "scripts/unknown.mjs"), "// forbidden\n");
  assert.throws(() => executeCi(f.plan, "check", f), failed("INPUT_FORBIDDEN"));
});

test("CI refuses local plan or arbitrary internal mode before any children", (t) => {
  const f = fixture(t);
  assert.throws(() => executeCi(f.plan), failed("CI_PROFILE_REQUIRED"));
  assert.throws(
    () => executeCi({ ...f.plan, profile: "github" }, "--online"),
    failed("ARGUMENTS_FORBIDDEN", 64),
  );
});

test("real CI entry refuses an untrusted host before installation or native work", () => {
  const result = spawnSync(process.execPath, [join(source, "scripts/ci.mjs")], {
    env: { HOME: env.HOME, CI: "true" },
    encoding: "utf8",
    timeout: 2000,
  });
  assert.equal(result.status, 78);
  assert.equal(result.stdout, "");
  assert.equal(JSON.parse(result.stderr).code, "CI_RUNNER_UNSUPPORTED");
});

test("actual Cargo version drift also blocks preparation before npm", (t) => {
  const f = ciFixture(t);
  const run = f.run;
  f.run = (command, args, options) =>
    command.endsWith("/cargo") && args[0] === "--version"
      ? { status: 0, stdout: "cargo 1.94.0 (drift)" }
      : run(command, args, options);
  assert.throws(() => prepare(f), failed("RUST_VERSION_INVALID"));
  assert.equal(
    f.calls.some((call) => call.args[1] === "ci"),
    false,
  );
  assert.equal(existsSync(receipt(f)), false);
});
