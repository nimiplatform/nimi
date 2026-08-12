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

test('Desktop Cloud choices preserve implementation, target, and current-account Connector boundaries', async () => {
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
    async listConnectorModels(request: { connectorId: string }) {
      assert.equal(request.connectorId, 'connector-1');
      return {
        models: [{
          modelLabel: 'GPT Test',
          available: true,
          capabilities: ['text.generate'],
          remoteModelCatalogId: 'rmc-openai-gpt-test',
          providerModelId: 'gpt-test',
          provider: 'openai',
          connectorSnapshotId: 'connector-snapshot',
          endpointProfileId: 'endpoint-profile',
          inventorySnapshotId: 'inventory-snapshot',
        }],
        nextPageToken: '',
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
        connectors: [
          {
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
          },
          {
            connectorId: 'connector-unconfigured',
            kind: ConnectorKind.REMOTE_MANAGED,
            ownerType: ConnectorOwnerType.REALM_USER,
            ownerId: 'user-1',
            provider: 'anthropic',
            endpoint: '',
            label: 'Unconfigured account',
            status: ConnectorStatus.ACTIVE,
            localCategory: 0,
            hasCredential: false,
            authKind: ConnectorAuthKind.API_KEY,
            providerAuthProfile: '',
          },
        ],
        nextPageToken: '',
      };
    },
  };
  const sdk = {
    connectorAdmin: () => connectorAdmin,
    accountProduct: () => ({}),
  } as unknown as Pick<DesktopRendererSdkPort, 'connectorAdmin' | 'accountProduct'>;
  const module = createDesktopCloudAIConfigModule(sdk);

  const implementations = await module.listImplementations('text.generate');
  const targets = await module.listTargets({
    capabilityContract: 'text.generate',
    provider: 'openai',
    connectorId: 'connector-1',
  });
  const authorization = await module.listAuthorizationOptions();

  assert.equal(implementations[0]?.provider, 'openai');
  assert.doesNotMatch(JSON.stringify(implementations), /connector|grant|providerModelTarget/i);
  assert.deepEqual(targets[0]?.providerModelTarget, {
    provider: 'openai',
    providerModelId: 'gpt-test',
    remoteModelCatalogId: 'rmc-openai-gpt-test',
  });
  assert.doesNotMatch(JSON.stringify(targets), /connector|grant|implementation/i);
  assert.deepEqual(authorization.connectors.map((connector) => connector.connectorId), ['connector-1']);
  assert.doesNotMatch(JSON.stringify(authorization), /providerModelTarget|implementation/i);
});
