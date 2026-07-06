import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { transformSync } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

async function loadModule() {
  const sourcePath = path.join(root, 'src/shell/avatar/avatar-presence.ts');
  const source = readFileSync(sourcePath, 'utf8');
  const output = transformSync(source, {
    loader: 'ts',
    format: 'esm',
    target: 'es2022',
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.code).toString('base64')}`);
}

function localAgentReady() {
  return {
    transport: 'electron-ipc',
    ready: true,
    reasonCode: 'local-agent-discovered',
    actionHint: 'open_runtime_agent_home',
    source: 'runtime',
    message: 'Runtime-owned LocalAgent was discovered.',
    ownerUserId: 'user-1',
    runtimeSourceRef: 'runtime-source:opaque',
    localAgentRef: 'local-agent:opaque',
  };
}

function localAgentUnavailable() {
  return {
    ...localAgentReady(),
    ready: false,
    reasonCode: 'zhiyu-runtime-source-required',
    actionHint: 'provide_admitted_runtime_source_projection',
    source: 'renderer',
    ownerUserId: null,
    runtimeSourceRef: null,
    localAgentRef: null,
  };
}

function runtimePresentationProfile() {
  return {
    backendKind: 'live2d',
    avatarAssetRef: 'profile_media_url:https://cdn.nimi.test/cbdb/su-zhe-reviewed-portrait.png',
    expressionProfileRef: 'expression://agent-1/calm',
    idlePreset: 'idle-soft',
    interactionPolicyRef: 'policy://agent-1/ambient',
    defaultVoiceReference: 'voice://agent-1/default',
  };
}

test('reads Runtime Agent presentation profile without exposing asset ownership', async () => {
  const { probeZhiyuAvatarPresence } = await loadModule();
  const calls = [];
  const avatar = await probeZhiyuAvatarPresence(localAgentReady(), {
    readPresentationProfile: async (input) => {
      calls.push(input);
      return runtimePresentationProfile();
    },
  });

  assert.deepEqual(calls, [{
    ownerUserId: 'user-1',
    runtimeSourceRef: 'runtime-source:opaque',
    localAgentRef: 'local-agent:opaque',
  }]);
  assert.equal(avatar.ready, true);
  assert.equal(avatar.state, 'projected');
  assert.equal(avatar.reasonCode, 'runtime-agent-presentation-profile-projected');
  assert.equal(avatar.actionHint, 'inspect_runtime_agent_presentation_profile');
  assert.equal(avatar.source, 'runtime');
  assert.equal(avatar.projectionRef, 'runtime-agent-presentation-profile');
  assert.equal(avatar.configurationRef, null);
  assert.equal(avatar.backendKind, 'live2d');
  assert.equal(avatar.visualReadiness, 'projected');
  assert.equal(avatar.voiceReadiness, 'projected');
  assert.equal(avatar.launchAvailable, true);
  assert.equal(avatar.manageAvailable, false);
  const serialized = JSON.stringify(avatar);
  assert.doesNotMatch(serialized, /avatarAssetRef|profile_media_url|cdn\.nimi\.test|voice:\/\/agent-1\/default/);
});

test('projects admitted Avatar facade presence without taking visual asset ownership', async () => {
  const { probeZhiyuAvatarPresence } = await loadModule();
  const calls = [];
  const avatar = await probeZhiyuAvatarPresence(localAgentReady(), {
    readAvatarPresence: async (input) => {
      calls.push(input);
      return {
        configurationRef: 'avatar-config-evidence:agent-1',
        launchAvailable: true,
        manageAvailable: true,
        reasonCode: 'avatar-facade-projected',
        actionHint: 'open_avatar_through_admitted_facade',
        source: 'sdk',
        message: 'Avatar facade projection is available.',
      };
    },
  });

  assert.deepEqual(calls, [{
    ownerUserId: 'user-1',
    runtimeSourceRef: 'runtime-source:opaque',
    localAgentRef: 'local-agent:opaque',
  }]);
  assert.equal(avatar.ready, true);
  assert.equal(avatar.state, 'projected');
  assert.equal(avatar.reasonCode, 'avatar-facade-projected');
  assert.equal(avatar.actionHint, 'open_avatar_through_admitted_facade');
  assert.equal(avatar.source, 'sdk');
  assert.equal(avatar.configurationRef, 'avatar-config-evidence:agent-1');
  assert.equal(avatar.projectionRef, null);
  assert.equal(avatar.backendKind, null);
  assert.equal(avatar.visualReadiness, 'not_projected');
  assert.equal(avatar.voiceReadiness, 'not_projected');
  assert.equal(avatar.launchAvailable, true);
  assert.equal(avatar.manageAvailable, true);
  assert.deepEqual(avatar.unsupportedFields, [
    'configurationId',
    'displayName',
    'compatibilityTier',
    'readinessState',
    'liveInstanceBinding',
    'presentationHandoffState',
    'avatarDiagnosticCode',
    'assetManifestPath',
    'motionState',
    'expressionState',
  ]);
});

test('fails closed before Avatar facade read when LocalAgent is unavailable', async () => {
  const { probeZhiyuAvatarPresence } = await loadModule();
  let called = false;
  const avatar = await probeZhiyuAvatarPresence(localAgentUnavailable(), {
    readAvatarPresence: async () => {
      called = true;
      throw new Error('not expected');
    },
  });

  assert.equal(called, false);
  assert.equal(avatar.ready, false);
  assert.equal(avatar.state, 'blocked');
  assert.equal(avatar.reasonCode, 'zhiyu-local-agent-required');
  assert.equal(avatar.actionHint, 'select_runtime_owned_partner');
  assert.equal(avatar.configurationRef, null);
  assert.equal(avatar.projectionRef, null);
  assert.equal(avatar.backendKind, null);
  assert.equal(avatar.visualReadiness, 'not_projected');
  assert.equal(avatar.voiceReadiness, 'not_projected');
  assert.equal(avatar.launchAvailable, false);
  assert.equal(avatar.manageAvailable, false);
});

test('fails closed when Runtime presentation profile is not projected', async () => {
  const { probeZhiyuAvatarPresence } = await loadModule();
  const avatar = await probeZhiyuAvatarPresence(localAgentReady(), {
    readPresentationProfile: async () => null,
  });

  assert.equal(avatar.ready, false);
  assert.equal(avatar.state, 'blocked');
  assert.equal(avatar.reasonCode, 'runtime-agent-presentation-profile-not-projected');
  assert.equal(avatar.actionHint, 'set_runtime_agent_presentation_profile');
  assert.equal(avatar.source, 'runtime');
  assert.equal(avatar.configurationRef, null);
  assert.equal(avatar.projectionRef, null);
  assert.equal(avatar.visualReadiness, 'not_projected');
  assert.equal(avatar.voiceReadiness, 'not_projected');
});

test('fails closed before default Runtime presentation read when Electron bridge is unavailable', async () => {
  const { probeZhiyuAvatarPresence } = await loadModule();
  let called = false;
  const avatar = await probeZhiyuAvatarPresence(localAgentReady(), {
    hasRuntimeBridge: async () => false,
    readPresentationProfile: async () => {
      called = true;
      return runtimePresentationProfile();
    },
  });

  assert.equal(called, false);
  assert.equal(avatar.ready, false);
  assert.equal(avatar.state, 'blocked');
  assert.equal(avatar.reasonCode, 'electron-runtime-bridge-unavailable');
  assert.equal(avatar.actionHint, 'restart_zhiyu_electron_shell');
  assert.equal(avatar.source, 'renderer');
  assert.equal(avatar.projectionRef, null);
});

test('normalizes Avatar facade read failures without pseudo presence', async () => {
  const { probeZhiyuAvatarPresence } = await loadModule();
  const error = Object.assign(new Error('Avatar facade read failed.'), {
    reasonCode: 'SDK_AVATAR_CONFIGURATION_RECORD_INVALID',
    actionHint: 'check_avatar_facade_projection',
    source: 'sdk',
  });
  const avatar = await probeZhiyuAvatarPresence(localAgentReady(), {
    readAvatarPresence: async () => {
      throw error;
    },
  });

  assert.equal(avatar.ready, false);
  assert.equal(avatar.state, 'blocked');
  assert.equal(avatar.reasonCode, 'SDK_AVATAR_CONFIGURATION_RECORD_INVALID');
  assert.equal(avatar.actionHint, 'check_avatar_facade_projection');
  assert.equal(avatar.source, 'sdk');
  assert.equal(avatar.configurationRef, null);
  assert.equal(avatar.projectionRef, null);
});

test('Avatar presence source keeps Zhiyu out of private renderer and asset truth', () => {
  const source = readFileSync(path.join(root, 'src/shell/avatar/avatar-presence.ts'), 'utf8');
  assert.match(source, /readAvatarPresence/);
  assert.match(source, /readRuntimeAgentPresentationProfile/);
  assert.match(source, /readNimiRuntimeAgentPresentationProfile/);
  assert.match(source, /runtime\.agents\.getAgent/);
  assert.match(source, /runtime\.agent\.read/);
  assert.match(source, /set_runtime_agent_presentation_profile/);
  assert.doesNotMatch(source, /apiKey|providerId|runtime\/internal|apps\/desktop/);
  assert.doesNotMatch(source, /queryMemory|writeMemory|getCanonicalMemoryStatus|bindCanonicalMemoryStandard|runtime\.memory/);
  assert.doesNotMatch(source, /SourceMaterializationPacket|nimi-guide-archivist|local-agent\.identity/);
  assert.doesNotMatch(source, /visualPackage|packageDescriptor|packagePath|manifestPayload|motionPayload|expressionInventory/);
  assert.doesNotMatch(source, /configurationRef:\s*profile\.avatarAssetRef/);
  assert.doesNotMatch(source, /projectionRef:\s*profile\.avatarAssetRef/);
});

test('Avatar product surfaces do not fabricate a local Avatar resource from Runtime projection evidence', () => {
  const homeSurfaceSections = readFileSync(path.join(root, 'src/shell/app/home-surface-sections.tsx'), 'utf8');
  const appearancePanel = readFileSync(path.join(root, 'src/shell/agent-chat/ZhiyuAgentAppearancePanel.tsx'), 'utf8');
  const source = `${homeSurfaceSections}\n${appearancePanel}`;

  assert.doesNotMatch(homeSurfaceSections, /fallback:\/\//);
  assert.doesNotMatch(homeSurfaceSections, /createAvatarStageSnapshot/);
  assert.doesNotMatch(homeSurfaceSections, /<AvatarStage/);
  assert.match(homeSurfaceSections, /data-zhiyu-avatar-resource-ref="not-owned-by-zhiyu"/);
  assert.match(appearancePanel, /const assetConfigured = Boolean\(selectedAvatarAssetRef\)/);
  assert.match(appearancePanel, /const avatarAssetRef = selectedAvatarAssetRef/);
  assert.doesNotMatch(appearancePanel, /avatarAssetRef\s*=\s*selectedAvatarAssetRef\s*\|\|\s*avatar\.configurationRef\s*\|\|\s*avatar\.projectionRef/);
  assert.match(source, /data-zhiyu-avatar-unsupported-count/);
  assert.doesNotMatch(source, /avatar\.unsupportedFields\.map/);
  assert.doesNotMatch(source, /data-zhiyu-avatar-unsupported-field/);
});
