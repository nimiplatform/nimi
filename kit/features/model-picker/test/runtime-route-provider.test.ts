import { describe, expect, it } from 'vitest';
import {
  createRuntimeRouteModelPickerProvider,
  createRuntimeRouteModelPickerProviderCache,
} from '../src/runtime.js';
import type {
  NimiRuntimeCanonicalCapability,
  NimiRuntimeRouteOptionsSnapshot,
} from '@nimiplatform/kit/core/sdk-contract';

function makeRouteOptionsLoader() {
  let calls = 0;
  type RouteOptionsInput = { capability: NimiRuntimeCanonicalCapability };
  return {
    get calls() {
      return calls;
    },
    async loadOptions(input: RouteOptionsInput): Promise<NimiRuntimeRouteOptionsSnapshot> {
      calls += 1;
      return {
        capability: input.capability,
        selectedTargetRef: null,
        inventory: {
          capability: input.capability,
          targets: [
            {
              targetRef: {
                kind: 'local-runtime',
                version: 'v2',
                profileBindingId: 'runtime-profile:local-chat',
              },
              display: {
                label: 'local/chat',
                model: 'local/chat',
                engine: 'llama',
              },
              readiness: {
                status: 'active',
              },
              compatibility: {
                capabilities: [input.capability],
              },
              evidence: {
                source: 'local-runtime',
                localAssetId: 'local-chat',
                resolvedModelId: 'local/chat',
                engine: 'llama',
              },
            },
            {
              targetRef: {
                kind: 'cloud-connector',
                version: 'v2',
                connectorId: 'cloud-1',
                remoteModelCatalogId: 'remote-catalog:cloud-1:cloud-model',
                providerModelId: 'cloud-model',
                provider: 'cloud',
              },
              display: {
                label: 'cloud-model',
                modelLabel: 'cloud-model',
                provider: 'cloud',
              },
              readiness: {
                status: 'active',
              },
              compatibility: {
                capabilities: [input.capability],
              },
              evidence: {
                source: 'cloud-connector',
                connectorId: 'cloud-1',
                remoteModelCatalogId: 'remote-catalog:cloud-1:cloud-model',
                providerModelId: 'cloud-model',
                provider: 'cloud',
              },
            },
          ],
        },
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
