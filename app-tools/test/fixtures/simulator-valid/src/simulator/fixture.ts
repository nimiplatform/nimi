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
  lifecycle: ['prepare', 'activate', 'deactivate', 'dispose'],
} as const;
