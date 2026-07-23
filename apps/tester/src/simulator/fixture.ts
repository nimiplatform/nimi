export const simulatorConformanceFixture = {
  protocol: 'nimi.simulator.module/v1',
  moduleId: 'tester',
  catalog: {
    commandSchemas: {
      'tester.ecosystem.observe': {
        kind: 'object',
        properties: {
          protocolRevision: { kind: 'integer', minimum: 1, maximum: 1 },
          ecosystemRevision: { kind: 'integer', minimum: 1 },
          interactionId: { kind: 'string', minLength: 1, maxLength: 256 },
          checkpointId: { kind: 'string', minLength: 1, maxLength: 128 },
          label: { kind: 'string', minLength: 1, maxLength: 256 },
          committedAt: { kind: 'integer', minimum: 0 },
        },
      },
      'tester.persona.observe': {
        kind: 'object',
        properties: {
          protocolRevision: { kind: 'integer', minimum: 1, maximum: 1 },
          ecosystemRevision: { kind: 'integer', minimum: 1 },
          interactionId: { kind: 'string', minLength: 1, maxLength: 256 },
          persona: {
            kind: 'object',
            properties: {
              accountId: { kind: 'string', minLength: 1, maxLength: 128 },
              userId: { kind: 'string', minLength: 1, maxLength: 128 },
              displayName: { kind: 'string', minLength: 1, maxLength: 128 },
              role: { kind: 'string', minLength: 1, maxLength: 128 },
              realmEnvironmentId: { kind: 'string', minLength: 1, maxLength: 128 },
            },
          },
          committedAt: { kind: 'integer', minimum: 0 },
        },
      },
      'tester.run.allocate': {
        kind: 'object',
        properties: {},
      },
      'tester.capability.execute': {
        kind: 'object',
        properties: {
          capabilityId: {
            kind: 'stringEnum',
            values: ['text.generate'],
          },
          prompt: { kind: 'string', maxLength: 20000 },
          scenarioId: { kind: 'union', variants: [{ kind: 'null' }, { kind: 'string', maxLength: 256 }] },
          attachmentCount: { kind: 'integer', minimum: 0, maximum: 16 },
          directive: { kind: 'union', variants: [{ kind: 'null' }, { kind: 'string', maxLength: 2000 }] },
        },
      },
      'tester.history.append': {
        kind: 'object',
        properties: { record: { kind: 'json' } },
      },
      'tester.image-history.append': {
        kind: 'object',
        properties: { record: { kind: 'json' } },
      },
      'tester.prompt.save': {
        kind: 'object',
        properties: {
          key: {
            kind: 'object',
            properties: {
              surfaceId: { kind: 'stringEnum', values: ['app-lab', 'ai-capabilities'] },
              capabilityId: { kind: 'string', maxLength: 128 },
              scenarioId: { kind: 'string', maxLength: 256 },
            },
          },
          prompt: { kind: 'string', maxLength: 20000 },
          enabled: { kind: 'boolean' },
        },
      },
      'tester.action.record': {
        kind: 'object',
        properties: {
          kind: {
            kind: 'stringEnum',
            values: ['permission-request', 'telemetry-runtime', 'telemetry-renderer'],
          },
          subject: { kind: 'string', maxLength: 512 },
          details: { kind: 'json' },
        },
      },
      'tester.ai-config.update': {
        kind: 'object',
        properties: { config: { kind: 'json' } },
      },
    },
    eventSchemas: {},
    moduleData: {
      generatedText: 'Nimi connects apps through one shared, simulated ecosystem state.',
      textModel: {
        providerId: 'simulated-provider',
        modelId: 'simulated-text-model',
      },
      connector: {
        connectorId: 'simulated-connector',
        provider: 'simulated-provider',
        label: 'Simulator Cloud',
        remoteModelCatalogId: 'simulated-catalog',
        providerModelId: 'simulated-text-model',
        modelLabel: 'Simulator Text Model',
      },
      runtimePlatform: {
        status: 'unavailable',
        mode: 'local-app',
        reasonCode: 'simulator-local-app-unavailable',
        message: 'Local-app identity and Desktop protection are unavailable in the Simulator.',
        actionHint: 'use_simulated_capability',
      },
      aiConfigSummary: {
        runtime: {
          status: 'simulated',
          mode: 'simulated',
          detail: 'The SDK testing facade uses deterministic Simulator State Engine data; no Runtime connection is established.',
        },
        schedulingOwner: 'runtime',
        providerCatalogSurface: 'sdk.runtime.listNimiRuntimeRouteOptions',
        appLocalProviderDefaults: false,
      },
    },
  },
  readiness: [{
    contractId: 'tester.main.usable',
    surfaceId: 'main',
    rootContentSemanticId: 'tester-main-root',
    primaryControl: {
      semanticId: 'tester-primary-action',
      ariaRole: 'button',
      accessibleName: 'Text Studio',
    },
  }],
  lifecycle: ['prepare', 'activate', 'deactivate', 'dispose'],
} as const;
