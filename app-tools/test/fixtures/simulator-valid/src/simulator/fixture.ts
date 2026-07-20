export const simulatorConformanceFixture = {
  protocol: 'nimi.simulator.module/v1',
  moduleId: 'sample-app',
  catalog: {
    commandSchemas: {
      'sample-app.window.open': {
        kind: 'object',
        properties: {},
      },
    },
    eventSchemas: {
      'sample-app.window.opened': {
        kind: 'object',
        properties: {},
      },
    },
    moduleData: {},
  },
  readiness: [{
    contractId: 'sample-app.main.usable',
    surfaceId: 'main',
    rootContentSemanticId: 'sample-app-main-root',
    primaryControl: {
      semanticId: 'sample-app-primary-action',
      ariaRole: 'button',
      accessibleName: 'Open sample',
    },
  }],
  lifecycle: ['prepare', 'activate', 'deactivate', 'dispose'],
} as const;
