/** Shared fixture helpers for Simulator contract tests. */

export const FIXTURE_SEED = 'a1b2c3d4e5f60718293a4b5c6d7e8f9fa1b2c3d4e5f60718293a4b5c6d7e8f9f';

export function fixtureScenario(overrides = {}) {
  return {
    scenarioId: 'fixture-scenario',
    scenarioRevision: 'fixture-revision-1',
    seed: FIXTURE_SEED,
    initialLogicalTime: 0,
    scenarioState: { fixture: true },
    ecosystemState: { shared: 0 },
    shellState: { windows: [] },
    ...overrides,
  };
}

/**
 * A deterministic fixture module with counter state, one event, one query,
 * and optional random draws, used across State Engine tests.
 */
export function fixtureModule(moduleId = 'fixture-module', options = {}) {
  const eventSchemas = {
    'counter-changed': { kind: 'object', properties: { value: { kind: 'integer' } } },
    ...(options.eventSchemas || {}),
  };
  const commandSchemas = {
    increment: {
      kind: 'object',
      properties: {
        by: { kind: 'integer', minimum: 0, maximum: 1000 },
      },
    },
    'increment-with-random': {
      kind: 'object',
      properties: {
        scale: { kind: 'integer', minimum: 1, maximum: 1000 },
      },
    },
    enqueue: {
      kind: 'object',
      properties: {
        type: { kind: 'string', minLength: 1 },
        payload: { kind: 'json' },
      },
    },
    ...(options.commandSchemas || {}),
  };
  const behavior = {
    initialState(input) {
      return { counter: 0, moduleData: input.moduleData };
    },
    reduce(state, envelope, context) {
      if (envelope.type === 'increment') {
        const value = state.counter + envelope.payload.by;
        return {
          state: { ...state, counter: value },
          events: [{ type: 'counter-changed', payload: { value } }],
        };
      }
      if (envelope.type === 'increment-with-random') {
        const draw = context.drawRandom();
        const value = state.counter + Math.floor(draw * envelope.payload.scale);
        return {
          state: { ...state, counter: value },
          events: [{ type: 'counter-changed', payload: { value } }],
        };
      }
      if (envelope.type === 'enqueue') {
        return { state, events: [] };
      }
      throw new Error(`unexpected fixture command ${envelope.type}`);
    },
    project(state) {
      return { counter: state.counter };
    },
  };
  return {
    moduleId,
    orderingKey: options.orderingKey ?? 0,
    behavior,
    commandSchemas,
    eventSchemas,
    queries: {
      'read-counter': {
        inputSchema: { kind: 'object', properties: {} },
        projectionSchema: { kind: 'object', properties: { counter: { kind: 'integer' } } },
        select: (moduleState) => ({ counter: moduleState.counter }),
      },
    },
    selectSharedProjection: null,
    moduleData: options.moduleData ?? null,
  };
}

export function fixtureModuleCatalog(definition) {
  const { behavior: ignoredBehavior, ...catalog } = definition;
  void ignoredBehavior;
  return catalog;
}

export function registerFixtureModule(engine, definition = fixtureModule()) {
  engine.registerModuleCatalog(fixtureModuleCatalog(definition));
  const attached = engine.attachModuleBehavior(definition.moduleId, definition.behavior);
  if (!attached.ok) {
    throw new Error(`fixture behavior attachment failed for ${definition.moduleId}`);
  }
  return definition;
}

export const SHELL_ISSUER = Object.freeze({ kind: 'shell', moduleId: null, instanceId: null });
export const SCENARIO_ISSUER = Object.freeze({ kind: 'scenario', moduleId: null, instanceId: null });

export function instanceIssuer(moduleId, instanceId) {
  return Object.freeze({ kind: 'instance', moduleId, instanceId });
}

export function fixtureCanonicalBindings(scopePrefix = 'opaque-scope') {
  const scope = Object.freeze({
    domId: (localId) => `${scopePrefix}--id--${localId}`,
    globalName: (localName) => `${scopePrefix}--global--${localName}`,
  });
  const capabilities = fixtureReadonlySet([]);
  const localization = Object.freeze({ locale: 'en-US', language: 'en', direction: 'ltr' });
  const surfaceLifecycle = Object.freeze({ reportReadyCandidate() {} });
  const kit = Object.freeze({
    protocol: 'nimi.renderer.host/v1',
    scope,
    capabilities,
    localization,
    theme: Object.freeze({ getSnapshot: () => ({}), subscribe: () => () => {} }),
    overlays: Object.freeze({
      target: {},
      acquire: async () => ({ ok: false, error: { disposition: 'unsupported' } }),
    }),
    surfaceLifecycle,
    invoke: async () => ({}),
  });
  return Object.freeze({
    protocol: 'nimi.renderer.host/v1',
    scope,
    capabilities,
    localization,
    kit,
    sdk: Object.freeze({}),
    app: Object.freeze({
      projection: Object.freeze({}),
      commands: Object.freeze({}),
      events: Object.freeze({}),
    }),
    route: Object.freeze({}),
    clock: Object.freeze({}),
    surfaceLifecycle,
  });
}

function fixtureReadonlySet(values) {
  const internal = new Set(values);
  let view;
  view = Object.freeze({
    get size() { return internal.size; },
    has: (value) => internal.has(value),
    entries: () => internal.entries(),
    keys: () => internal.keys(),
    values: () => internal.values(),
    forEach(callback, thisArg) {
      internal.forEach((value) => callback.call(thisArg, value, value, view));
    },
    [Symbol.iterator]: () => internal[Symbol.iterator](),
  });
  return view;
}
