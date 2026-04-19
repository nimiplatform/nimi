import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createDefaultAIScopeRef, createEmptyMemoryEmbeddingConfig } from '@nimiplatform/sdk/mod';
import { getDesktopMemoryEmbeddingConfigService } from '../src/shell/renderer/app-shell/providers/desktop-memory-embedding-config-service';
import { RuntimeConfigMemoryEmbeddingSection } from '../src/shell/renderer/features/runtime-config/runtime-config-memory-embedding-section';
import { createDefaultStateV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-storage-defaults';

function createStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

test('runtime config memory embedding section renders configured cloud selection and ready state', () => {
  const previousLocalStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: createStorageMock(),
  });

  try {
    const scopeRef = createDefaultAIScopeRef();
    const service = getDesktopMemoryEmbeddingConfigService();
    service.memoryEmbeddingConfig.update(scopeRef, {
      ...createEmptyMemoryEmbeddingConfig(scopeRef),
      sourceKind: 'cloud',
      bindingRef: {
        kind: 'cloud',
        connectorId: 'conn-gemini',
        modelId: 'gemini-embedding-001',
      },
    });

    const state = createDefaultStateV11({});
    state.connectors = [{
      id: 'conn-gemini',
      label: 'Gemini Primary',
      vendor: 'gemini',
      provider: 'google',
      endpoint: 'https://generativelanguage.googleapis.com',
      scope: 'user',
      hasCredential: true,
      isSystemOwned: false,
      models: ['gemini-embedding-001'],
      modelCapabilities: {
        'gemini-embedding-001': ['text.embed'],
      },
      status: 'healthy',
      lastCheckedAt: null,
      lastDetail: '',
    }];

    const markup = renderToStaticMarkup(
      <RuntimeConfigMemoryEmbeddingSection state={state} />,
    );

    assert.match(markup, /Memory Embedding/);
    assert.match(markup, /Current selection/);
    assert.match(markup, /conn-gemini \/ gemini-embedding-001/);
    assert.match(markup, />Ready</);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: previousLocalStorage,
    });
  }
});
