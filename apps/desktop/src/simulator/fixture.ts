export const simulatorConformanceFixture = {
  protocol: 'nimi.simulator.module/v1',
  moduleId: 'desktop',
  catalog: {
    commandSchemas: {
      'desktop.locale.apply': {
        kind: 'object',
        properties: {
          locale: { kind: 'stringEnum', values: ['en', 'zh'] },
          lang: { kind: 'string', minLength: 1, maxLength: 32 },
          title: { kind: 'string', minLength: 1, maxLength: 128 },
        },
      },
    },
    eventSchemas: {},
    moduleData: { locale: 'en' },
  },
  readiness: [{
    contractId: 'desktop.main.usable',
    surfaceId: 'main',
    rootContentSemanticId: 'desktop-main-root',
    primaryControl: {
      semanticId: 'desktop-main-root',
      ariaRole: 'region',
      accessibleName: 'Nimi Desktop',
    },
  }],
  lifecycle: ['prepare', 'activate', 'deactivate', 'dispose'],
} as const;
