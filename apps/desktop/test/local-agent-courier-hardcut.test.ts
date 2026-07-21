import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.join(import.meta.dirname, '../../..');
const rendererRoot = path.join(repoRoot, 'apps/desktop/src/shell/renderer');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function readRenderer(relativePath: string): string {
  return fs.readFileSync(path.join(rendererRoot, relativePath), 'utf8');
}

test('Desktop has no Realm source to LocalAgent courier', () => {
  assert.equal(
    fs.existsSync(path.join(rendererRoot, 'infra/local-agent-courier')),
    false,
    'Desktop must not provision or terminate LocalAgent from Realm source/social events',
  );

  for (const source of [
    readRenderer('infra/bootstrap/auth-state-watcher.ts'),
    readRenderer('infra/bootstrap/exit-handler.ts'),
    readRenderer('features/social/data/realm-social-data.ts'),
  ]) {
    assert.doesNotMatch(source, /local-agent-courier/);
    assert.doesNotMatch(source, /runLocalAgent(Provision|Termination)CourierPass/);
    assert.doesNotMatch(source, /startLocalAgent(Provision|Termination)Courier/);
    assert.doesNotMatch(source, /stopLocalAgentCouriers/);
  }
});

test('source chat launch delegates CharacterSourceRefV3 and request id to the SDK facade', () => {
  const launchTarget = readRenderer('features/relationship/source-contact-launch-target.ts');
  const materialization = readRenderer('features/explore/character-source-materialization.ts');
  const launcher = readRenderer('features/chat/agent-conversation-launcher.ts');
  const adapterState = readRenderer('features/chat/chat-agent-shell-adapter-state.ts');
  const alignmentTest = read('apps/desktop/test/contact-agent-local-launch-alignment.test.ts');

  assert.match(launchTarget, /materializeCharacterSourceLocalAgent/);
  assert.doesNotMatch(launchTarget, new RegExp(['initialize', 'Local', 'Agent'].join('')));
  assert.doesNotMatch(launchTarget, new RegExp(['source', 'Materialization', 'Packet'].join('')));
  assert.match(launchTarget, /normalizeRequiredText\(\s*source\.runtimeSourceRef,\s*'runtimeSourceRef'/);
  assert.match(launchTarget, /materialized\.localAgentRef/);
  assert.doesNotMatch(launchTarget, /createNimiClientId\('local-agent:desktop'\)/);
  assert.doesNotMatch(launchTarget, /runtime-source:\$\{/);
  assert.doesNotMatch(launchTarget, /source\.id\s+as\s+runtimeSourceRef/);

  assert.match(materialization, /sdk\.runtime\(\)\.materializeRealmSource/);
  assert.match(materialization, /materializeRealmSource/);
  assert.match(materialization, /sourceRef,/);
  assert.match(materialization, /requestId: createNimiClientId\('desktop-source-materialization'\)/);
  assert.doesNotMatch(materialization, /intendedRuntimeAudience/);
  assert.doesNotMatch(materialization, new RegExp(['active', 'Source', 'Connections'].join('')));
  assert.doesNotMatch(materialization, /runtimeSourceRef:\s*source\.id/);

  assert.match(launcher, /setAgentConversationTargetSnapshot\(input\.target\)/);
  assert.doesNotMatch(launcher, new RegExp(['build', 'Runtime', 'Local', 'Agent', 'Ref'].join('')));
  assert.match(adapterState, /agentConversationTargetByLocalRef/);
  assert.match(adapterState, /Object\.values\(storedTargetsByLocalRef\)/);
  assert.doesNotMatch(adapterState, /\(\): AgentLocalTargetSnapshot\[\] => \[\]/);

  assert.match(alignmentTest, /materializeSourceContactLaunchTarget/);
  assert.match(alignmentTest, /requires localAgentRef/);
});

test('group source picker does not read Realm source connection rows or human friends', () => {
  const source = readRenderer('features/chat/chat-group-participant-panel.tsx');

  assert.doesNotMatch(source, /loadRealmPersonaSourceAdmissionProjection/);
  assert.doesNotMatch(source, new RegExp(['active', 'Source', 'Connections'].join('')));
  assert.doesNotMatch(source, /loadRealmSourceDetailsBySourceRef/);
  assert.doesNotMatch(source, /realmSocialData/);
  assert.doesNotMatch(source, /loadSocialSnapshot/);
  assert.doesNotMatch(source, /snapshot\.friends/);
});
