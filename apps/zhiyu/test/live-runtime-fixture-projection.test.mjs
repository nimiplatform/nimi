import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createZhiyuLiveRuntimeAcceptanceRendererUrl,
  createZhiyuLiveRuntimeFixtureAcceptanceInitScript,
} from './electron-live-runtime-acceptance-helpers.mjs';

const fixture = {
  ownerUserId: 'user-live',
  runtimeSourceRef: 'runtime-source:worldCharacter:world-live:source-live:hash-live',
  sourceRef: {
    kind: 'worldCharacter',
    worldId: 'world-live',
    sourceId: 'source-live',
    sourceContentHash: 'hash-live',
  },
  route: {
    capability: 'text.generate',
    selectedTargetRefKind: 'local-runtime',
    resolvedBindingRef: 'local:text.generate:fixture',
    executionBinding: {
      route: 'local',
      modelId: 'local/live-runtime-fixture',
    },
  },
};

test('live Runtime acceptance does not inject pre-materialized renderer source truth', () => {
  globalThis.window = {};

  const script = createZhiyuLiveRuntimeFixtureAcceptanceInitScript(fixture);
  Function(script)();

  assert.deepEqual(window, {});
  assert.doesNotMatch(script, /ownerUserId|runtimeSourceRef|sourceRef|sourceContentHash/);
  assert.doesNotMatch(script, /executionBinding|resolvedBindingRef|selectedTargetRefKind|modelId/);
  assert.doesNotMatch(script, /SourceMaterializationPacket|apps\/desktop|runtime\/internal|apiKey|providerId/);
});

test('live Runtime fixture adapter renderer URL carries acceptance gate but no fixture truth', () => {
  const url = new URL(createZhiyuLiveRuntimeAcceptanceRendererUrl('/tmp/zhiyu'));

  assert.equal(url.searchParams.get('nimiElectronSdkAcceptance'), '1');
  assert.equal(url.searchParams.has('nimiZhiyuLiveRuntimeFixture'), false);
  assert.doesNotMatch(url.href, /source-live|hash-live|runtime-agent-live-e2e|resolvedBindingRef/);
});
