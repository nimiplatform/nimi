import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CatalogModelSource,
  ConnectorAuthKind,
  ConnectorKind,
  ConnectorOwnerType,
  ConnectorStatus,
  ModelCatalogProviderSource,
} from '@nimiplatform/sdk/runtime/generated';
import { createDesktopCloudAIConfigModule } from '../src/shell/renderer/features/chat/chat-cloud-ai-config-module.js';
import type { DesktopRendererSdkPort } from '../src/shell/renderer/renderer/sdk-port.js';

function provider() {
  return {
    provider: 'openai',
    version: 1,
    catalogVersion: '2026-08-01',
    source: ModelCatalogProviderSource.BUILTIN,
    modelCount: 1,
    voiceCount: 0,
    yaml: '',
    defaultTextModel: 'gpt-test',
    capabilities: ['text.generate'],
    hasOverlay: false,
    customModelCount: 0,
    overriddenModelCount: 0,
    overlayUpdatedAt: '',
    effectiveYaml: '',
    defaultEndpoint: 'https://api.openai.example/v1',
    requiresExplicitEndpoint: false,
    runtimePlane: 'remote',
    executionModule: 'nimillm',
    managedSupported: true,
    inventoryMode: 'static_source',
  };
}

test('Desktop Cloud choices preserve implementation, target, and ConnectorGrant boundaries', async () => {
  const create = async (connectorId: string) => ({
    grantId: 'grant-new',
    connectorId,
    status: 'active' as const,
    createdAt: '2026-08-05T00:00:00.000Z',
    revokedAt: null,
  });
  const connectorAdmin = {
    async listModelCatalogProviders() { return { providers: [provider()] }; },
    async listCatalogProviderModels() {
      return {
        provider: provider(),
        models: [{
          provider: 'openai',
          modelId: 'gpt-test',
          modelType: 'text',
          updatedAt: '2026-08-01',
          capabilities: ['text.generate'],
          source: CatalogModelSource.BUILTIN,
          userScoped: false,
          sourceNote: '',
          hasVoiceCatalog: false,
          hasVideoGeneration: false,
        }],
        nextPageToken: '',
        warnings: [],
      };
    },
    async listProviderCatalog() {
      return { providers: [{
        provider: 'openai',
        defaultEndpoint: 'https://api.openai.example/v1',
        requiresExplicitEndpoint: false,
        runtimePlane: 'cloud',
        executionModule: 'cloud',
        managedSupported: true,
        inventoryMode: 'static_source',
        inlineSupported: false,
      }] };
    },
    async listConnectors() {
      return {
        connectors: [{
          connectorId: 'connector-1',
          kind: ConnectorKind.REMOTE_MANAGED,
          ownerType: ConnectorOwnerType.REALM_USER,
          ownerId: 'user-1',
          provider: 'openai',
          endpoint: '',
          label: 'Work account',
          status: ConnectorStatus.ACTIVE,
          localCategory: 0,
          hasCredential: true,
          authKind: ConnectorAuthKind.API_KEY,
          providerAuthProfile: '',
        }],
        nextPageToken: '',
      };
    },
  };
  const sdk = {
    connectorAdmin: () => connectorAdmin,
    accountProduct: () => ({
      connectorGrants: {
        create,
        async list() {
          return [{
            grantId: 'grant-1',
            connectorId: 'connector-1',
            status: 'active' as const,
            createdAt: '2026-08-04T00:00:00.000Z',
            revokedAt: null,
          }];
        },
      },
    }),
  } as unknown as Pick<DesktopRendererSdkPort, 'connectorAdmin' | 'accountProduct'>;
  const module = createDesktopCloudAIConfigModule(sdk);

  const implementations = await module.listImplementations('text.generate');
  const targets = await module.listTargets({ capabilityContract: 'text.generate', provider: 'openai' });
  const authorization = await module.listAuthorizationOptions();
  const created = await module.createGrant('connector-1');

  assert.equal(implementations[0]?.provider, 'openai');
  assert.doesNotMatch(JSON.stringify(implementations), /connector|grant|providerModelTarget/i);
  assert.deepEqual(targets[0]?.providerModelTarget, { provider: 'openai', providerModelId: 'gpt-test' });
  assert.doesNotMatch(JSON.stringify(targets), /connector|grant|implementation/i);
  assert.equal(authorization.grants[0]?.grantId, 'grant-1');
  assert.doesNotMatch(JSON.stringify(authorization), /providerModelTarget|implementation/i);
  assert.equal(created.grantId, 'grant-new');
});
