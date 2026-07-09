import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.join(import.meta.dirname, '../../..');
const checkerPath = path.join(repoRoot, 'scripts/check-desktop-tauri-command-execution.mjs');
const futureRedesignPacketsPath = path.join(
  repoRoot,
  'config/desktop-tauri-shell-refactor/future-redesign-packets.md',
);
const commandDispositionPath = path.join(
  repoRoot,
  'config/desktop-tauri-shell-refactor/command-disposition.md',
);
const classificationPath = path.join(
  repoRoot,
  '.nimi/spec/desktop/kernel/tables/command-execution-classification.yaml',
);

type CommandSurfaceReport = {
  registered: string[];
  kitRegistered: string[];
  appLocalRegistered: string[];
  annotated: string[];
  dormant: string[];
  rendererReferencedAppLocal: string[];
  unreferencedRegisteredAppLocal: string[];
  missingActiveSpec: string[];
  missingExecutionClassification: string[];
};

function readCommandSurfaceReport(): CommandSurfaceReport {
  const result = spawnSync(process.execPath, [checkerPath, '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stderr, /\S/);
  return JSON.parse(result.stdout) as CommandSurfaceReport;
}

function readDispositionCommands(): string[] {
  const source = fs.readFileSync(commandDispositionPath, 'utf8');
  const commands: string[] = [];
  for (const match of source.matchAll(/^\| `([a-z][a-z0-9_]*)` \|/gmu)) {
    const command = match[1];
    if (command) {
      commands.push(command);
    }
  }
  return commands.sort();
}

test('Desktop Tauri command surface exposes source-derived accounting buckets', () => {
  const report = readCommandSurfaceReport();

  assert.equal(report.registered.length, 97);
  assert.equal(report.kitRegistered.length, 37);
  assert.equal(report.appLocalRegistered.length, 60);
  assert.equal(report.dormant.length, 10);

  assert.deepEqual(report.missingActiveSpec, []);
  assert.deepEqual(report.missingExecutionClassification, []);

  const appLocal = new Set(report.appLocalRegistered);
  const overlapping = report.kitRegistered.filter((command) => appLocal.has(command));
  assert.deepEqual(overlapping, []);

  assert.equal(report.rendererReferencedAppLocal.length, report.appLocalRegistered.length);
  assert.deepEqual(report.unreferencedRegisteredAppLocal, []);
});

test('future redesign commands are retained app-local and excluded from this Kit migration batch', () => {
  const report = readCommandSurfaceReport();
  const appLocal = new Set(report.appLocalRegistered);
  const kit = new Set(report.kitRegistered);
  const futurePackets = fs.readFileSync(futureRedesignPacketsPath, 'utf8');
  const classification = fs.readFileSync(classificationPath, 'utf8');

  const retainedCommands = [
    'http_request',
    'get_system_resource_snapshot',
    'desktop_agent_center_avatar_asset_import',
    'desktop_agent_center_avatar_asset_validate',
  ];

  for (const command of retainedCommands) {
    assert.equal(appLocal.has(command), true, `${command} must remain app-local in this batch`);
    assert.equal(kit.has(command), false, `${command} must not be registered as a Kit command in this batch`);
    assert.match(futurePackets, new RegExp(`\\| \`${command}\` \\|`, 'u'));
  }

  const chatCommands = report.appLocalRegistered.filter((command) => command.startsWith('chat_ai_'));
  assert.deepEqual(chatCommands, [
    'chat_ai_list_threads',
    'chat_ai_get_thread_bundle',
    'chat_ai_create_thread',
    'chat_ai_update_thread_metadata',
    'chat_ai_create_message',
    'chat_ai_update_message',
    'chat_ai_get_draft',
    'chat_ai_put_draft',
    'chat_ai_delete_draft',
  ]);
  assert.equal(report.kitRegistered.some((command) => command.startsWith('chat_ai_')), false);
  assert.match(futurePackets, /\| `chat_ai_\*` \|/u);

  for (const blockedCapability of [
    'nimi.shell.aiProfile.get',
    'nimi.shell.aiConfig.get',
    'nimi.shell.aiConfig.set',
  ]) {
    assert.match(futurePackets, new RegExp(`\\| \`${blockedCapability.replaceAll('.', '\\.')}\` \\|`, 'u'));
    assert.equal(report.registered.includes(blockedCapability), false);
  }

  assert.match(futurePackets, /kit shell host network capability/u);
  assert.match(futurePackets, /kit device-probe/u);
  assert.match(futurePackets, /kit\/features\/avatar custody\/import capability/u);
  assert.match(futurePackets, /AI config authority redesign/u);
  assert.match(futurePackets, /admitted Desktop local truth and runtime ownership/u);

  assert.match(classification, /future redesign target: kit shell host network capability/u);
  assert.match(classification, /future redesign target: kit device-probe/u);
  assert.match(classification, /future redesign target: kit\/features\/avatar custody\/import capability/u);
  assert.match(classification, /pending explicit decision between admitted Desktop local truth and runtime ownership/u);
});

test('retained app-local command disposition report covers every active app-local command', () => {
  const report = readCommandSurfaceReport();
  const dispositionCommands = readDispositionCommands();

  assert.deepEqual(dispositionCommands, [...report.appLocalRegistered].sort());

  const disposition = fs.readFileSync(commandDispositionPath, 'utf8');
  for (const ownerBucket of [
    'desktop-product',
    'desktop-packaging',
    'desktop-acceptance-instrumentation',
    'runtime-domain-retained',
    'desktop-support',
    'future-redesign-retained',
  ]) {
    assert.match(disposition, new RegExp(`\\| \`${ownerBucket}\` \\|`, 'u'));
  }
});
