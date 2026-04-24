import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyAIConfig, type AIConfig, type RuntimeRouteBinding } from '@nimiplatform/sdk/mod';

import {
  TESTER_AI_SCOPE_REF,
  bootstrapTesterAIConfigScope,
  migrateTesterLegacyCapabilityKeys,
} from '../src/shell/renderer/features/tester/tester-ai-config.js';

function makeBinding(model: string): RuntimeRouteBinding {
  return {
    source: 'cloud',
    connectorId: 'connector-x',
    model,
    modelLabel: model,
  } as unknown as RuntimeRouteBinding;
}

function makeConfigWithLegacyKeys(): AIConfig {
  const base = createEmptyAIConfig(TESTER_AI_SCOPE_REF);
  return {
    ...base,
    capabilities: {
      ...base.capabilities,
      selectedBindings: {
        'voice.clone': makeBinding('voice-clone-model'),
        'voice.design': makeBinding('voice-design-model'),
        'text.generate': makeBinding('text-model'),
      },
      selectedParams: {
        'voice.clone': { seed: 42 },
        'voice.design': { style: 'bright' },
        'text.generate': { temperature: 0.7 },
      },
    },
  };
}

test('migrateTesterLegacyCapabilityKeys renames legacy voice keys to canonical workflow ids', () => {
  const config = makeConfigWithLegacyKeys();
  const migrated = migrateTesterLegacyCapabilityKeys(config);

  assert.notStrictEqual(migrated, config, 'expect new object when legacy keys present');
  assert.deepStrictEqual(Object.keys(migrated.capabilities.selectedBindings || {}).sort(), [
    'text.generate',
    'voice_workflow.tts_t2v',
    'voice_workflow.tts_v2v',
  ]);
  assert.deepStrictEqual(Object.keys(migrated.capabilities.selectedParams || {}).sort(), [
    'text.generate',
    'voice_workflow.tts_t2v',
    'voice_workflow.tts_v2v',
  ]);
  assert.deepStrictEqual(migrated.capabilities.selectedParams['voice_workflow.tts_v2v'], { seed: 42 });
  assert.deepStrictEqual(migrated.capabilities.selectedParams['voice_workflow.tts_t2v'], { style: 'bright' });
  assert.strictEqual(migrated.capabilities.selectedBindings['voice.clone'], undefined);
  assert.strictEqual(migrated.capabilities.selectedBindings['voice.design'], undefined);
});

test('migrateTesterLegacyCapabilityKeys is idempotent — second run returns same reference', () => {
  const config = makeConfigWithLegacyKeys();
  const first = migrateTesterLegacyCapabilityKeys(config);
  const second = migrateTesterLegacyCapabilityKeys(first);
  assert.strictEqual(second, first, 'second migrate must be no-op (same reference)');
});

test('migrateTesterLegacyCapabilityKeys returns original reference when no legacy keys exist', () => {
  const fresh = createEmptyAIConfig(TESTER_AI_SCOPE_REF);
  const canonical: AIConfig = {
    ...fresh,
    capabilities: {
      ...fresh.capabilities,
      selectedBindings: {
        'voice_workflow.tts_v2v': makeBinding('voice-v2v'),
        'text.generate': makeBinding('text-model'),
      },
      selectedParams: {
        'voice_workflow.tts_t2v': { style: 'bright' },
      },
    },
  };
  const result = migrateTesterLegacyCapabilityKeys(canonical);
  assert.strictEqual(result, canonical);
});

test('bootstrapTesterAIConfigScope writes back exactly once when legacy keys are present', () => {
  let stored = makeConfigWithLegacyKeys();
  const updates: AIConfig[] = [];
  const surface = {
    aiConfig: {
      get: () => stored,
      update: (_scope: unknown, next: AIConfig) => {
        stored = next;
        updates.push(next);
      },
    },
  };

  const first = bootstrapTesterAIConfigScope(surface);
  assert.strictEqual(updates.length, 1, 'legacy cleanup must persist once');
  assert.ok(!('voice.clone' in (first.capabilities.selectedBindings as object)));

  bootstrapTesterAIConfigScope(surface);
  assert.strictEqual(updates.length, 1, 'idempotent bootstrap must not write again');
});

test('bootstrapTesterAIConfigScope propagates persistence failure fail-close', () => {
  const failing = {
    aiConfig: {
      get: () => makeConfigWithLegacyKeys(),
      update: () => {
        throw new Error('persistence offline');
      },
    },
  };
  assert.throws(() => bootstrapTesterAIConfigScope(failing), /persistence offline/);
});
