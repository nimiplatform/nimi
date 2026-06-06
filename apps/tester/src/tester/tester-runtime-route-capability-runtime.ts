import {
  createNimiRuntimeRouteCapabilityRuntimeWithHost,
  type NimiRuntimeRouteBinding,
  type NimiRuntimeRouteOptionsSnapshot,
} from '@nimiplatform/sdk/runtime';

function encodeRouteDescribePayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

const testerBinding: NimiRuntimeRouteBinding = {
  source: 'cloud',
  connectorId: 'tester-cloud',
  provider: 'tester',
  model: 'tester-model',
};

function createTesterSnapshot(): NimiRuntimeRouteOptionsSnapshot {
  return {
    capability: 'text.generate',
    selected: testerBinding,
    local: {
      models: [],
    },
    connectors: [{
      id: 'tester-cloud',
      label: 'Tester Cloud',
      provider: 'tester',
      models: ['tester-model'],
      modelCapabilities: {
        'tester-model': ['text.generate'],
      },
    }],
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
            resolvedBindingRef: 'cloud:text.generate:tester-cloud:tester-model',
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
    binding: testerBinding,
  });
  const health = await routeRuntime.checkHealth({
    capability: 'text.generate',
    binding: testerBinding,
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
