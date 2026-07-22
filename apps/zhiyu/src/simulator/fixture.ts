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
          checkpointId: { kind: 'string', minLength: 1, maxLength: 128 },
          label: { kind: 'string', minLength: 1, maxLength: 256 },
          committedAt: { kind: 'integer', minimum: 0 },
        },
      },
      'zhiyu.turn.allocate': {
        kind: 'object',
        properties: {},
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
          checkpointId: { kind: 'string', minLength: 1, maxLength: 128 },
          label: { kind: 'string', minLength: 1, maxLength: 256 },
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
  readiness: [{
    contractId: 'zhiyu.main.usable',
    surfaceId: 'main',
    rootContentSemanticId: 'zhiyu-main-root',
    primaryControl: {
      semanticId: 'zhiyu-primary-action',
      ariaRole: 'button',
      accessibleName: '伙伴中心',
    },
  }],
  lifecycle: ['prepare', 'activate', 'deactivate', 'dispose'],
} as const;
