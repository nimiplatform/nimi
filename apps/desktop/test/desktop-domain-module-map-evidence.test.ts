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
const realmAgentDetailDataSource = readRepo('apps/desktop/src/shell/renderer/features/agent-detail/data/realm-agent-detail-data.ts');
const realmAgentCreateDataSource = readRepo('apps/desktop/src/shell/renderer/features/world/data/realm-agent-create-data.ts');
const runtimePageSource = readRepo('apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-page-runtime.tsx');
const settingsPagesSource = readRepo('apps/desktop/src/shell/renderer/features/settings/settings-pages.tsx');

test('Agent Detail module map resolves to live Realm feature-data evidence', () => {
  assert.match(realmAgentDetailDataSource, /export async function loadAgentDetails/);
  assert.match(realmAgentCreateDataSource, /export async function createMasterAgent/);
  assertRepoFile('apps/desktop/src/shell/renderer/features/agent-detail/data/realm-agent-detail-data.ts');
  assertRepoFile('apps/desktop/src/shell/renderer/features/world/data/realm-agent-create-data.ts');
});

test('Agent Detail reaches Agent Chat only through the friend-state LocalAgent path', () => {
  // T5-2 (`9d558335d`) introduced the D-EXPL-006 friend-state primary action.
  // For a befriended RealmAgent, Agent Detail's `friend` -> Open Agent Chat
  // action opens the one-to-one LocalAgent Chat. It must NOT construct a chat
  // session from a bare RealmAgent id: the panel routes exclusively through
  // `openRealmAgentLocalChat`, which materializes the deterministic
  // `local-agent:` ref and delegates to the shared LocalAgent launcher.
  const panelSource = readRepo('apps/desktop/src/shell/renderer/features/agent-detail/agent-detail-panel.tsx');
  const viewSource = readRepo('apps/desktop/src/shell/renderer/features/agent-detail/agent-detail-view.tsx');

  // Agent Detail never imports or calls the raw launcher directly; the only
  // chat entry point is the LocalAgent-projecting `openRealmAgentLocalChat`.
  assert.doesNotMatch(panelSource, /launchAgentConversationFromDisplay/);
  assert.doesNotMatch(panelSource, /launchRealmAgentChat|launchRealmAgentConversation/);
  assert.match(panelSource, /openRealmAgentLocalChat/);

  // The view's primary action for the `friend` state is onOpenChat, which the
  // panel wires to the LocalAgent chat path — there is no direct-RealmAgent
  // chat affordance.
  assert.match(viewSource, /onOpenChat/);
  assert.match(viewSource, /describeRealmAgentPrimaryAction/);
  assert.doesNotMatch(viewSource, /launchRealmAgentChat|launchRealmAgentConversation/);
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

test('Home module map resolves Feed outside the retired dataSync facade', () => {
  assertRepoFile('apps/desktop/src/shell/renderer/features/social/data/post-feed-data.ts');
});

test('Desktop runtime bridge commands resolve through the shared Tauri shell authority', () => {
  const mainSource = readRepo('apps/desktop/src-tauri/src/main.rs');

  assert.match(bridgeIpcSpec, /kit\/shell\/tauri\/\*\*/);
  assert.match(mainSource, /use nimi_shell_tauri::runtime_bridge;/);
  assert.doesNotMatch(mainSource, /\bmod runtime_bridge\b/);
  assert.deepEqual(listRepoFiles('apps/desktop/src-tauri/src/runtime_bridge'), []);
  assertRepoFile('kit/shell/tauri/src/runtime_bridge/mod.rs');
});
