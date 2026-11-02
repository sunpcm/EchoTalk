import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BuildFailure,
  createPlan,
  generatedBytes,
  requireSafePath,
  validateGenerated,
  validateInputs,
} from "./policy.mjs";

export function prepareAssets(plan) {
  // Validate EVERY existing destination/source before the first write. Never repair
  // corrupt outputs in place: the owner must explicitly inspect/remove those files.
  validateGenerated(plan);
  const files = generatedBytes(plan);
  for (const path of files.keys()) requireSafePath(join(plan.projectDir, path));
  for (const [path, bytes] of files) {
    const full = join(plan.projectDir, path);
    if (!existsSync(full)) {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, bytes, { flag: "wx" });
    }
  }
  validateGenerated(plan);
}

export function main(argv = process.argv.slice(2)) {
  try {
    if (argv.length) throw new BuildFailure("ARGUMENTS_FORBIDDEN", 64);
    const plan = createPlan(dirname(dirname(fileURLToPath(import.meta.url))), process.env);
    validateInputs(plan);
    prepareAssets(plan);
    console.log(
      JSON.stringify({
        stage: "local-assets-prepared",
        sdk: "2.17.2",
        network: false,
        nativeBuild: false,
      }),
    );
    return 0;
  } catch (error) {
    const known = error instanceof BuildFailure;
    console.error(
      JSON.stringify({
        stage: "failed",
        code: known ? error.code : "ASSET_IO_FAILED",
        exit: known ? error.exitCode : 78,
      }),
    );
    return known ? error.exitCode : 78;
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  process.exitCode = main();
