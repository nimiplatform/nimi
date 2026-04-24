import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.join(import.meta.dirname, '../../..');

function readRepo(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assertRepoFile(relativePath: string): void {
  assert.ok(fs.existsSync(path.join(repoRoot, relativePath)), `${relativePath} should exist`);
}

function listRepoFiles(relativePath: string): string[] {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return [];
  }

  const files: string[] = [];
  const visit = (directoryPath: string): void => {
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }
      if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  };

  visit(absolutePath);
  return files.sort();
}

const agentDetailSpec = readRepo('.nimi/spec/desktop/agent-detail.md');
const economySpec = readRepo('.nimi/spec/desktop/economy.md');
const externalAgentSpec = readRepo('.nimi/spec/desktop/external-agent.md');
const homeSpec = readRepo('.nimi/spec/desktop/home.md');
const bridgeIpcSpec = readRepo('.nimi/spec/desktop/kernel/bridge-ipc-contract.md');

test('Agent Detail module map resolves to live agent DataSync evidence', () => {
  assert.match(agentDetailSpec, /runtime\/data-sync\/flows\/agent-runtime-flow\.ts/);
  assert.match(agentDetailSpec, /runtime\/data-sync\/flows\/agent-flow\.ts/);
  assertRepoFile('apps/desktop/src/runtime/data-sync/flows/agent-runtime-flow.ts');
  assertRepoFile('apps/desktop/src/runtime/data-sync/flows/agent-flow.ts');
});

test('Agent Detail domain does not launch agent chat routes', () => {
  const panelSource = readRepo('apps/desktop/src/shell/renderer/features/agent-detail/agent-detail-panel.tsx');
  const viewSource = readRepo('apps/desktop/src/shell/renderer/features/agent-detail/agent-detail-view.tsx');

  assert.doesNotMatch(panelSource, /launchAgentConversationFromDisplay/);
  assert.doesNotMatch(panelSource, /setAgentConversationSelection|setChatMode|setRuntimeFields/);
  assert.doesNotMatch(viewSource, /onChat/);
  assert.doesNotMatch(viewSource, /AgentDetail\.chat/);
});

test('Economy Wallet module map resolves to the current settings wallet page', () => {
  assert.match(economySpec, /features\/settings\/settings-advanced-panel\.tsx/);
  assert.doesNotMatch(economySpec, /features\/settings\/panels\/advanced-panel\.tsx/);
  assertRepoFile('apps/desktop/src/shell/renderer/features/settings/settings-advanced-panel.tsx');
});

test('External Agent module map admits the Access panel evidence', () => {
  assert.match(externalAgentSpec, /features\/runtime-config\/runtime-config-external-agent-access\.tsx/);
  assertRepoFile('apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-external-agent-access.tsx');
});

test('Home module map resolves Feed to the existing D-DSYNC-007 owner', () => {
  assert.match(homeSpec, /runtime\/data-sync\/flows\/post-attachment-flow\.ts/);
  assert.doesNotMatch(homeSpec, /runtime\/data-sync\/flows\/feed-flow\.ts/);
  assertRepoFile('apps/desktop/src/runtime/data-sync/flows/post-attachment-flow.ts');
});

test('Desktop runtime bridge commands resolve through the shared Tauri shell authority', () => {
  const mainSource = readRepo('apps/desktop/src-tauri/src/main.rs');

  assert.match(bridgeIpcSpec, /kit\/shell\/tauri\/\*\*/);
  assert.match(mainSource, /use nimi_kit_shell_tauri::runtime_bridge;/);
  assert.doesNotMatch(mainSource, /\bmod runtime_bridge\b/);
  assert.deepEqual(listRepoFiles('apps/desktop/src-tauri/src/runtime_bridge'), []);
  assertRepoFile('kit/shell/tauri/src/runtime_bridge/mod.rs');
});
