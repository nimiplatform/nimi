export const simulatorConformanceFixture = {
  protocol: 'nimi.simulator.module/v1',
  moduleId: 'zhiyu',
  catalog: {
    commandSchemas: {
      'zhiyu.ecosystem.project': {
        kind: 'object',
        properties: {
          protocolRevision: { kind: 'integer', minimum: 1, maximum: 1 },
          ecosystemRevision: { kind: 'integer', minimum: 1 },
          interactionId: { kind: 'string', minLength: 1, maxLength: 256 },
          committedAt: { kind: 'integer', minimum: 0 },
        },
      },
      'zhiyu.turn.allocate': {
        kind: 'object',
        properties: {},
      },
      'zhiyu.persona.project': {
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
      'zhiyu.handoff.accept': {
        kind: 'object',
        properties: {
          protocolRevision: { kind: 'integer', minimum: 1, maximum: 1 },
          ecosystemRevision: { kind: 'integer', minimum: 1 },
          interactionId: { kind: 'string', minLength: 1, maxLength: 256 },
          targetSurfaceId: { kind: 'string', minLength: 1, maxLength: 64 },
          route: {
            kind: 'object',
            properties: {
              pathname: { kind: 'string', minLength: 1, maxLength: 512 },
              search: {
                kind: 'array',
                items: {
                  kind: 'object',
                  properties: {
                    key: { kind: 'string', minLength: 1, maxLength: 128 },
                    value: { kind: 'string', minLength: 1, maxLength: 256 },
                  },
                },
                maxItems: 8,
              },
              fragment: { kind: 'union', variants: [{ kind: 'null' }, { kind: 'string', maxLength: 256 }] },
            },
          },
          card: {
            kind: 'object',
            properties: {
              title: { kind: 'string', minLength: 1, maxLength: 256 },
              detail: { kind: 'string', minLength: 1, maxLength: 1024 },
            },
          },
          committedAt: { kind: 'integer', minimum: 0 },
        },
      },
      'zhiyu.carry.accept': {
        kind: 'object',
        properties: {
          protocolRevision: { kind: 'integer', minimum: 1, maximum: 1 },
          ecosystemRevision: { kind: 'integer', minimum: 1 },
          interactionId: { kind: 'string', minLength: 1, maxLength: 256 },
          carry: { kind: 'string', minLength: 1, maxLength: 512 },
          card: {
            kind: 'object',
            properties: {
              title: { kind: 'string', minLength: 1, maxLength: 256 },
              detail: { kind: 'string', minLength: 1, maxLength: 1024 },
            },
          },
          committedAt: { kind: 'integer', minimum: 0 },
        },
      },
      'zhiyu.turn.submit': {
        kind: 'object',
        properties: {
          requestId: { kind: 'string', minLength: 1, maxLength: 256 },
          text: { kind: 'string', minLength: 1, maxLength: 20000 },
        },
      },
    },
    eventSchemas: {
      'zhiyu.ecosystem.projected': {
        kind: 'object',
        properties: {
          protocolRevision: { kind: 'integer', minimum: 1, maximum: 1 },
          ecosystemRevision: { kind: 'integer', minimum: 1 },
          interactionId: { kind: 'string', minLength: 1, maxLength: 256 },
          committedAt: { kind: 'integer', minimum: 0 },
        },
      },
      'zhiyu.persona.projected': {
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
      'zhiyu.conversation.updated': {
        kind: 'object',
        properties: {
          requestId: { kind: 'string', minLength: 1, maxLength: 256 },
          responseText: { kind: 'string', minLength: 1, maxLength: 20000 },
        },
      },
    },
    moduleData: {
      ownerUserId: 'sim-user-zhiyu',
      agents: [{
        localAgentRef: 'sim-agent-lin',
        runtimeSourceRef: 'sim-source-lin',
        displayName: '林默',
      }, {
        localAgentRef: 'sim-agent-yun',
        runtimeSourceRef: 'sim-source-yun',
        displayName: '云织',
      }],
      responseText: '我已收到你的消息。这次回复来自同一条可回放的 Nimi 模拟生态状态链。',
    },
  },
  lifecycle: ['prepare', 'activate', 'deactivate', 'dispose'],
} as const;
