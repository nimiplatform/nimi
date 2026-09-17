export const simulatorConformanceFixture = {
  protocol: 'nimi.simulator.module/v1',
  moduleId: 'lab',
  catalog: {
    commandSchemas: {
      'lab.ecosystem.observe': {
        kind: 'object',
        properties: {
          protocolRevision: { kind: 'integer', minimum: 1, maximum: 1 },
          ecosystemRevision: { kind: 'integer', minimum: 1 },
          interactionId: { kind: 'string', minLength: 1, maxLength: 256 },
          committedAt: { kind: 'integer', minimum: 0 },
        },
      },
      'lab.persona.observe': {
        kind: 'object',
        properties: {
          protocolRevision: { kind: 'integer', minimum: 1, maximum: 1 },
          ecosystemRevision: { kind: 'integer', minimum: 1 },
          interactionId: { kind: 'string', minLength: 1, maxLength: 256 },
          committedAt: { kind: 'integer', minimum: 0 },
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
        },
      },
      'lab.run.allocate': { kind: 'object', properties: {} },
      'lab.capability.execute': {
        kind: 'object',
        properties: {
          capabilityId: { kind: 'stringEnum', values: ['text.generate'] },
          prompt: { kind: 'string', minLength: 1, maxLength: 20000 },
        },
      },
      'lab.ai-config.overwrite': {
        kind: 'object',
        properties: {
          expectedRevision: { kind: 'string', minLength: 1, maxLength: 32 },
          capabilities: { kind: 'array', items: { kind: 'json' }, maxItems: 64 },
        },
      },
      'lab.history.append': { kind: 'object', properties: { record: { kind: 'json' } } },
      'lab.history.remove': {
        kind: 'object',
        properties: { recordId: { kind: 'string', minLength: 1, maxLength: 256 } },
      },
      'lab.history.clear': {
        kind: 'object',
        properties: {
          capabilityId: { kind: 'union', variants: [{ kind: 'null' }, { kind: 'string', minLength: 1, maxLength: 128 }] },
        },
      },
      'lab.image-history.append': { kind: 'object', properties: { record: { kind: 'json' } } },
      'lab.image-history.remove': {
        kind: 'object',
        properties: { runId: { kind: 'string', minLength: 1, maxLength: 256 } },
      },
      'lab.image-history.clear': {
        kind: 'object',
        properties: {
          capabilityId: { kind: 'union', variants: [{ kind: 'null' }, { kind: 'string', minLength: 1, maxLength: 128 }] },
        },
      },
      'lab.asset.write': {
        kind: 'object',
        properties: {
          relativePath: { kind: 'string', minLength: 1, maxLength: 240 },
          mediaType: { kind: 'string', maxLength: 255 },
          overwrite: { kind: 'boolean' },
          sizeBytes: { kind: 'integer', minimum: 1, maximum: 32768 },
          sha256: { kind: 'string', minLength: 71, maxLength: 71 },
          body: { kind: 'array', items: { kind: 'integer', minimum: 0, maximum: 255 }, maxItems: 32768 },
        },
      },
      'lab.asset.remove': {
        kind: 'object',
        properties: { relativePath: { kind: 'string', minLength: 1, maxLength: 240 } },
      },
      'lab.asset.move': {
        kind: 'object',
        properties: {
          from: { kind: 'string', minLength: 1, maxLength: 240 },
          to: { kind: 'string', minLength: 1, maxLength: 240 },
          overwrite: { kind: 'boolean' },
        },
      },
      'lab.asset.adopt': {
        kind: 'object',
        properties: {
          artifactId: { kind: 'string', minLength: 1, maxLength: 512 },
          relativePath: { kind: 'string', minLength: 1, maxLength: 240 },
          overwrite: { kind: 'boolean' },
        },
      },
      'lab.action.record': {
        kind: 'object',
        properties: {
          kind: { kind: 'stringEnum', values: ['telemetry-runtime', 'telemetry-renderer'] },
          channel: { kind: 'string', minLength: 1, maxLength: 128 },
          details: { kind: 'json' },
        },
      },
      'lab.preferences.save': { kind: 'object', properties: { preferences: { kind: 'json' } } },
      'lab.prompt.save': {
        kind: 'object',
        properties: {
          key: {
            kind: 'object',
            properties: {
              surfaceId: { kind: 'string', minLength: 1, maxLength: 128 },
              capabilityId: { kind: 'string', minLength: 1, maxLength: 128 },
              scenarioId: { kind: 'string', minLength: 1, maxLength: 256 },
            },
          },
          prompt: { kind: 'string', maxLength: 20000 },
          enabled: { kind: 'boolean' },
        },
      },
    },
    eventSchemas: {},
    moduleData: {
      generatedText: 'Nimi connects apps through one shared, simulated ecosystem state.',
      runtimePlatform: {
        status: 'ready',
        mode: 'local-app',
        localAppSession: {
          mode: 'local-app',
          state: 'session-bound',
          sessionBound: true,
          reasonCode: 'ACTION_EXECUTED',
          actionHint: '',
          retryable: false,
        },
      },
      aiConfigSummary: {
        runtime: {
          status: 'connected',
          mode: 'simulated',
          detail: 'The selected Lab source replaces declared owner call results with deterministic Simulator data.',
        },
      },
      adoptionArtifacts: {
        'simulator-artifact-png': {
          mediaType: 'image/png',
          sizeBytes: 8,
          sha256: 'sha256:4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6',
          body: [137, 80, 78, 71, 13, 10, 26, 10],
        },
      },
    },
  },
  lifecycle: ['prepare', 'activate', 'deactivate', 'dispose'],
} as const;
