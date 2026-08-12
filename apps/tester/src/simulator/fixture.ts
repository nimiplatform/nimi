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
      'tester.image-history.remove': {
        kind: 'object',
        properties: { runId: { kind: 'string', minLength: 1, maxLength: 256 } },
      },
      'tester.image-history.clear': {
        kind: 'object',
        properties: {
          capabilityId: { kind: 'union', variants: [{ kind: 'null' }, { kind: 'string', minLength: 1, maxLength: 128 }] },
        },
      },
      'tester.asset.write': {
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
      'tester.asset.remove': {
        kind: 'object',
        properties: { relativePath: { kind: 'string', minLength: 1, maxLength: 240 } },
      },
      'tester.asset.move': {
        kind: 'object',
        properties: {
          from: { kind: 'string', minLength: 1, maxLength: 240 },
          to: { kind: 'string', minLength: 1, maxLength: 240 },
          overwrite: { kind: 'boolean' },
        },
      },
      'tester.asset.adopt': {
        kind: 'object',
        properties: {
          artifactId: { kind: 'string', minLength: 1, maxLength: 512 },
          relativePath: { kind: 'string', minLength: 1, maxLength: 240 },
          overwrite: { kind: 'boolean' },
        },
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
            values: ['telemetry-runtime', 'telemetry-renderer'],
          },
          subject: { kind: 'string', maxLength: 512 },
          details: { kind: 'json' },
        },
      },
    },
    eventSchemas: {},
    moduleData: {
      generatedText: 'Nimi connects apps through one shared, simulated ecosystem state.',
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
