#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const RUSTUP_URL = "https://rustup.rs";
const CARGO_HOME_BIN = path.join(homedir(), ".cargo", "bin");
const CARGO_BIN = process.platform === "win32" ? "cargo.exe" : "cargo";
const CARGO_PATH = path.join(CARGO_HOME_BIN, CARGO_BIN);

function run(cmd, args, options = {}) {
  return spawnSync(cmd, args, {
    stdio: "pipe",
    encoding: "utf8",
    ...options,
  });
}

function cargoVersion() {
  let result = run("cargo", ["--version"]);
  if (result.status === 0) {
    return result.stdout.trim();
  }

  if (existsSync(CARGO_PATH)) {
    result = run(CARGO_PATH, ["--version"]);
    if (result.status === 0) {
      return result.stdout.trim();
    }
  }

  return null;
}

function logInfo(message) {
  process.stdout.write(`[ensure-rust] ${message}\n`);
}

function logWarn(message) {
  process.stderr.write(`[ensure-rust] ${message}\n`);
}

function finishWithWarning() {
  logWarn(`Rust was not installed automatically. Install it from ${RUSTUP_URL}.`);
  logWarn("Desktop build commands require Rust and cargo in PATH.");
  process.exit(0);
}

const current = cargoVersion();
if (current) {
  logInfo(`cargo found: ${current}`);
  process.exit(0);
}

if (process.platform === "linux" || process.platform === "darwin") {
  logInfo("cargo not found; attempting rustup install (stable, minimal profile)...");
  const install = run("sh", [
    "-c",
    "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal",
  ]);

  if (install.status !== 0) {
    const stderr = install.stderr?.trim();
    if (stderr) {
      logWarn(stderr);
    }
    finishWithWarning();
  }

  const installed = cargoVersion();
  if (installed) {
    logInfo(`Rust installed: ${installed}`);
    process.exit(0);
  }

  finishWithWarning();
}

if (process.platform === "win32") {
  logWarn("Windows detected and cargo is not available.");
  finishWithWarning();
}

logWarn(`Unsupported platform: ${process.platform}`);
finishWithWarning();
