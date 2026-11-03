import assert from "node:assert/strict";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  BINARY,
  IDENTIFIER,
  INPUTS,
  SDK_INPUTS,
  GENERATED,
  COMMANDS,
  SDK_SHA256,
  INFO_PLIST,
  NODE as LOCAL_NODE,
  createPlan,
  validateInputs,
  permissionText,
  mediaConnectSources,
} from "./policy.mjs";
import { executeBuild, runChild } from "./build.mjs";
import { prepareAssets } from "./assets.mjs";
import { executeAuthTests } from "./auth-test.mjs";

const source = dirname(dirname(fileURLToPath(import.meta.url)));
const temporaryRoot = resolve(process.env.TMPDIR ?? tmpdir());
mkdirSync(temporaryRoot, { recursive: true });
const temporary = realpathSync(temporaryRoot);
const host = { platform: "darwin", arch: "arm64", version: "v22.13.1", execPath: LOCAL_NODE };
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
  for (const path of SDK_INPUTS) {
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
      packages: {
        "": {
          dependencies: { "livekit-client": "2.17.2" },
          devDependencies: { "@tauri-apps/cli": "2.12.4" },
        },
        "node_modules/@tauri-apps/cli": { version: "2.12.4" },
        "node_modules/livekit-client": { version: "2.17.2" },
      },
    }),
  );
  writeFileSync(
    join(project, "src-tauri/Cargo.lock"),
    "# TEST fixture, not a dependency resolution\n",
  );
  const plan = Object.freeze({ ...createPlan(project, env, host), node: process.execPath });
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
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>NSMicrophoneUsageDescription</key><string>仅在您点击开始语音后，使用麦克风进行隔离语音验证。</string><key>CFBundleIdentifier</key><string>${identifier}</string><key>CFBundleExecutable</key><string>${executable}</string><key>CFBundleShortVersionString</key><string>0.0.0</string><key>LSMinimumSystemVersion</key><string>${minimum}</string><key>CFBundleURLTypes</key><array><dict><key>CFBundleURLSchemes</key><array><string>echotalk-m1</string></array></dict></array></dict></plist>`,
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
    assert.equal(command, f.plan.node);
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

export { source, temporary, host, env, failed, fixture, writeBundle, runner };

// Fixture-only launcher: execute the real build pipeline with a synthetic host plan.
// Production CLI/profile selection is tested separately; this never builds native code.
const testNode = process.execPath;
function fixtureBuildArgs(f, { forceCiWrapper = false } = {}) {
  // Preserve the real local entry by default; tests can exercise the CI wrapper
  // explicitly on the pinned local host without an environment/production switch.
  if (!forceCiWrapper && process.execPath === LOCAL_NODE)
    return [join(f.project, "scripts/build.mjs")];
  return [
    "--input-type=module",
    "-e",
    `
    import { executeBuild } from ${JSON.stringify(new URL("./build.mjs", import.meta.url).href)};
    try { executeBuild(${JSON.stringify(f.plan)}); }
    catch (error) {
      console.error("\\n" + JSON.stringify({stage:"failed", code:error.code ?? "BUILD_IO_FAILED", exit:error.exitCode ?? 78}));
      process.exitCode = error.exitCode ?? 78;
    }
  `,
  ];
}
export { testNode, fixtureBuildArgs };
