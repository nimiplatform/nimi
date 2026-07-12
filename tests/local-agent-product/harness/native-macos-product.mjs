#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from './registry.mjs';

if (process.platform !== 'darwin') throw new Error('native-macos-input Journey requires macOS');

const artifactsRoot = requiredPath('NIMI_LOCAL_AGENT_PRODUCT_NATIVE_ARTIFACTS_ROOT');
const handoffPath = requiredPath('NIMI_LOCAL_AGENT_PRODUCT_HANDOFF_PATH');
const releasePath = requiredPath('NIMI_LOCAL_AGENT_PRODUCT_RELEASE_PATH');
const summaryPath = requiredPath('NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_SUMMARY_PATH');
const desktopArtifacts = path.join(artifactsRoot, 'desktop');
fs.mkdirSync(desktopArtifacts, { recursive: true });

const sharedEnv = {
  ...process.env,
  NO_COLOR: '1',
  FORCE_COLOR: '0',
  NIMI_LOCAL_AGENT_PRODUCT_JOURNEY_ID: 'native-macos-input',
  NIMI_LOCAL_AGENT_PRODUCT_HANDOFF_PATH: handoffPath,
  NIMI_LOCAL_AGENT_PRODUCT_RELEASE_PATH: releasePath,
  NIMI_LOCAL_AGENT_PRODUCT_DESKTOP_ARTIFACTS_ROOT: desktopArtifacts,
};
const desktop = startProcess(process.execPath, [
  path.join(repoRoot, 'apps/desktop/scripts/run-electron-explore-materialization-acceptance.mjs'),
], sharedEnv);

let failure = null;
try {
  const handoff = await Promise.race([
    waitForJsonFile(handoffPath, 240_000),
    desktop.completed.then((result) => {
      throw new Error(`Desktop exited before native Journey handoff: ${diagnostic(result)}`);
    }),
  ]);
  const zhiyu = startProcess(process.execPath, [
    '--import', 'tsx', '--test',
    path.join(repoRoot, 'apps/zhiyu/test/e2e/electron-real-local-agent-acceptance.test.mjs'),
  ], {
    ...sharedEnv,
    NIMI_LOCAL_AGENT_PRODUCT_TARGET_DISPLAY_NAME: handoff.displayName,
    NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_ARTIFACTS_ROOT: artifactsRoot,
    NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_SUMMARY_PATH: summaryPath,
    NIMI_ZHIYU_EVIDENCE_CHECKPOINT: process.env.NIMI_LOCAL_AGENT_PRODUCT_TRIAL_ID || 'native-macos-input',
  });
  const zhiyuResult = await zhiyu.completed;
  if (zhiyuResult.code !== 0 || zhiyuResult.signal) {
    throw new Error(`Zhiyu native Journey failed: ${diagnostic(zhiyuResult)}`);
  }
  await waitForJsonFile(summaryPath, 10_000);
} catch (error) {
  failure = error;
} finally {
  fs.writeFileSync(releasePath, 'released\n');
}

const desktopResult = await desktop.completed;
if (desktopResult.code !== 0 || desktopResult.signal) {
  throw new Error(`Desktop native Journey failed: ${diagnostic(desktopResult)}`, { cause: failure });
}
if (failure) throw failure;
process.stdout.write('native-macos-input product Journey completed\n');

function startProcess(command, args, env) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  const completed = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { child, completed };
}

async function waitForJsonFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for ${path.basename(file)}`, { cause: lastError });
}

function diagnostic(result) {
  return `${result.code ?? result.signal}: ${result.stderr || result.stdout}`.trim().slice(-12_000);
}

function requiredPath(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return path.resolve(value);
}
