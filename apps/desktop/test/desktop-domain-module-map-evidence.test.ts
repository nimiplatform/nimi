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

const agentDetailSpec = readRepo('.nimi/spec/desktop/agent-detail.md');
const economySpec = readRepo('.nimi/spec/desktop/economy.md');
const externalAgentSpec = readRepo('.nimi/spec/desktop/external-agent.md');
const homeSpec = readRepo('.nimi/spec/desktop/home.md');

test('Agent Detail module map resolves to live agent DataSync evidence', () => {
  assert.match(agentDetailSpec, /runtime\/data-sync\/flows\/agent-runtime-flow\.ts/);
  assert.match(agentDetailSpec, /runtime\/data-sync\/flows\/agent-flow\.ts/);
  assertRepoFile('apps/desktop/src/runtime/data-sync/flows/agent-runtime-flow.ts');
  assertRepoFile('apps/desktop/src/runtime/data-sync/flows/agent-flow.ts');
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
