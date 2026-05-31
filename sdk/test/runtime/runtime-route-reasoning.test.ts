import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeRuntimeRouteReasoningPreference,
  resolveRuntimeRouteReasoningConfig,
  resolveRuntimeTextRouteReasoningSupport,
  type RuntimeResolvedBinding,
  type RuntimeRouteDescribeResult,
} from '../../src/runtime/index.js';

const resolvedBinding: RuntimeResolvedBinding = {
  capability: 'text.generate',
  source: 'cloud',
  connectorId: 'tester-cloud',
  provider: 'tester',
  model: 'tester-reasoning-model',
  modelId: 'tester-reasoning-model',
  resolvedBindingRef: 'binding:tester-reasoning',
};

function textMetadata(overrides: Partial<RuntimeRouteDescribeResult['metadata']> = {}): RuntimeRouteDescribeResult {
  return {
    capability: 'text.generate',
    metadataVersion: 'v1',
    resolvedBindingRef: 'binding:tester-reasoning',
    metadataKind: 'text.generate',
    metadata: {
      supportsThinking: true,
      traceModeSupport: 'separate',
      supportsImageInput: false,
      supportsAudioInput: false,
      supportsVideoInput: false,
      supportsArtifactRefInput: false,
      ...overrides,
    },
  };
}

test('runtime route reasoning support projects text.generate metadata without owning routing truth', () => {
  assert.deepEqual(resolveRuntimeTextRouteReasoningSupport({
    resolvedBinding,
    metadata: textMetadata(),
  }), {
    supported: true,
    reason: null,
  });

  assert.deepEqual(resolveRuntimeTextRouteReasoningSupport({
    resolvedBinding,
    metadata: textMetadata({ supportsThinking: false }),
  }), {
    supported: false,
    reason: 'thinking_unsupported',
  });

  assert.deepEqual(resolveRuntimeTextRouteReasoningSupport({
    resolvedBinding,
    metadata: textMetadata({ traceModeSupport: 'hide' }),
  }), {
    supported: false,
    reason: 'trace_mode_unsupported',
  });
});

test('runtime route reasoning support fails closed without resolved route metadata', () => {
  assert.deepEqual(resolveRuntimeTextRouteReasoningSupport({
    resolvedBinding: null,
    metadata: textMetadata(),
  }), {
    supported: false,
    reason: 'missing_route',
  });

  assert.deepEqual(resolveRuntimeTextRouteReasoningSupport({
    resolvedBinding,
    metadata: null,
  }), {
    supported: false,
    reason: 'metadata_missing',
  });
});

test('runtime route reasoning config only enables reasoning when caller preference and support agree', () => {
  assert.equal(normalizeRuntimeRouteReasoningPreference('on'), 'on');
  assert.equal(normalizeRuntimeRouteReasoningPreference('unexpected'), 'off');
  assert.deepEqual(resolveRuntimeRouteReasoningConfig('on', {
    supported: true,
    reason: null,
  }), {
    mode: 'on',
    traceMode: 'separate',
  });
  assert.deepEqual(resolveRuntimeRouteReasoningConfig('on', {
    supported: false,
    reason: 'thinking_unsupported',
  }), {
    mode: 'off',
    traceMode: 'hide',
  });
});
