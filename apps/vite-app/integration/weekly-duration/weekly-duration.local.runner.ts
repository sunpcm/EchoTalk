import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const APP_ROOT = path.resolve(__dirname, "../..");
const REPO_ROOT = path.resolve(APP_ROOT, "../..");
const BACKEND_ROOT = path.join(REPO_ROOT, "backend");
const HARNESS = path.join(__dirname, "weekly-duration.local.backend.py");
const LOCAL_VITE_CONFIG = path.join(__dirname, "weekly-duration.local.vite.config.ts");
const VITE_BIN = path.join(APP_ROOT, "node_modules/.bin/vite");
const PYTHON_BIN = path.join(BACKEND_ROOT, ".venv/bin/python");
const API_PORT = 18183;
const WEB_PORT = 4175;
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
const WEB_ORIGIN = `https://127.0.0.1:${WEB_PORT}`;
const START_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 10_000;
const FIXTURE_TIMEOUT_MS = 60_000;

const DEFER_DOTENV_GUARD = String.raw`
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");

function isEnvFile(value) {
  try {
    const raw =
      value instanceof URL ? fileURLToPath(value) : Buffer.isBuffer(value) ? value.toString() : String(value);
    const name = path.basename(raw);
    return name === ".env" || name.startsWith(".env.");
  } catch {
    return false;
  }
}

function reject(value) {
  if (isEnvFile(value)) throw new Error("dotenv_read_forbidden");
}

const readFileSync = fs.readFileSync;
const readFile = fs.readFile;
const openSync = fs.openSync;
const existsSync = fs.existsSync;
const statSync = fs.statSync;
const lstatSync = fs.lstatSync;
const stat = fs.stat;
const lstat = fs.lstat;
const access = fs.access;
const promisesStat = fs.promises.stat;
const promisesLstat = fs.promises.lstat;
const promisesAccess = fs.promises.access;
const promisesReadFile = fs.promises.readFile;
const promisesOpen = fs.promises.open;

function missingEnvFileResult(value) {
  const error = new Error("ENOENT: no such file or directory");
  error.code = "ENOENT";
  error.errno = -2;
  error.path = String(value);
  return error;
}

function missingEnvFile(value) {
  throw missingEnvFileResult(value);
}

fs.readFileSync = function guardedReadFileSync(file, ...args) {
  reject(file);
  return readFileSync.call(this, file, ...args);
};
fs.readFile = function guardedReadFile(file, ...args) {
  reject(file);
  return readFile.call(this, file, ...args);
};
fs.openSync = function guardedOpenSync(file, ...args) {
  reject(file);
  return openSync.call(this, file, ...args);
};
fs.existsSync = function guardedExistsSync(file) {
  return isEnvFile(file) ? false : existsSync.call(this, file);
};
fs.statSync = function guardedStatSync(file, ...args) {
  if (isEnvFile(file)) missingEnvFile(file);
  return statSync.call(this, file, ...args);
};
fs.lstatSync = function guardedLstatSync(file, ...args) {
  if (isEnvFile(file)) missingEnvFile(file);
  return lstatSync.call(this, file, ...args);
};
fs.stat = function guardedStat(file, ...args) {
  if (!isEnvFile(file)) return stat.call(this, file, ...args);
  const callback = args.at(-1);
  if (typeof callback === "function") {
    process.nextTick(callback, missingEnvFileResult(file));
    return;
  }
  return missingEnvFile(file);
};
fs.lstat = function guardedLstat(file, ...args) {
  if (!isEnvFile(file)) return lstat.call(this, file, ...args);
  const callback = args.at(-1);
  if (typeof callback === "function") {
    process.nextTick(callback, missingEnvFileResult(file));
    return;
  }
  return missingEnvFile(file);
};
fs.access = function guardedAccess(file, ...args) {
  if (!isEnvFile(file)) return access.call(this, file, ...args);
  const callback = args.at(-1);
  if (typeof callback === "function") {
    process.nextTick(callback, missingEnvFileResult(file));
    return;
  }
  return missingEnvFile(file);
};
fs.promises.stat = function guardedPromisesStat(file, ...args) {
  if (isEnvFile(file)) return Promise.reject(missingEnvFileResult(file));
  return promisesStat.call(this, file, ...args);
};
fs.promises.lstat = function guardedPromisesLstat(file, ...args) {
  if (isEnvFile(file)) return Promise.reject(missingEnvFileResult(file));
  return promisesLstat.call(this, file, ...args);
};
fs.promises.access = function guardedPromisesAccess(file, ...args) {
  if (isEnvFile(file)) return Promise.reject(missingEnvFileResult(file));
  return promisesAccess.call(this, file, ...args);
};
fs.promises.readFile = function guardedPromisesReadFile(file, ...args) {
  reject(file);
  return promisesReadFile.call(this, file, ...args);
};
fs.promises.open = function guardedPromisesOpen(file, ...args) {
  reject(file);
  return promisesOpen.call(this, file, ...args);
};
`;

