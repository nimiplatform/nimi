import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalTargetKey,
  ensureNimiRouteConfig,
  loadNimiModelRouteCatalog,
  supportsStreamingToolUse,
} from '../src/product/model-routes.ts';

test('loadNimiModelRouteCatalog projects saved configs, local loadout state, and cloud connectors with match links', async () => {
  const targetA = { provider: 'openai', providerModelId: 'gpt-6-luna', remoteModelCatalogId: 'cat-a' };
  const targetB = { provider: 'dashscope', providerModelId: 'qwen3.7-max', remoteModelCatalogId: 'cat-b' };
  const implA = { driverId: 'nimillm', implementationId: 'openai', driverDialect: 'openai' };
  const implB = { driverId: 'nimillm', implementationId: 'dashscope', driverDialect: 'openai-compatible' };
  const audioIntent = {
    capabilityContract: 'audio.transcribe',
    requiredFeatures: [],
    route: { oneofKind: 'cloud', cloud: { connectorRef: 'c-openai', providerModelTarget: {} } },
  };

  const store = new Map([
    ['main', {
      record: { configRef: 'main', name: 'Default', revision: '7', isDefault: true },
      capabilities: [
        audioIntent,
        {
          capabilityContract: 'text.generate',
          requiredFeatures: [],
          route: { oneofKind: 'cloud', cloud: { connectorRef: 'c-openai', implementation: implA, providerModelTarget: targetA } },
        },
      ],
      effectiveSelections: [{
        capabilityContract: 'text.generate',
        state: 'ready',
        resource: {
          oneofKind: 'cloud',
          cloud: {
            connector: { connectorRef: 'c-openai', label: 'openai', provider: 'openai' },
            target: { label: 'gpt-6-luna', providerModelTarget: targetA },
          },
        },
        reasons: [],
      }],
    }],
  ]);

  let localReady = false;
  let overwriteCalls = 0;
  let lastCreatedCaps = [];
  const aiConfig = {
    async get(query) {
      const entry = store.get(query?.configRef ?? 'main');
      return {
        record: entry.record,
        records: query?.includeRecords ? [...store.values()].map(v => v.record) : undefined,
        revision: entry.record.revision,
        config: { capabilities: entry.capabilities },
        effectiveSelections: entry.effectiveSelections,
      };
    },
    async listOptions(query) {
      if (query.kind === 'local-loadouts') {
        return {
          kind: 'local-loadouts',
          options: localReady ? [{ loadoutRef: 'l-1', label: 'Qwen3-8B', state: 'ready', reasons: [] }] : [],
          truncated: false,
        };
      }
      if (query.kind === 'cloud-connectors') {
        return {
          kind: 'cloud-connectors',
          options: [
            { connectorRef: 'c-openai', label: 'openai', provider: 'openai', state: 'ready', reasons: [] },
            { connectorRef: 'c-dash', label: 'dashscope', provider: 'dashscope', state: 'ready', reasons: [] },
          ],
          truncated: false,
        };
      }
      if (query.connectorRef === 'c-openai') {
        return {
          kind: 'cloud-targets',
          options: [{ connectorRef: 'c-openai', label: 'gpt-6-luna', implementation: implA, providerModelTarget: targetA, state: 'ready', reasons: [] }],
          truncated: false,
        };
      }
      return {
        kind: 'cloud-targets',
        options: [{ connectorRef: 'c-dash', label: 'qwen3.7-max', implementation: implB, providerModelTarget: targetB, state: 'ready', reasons: [] }],
        truncated: false,
      };
    },
    async overwrite(input) {
      overwriteCalls += 1;
      lastCreatedCaps = input.capabilities;
      const ref = `${overwriteCalls}`.repeat(32);
      const record = { configRef: ref, name: input.record.name, revision: '1', isDefault: false };
      store.set(ref, {
        record,
        capabilities: input.capabilities,
        effectiveSelections: [{
          capabilityContract: 'text.generate',
          state: 'ready',
          resource: { oneofKind: 'cloud', cloud: { connector: { connectorRef: 'c-dash', label: 'dashscope', provider: 'dashscope' }, target: { label: 'qwen3.7-max', providerModelTarget: targetB } } },
          reasons: [],
        }],
      });
      return { outcome: 'committed', record, revision: '1' };
    },
  };

  const catalog = await loadNimiModelRouteCatalog(aiConfig);
  assert.equal(catalog.local.available, false);
  assert.deepEqual(catalog.cloudConnectors.map(c => c.label), ['dashscope', 'openai']);
  const openaiTarget = catalog.cloudConnectors.find(c => c.label === 'openai').targets[0];
  assert.equal(openaiTarget.matchedConfigRef, 'main');

  // Reuses existing config when Cloud target already matches Default
  const reused = await ensureNimiRouteConfig(aiConfig, {
    route: 'cloud',
    connectorRef: 'c-openai',
    targetKey: canonicalTargetKey(targetA),
  });
  assert.equal(reused.created, false);
  assert.equal(reused.configRef, 'main');
  assert.equal(overwriteCalls, 0);

  // Rejects Local when no local model is configured
  await assert.rejects(ensureNimiRouteConfig(aiConfig, { route: 'local' }), /No ready on-device text model/);

  // Creates canonical named AppAIConfig for a new Cloud target while preserving audio.transcribe
  const created = await ensureNimiRouteConfig(aiConfig, {
    route: 'cloud',
    connectorRef: 'c-dash',
    targetKey: canonicalTargetKey(targetB),
  });
  assert.equal(created.created, true);
  assert.equal(created.name, 'dashscope / qwen3.7-max');
  assert.equal(overwriteCalls, 1);
  assert.deepEqual(lastCreatedCaps.map(c => c.capabilityContract).sort(), ['audio.transcribe', 'text.generate']);

  // Creates Local AppAIConfig once Local loadout becomes ready
  localReady = true;
  const createdLocal = await ensureNimiRouteConfig(aiConfig, { route: 'local' });
  assert.equal(createdLocal.created, true);
  assert.equal(createdLocal.name, 'Local · Qwen3-8B');
});

test('supportsStreamingToolUse excludes sync-only and unconfigured Cloud targets when Runtime projects textBehaviors', () => {
  assert.equal(supportsStreamingToolUse({}), true);
  assert.equal(supportsStreamingToolUse({ textBehaviors: [] }), true);
  assert.equal(supportsStreamingToolUse({
    textBehaviors: [
      { kind: 'tool-use', configurationState: 'configured', configuredToolUse: { supportsStream: true } },
    ],
  }), true);
  assert.equal(supportsStreamingToolUse({
    textBehaviors: [
      { kind: 'tool-use', configurationState: 'configured', configuredToolUse: { supportsStream: false } },
    ],
  }), false);
  assert.equal(supportsStreamingToolUse({
    textBehaviors: [
      { kind: 'tool-use', configurationState: 'unavailable' },
    ],
  }), false);
});
