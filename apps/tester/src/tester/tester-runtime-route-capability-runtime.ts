import {
  createNimiRuntimeRouteCapabilityRuntimeWithHost,
  type NimiRuntimeRouteTargetRef,
  type NimiRuntimeRouteOptionsSnapshot,
} from '@nimiplatform/sdk/runtime';

function encodeRouteDescribePayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

const testerTargetRef: NimiRuntimeRouteTargetRef = {
  kind: 'cloud-connector',
  version: 'v2',
  connectorId: 'tester-cloud',
  remoteModelCatalogId: 'remote-catalog:tester-cloud:tester-model',
  providerModelId: 'tester-model',
  provider: 'tester',
};

function createTesterSnapshot(): NimiRuntimeRouteOptionsSnapshot {
  return {
    capability: 'text.generate',
    selectedTargetRef: testerTargetRef,
    inventory: {
      capability: 'text.generate',
      targets: [{
        targetRef: testerTargetRef,
        display: {
          label: 'tester-model',
          provider: 'tester',
          model: 'tester-model',
        },
        readiness: {
          status: 'ready',
        },
        compatibility: {
          capabilities: ['text.generate'],
        },
        evidence: {
          source: 'cloud-connector',
          connectorId: 'tester-cloud',
          remoteModelCatalogId: 'remote-catalog:tester-cloud:tester-model',
          providerModelId: 'tester-model',
          provider: 'tester',
        },
      },
      ],
    },
  };
}

export async function createTesterRuntimeRouteCapabilityRuntimeProjection(): Promise<{
  resolvedRef: string;
  healthStatus: string;
  describeTargetId: string;
  supportsThinking: boolean;
}> {
  let describeTargetId = '';
  const routeRuntime = createNimiRuntimeRouteCapabilityRuntimeWithHost({
    loadRuntimeRouteOptions: async () => createTesterSnapshot(),
    checkHealth: async () => ({
      provider: 'tester',
      status: 'healthy',
      detail: '',
    }),
    describeTargetId: 'tester.capability.route',
    buildDescribeCallOptions: async (input) => {
      describeTargetId = input.targetId;
      return {
        timeoutMs: input.timeoutMs,
        metadata: {
          callerKind: 'third-party-app',
          callerId: 'tester.capability.route',
          surfaceId: 'tester',
        },
      };
    },
    getDescribeHost: () => ({
      appId: 'nimi.tester',
      executeScenario: async (_request, options) => {
        options.responseMetadataObserver?.({
          'x-nimi-route-describe-result': encodeRouteDescribePayload({
            capability: 'text.generate',
            metadataVersion: 'v1',
            resolvedBindingRef: 'cloud:text.generate:tester-cloud:remote-catalog%3Atester-cloud%3Atester-model:tester-model',
            metadataKind: 'text.generate',
            metadata: {
              supportsThinking: true,
              traceModeSupport: 'separate',
              supportsImageInput: false,
              supportsAudioInput: false,
              supportsVideoInput: false,
              supportsArtifactRefInput: false,
            },
          }),
        });
        return {};
      },
    }),
  });

  const resolved = await routeRuntime.resolve({
    capability: 'text.generate',
    targetRef: testerTargetRef,
  });
  const health = await routeRuntime.checkHealth({
    capability: 'text.generate',
    targetRef: testerTargetRef,
  });
  const resolvedBindingRef = resolved.resolvedBindingRef;
  if (!resolvedBindingRef) {
    throw new Error('tester route capability runtime did not resolve a binding ref');
  }
  const metadata = await routeRuntime.describe({
    capability: 'text.generate',
    resolvedBindingRef,
  });
  const textMetadata = metadata.metadata as { supportsThinking?: unknown };

  return {
    resolvedRef: resolvedBindingRef,
    healthStatus: String(health.status || ''),
    describeTargetId,
    supportsThinking: textMetadata.supportsThinking === true,
  };
}