type ManagedChild = {
  child: ChildProcess;
  name: string;
  output: string;
};

function fail(message: string): never {
  throw new Error(message);
}

function assertRuntimeConfiguration(): string {
  if (process.env.ECHOTALK_WDI_LOCAL_PG !== "1") {
    fail("ECHOTALK_WDI_LOCAL_PG=1 must be explicitly enabled");
  }
  const raw = process.env.DATABASE_URL;
  if (!raw) fail("DATABASE_URL is required");

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    fail("DATABASE_URL is invalid");
  }
  if (!["postgresql:", "postgres:", "postgresql+asyncpg:"].includes(parsed.protocol)) {
    fail("DATABASE_URL uses an unsupported scheme");
  }
  if (parsed.hostname !== "127.0.0.1" || parsed.port !== "55433") {
    fail("DATABASE_URL must target 127.0.0.1:55433");
  }
  if (decodeURIComponent(parsed.username) !== "echotalk_b1_test") {
    fail("DATABASE_URL must use the echotalk_b1_test user");
  }
  if (decodeURIComponent(parsed.password) === "") {
    fail("DATABASE_URL password must not be empty");
  }
  if (parsed.pathname !== "/echotalk_b1_test" || parsed.search || parsed.hash) {
    fail("DATABASE_URL must target the echotalk_b1_test database without query or fragment");
  }
  return raw;
}

async function assertPortAvailable(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => reject(new Error(`port ${port} is already in use`)));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });
}

function baseChildEnvironment(temporaryRoot: string): NodeJS.ProcessEnv {
  return {
    HOME: process.env.HOME ?? "",
    PATH: process.env.PATH ?? "",
    TMPDIR: temporaryRoot,
    TMP: temporaryRoot,
    TEMP: temporaryRoot,
    LANG: process.env.LANG ?? "C.UTF-8",
    LC_ALL: process.env.LC_ALL ?? "C.UTF-8",
  };
}

