import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAgentRuntimeVoiceCatalog } from '../src/shell/renderer/features/chat/chat-agent-runtime-voice-catalog.js';

function aiClient(input: {
  preset?: () => Promise<unknown>;
  assets?: () => Promise<unknown>;
} = {}) {
  const calls = {
    preset: [] as Array<{ request: Record<string, unknown>; options: { signal?: AbortSignal } }>,
    assets: [] as Array<{ request: Record<string, unknown>; options: { signal?: AbortSignal } }>,
  };
  return {
    calls,
    client: {
      async listPresetVoices(
        request: Record<string, unknown>,
        options: { signal?: AbortSignal },
      ) {
        calls.preset.push({ request, options });
        return (input.preset ? await input.preset() : {
          modelResolved: 'local-selected-tts-model',
          voices: [{ voiceId: 'serena', name: 'Serena', supportedLangs: ['zh', 'en'] }],
        });
      },
      async listVoiceAssets(
        request: Record<string, unknown>,
        options: { signal?: AbortSignal },
      ) {
        calls.assets.push({ request, options });
        return (input.assets ? await input.assets() : { assets: [] });
      },
    },
  };
}

test('Desktop voice catalog uses Runtime-owned preset and owner-scoped asset identities', async () => {
  const ai = aiClient({
    assets: async () => ({
      assets: [{ voiceAssetId: 'voice-1', appId: 'nimi.desktop', subjectUserId: 'user-1' }],
    }),
  });

  const result = await loadAgentRuntimeVoiceCatalog({
    ai: ai.client as never,
    appId: 'nimi.desktop',
    subjectUserId: 'user-1',
  });

  assert.deepEqual(result, {
    state: 'ready',
    sourceLabel: 'local-selected-tts-model',
    options: [
      {
        reference: 'preset_voice_id:serena',
        kind: 'preset_voice_id',
        name: 'Serena',
        supportedLangs: ['zh', 'en'],
      },
      {
        reference: 'voice_asset_id:voice-1',
        kind: 'voice_asset_id',
        name: 'Voice asset voice-1',
        supportedLangs: [],
      },
    ],
    message: null,
  });
  assert.deepEqual(ai.calls.preset[0]?.request, {
    appId: 'nimi.desktop',
    subjectUserId: 'user-1',
    modelId: '',
    targetModelId: '',
    connectorId: '',
  });
  assert.equal(ai.calls.preset[0]?.options.signal instanceof AbortSignal, true);
});

test('Desktop voice catalog isolates one unavailable catalog without fabricating entries', async () => {
  const ai = aiClient({
    assets: async () => { throw new Error('voice asset store unavailable'); },
  });

  const result = await loadAgentRuntimeVoiceCatalog({
    ai: ai.client as never,
    appId: 'nimi.desktop',
    subjectUserId: 'user-1',
  });

  assert.equal(result.state, 'ready');
  assert.deepEqual(result.options.map((option) => option.reference), ['preset_voice_id:serena']);
});

test('Desktop voice catalog fails closed on cross-owner assets even when presets succeed', async () => {
  const ai = aiClient({
    assets: async () => ({
      assets: [{ voiceAssetId: 'foreign', appId: 'nimi.desktop', subjectUserId: 'user-2' }],
    }),
  });

  await assert.rejects(
    loadAgentRuntimeVoiceCatalog({
      ai: ai.client as never,
      appId: 'nimi.desktop',
      subjectUserId: 'user-1',
    }),
    /cross-owner voice asset/,
  );
});

test('Desktop voice catalog rejects when both Runtime catalogs are unavailable', async () => {
  const ai = aiClient({
    preset: async () => { throw new Error('preset unavailable'); },
    assets: async () => { throw new Error('assets unavailable'); },
  });

  await assert.rejects(
    loadAgentRuntimeVoiceCatalog({
      ai: ai.client as never,
      appId: 'nimi.desktop',
      subjectUserId: 'user-1',
    }),
    /preset unavailable/,
  );
});
