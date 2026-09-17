export const sampleSimulatorAdapterFactory = {
  protocol: 'nimi.simulator.module/v1',
  moduleId: 'sample-app',
  behavior: {
    initialState() {
      return { opened: false };
    },
    reduce(state: { readonly opened: boolean }) {
      return { state, events: [] };
    },
    project(state: { readonly opened: boolean }) {
      return state;
    },
  },
  create() {
    return {
      prepare() {},
      activate() {},
      deactivate() {},
      dispose() {},
    };
  },
} as const;
