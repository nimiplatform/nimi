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
      if (entry.name === 'generated') {
        continue;
      }
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

const bridgeIpcSpec = readRepo('.nimi/spec/desktop/kernel/bridge-ipc-contract.md');
const facadeActionsSource = readRepo('apps/desktop/src/runtime/data-sync/facade-actions.ts');
const runtimePageSource = readRepo('apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-page-runtime.tsx');
const settingsPagesSource = readRepo('apps/desktop/src/shell/renderer/features/settings/settings-pages.tsx');

test('Agent Detail module map resolves to live agent DataSync evidence', () => {
  assert.match(facadeActionsSource, /from '\.\/flows\/agent-runtime-flow';/);
  assert.match(facadeActionsSource, /from '\.\/flows\/agent-flow';/);
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
  assert.match(settingsPagesSource, /from '\.\/settings-advanced-panel\.js'/);
  assert.doesNotMatch(settingsPagesSource, /settings\/panels\/advanced-panel/);
  assertRepoFile('apps/desktop/src/shell/renderer/features/settings/settings-advanced-panel.tsx');
});

test('External Agent module map admits the Access panel evidence', () => {
  assert.match(runtimePageSource, /from '\.\/runtime-config-external-agent-access'/);
  assertRepoFile('apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-external-agent-access.tsx');
});

test('Home module map resolves Feed to the existing D-DSYNC-007 owner', () => {
  assert.match(facadeActionsSource, /from '\.\/flows\/post-attachment-flow';/);
  assert.doesNotMatch(facadeActionsSource, /from '\.\/flows\/feed-flow';/);
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
