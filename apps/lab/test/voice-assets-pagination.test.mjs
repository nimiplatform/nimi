import assert from 'node:assert/strict';
import test from 'node:test';
import { listLabVoiceAssets } from '../src/ai-studio-core/voice-assets.ts';

const asset = (voiceAssetId) => ({ voiceAssetId, creationSource: 'text-description', status: 'active' });

test('voice catalog reads the second page before deciding a saved voice is absent', async () => {
  const calls = [];
  const voices = await listLabVoiceAssets({ list: async (input) => {
    calls.push(input);
    return input.pageToken === ''
      ? { assets: [asset('first')], nextPageToken: '100' }
      : { assets: [asset('saved-on-second-page')], nextPageToken: '' };
  } });
  assert.deepEqual(calls, [{ pageSize: 100, pageToken: '' }, { pageSize: 100, pageToken: '100' }]);
  assert.equal(voices.find((voice) => voice.voiceAssetId === 'saved-on-second-page')?.status, 'active');
});

test('later page failure rejects the catalog instead of returning a partial absence', async () => {
  const failure = new Error('catalog unavailable');
  await assert.rejects(listLabVoiceAssets({ list: async ({ pageToken }) => {
    if (pageToken) throw failure;
    return { assets: [asset('first')], nextPageToken: '100' };
  } }), (error) => error === failure);
});

test('a repeated voice catalog cursor stops before another request', async () => {
  let calls = 0;
  await assert.rejects(listLabVoiceAssets({ list: async () => {
    calls += 1;
    return { assets: [asset('first')], nextPageToken: '100' };
  } }), /VOICE_ASSET_CATALOG_CURSOR_REPEATED/);
  assert.equal(calls, 2);
});
