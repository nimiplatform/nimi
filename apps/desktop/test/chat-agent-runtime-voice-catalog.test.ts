import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAgentRuntimeVoiceCatalog } from '../src/shell/renderer/features/chat/chat-agent-runtime-voice-catalog.js';

function aiClient(input: {
  assets?: () => Promise<unknown>;
} = {}) {
  const calls = {
    assets: [] as Array<{ request: Record<string, unknown>; options: { signal?: AbortSignal } }>,
  };
  return {
    calls,
    client: {
      async listPresetVoices() { throw new Error('Desktop App AIConfig preset path must not be used'); },
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

function sharedAIConfig(input: { preset?: (options?: { readonly signal?: AbortSignal }) => Promise<unknown> } = {}) {
  const calls: unknown[] = [];
  return {
    calls,
    client: {
      async listOptions(query: unknown, options?: { readonly signal?: AbortSignal }) {
        calls.push(query);
        return input.preset ? await input.preset(options) : {
          kind: 'preset-voices',
          options: [{ voiceId: 'serena', name: 'Serena', supportedLangs: ['zh', 'en'] }],
          truncated: false,
        };
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
  const shared = sharedAIConfig();

  const result = await loadAgentRuntimeVoiceCatalog({
    ai: ai.client as never,
    sharedAIConfig: shared.client as never,
    appId: 'nimi.desktop',
    subjectUserId: 'user-1',
  });

  assert.deepEqual(result, {
    state: 'ready',
    sourceLabel: 'Runtime preset voices',
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
    truncated: false,
    message: null,
  });
  assert.deepEqual(shared.calls, [{ kind: 'preset-voices' }]);
});

test('Desktop voice catalog isolates one unavailable catalog without fabricating entries', async () => {
  const ai = aiClient({
    assets: async () => { throw new Error('voice asset store unavailable'); },
  });
  const shared = sharedAIConfig();

  const result = await loadAgentRuntimeVoiceCatalog({
    ai: ai.client as never,
    sharedAIConfig: shared.client as never,
    appId: 'nimi.desktop',
    subjectUserId: 'user-1',
  });

  assert.equal(result.state, 'ready');
  assert.deepEqual(result.options.map((option) => option.reference), ['preset_voice_id:serena']);
});

test('Desktop voice catalog preserves shared preset truncation', async () => {
  const ai = aiClient();
  const shared = sharedAIConfig({
    preset: async () => ({
      kind: 'preset-voices',
      options: [{ voiceId: 'serena', name: 'Serena', supportedLangs: ['zh'] }],
      truncated: true,
    }),
  });
  const result = await loadAgentRuntimeVoiceCatalog({
    ai: ai.client as never,
    sharedAIConfig: shared.client as never,
    appId: 'nimi.desktop',
    subjectUserId: 'user-1',
  });
  assert.equal(result.state, 'ready');
  assert.equal(result.truncated, true);
});

test('Desktop voice catalog timeout cancels a stalled shared preset read', async () => {
  const ai = aiClient();
  const shared = sharedAIConfig({
    preset: async (options) => new Promise<never>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }),
  });
  const startedAt = Date.now();
  const result = await loadAgentRuntimeVoiceCatalog({
    ai: ai.client as never,
    sharedAIConfig: shared.client as never,
    appId: 'nimi.desktop',
    subjectUserId: 'user-1',
    timeoutMs: 5,
  });
  assert.equal(result.state, 'ready');
  assert.deepEqual(result.options, []);
  assert.ok(Date.now() - startedAt < 1_000);
});

test('Desktop voice catalog fails closed on cross-owner assets even when presets succeed', async () => {
  const ai = aiClient({
    assets: async () => ({
      assets: [{ voiceAssetId: 'foreign', appId: 'nimi.desktop', subjectUserId: 'user-2' }],
    }),
  });
  const shared = sharedAIConfig();

  await assert.rejects(
    loadAgentRuntimeVoiceCatalog({
      ai: ai.client as never,
      sharedAIConfig: shared.client as never,
      appId: 'nimi.desktop',
      subjectUserId: 'user-1',
    }),
    /cross-owner voice asset/,
  );
});

test('Desktop voice catalog rejects when both Runtime catalogs are unavailable', async () => {
  const ai = aiClient({
    assets: async () => { throw new Error('assets unavailable'); },
  });
  const shared = sharedAIConfig({
    preset: async () => { throw new Error('preset unavailable'); },
  });

  await assert.rejects(
    loadAgentRuntimeVoiceCatalog({
      ai: ai.client as never,
      sharedAIConfig: shared.client as never,
      appId: 'nimi.desktop',
      subjectUserId: 'user-1',
    }),
    /preset unavailable/,
  );
});
