#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const officialLauncher = path.resolve(root, '..', '..', 'app-tools', 'bin', 'nimi-app.mjs');
const timeoutMs = Number.parseInt(process.env.NIMI_TESTER_TAURI_ACCEPTANCE_TIMEOUT_MS || '90000', 10);
const commandMatrix = [
  { id: 'artifacts.readRuntimeBytes.native-unavailable', command: 'artifacts_read_runtime_bytes', expectError: true },
  { id: 'ai-config.set.negative', command: 'ai_config_set', expectError: true },
  { id: 'ai-config.get.negative', command: 'ai_config_get', expectError: true },
  { id: 'config.get.negative', command: 'runtime_bridge_config_get', expectError: true },
  { id: 'standard-storage.runHistory.write.negative', command: 'storage_write_json', expectError: true },
  { id: 'standard-storage.runHistory.read.negative', command: 'storage_read_json', expectError: true },
  { id: 'runtime-lifecycle.status.negative', command: 'runtime_bridge_status', expectError: true },
  { id: 'runtime-defaults.get.negative', command: 'runtime_defaults', expectError: true },
  { id: 'auth.sessionLoad.negative', command: 'auth_session_load', expectError: true },
  { id: 'local-agent.identity.negative', command: 'local_agent_identity', expectError: true },
  { id: 'unsupported-standard-command.negative', command: 'unsupported-standard-command', expectError: true },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function outputTail(chunks) {
  return chunks.join('').slice(-8000).trim();
}

async function waitForExit(child, timeoutMs) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) {
    return true;
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    child.once('exit', onExit);
  });
}

async function terminateProcessTree(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
    });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  if (await waitForExit(child, 3_000)) {
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
  await waitForExit(child, 1_000);
}

function readProbe(probePath) {
  if (!existsSync(probePath)) {
    return null;
  }
  return JSON.parse(readFileSync(probePath, 'utf8'));
}

function assertCommandMatrix(record) {
  const checks = Array.isArray(record.payload?.commandChecks) ? record.payload.commandChecks : [];
  const actual = new Map(checks.map((check) => [check.id, check]));
  const failures = checks.filter((check) => check.ok !== true);
  if (failures.length > 0) {
    throw new Error(`Tauri renderer command matrix has failed rows\n${JSON.stringify(failures, null, 2)}`);
  }
  for (const expected of commandMatrix) {
    const check = actual.get(expected.id);
    if (!check) {
      throw new Error(`Tauri renderer command matrix missing ${expected.id}\n${JSON.stringify(checks, null, 2)}`);
    }
    if (check.command !== expected.command) {
      throw new Error(`Tauri renderer command matrix command mismatch for ${expected.id}: ${check.command} !== ${expected.command}`);
    }
    if (Boolean(check.expectError) !== Boolean(expected.expectError)) {
      throw new Error(`Tauri renderer command matrix expectation mismatch for ${expected.id}`);
    }
  }
}

async function waitForProbe(child, probePath, outputChunks) {
  const deadline = Date.now() + timeoutMs;
  let lastRecord = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Tauri acceptance host exited before renderer probe passed (code=${child.exitCode}, signal=${child.signalCode})\n${outputTail(outputChunks)}`);
    }
    const record = readProbe(probePath);
    if (record) {
      lastRecord = record;
      if (record.kind === 'report') {
        throw new Error(`Tauri renderer probe reported failure\n${JSON.stringify(record, null, 2)}\n${outputTail(outputChunks)}`);
      }
      if (record.kind === 'ping' && record.payload?.stage === 'command-checks-ok') {
        assertCommandMatrix(record);
        return record;
      }
    }
    await sleep(250);
  }
  throw new Error(`Tauri renderer probe did not pass within ${timeoutMs}ms\nlastRecord=${JSON.stringify(lastRecord, null, 2)}\n${outputTail(outputChunks)}`);
}

async function main() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-tester-tauri-acceptance-'));
  const probePath = path.join(tempRoot, 'probe.json');
  const outputChunks = [];
  const child = spawn(process.execPath, [officialLauncher, 'dev', '--shell', 'tauri'], {
    cwd: root,
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      CARGO_TERM_PROGRESS_WHEN: process.env.CARGO_TERM_PROGRESS_WHEN || 'never',
      NIMI_RUNTIME_BRIDGE_MODE: 'ACCEPTANCE_INVALID_MODE',
      NIMI_TESTER_TAURI_ACCEPTANCE_PROBE_PATH: probePath,
      NIMI_TESTER_TAURI_ACCEPTANCE_SCENARIO_ID: 'tester.tauri.acceptance',
      NIMI_TESTER_TAURI_ACCEPTANCE_STORAGE_ROOT: tempRoot,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => outputChunks.push(chunk.toString()));
  child.stderr.on('data', (chunk) => outputChunks.push(chunk.toString()));

  try {
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    const record = await waitForProbe(child, probePath, outputChunks);
    process.stdout.write(`[tester-tauri-acceptance] passed (${record.payload.stage})\n`);
  } finally {
    await terminateProcessTree(child);
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error || 'unknown error');
  process.stderr.write(`[tester-tauri-acceptance] failed: ${message}\n`);
  process.exit(1);
}
