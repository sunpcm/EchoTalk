import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BuildFailure,
  PROBE_SCRIPTS,
  createCiPlan,
  jsonFile,
  requireSafePath,
  validateInputs,
} from "./policy.mjs";
import { executeBuild, inputHashes, prepareCaches, runChild } from "./build.mjs";
import { executeAuthTests } from "./auth-test.mjs";
import { prepareAssets } from "./assets.mjs";

export const NODE_TEST_ARGS = Object.freeze([
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

function step(plan, run, emit, stage, command, args, timeout, capture = false, env = plan.env) {
  const result = run(command, args, { cwd: plan.projectDir, env, timeout, capture });
  emit({
    stage,
    childExit: result.status,
    signal: result.signal ?? null,
    timedOut: result.errorCode === "ETIMEDOUT",
  });
  if (result.errorCode || result.signal || !Number.isInteger(result.status))
    throw new BuildFailure("CHILD_INCOMPLETE", result.errorCode === "ETIMEDOUT" ? 124 : 70);
  if (result.status !== 0) throw new BuildFailure("CHILD_FAILED", result.status);
  return result.stdout ?? "";
}

function versions(plan, run, emit) {
  const rustc = step(
    plan,
    run,
    emit,
    "ci-rustc-version",
    join(plan.rustBin, "rustc"),
    ["--version"],
    10000,
    true,
  ).trim();
  const cargo = step(
    plan,
    run,
    emit,
    "ci-cargo-version",
    join(plan.rustBin, "cargo"),
    ["--version"],
    10000,
    true,
  ).trim();
  if (
    !/^rustc 1\.93\.1 \([^\r\n]+\)$/u.test(rustc) ||
    !/^cargo 1\.93\.1 \([^\r\n]+\)$/u.test(cargo)
  )
    throw new BuildFailure("RUST_VERSION_INVALID");
}

const locks = (plan) =>
  ["package-lock.json", "src-tauri/Cargo.lock"].map((path) => {
    const full = join(plan.projectDir, path);
    requireSafePath(full);
    return readFileSync(full);
  });
function unchangedLocks(plan, before) {
  if (locks(plan).some((bytes, i) => !bytes.equals(before[i])))
    throw new BuildFailure("INPUT_CHANGED");
}

// Online dependency preparation is explicit and separate from the offline gate.
// Neither argv nor environment can supply a command, path, flags or config.
export function executeCi(
  plan,
  mode = "check",
  { run = runChild, emit = (record) => process.stdout.write(`\n${JSON.stringify(record)}\n`) } = {},
) {
  if (plan.profile !== "github") throw new BuildFailure("CI_PROFILE_REQUIRED");
  if (!["prepare", "check"].includes(mode)) throw new BuildFailure("ARGUMENTS_FORBIDDEN", 64);
  const receipt = join(plan.cache, "ci-prepared.json");
  requireSafePath(receipt);
  if (mode === "prepare") {
    if (existsSync(receipt)) throw new BuildFailure("CI_PREPARATION_EXISTS");
    // Refuse local npm hooks/config and changed dependency commands before installation.
    if (existsSync(join(plan.projectDir, ".npmrc"))) throw new BuildFailure("NPM_CONFIG_FORBIDDEN");
    const pkg = jsonFile(join(plan.projectDir, "package.json"));
    const lock = jsonFile(join(plan.projectDir, "package-lock.json"));
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
      pkg.private !== true ||
      JSON.stringify(pkg.scripts) !== JSON.stringify(PROBE_SCRIPTS) ||
      JSON.stringify(pkg.devDependencies) !== JSON.stringify({ "@tauri-apps/cli": "2.12.4" }) ||
      JSON.stringify(pkg.dependencies) !== JSON.stringify({ "livekit-client": "2.17.2" }) ||
      lock.packages?.[""]?.devDependencies?.["@tauri-apps/cli"] !== "2.12.4" ||
      lock.packages?.[""]?.dependencies?.["livekit-client"] !== "2.17.2"
    )
      throw new BuildFailure("DEPENDENCY_INVALID");
    const before = locks(plan);
    prepareCaches(plan);
    versions(plan, run, emit);
    const npm = join(dirname(plan.node), "../lib/node_modules/npm/bin/npm-cli.js");
    requireSafePath(npm);
    step(
      plan,
      run,
      emit,
      "ci-npm-install",
      plan.node,
      [
        npm,
        "ci",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--registry=https://registry.npmjs.org",
      ],
      600000,
    );
    unchangedLocks(plan, before);
    validateInputs(plan);
    prepareAssets(plan);
    const inputs = inputHashes(plan);
    step(
      plan,
      run,
      emit,
      "ci-cargo-fetch",
      join(plan.rustBin, "cargo"),
      [
        "fetch",
        "--manifest-path",
        join(plan.projectDir, "src-tauri/Cargo.toml"),
        "--locked",
        "--target",
        "aarch64-apple-darwin",
      ],
      600000,
      false,
      Object.freeze({ ...plan.env, CARGO_NET_OFFLINE: "false" }),
    );
    unchangedLocks(plan, before);
    validateInputs(plan);
    if (JSON.stringify(inputHashes(plan)) !== JSON.stringify(inputs))
      throw new BuildFailure("INPUT_CHANGED");
    writeFileSync(
      receipt,
      JSON.stringify({ stage: "ci-dependencies-prepared", inputHashes: inputs }),
      { flag: "wx", mode: 0o600 },
    );
    emit({ stage: "ci-dependencies-prepared", inputHashes: inputs });
    return 0;
  }
  validateInputs(plan);
  const prepared = jsonFile(receipt);
  const inputs = inputHashes(plan);
  if (
    prepared.stage !== "ci-dependencies-prepared" ||
    JSON.stringify(prepared.inputHashes) !== JSON.stringify(inputs)
  )
    throw new BuildFailure("CI_PREPARATION_MISMATCH");
  prepareCaches(plan);
  versions(plan, run, emit);
  step(plan, run, emit, "ci-node-tests", plan.node, [...NODE_TEST_ARGS], 120000);
  validateInputs(plan);
  if (JSON.stringify(inputHashes(plan)) !== JSON.stringify(inputs))
    throw new BuildFailure("INPUT_CHANGED");
  executeAuthTests(plan, run);
  const built = executeBuild(plan, { run, emit });
  emit({ stage: "ci-passed-built-not-run", sourceSha256: built.sourceSha256 });
  return 0;
}

export function main(argv = process.argv.slice(2)) {
  try {
    if (!(argv.length === 0 || (argv.length === 1 && argv[0] === "prepare")))
      throw new BuildFailure("ARGUMENTS_FORBIDDEN", 64);
    const projectDir = dirname(dirname(fileURLToPath(import.meta.url)));
    return executeCi(createCiPlan(projectDir, process.env), argv[0] ?? "check");
  } catch (error) {
    const known = error instanceof BuildFailure;
    console.error(
      JSON.stringify({
        stage: "failed",
        code: known ? error.code : "CI_IO_FAILED",
        exit: known ? error.exitCode : 78,
      }),
    );
    return known ? error.exitCode : 78;
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  process.exitCode = main();
