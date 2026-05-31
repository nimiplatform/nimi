import { describe, expect, it } from 'vitest';
import {
  createRuntimeRouteModelPickerProvider,
  createRuntimeRouteModelPickerProviderCache,
} from '../src/runtime.js';
import type {
  RuntimeCanonicalCapability,
  RuntimeRouteOptionsSnapshot,
} from '@nimiplatform/kit/core/sdk-contract';

function makeRouteOptionsLoader() {
  let calls = 0;
  type RouteOptionsInput = { capability: RuntimeCanonicalCapability };
  return {
    get calls() {
      return calls;
    },
    async loadOptions(input: RouteOptionsInput): Promise<RuntimeRouteOptionsSnapshot> {
      calls += 1;
      return {
        capability: input.capability,
        selected: null,
        local: {
          models: [
            {
              localModelId: 'local-chat',
              model: 'local/chat',
              modelId: 'local/chat',
              engine: 'llama',
              status: 'active',
              capabilities: [input.capability],
            },
          ],
          defaultEndpoint: 'http://127.0.0.1:11434/v1',
        },
        connectors: [
          {
            id: 'cloud-1',
            label: 'Cloud',
            provider: 'cloud',
            models: ['cloud-model'],
            modelCapabilities: {
              'cloud-model': [input.capability],
            },
          },
        ],
      };
    },
  };
}

describe('createRuntimeRouteModelPickerProvider', () => {
  it('uses SDK runtime.route options as the single snapshot source', async () => {
    const fixture = makeRouteOptionsLoader();
    const provider = createRuntimeRouteModelPickerProvider({
      capability: 'text.generate',
      loadOptions: fixture.loadOptions,
    });

    const [localModels, connectors, connectorModels] = await Promise.all([
      provider.listLocalModels(),
      provider.listConnectors(),
      provider.listConnectorModels('cloud-1'),
    ]);

    expect(fixture.calls).toBe(1);
    expect(localModels[0]?.localModelId).toBe('local-chat');
    expect(connectors[0]?.connectorId).toBe('cloud-1');
    expect(connectorModels[0]?.capabilities).toEqual(['text.generate']);
  });

  it('fails closed on empty capability tokens', () => {
    expect(() => createRuntimeRouteModelPickerProvider({
      capability: ' ',
      loadOptions: makeRouteOptionsLoader().loadOptions,
    })).toThrow('Runtime route capability is required');
  });

  it('caches providers by normalized capability', () => {
    const fixture = makeRouteOptionsLoader();
    const resolveProvider = createRuntimeRouteModelPickerProviderCache({
      loadOptions: fixture.loadOptions,
    });

    const first = resolveProvider('text.generate');
    const second = resolveProvider('text.generate');
    const invalid = resolveProvider(' ');

    expect(first).toBeTruthy();
    expect(second).toBe(first);
    expect(invalid).toBeNull();
  });
});
