import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.join(import.meta.dirname, '../../..');
const desktopRoot = path.join(repoRoot, 'apps/desktop');
const checkerPath = path.join(repoRoot, 'scripts/check-desktop-tauri-command-execution.mjs');

const smokeCommands = [
  'desktop_macos_smoke_context_get',
  'desktop_macos_smoke_report_write',
  'desktop_macos_smoke_ping',
] as const;

const allowedRendererCommandFiles = new Set([
  'apps/desktop/src/shell/renderer/bridge/runtime-bridge/macos-smoke.ts',
  'apps/desktop/src/shell/renderer/bridge/runtime-bridge/runtime-parsers.ts',
  'apps/desktop/src/shell/renderer/main.tsx',
]);

type CommandSurfaceReport = {
  appLocalRegistered: string[];
  kitRegistered: string[];
};

function readCommandSurfaceReport(): CommandSurfaceReport {
  const result = spawnSync(process.execPath, [checkerPath, '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout) as CommandSurfaceReport;
}

function listSourceFiles(root: string): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'dist' || entry.name === 'generated' || entry.name === 'gen') {
      continue;
    }
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...listSourceFiles(fullPath));
      continue;
    }
    if (/\.(?:ts|tsx|js|jsx|mjs)$/u.test(entry.name)) {
      result.push(fullPath);
    }
  }
  return result;
}

function slash(value: string): string {
  return value.replace(/\\/gu, '/');
}

test('macOS smoke commands remain registered as acceptance instrumentation only', () => {
  const report = readCommandSurfaceReport();
  const appLocal = new Set(report.appLocalRegistered);
  const kit = new Set(report.kitRegistered);
  const classification = fs.readFileSync(
    path.join(repoRoot, '.nimi/spec/desktop/kernel/tables/command-execution-classification.yaml'),
    'utf8',
  );
  const ipcCommands = fs.readFileSync(
    path.join(repoRoot, '.nimi/spec/desktop/kernel/tables/ipc-commands.yaml'),
    'utf8',
  );

  for (const command of smokeCommands) {
    assert.equal(appLocal.has(command), true, `${command} must stay registered in this batch`);
    assert.equal(kit.has(command), false, `${command} must not become a Kit command in this batch`);
    assert.match(ipcCommands, new RegExp(`command: ${command}`, 'u'));
  }

  assert.match(classification, /family: macos_smoke_acceptance_instrumentation/u);
  assert.match(classification, /owner_domain: desktop-smoke-instrumentation/u);
  assert.match(classification, /execution_class: bounded_blocking_with_admission/u);
});

test('production renderer feature code does not directly invoke macOS smoke commands', () => {
  const rendererRoot = path.join(desktopRoot, 'src/shell/renderer');
  const offenders: string[] = [];

  for (const filePath of listSourceFiles(rendererRoot)) {
    const rel = slash(path.relative(repoRoot, filePath));
    const source = fs.readFileSync(filePath, 'utf8');
    if (!smokeCommands.some((command) => source.includes(command))) {
      continue;
    }
    if (!allowedRendererCommandFiles.has(rel)) {
      offenders.push(rel);
    }
  }

  assert.deepEqual(offenders, []);
});