function startManagedChild(
  name: string,
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): ManagedChild {
  const child = spawn(command, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const managed: ManagedChild = { child, name, output: "" };
  const append = (chunk: Buffer): void => {
    managed.output = `${managed.output}${chunk.toString("utf8")}`.slice(-4000);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  child.once("error", () => {
    managed.output = `${managed.output}\nspawn_error`.slice(-4000);
  });
  return managed;
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("child exit timeout"));
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function stopManagedChild(managed: ManagedChild | null): Promise<void> {
  if (!managed || managed.child.exitCode !== null || managed.child.signalCode !== null) return;
  managed.child.kill("SIGTERM");
  try {
    await waitForExit(managed.child, STOP_TIMEOUT_MS);
  } catch {
    if (managed.child.exitCode === null && managed.child.signalCode === null) {
      managed.child.kill("SIGKILL");
    }
    await waitForExit(managed.child, STOP_TIMEOUT_MS).catch(() => undefined);
  }
}

function runHarness(
  operation: "seed" | "cleanup",
  statePath: string,
  environment: NodeJS.ProcessEnv,
): void {
  const result = spawnSync(PYTHON_BIN, [HARNESS, operation, "--state", statePath], {
    cwd: BACKEND_ROOT,
    env: environment,
    encoding: "utf8",
    timeout: FIXTURE_TIMEOUT_MS,
  });
  if (result.error || result.status !== 0) {
    fail(
      `fixture ${operation} failed with exit=${result.status ?? "none"} (${result.error?.name ?? "no error"})`,
    );
  }
}

function knownHarnessError(managed: ManagedChild): string {
  const match = managed.output.match(/(?:^|\r?\n)(WDI_HARNESS_ERROR: [^\r\n]*)/);
  return match ? `; ${match[1].slice(0, 512)}` : "";
}

function waitForEndpoint(
  url: string,
  managed: ManagedChild,
  options: https.RequestOptions = {},
): Promise<void> {
  const started = Date.now();
  const client = url.startsWith("https:") ? https : http;
  return new Promise<void>((resolve, reject) => {
    const probe = (): void => {
      if (managed.child.exitCode !== null || managed.child.signalCode !== null) {
        reject(new Error(`${managed.name} exited before readiness${knownHarnessError(managed)}`));
        return;
      }
      const request = client.get(
        url,
        { ...options, rejectUnauthorized: false, timeout: 2_000 },
        (response) => {
          response.resume();
          if (response.statusCode === 200) {
            resolve();
          } else {
            retry();
          }
        },
      );
      request.once("timeout", () => request.destroy());
      request.once("error", retry);
    };
    const retry = (): void => {
      if (Date.now() - started >= START_TIMEOUT_MS) {
        reject(new Error(`${managed.name} readiness timed out${knownHarnessError(managed)}`));
        return;
      }
      setTimeout(probe, 250);
    };
    probe();
  });
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const databaseUrl = assertRuntimeConfiguration();
  if (!fs.existsSync(PYTHON_BIN) || !fs.existsSync(VITE_BIN)) {
    fail("required local runner executable is missing");
  }
  await assertPortAvailable(API_PORT);
  await assertPortAvailable(WEB_PORT);

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wdi-weekly-duration-"));
  const statePath = path.join(temporaryRoot, "fixture-state.json");
  const dotenvGuardPath = path.join(temporaryRoot, "deny-dotenv.cjs");
  fs.writeFileSync(dotenvGuardPath, DEFER_DOTENV_GUARD, { mode: 0o600 });

  const token = `wdi_${randomBytes(32).toString("hex")}`;
  const keyVersion = "wdi-synthetic-v1";
  const fernetKey = randomBytes(32).toString("base64").replaceAll("+", "-").replaceAll("/", "_");
  const commonEnvironment = baseChildEnvironment(temporaryRoot);
  const apiEnvironment: NodeJS.ProcessEnv = {
    ...commonEnvironment,
    ACTIVE_CREDENTIAL_KEY_VERSION: keyVersion,
    AUTH_MODE: "dev",
    CALL_LEASE_MODE: "disabled",
    CORS_ORIGINS: JSON.stringify([WEB_ORIGIN]),
    CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({ [keyVersion]: fernetKey }),
    DATABASE_URL: databaseUrl,
    DEV_AUTH_TOKEN: token,
    ECHOTALK_WDI_LOCAL_PG: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONUNBUFFERED: "1",
  };
  const frontendEnvironment: NodeJS.ProcessEnv = {
    ...commonEnvironment,
    E2E_API_URL: API_ORIGIN,
    NODE_ENV: "test",
    NODE_OPTIONS: `--require=${dotenvGuardPath}`,
    VITE_AUTH_MODE: "dev",
    VITE_DEV_AUTH_TOKEN: token,
  };

  let api: ManagedChild | null = null;
  let frontend: ManagedChild | null = null;
  let seeded = false;
  let seedAttempted = false;
  let teardownStarted = false;

  const teardown = async (): Promise<void> => {
    if (teardownStarted) return;
    teardownStarted = true;
    const failures: string[] = [];
    for (const [name, managed] of [
      ["frontend", frontend],
      ["api", api],
    ] as const) {
      try {
        await stopManagedChild(managed);
      } catch {
        failures.push(`${name} shutdown failed`);
      }
    }
    if (fs.existsSync(statePath)) {
      try {
        runHarness("cleanup", statePath, apiEnvironment);
      } catch {
        failures.push("fixture cleanup failed");
      }
    }
    if (failures.length > 0) {
      throw new Error(
        `${failures.join("; ")}; temporary root preserved at ${temporaryRoot}; fixture state ${statePath}`,
      );
    }
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  };

  try {
    seedAttempted = true;
    runHarness("seed", statePath, apiEnvironment);
    seeded = true;
    api = startManagedChild("api", PYTHON_BIN, [HARNESS, "serve"], {
      cwd: BACKEND_ROOT,
      env: apiEnvironment,
    });
    await waitForEndpoint(`${API_ORIGIN}/api/health`, api);

    frontend = startManagedChild(
      "frontend",
      VITE_BIN,
      [
        "--config",
        LOCAL_VITE_CONFIG,
        "--host",
        "127.0.0.1",
        "--port",
        String(WEB_PORT),
        "--strictPort",
      ],
      {
        cwd: APP_ROOT,
        env: frontendEnvironment,
      },
    );
    await waitForEndpoint(`${WEB_ORIGIN}/`, frontend);
    return teardown;
  } catch (error) {
    if (seeded || fs.existsSync(statePath) || api !== null || frontend !== null) {
      try {
        await teardown();
      } catch (teardownError) {
        const startupMessage = error instanceof Error ? error.message : "unknown startup failure";
        const teardownMessage =
          teardownError instanceof Error ? teardownError.message : "unknown teardown failure";
        throw new Error(`startup failed (${startupMessage}); teardown failed (${teardownMessage})`);
      }
      throw error;
    }

    const startupMessage = error instanceof Error ? error.message : "unknown startup failure";
    const seedContext = seedAttempted
      ? `; seed state was not written; temporary root preserved at ${temporaryRoot}; expected fixture state ${statePath}`
      : "";
    throw new Error(`startup failed (${startupMessage})${seedContext}`);
  }
}
