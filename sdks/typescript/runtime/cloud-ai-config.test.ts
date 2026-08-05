import assert from 'node:assert/strict';
import test from 'node:test';

import type { NimiRuntimeModelCatalogProvider } from './model-catalog.js';
import { projectNimiRuntimeCloudImplementationOptions } from './cloud-ai-config.js';

function provider(overrides: Partial<NimiRuntimeModelCatalogProvider>): NimiRuntimeModelCatalogProvider {
  return {
    provider: 'openai',
    version: 1,
    catalogVersion: '1',
    source: 'builtin',
    inventoryMode: 'static_source',
    modelCount: 1,
    voiceCount: 0,
    defaultTextModel: 'gpt-test',
    capabilities: ['text.generate'],
    hasOverlay: false,
    customModelCount: 0,
    overriddenModelCount: 0,
    overlayUpdatedAt: '',
    yaml: '',
    effectiveYaml: '',
    defaultEndpoint: 'https://example.test',
    requiresExplicitEndpoint: false,
    runtimePlane: 'remote',
    executionModule: 'nimillm',
    managedSupported: true,
    ...overrides,
  };
}

test('Cloud implementation choices come only from the admitted Runtime provider set', () => {
  const options = projectNimiRuntimeCloudImplementationOptions([
    provider({ provider: 'openai_compatible' }),
    provider({ provider: 'local', runtimePlane: 'local' }),
    provider({ provider: 'image-only', capabilities: ['image.generate'] }),
    provider({ provider: 'unmanaged', managedSupported: false }),
  ], 'text.generate');

  assert.deepEqual(options, [{
    optionId: 'openai_compatible',
    label: 'Openai Compatible',
    capabilityContract: 'text.generate',
    provider: 'openai_compatible',
    implementation: {
      implementationId: 'openai_compatible',
      driverId: 'nimillm',
      driverDialect: 'openai_compatible',
    },
  }]);
  assert.doesNotMatch(JSON.stringify(options), /connector|grant/iu);
});
