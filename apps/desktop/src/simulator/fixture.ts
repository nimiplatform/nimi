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
      'desktop.renderer.timer.fire': {
        kind: 'object',
        properties: {
          token: { kind: 'string', minLength: 1, maxLength: 128 },
        },
      },
    },
    eventSchemas: {
      'desktop.renderer.timer.fired': {
        kind: 'object',
        properties: {
          token: { kind: 'string', minLength: 1, maxLength: 128 },
        },
      },
    },
    moduleData: { locale: 'en' },
  },
  readiness: [{
    contractId: 'desktop.main.usable',
    surfaceId: 'main',
    rootContentSemanticId: 'desktop-main-content',
    primaryControl: {
      semanticId: 'desktop-login-primary',
      ariaRole: 'button',
      accessibleName: 'Nimi Logo',
    },
  }],
  lifecycle: ['prepare', 'activate', 'deactivate', 'dispose'],
} as const;
