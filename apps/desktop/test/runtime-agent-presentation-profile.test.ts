import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { normalizeNimiRuntimeAgentPresentationBackendKind, normalizeNimiRuntimeAgentPresentationDefaultVoiceReference } from '@nimiplatform/sdk/runtime';
import { AgentPresentationBackendKind } from '@nimiplatform/sdk/runtime/wire-types';

const runtimeAgentPresentationProfileSource = () => readFileSync(
  resolve(process.cwd(), 'src/shell/renderer/infra/runtime-agent-presentation-profile.ts'),
  'utf8',
);
const chatAgentHostActionsSource = () => readFileSync(
  resolve(process.cwd(), 'src/shell/renderer/features/chat/chat-agent-shell-host-actions-helpers.ts'),
  'utf8',
);

test('desktop runtime agent presentation adapter consumes SDK request projection', () => {
  const source = runtimeAgentPresentationProfileSource();
  const chatHostActions = chatAgentHostActionsSource();
  assert.match(source, /createNimiHostRuntimeAgentPresentationProfileSurface/);
  assert.match(chatHostActions, /createNimiHostRuntimeAgentPresentationProfileSurface/);
  assert.match(source, /from '@nimiplatform\/sdk\/runtime'/);
  assert.doesNotMatch(source, /buildSetRuntimeAgentPresentationProfileRequest/);
  assert.doesNotMatch(chatHostActions, /buildSetRuntimeAgentPresentationProfileRequest/);
  assert.doesNotMatch(source, /createRuntimeProtectedScopeHelper/);
  assert.doesNotMatch(source, /function toSetPresentationProfileRequest/);
  assert.doesNotMatch(chatHostActions, /defaultVoiceReference:\s*normalizeNimiRuntimeAgentPresentationDefaultVoiceReference/);
  assert.doesNotMatch(source, /function parseLocalAgentIdentity/);
  assert.doesNotMatch(source, /RUNTIME_AGENT_PRESENTATION_VOICE_REFERENCE_PREFIXES/);
});

test('runtime agent presentation profile admits only runtime backend kinds', () => {
  assert.equal(normalizeNimiRuntimeAgentPresentationBackendKind('vrm'), AgentPresentationBackendKind.VRM);
  assert.equal(normalizeNimiRuntimeAgentPresentationBackendKind('live2d'), AgentPresentationBackendKind.LIVE2D);
  assert.equal(normalizeNimiRuntimeAgentPresentationBackendKind('sprite2d'), AgentPresentationBackendKind.SPRITE2D);
  assert.equal(normalizeNimiRuntimeAgentPresentationBackendKind('canvas2d'), AgentPresentationBackendKind.CANVAS2D);
  assert.equal(normalizeNimiRuntimeAgentPresentationBackendKind('video'), AgentPresentationBackendKind.VIDEO);
  assert.equal(normalizeNimiRuntimeAgentPresentationBackendKind('unknown' as 'vrm'), null);
});

test('runtime agent presentation profile keeps admitted runtime voice references', () => {
  assert.equal(
    normalizeNimiRuntimeAgentPresentationDefaultVoiceReference('preset_voice_id:alloy'),
    'preset_voice_id:alloy',
  );
  assert.equal(
    normalizeNimiRuntimeAgentPresentationDefaultVoiceReference('voice_asset_id:voice-asset-1'),
    'voice_asset_id:voice-asset-1',
  );
});

test('runtime agent presentation profile rejects non-runtime voice references before Runtime RPC', () => {
  assert.throws(
    () => normalizeNimiRuntimeAgentPresentationDefaultVoiceReference('provider_voice_ref:openai:verse'),
    /preset_voice_id or voice_asset_id/,
  );
  assert.throws(
    () => normalizeNimiRuntimeAgentPresentationDefaultVoiceReference('voice://agent-1/default'),
    /preset_voice_id or voice_asset_id/,
  );
  assert.throws(
    () => normalizeNimiRuntimeAgentPresentationDefaultVoiceReference(' voice_asset_id:voice-asset-1 '),
    /preset_voice_id or voice_asset_id/,
  );
  assert.throws(
    () => normalizeNimiRuntimeAgentPresentationDefaultVoiceReference(null),
    /preset_voice_id or voice_asset_id/,
  );
  assert.equal(normalizeNimiRuntimeAgentPresentationDefaultVoiceReference(''), '');
  assert.equal(normalizeNimiRuntimeAgentPresentationDefaultVoiceReference(undefined), '');
});
