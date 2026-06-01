import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const profileFlowSocialSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/social/data/social-snapshot.ts'),
  'utf8',
);
const agentFlowSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/world/data/realm-agent-create-data.ts'),
  'utf8',
);
const sdkRealmAgentProfileSource = fs.readFileSync(
  path.join(import.meta.dirname, '../../../sdk/src/realm/extensions/agent-profile.ts'),
  'utf8',
);

test('contacts social flow no longer owns CreatorService operations', () => {
  assert.doesNotMatch(profileFlowSocialSource, /loadCreatorAgents/);
  assert.doesNotMatch(profileFlowSocialSource, /CreatorService/);
});

test('Desktop agent flow delegates CreatorService list/create ownership to SDK Realm', () => {
  assert.match(agentFlowSource, /createRealmMasterAgent/);
  assert.match(agentFlowSource, /loadRealmCreatorAgents/);
  assert.match(agentFlowSource, /from '@nimiplatform\/sdk\/realm'/);
  assert.doesNotMatch(agentFlowSource, /CreatorService\.creatorControllerListAgents/);
  assert.doesNotMatch(agentFlowSource, /CreatorService\.creatorControllerCreateAgent/);
  assert.match(sdkRealmAgentProfileSource, /CreatorService\.creatorControllerListAgents/);
  assert.match(sdkRealmAgentProfileSource, /CreatorService\.creatorControllerCreateAgent/);
  assert.doesNotMatch(agentFlowSource, /sessionStorage/);
  assert.doesNotMatch(agentFlowSource, /nimi\.data-sync\.creator-agents\.denied/);
  assert.doesNotMatch(agentFlowSource, /Developer access required[\s\S]*return \[\]/);
  assert.doesNotMatch(agentFlowSource, /Forbidden[\s\S]*return \[\]/);
});
