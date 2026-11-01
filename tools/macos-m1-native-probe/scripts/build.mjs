import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BINARY,
  BuildFailure,
  IDENTIFIER,
  NODE,
  createPlan,
  requireSafePath,
  validateInputs,
} from "./policy.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function runChild(command, args, options) {
  const result = spawnSync(command, args, {
    ...options,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
    detached: true,
    killSignal: "SIGKILL",
    ...(options.capture ? { maxBuffer: Infinity } : {}),
  });
  // On a timeout/error also terminate this detached CLI's process group, so a
  // Cargo child is not intentionally left running. Never signal an unrelated PID.
  if (result.error && result.pid) {
    try {
      process.kill(-result.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  // Fixed control tools are captured for parsing AND forwarded byte-for-byte to
  // the local evidence streams, including failures and malformed responses.
  // The compiler branch inherits both streams and has no buffered-output limit.
  if (options.capture) {
    if (result.stdout?.length) process.stdout.write(result.stdout);
    if (result.stderr?.length) process.stderr.write(result.stderr);
  }
  return {
    status: result.status,
    signal: result.signal,
    errorCode: result.error?.code,
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
  };
}

export function executeBuild(
  plan,
  { run = runChild, emit = (record) => process.stdout.write(`\n${JSON.stringify(record)}\n`) } = {},
) {
  function step(stage, command, args, timeout, capture = true) {
    const result = run(command, args, { cwd: plan.projectDir, env: plan.env, timeout, capture });
    emit({
      stage,
      childExit: result.status,
      signal: result.signal ?? null,
      timedOut: result.errorCode === "ETIMEDOUT",
    });
    if (result.errorCode || result.signal || !Number.isInteger(result.status)) {
      throw new BuildFailure("CHILD_INCOMPLETE", result.errorCode === "ETIMEDOUT" ? 124 : 70);
    }
    if (result.status !== 0) throw new BuildFailure("CHILD_FAILED", result.status);
    return result.stdout;
  }
  validateInputs(plan);
  const version = step("cli-version", NODE, [plan.cli, "--version"], 10000).trim();
  if (!/^(?:tauri-cli|tauri) 2\.12\.4$/u.test(version))
    throw new BuildFailure("CLI_VERSION_INVALID");
  const help = step("cli-help", NODE, [plan.cli, "build", "--help"], 10000);
  if (
    ["--debug", "--target", "--bundles", "--no-sign", "--ci"].some(
      (flag) => !help.includes(flag),
    ) ||
    !/\bARGS\b/u.test(help) ||
    !/cargo|runner/iu.test(help)
  )
    throw new BuildFailure("CLI_HELP_INVALID");
  for (const path of [
    plan.env.CARGO_HOME,
    plan.target,
    plan.env.npm_config_cache,
    plan.env.TMPDIR,
    plan.env.CLANG_MODULE_CACHE_PATH,
    plan.env.XDG_CACHE_HOME,
  ]) {
    requireSafePath(path);
    mkdirSync(path, { recursive: true });
  }
  for (const path of [plan.env.npm_config_userconfig, plan.env.npm_config_globalconfig]) {
    requireSafePath(path);
    if (existsSync(path)) {
      if (!lstatSync(path).isFile() || lstatSync(path).size !== 0)
        throw new BuildFailure("NPM_CONFIG_NOT_EMPTY");
    } else {
      writeFileSync(path, "", { flag: "wx", mode: 0o600 });
    }
  }
  requireSafePath(plan.bundle);
  if (existsSync(plan.bundle)) {
    if (!lstatSync(plan.bundle).isDirectory()) throw new BuildFailure("ARTIFACT_INVALID");
    // Preserve the exact previous candidate instead of accepting a stale app or
    // deleting anything. All paths remain in this probe's unique target tree.
    renameSync(plan.bundle, join(dirname(plan.bundle), `.previous-${randomUUID()}.app`));
    emit({ stage: "previous-artifact-preserved" });
  }
  // No install/fetch, npm/npx, shell, config override, sign or binary execution.
  step("tauri-build", NODE, [plan.cli, ...plan.args], 1200000, false);
  requireSafePath(plan.bundle);
  const plist = join(plan.bundle, "Contents/Info.plist");
  const binary = join(plan.bundle, "Contents/MacOS", BINARY);
  for (const path of [plist, binary]) {
    requireSafePath(path);
    if (!existsSync(path) || !lstatSync(path).isFile()) throw new BuildFailure("ARTIFACT_INVALID");
  }
  const metadataText = step(
    "artifact-plist",
    "/usr/bin/plutil",
    ["-convert", "json", "-o", "-", plist],
    10000,
  );
  let metadata;
  try {
    metadata = JSON.parse(metadataText);
  } catch {
    throw new BuildFailure("ARTIFACT_INVALID");
  }
  if (
    metadata.CFBundleIdentifier !== IDENTIFIER ||
    metadata.CFBundleExecutable !== BINARY ||
    metadata.CFBundleShortVersionString !== "0.0.0" ||
    !/^14\.0(?:\.0)?$/u.test(metadata.LSMinimumSystemVersion ?? "")
  )
    throw new BuildFailure("ARTIFACT_INVALID");
  const bytes = readFileSync(binary);
  if (
    bytes.length < 32 ||
    bytes.readUInt32LE(0) !== 0xfeedfacf ||
    bytes.readUInt32LE(4) !== 0x0100000c ||
    bytes.readUInt32LE(12) !== 2 ||
    (lstatSync(binary).mode & 0o111) === 0
  )
    throw new BuildFailure("ARTIFACT_INVALID");
  const result = {
    stage: "built-not-run",
    cliVersion: "2.12.4",
    executableSha256: sha(bytes),
    plistSha256: sha(readFileSync(plist)),
    configSha256: sha(readFileSync(join(plan.projectDir, "src-tauri/tauri.conf.json"))),
    npmLockSha256: sha(readFileSync(join(plan.projectDir, "package-lock.json"))),
    cargoLockSha256: sha(readFileSync(join(plan.projectDir, "src-tauri/Cargo.lock"))),
  };
  emit(result);
  return result;
}

export function main(argv = process.argv.slice(2)) {
  try {
    if (argv.length !== 0) throw new BuildFailure("ARGUMENTS_FORBIDDEN", 64);
    const projectDir = dirname(dirname(fileURLToPath(import.meta.url)));
    const plan = createPlan(projectDir, process.env);
    executeBuild(plan);
    return 0;
  } catch (error) {
    const known = error instanceof BuildFailure;
    console.error(
      "\n" +
        JSON.stringify({
          stage: "failed",
          code: known ? error.code : "BUILD_IO_FAILED",
          exit: known ? error.exitCode : 78,
        }),
    );
    return known ? error.exitCode : 78;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  process.exitCode = main();
