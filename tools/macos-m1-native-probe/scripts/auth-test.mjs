import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BuildFailure, RUST_BIN, createPlan, validateInputs } from "./policy.mjs";
import { inputHashes, prepareCaches, runChild } from "./build.mjs";

export function executeAuthTests(plan, run = runChild) {
  validateInputs(plan);
  const inputs = inputHashes(plan);
  prepareCaches(plan);
  const result = run(
    join(RUST_BIN, "cargo"),
    [
      "test",
      "--manifest-path",
      join(plan.projectDir, "src-tauri/Cargo.toml"),
      "--locked",
      "--offline",
      "--target",
      "aarch64-apple-darwin",
      "--jobs",
      "2",
    ],
    { cwd: plan.projectDir, env: plan.env, timeout: 1200000, capture: false },
  );
  process.stdout.write(
    `\n${JSON.stringify({
      stage: "auth-rust-tests",
      childExit: result.status,
      signal: result.signal ?? null,
      timedOut: result.errorCode === "ETIMEDOUT",
      inputHashes: inputs,
    })}\n`,
  );
  if (result.errorCode || result.signal || !Number.isInteger(result.status))
    throw new BuildFailure("CHILD_INCOMPLETE", result.errorCode === "ETIMEDOUT" ? 124 : 70);
  if (result.status !== 0) throw new BuildFailure("CHILD_FAILED", result.status);
  validateInputs(plan);
  if (JSON.stringify(inputHashes(plan)) !== JSON.stringify(inputs))
    throw new BuildFailure("INPUT_CHANGED");
  return 0;
}
export function main(argv = process.argv.slice(2)) {
  try {
    if (argv.length) throw new BuildFailure("ARGUMENTS_FORBIDDEN", 64);
    const projectDir = dirname(dirname(fileURLToPath(import.meta.url)));
    return executeAuthTests(createPlan(projectDir, process.env));
  } catch (error) {
    const known = error instanceof BuildFailure;
    console.error(
      JSON.stringify({
        stage: "failed",
        code: known ? error.code : "AUTH_TEST_IO_FAILED",
        exit: known ? error.exitCode : 78,
      }),
    );
    return known ? error.exitCode : 78;
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  process.exitCode = main();
