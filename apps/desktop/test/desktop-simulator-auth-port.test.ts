import assert from 'node:assert/strict';
import test from 'node:test';

import { createDesktopSimulatorBindings } from '../src/simulator/bindings.js';
import { desktopSimulatorBehavior } from '../src/simulator/behavior.js';
import { simulatorConformanceFixture } from '../src/simulator/fixture.js';
import type {
  DesktopSimulatorJsonValue,
  DesktopSimulatorPrepareContext,
  DesktopSimulatorResult,
  DesktopSimulatorRouteState,
} from '../src/simulator/protocol.js';
import type { DesktopRendererLifecyclePort } from '../src/shell/renderer/renderer/lifecycle-port.js';
import type { RuntimeAccountAuthProjection } from '../src/shell/renderer/app-shell/providers/store-types.js';

/**
 * End-to-end headless proof for the deterministic State Engine-backed
 * RuntimeAccount projection, driven through real simulator bindings and
 * the RuntimeAccount browser broker + OAuth bridge seams exactly like the
 * production desktop loopback flow, with no network, no timers, and no
 * wall-clock reads.
 */

const LOGIN_CALLBACK_URL = 'http://127.0.0.1:43110/oauth/callback';
const BROWSER_CALLBACK_URL = 'http://127.0.0.1:29365/oauth/callback';
const SECOND_BROWSER_CALLBACK_URL = 'http://127.0.0.1:20481/oauth/callback';

type JsonRecord = { readonly [key: string]: DesktopSimulatorJsonValue };

type EventSubscriber = {
  readonly eventType: string;
  readonly handler: (payload: DesktopSimulatorJsonValue, event: DesktopSimulatorJsonValue) => unknown;
};

function createEngineHarness() {
  const moduleData = simulatorConformanceFixture.catalog.moduleData as unknown as DesktopSimulatorJsonValue;
  let state = desktopSimulatorBehavior.initialState({
    scenarioId: 'desktop-auth-port-test',
    scenarioRevision: '1',
    moduleData,
    sharedProjection: {},
  });
  const route: DesktopSimulatorRouteState = { pathname: '/login', search: [], fragment: null };
  const logicalTime = 123_456;
  let revision = 0;
  const eventSubscribers: EventSubscriber[] = [];
  const committedEvents: { readonly type: string; readonly payload: DesktopSimulatorJsonValue }[] = [];
  const emittedInteractions: {
    readonly protocol: string;
    readonly interactionId: string;
    readonly targets: readonly string[];
    readonly type: string;
    readonly payload: DesktopSimulatorJsonValue;
  }[] = [];

  function project(instanceId: string): DesktopSimulatorJsonValue {
    return desktopSimulatorBehavior.project(state, {
      instanceId,
      surfaceId: 'main',
      route,
      sharedProjection: {},
    });
  }

  async function invoke(
    type: string,
    payload: DesktopSimulatorJsonValue,
  ): Promise<DesktopSimulatorResult<DesktopSimulatorJsonValue>> {
    if (!Object.hasOwn(simulatorConformanceFixture.catalog.commandSchemas, type)) {
      return { ok: false, error: { code: 'SIMULATOR_UNSUPPORTED' } };
    }
    let reduction: {
      readonly state: DesktopSimulatorJsonValue;
      readonly events: readonly { readonly type: string; readonly payload: DesktopSimulatorJsonValue }[];
    };
    try {
      reduction = desktopSimulatorBehavior.reduce(
        state,
        {
          type,
          payload,
          issuer: {
            kind: 'instance',
            moduleId: 'desktop',
            instanceId: typeof (payload as JsonRecord).instanceId === 'string'
              ? (payload as JsonRecord).instanceId as string
              : '1:instance:1',
          },
        },
        { now: logicalTime, drawRandom: () => 0.5 },
      ) as typeof reduction;
    } catch {
      return { ok: false, error: { code: 'SIMULATOR_INTEGRITY_FAILURE' } };
    }
    state = reduction.state;
    revision += 1;
    for (const event of reduction.events) {
      committedEvents.push(event);
      for (const subscriber of eventSubscribers.filter((entry) => entry.eventType === event.type)) {
        subscriber.handler(event.payload, event);
      }
    }
    return { ok: true, value: { revision, eventIds: [] } };
  }

  function subscribe(
    eventType: string,
    handler: EventSubscriber['handler'],
  ): DesktopSimulatorResult<() => void> {
    if (!Object.hasOwn(simulatorConformanceFixture.catalog.eventSchemas, eventType)) {
      return { ok: false, error: { code: 'SIMULATOR_CAPABILITY_DENIED' } };
    }
    const subscriber: EventSubscriber = { eventType, handler };
    eventSubscribers.push(subscriber);
    return {
      ok: true,
      value: () => {
        const index = eventSubscribers.indexOf(subscriber);
        if (index >= 0) eventSubscribers.splice(index, 1);
      },
    };
  }

  return {
    project,
    invoke,
    subscribe,
    committedEvents: () => [...committedEvents],
    recordInteraction(input: {
      readonly protocol: string;
      readonly interactionId: string;
      readonly targets: readonly string[];
      readonly type: string;
      readonly payload: DesktopSimulatorJsonValue;
    }) {
      emittedInteractions.push(Object.freeze({ ...input }));
      return { ok: true as const, value: { ecosystemRevision: 1 } };
    },
    emittedInteractions: () => [...emittedInteractions],
  };
}

function createKitFacade() {
  const scope = Object.freeze({
    domId: (localId: string) => `desktop-auth-test--id--${localId}`,
    globalName: (localName: string) => `desktop-auth-test--global--${localName}`,
  });
  const capabilitiesInternal = new Set<string>();
  const capabilitiesView: ReadonlySet<string> = Object.freeze({
    get size() { return capabilitiesInternal.size; },
    has: (value: string) => capabilitiesInternal.has(value),
    entries: () => capabilitiesInternal.entries(),
    keys: () => capabilitiesInternal.keys(),
    values: () => capabilitiesInternal.values(),
    forEach: (callback: (value: string, key: string, set: ReadonlySet<string>) => void, thisArg?: unknown) => {
      capabilitiesInternal.forEach((value) => callback.call(thisArg, value, value, capabilitiesView));
    },
    [Symbol.iterator]: () => capabilitiesInternal[Symbol.iterator](),
  }) as ReadonlySet<string>;
  const capabilities = capabilitiesView;
  const localization = Object.freeze({ locale: 'en-US', language: 'en', direction: 'ltr' as const });
  const surfaceLifecycle = Object.freeze({ reportReadyCandidate: () => undefined });
  const kit = Object.freeze({
    protocol: 'nimi.renderer.host/v1',
    scope,
    capabilities,
    localization,
    theme: Object.freeze({ getSnapshot: () => ({}), subscribe: () => () => undefined }),
    overlays: Object.freeze({
      target: {},
      acquire: async () => ({ ok: false as const, error: { disposition: 'unsupported' as const } }),
    }),
    surfaceLifecycle,
    invoke: async () => ({}),
  });
  return { kit, scope, capabilities, localization, surfaceLifecycle };
}

function createLifecycleRecorder() {
  const applied: RuntimeAccountAuthProjection[] = [];
  let cleared = 0;
  const sessions: (Record<string, unknown> | null)[] = [];
  const lifecycle = {
    applied,
    sessions,
    clearedCount: () => cleared,
    port: {
      auth: () => ({ status: 'anonymous' }),
      bootstrap: () => Object.freeze({ bootstrapError: null, bootstrapReady: true }),
      translate: (key: string) => key,
      subscribeBootstrap: () => () => undefined,
      setActiveTab: () => undefined,
      setOfflineTier: () => undefined,
      setAuthBootstrapping: () => undefined,
      applyRuntimeAccountProjection: (projection: RuntimeAccountAuthProjection) => {
        applied.push(projection);
      },
      setAuthSession: (user: Record<string, unknown> | null) => {
        sessions.push(user);
      },
      clearAuthSession: () => {
        cleared += 1;
      },
      setRuntimeDefaults: () => undefined,
      setStatusBanner: () => undefined,
      setBootstrapReady: () => undefined,
      setBootstrapError: () => undefined,
      invalidateQueries: async () => undefined,
      cancelAndClearQueries: async () => undefined,
      clearAgentConversationAnchorBindings: () => undefined,
      readAgentConversationAnchorBinding: () => null,
    } as unknown as DesktopRendererLifecyclePort,
  };
  return lifecycle;
}

function createInstance(engine: ReturnType<typeof createEngineHarness>, instanceId: string) {
  const kitFacade = createKitFacade();
  const cleanupTasks: (() => Promise<void> | void)[] = [];
  const context: DesktopSimulatorPrepareContext = {
    protocol: 'nimi.simulator.module/v1',
    moduleId: 'desktop',
    instanceId,
    surfaceId: 'main',
    epoch: 1,
    abortSignal: new AbortController().signal,
    kit: kitFacade.kit as unknown as DesktopSimulatorPrepareContext['kit'],
    commands: {
      invoke: (type, payload) => engine.invoke(type, payload),
    },
    interactions: {
      emit: async (input) => engine.recordInteraction(input),
    },
    events: {
      subscribe: (eventType, handler) => engine.subscribe(eventType, handler),
    },
    cleanup: {
      add: (dispose) => {
        cleanupTasks.push(dispose);
        return { ok: true, value: { registrationId: `cleanup-${cleanupTasks.length}` } };
      },
    },
    projection: {
      get: () => engine.project(instanceId),
      subscribe: () => () => undefined,
    },
    route: {
      get: () => ({ pathname: '/login', search: [], fragment: null }),
      subscribe: () => () => undefined,
      navigate: async () => ({ ok: true, value: {} }),
    },
    clock: {
      now: () => 123_456,
      schedule: async () => ({ ok: true, value: { jobId: 'job-1' } }),
      cancel: async () => ({ ok: true, value: {} }),
    },
  };
  const bindings = createDesktopSimulatorBindings(context);
  const lifecycle = createLifecycleRecorder();
  const disconnectLifecycle = bindings.app.events.connectLifecycle(lifecycle.port);
  return { bindings, lifecycle, cleanupTasks, disconnectLifecycle };
}

async function driveSimulatedLogin(
  instance: ReturnType<typeof createInstance>,
  browserCallbackUrl = BROWSER_CALLBACK_URL,
) {
  const auth = instance.bindings.app.commands.auth;
  const attempt = await auth.runtimeAccountBroker.begin({
    callbackUrl: browserCallbackUrl,
    timeoutMs: 60_000,
  });
  const listen = auth.oauthBridge.oauthListenForCode({
    redirectUri: browserCallbackUrl,
    timeoutMs: 60_000,
  });
  const opened = await auth.oauthBridge.openExternalUrl(attempt.authorizationUrl);
  const callback = await listen;
  const completion = await auth.runtimeAccountBroker.complete({
    loginAttemptId: attempt.loginAttemptId,
    code: String(callback.code || ''),
    state: attempt.state,
    nonce: attempt.nonce,
    callbackUrl: browserCallbackUrl,
  });
  return { attempt, opened, callback, completion };
}

test('Desktop Simulator projection boots authenticated and drives logout plus RuntimeAccount broker re-login', async () => {
  const engine = createEngineHarness();
  const first = createInstance(engine, '1:instance:1');
  const second = createInstance(engine, '1:instance:2');

  // Lifecycle binding synchronously receives independent authenticated projections.
  assert.equal(first.lifecycle.clearedCount(), 0);
  assert.equal(second.lifecycle.clearedCount(), 0);
  assert.equal(first.lifecycle.applied.length, 1);
  assert.equal(second.lifecycle.applied.length, 1);
  assert.deepEqual((engine.project('1:instance:1') as JsonRecord).auth, {
    status: 'authenticated',
    sessionRevision: 0,
    persona: {
      accountId: 'sim-account-linche',
      userId: 'sim-user-linche',
      displayName: '林澈',
      role: '生态居民 · 早期体验者',
      realmEnvironmentId: 'sim-realm-env-desktop',
    },
    authenticatedAt: null,
  });
  assert.equal(first.bindings.sdk.isSessionReady(), true);
  assert.equal(second.bindings.sdk.isRuntimeAccountSessionReady(), true);
  assert.notEqual(first.bindings.sdk.accountCaller().appInstanceId, second.bindings.sdk.accountCaller().appInstanceId);
  assert.notEqual(first.bindings.sdk.accountCaller().deviceId, second.bindings.sdk.accountCaller().deviceId);

  // Runtime-owned adapter routes keep throwing; only the broker flow is admitted.
  const adapter = first.bindings.app.commands.auth.adapter;
  await assert.rejects(() => adapter.checkEmail('linche@nimi.example'), /owned by RuntimeAccountService/);
  const passwordLogin = adapter.passwordLogin;
  assert.ok(passwordLogin);
  await assert.rejects(() => passwordLogin('linche', 'secret'), /owned by RuntimeAccountService/);
  await assert.rejects(() => adapter.applyToken('token'), /owned by RuntimeAccountService/);
  await assert.rejects(
    () => first.bindings.app.commands.auth.oauthBridge.oauthTokenExchange({} as never),
    /owned by RuntimeAccountService/,
  );

  const initialLogout = await first.bindings.sdk.accountRuntime().account.logout({
    caller: first.bindings.sdk.accountCaller(),
    reason: 'desktop_logout',
  });
  assert.equal(initialLogout.accepted, true);
  assert.equal(((engine.project('1:instance:1') as JsonRecord).auth as JsonRecord).status, 'anonymous');
  assert.equal(((engine.project('1:instance:2') as JsonRecord).auth as JsonRecord).status, 'authenticated');
  assert.equal(first.bindings.sdk.isSessionReady(), false);

  const { attempt, opened, callback, completion } = await driveSimulatedLogin(first);

  assert.equal(attempt.loginAttemptId, 'sim-login-attempt-1');
  assert.equal(attempt.state, 'sim-oauth-state-1');
  assert.equal(attempt.nonce, 'sim-oauth-nonce-1');
  const authorizationUrl = new URL(attempt.authorizationUrl);
  assert.equal(authorizationUrl.protocol, 'https:');
  assert.equal(authorizationUrl.pathname, '/oauth/authorize');
  assert.equal(authorizationUrl.searchParams.get('redirect_uri'), LOGIN_CALLBACK_URL);
  assert.equal(authorizationUrl.searchParams.get('state'), 'sim-oauth-state-1');
  assert.equal(authorizationUrl.hash, '');
  assert.deepEqual(opened, { opened: true });
  assert.equal(callback.error, undefined);
  assert.equal(callback.code, 'sim-oauth-code-1');
  assert.equal(callback.state, attempt.state);

  const user = completion.user as Record<string, unknown> | null;
  assert.ok(user);
  assert.equal(user.id, 'sim-user-linche');
  assert.equal(user.displayName, '林澈');
  assert.equal(user.role, '生态居民 · 早期体验者');
  assert.equal(user.accountId, 'sim-account-linche');
  assert.equal(user.realmEnvironmentId, 'sim-realm-env-desktop');
  assert.equal(user.simulated, true);

  // The engine commit drove the zustand auth slice through the lifecycle port.
  assert.equal(first.lifecycle.applied.length, 2);
  assert.equal(first.lifecycle.applied[1]?.status, 'authenticated');
  assert.equal((first.lifecycle.applied[1]?.user as Record<string, unknown>).id, 'sim-user-linche');
  assert.equal(first.lifecycle.applied[1]?.sequence, '3');
  assert.equal(second.lifecycle.applied.length, 1);

  // Authenticated persona is projected for the Phase-5 seam, per instance.
  assert.deepEqual((engine.project('1:instance:1') as JsonRecord).auth, {
    status: 'authenticated',
    sessionRevision: 3,
    persona: {
      accountId: 'sim-account-linche',
      userId: 'sim-user-linche',
      displayName: '林澈',
      role: '生态居民 · 早期体验者',
      realmEnvironmentId: 'sim-realm-env-desktop',
    },
    authenticatedAt: 123_456,
  });
  assert.deepEqual((engine.project('1:instance:2') as JsonRecord).auth, {
    status: 'authenticated',
    sessionRevision: 3,
    persona: {
      accountId: 'sim-account-linche',
      userId: 'sim-user-linche',
      displayName: '林澈',
      role: '生态居民 · 早期体验者',
      realmEnvironmentId: 'sim-realm-env-desktop',
    },
    authenticatedAt: null,
  });

  // Session status reads flow through the admitted SDK testing facade.
  const loaded = await adapter.loadCurrentUser();
  assert.equal((loaded as Record<string, unknown> | null)?.id, 'sim-user-linche');

  // reconcileLoginState reconciles the renderer against engine truth.
  assert.deepEqual(await first.bindings.app.commands.reconcileLoginState({ authStatus: 'anonymous' }), {
    clearAuthSession: false,
  });
  assert.deepEqual(await second.bindings.app.commands.reconcileLoginState({ authStatus: 'authenticated' }), {
    clearAuthSession: false,
  });

  // Logout returns the session to anonymous through the declared command/event.
  const clearPersistedSession = adapter.clearPersistedSession;
  assert.ok(clearPersistedSession);
  await clearPersistedSession();
  assert.equal(((engine.project('1:instance:1') as JsonRecord).auth as JsonRecord).status, 'anonymous');
  assert.equal(first.lifecycle.clearedCount(), 2);

  // Declared simulator events form the typed audit trail of the whole flow.
  assert.deepEqual(
    engine.committedEvents().map((event) => event.type),
    [
      'desktop.auth.session.anonymous',
      'desktop.auth.login.pending',
      'desktop.auth.oauth.callback',
      'desktop.auth.session.authenticated',
      'desktop.auth.session.anonymous',
    ],
  );

  // The authenticated session emitted the declared persona share interaction.
  const shares = engine.emittedInteractions().filter((entry) => entry.type === 'session.persona.share');
  assert.equal(shares.length, 1);
  assert.equal(shares[0]?.interactionId, 'sim-persona-sim-user-linche');
  assert.deepEqual(shares[0]?.targets, ['zhiyu', 'tester']);
  assert.equal((shares[0]?.payload as JsonRecord).displayName, '林澈');
  assert.equal((shares[0]?.payload as JsonRecord).accountId, 'sim-account-linche');
});

test('Desktop Simulator lifecycle cleanup and reconnect are idempotent', () => {
  const engine = createEngineHarness();
  const instance = createInstance(engine, '1:instance:1');
  assert.equal(instance.lifecycle.applied.length, 1);
  instance.disconnectLifecycle();
  instance.disconnectLifecycle();
  const replacement = createLifecycleRecorder();
  const disconnectReplacement = instance.bindings.app.events.connectLifecycle(replacement.port);
  assert.equal(replacement.applied.length, 1);
  assert.equal(replacement.applied[0]?.status, 'authenticated');
  disconnectReplacement();
  disconnectReplacement();
});

test('Desktop Simulator routes handoff and carry requests through typed interactions', async () => {
  const engine = createEngineHarness();
  createInstance(engine, '1:instance:1');
  createInstance(engine, '1:instance:2');

  const handoffRoute = {
    pathname: '/',
    search: [{ key: 'handoff', value: 'sim-intent-handoff' }],
    fragment: null,
  };
  const handoffResult = await engine.invoke('desktop.handoff.request', {
    originInstanceId: '1:instance:1',
    targetSurfaceId: 'main',
    route: handoffRoute,
    card: { title: '在织羽中继续', detail: '模拟交接卡片' },
  });
  assert.equal(handoffResult.ok, true);
  const carryResult = await engine.invoke('desktop.context-projection.request', {
    originInstanceId: '1:instance:2',
    carry: '回声谷解谜计划',
    card: { title: '会话摘要', detail: '模拟摘要卡片' },
  });
  assert.equal(carryResult.ok, true);

  const emissions = engine.emittedInteractions().filter((entry) => entry.type !== 'session.persona.share');
  assert.equal(emissions.length, 2);
  const handoff = emissions[0];
  assert.equal(handoff?.type, 'handoff.surface.commit');
  assert.equal(handoff?.interactionId, '1:instance:1:sim-handoff-1');
  assert.deepEqual(handoff?.targets, ['zhiyu']);
  assert.deepEqual((handoff?.payload as JsonRecord).route, handoffRoute);
  const carry = emissions[1];
  assert.equal(carry?.type, 'local-agent.context.project');
  assert.equal(carry?.interactionId, '1:instance:2:sim-carry-2');
  assert.deepEqual(carry?.targets, ['zhiyu']);
  assert.equal((carry?.payload as JsonRecord).carry, '回声谷解谜计划');

  // Requests are engine truth in the module state audit log.
  const requests = (engine.project('1:instance:1') as JsonRecord).productRequests as JsonRecord;
  assert.equal(requests.sequence, 2);
  assert.equal((requests.log as readonly JsonRecord[]).length, 2);
});

test('Desktop Simulator simulated re-login is deterministic across fresh engines', async () => {
  const firstRun = await (async () => {
    const engine = createEngineHarness();
    const instance = createInstance(engine, '1:instance:1');
    await instance.bindings.sdk.accountRuntime().account.logout({ caller: instance.bindings.sdk.accountCaller(), reason: 'desktop_logout' });
    const flow = await driveSimulatedLogin(instance, SECOND_BROWSER_CALLBACK_URL);
    return {
      attempt: flow.attempt,
      user: flow.completion.user,
      projection: (engine.project('1:instance:1') as JsonRecord).auth,
      events: engine.committedEvents(),
    };
  })();
  const secondRun = await (async () => {
    const engine = createEngineHarness();
    const instance = createInstance(engine, '1:instance:1');
    await instance.bindings.sdk.accountRuntime().account.logout({ caller: instance.bindings.sdk.accountCaller(), reason: 'desktop_logout' });
    const flow = await driveSimulatedLogin(instance);
    return {
      attempt: flow.attempt,
      user: flow.completion.user,
      projection: (engine.project('1:instance:1') as JsonRecord).auth,
      events: engine.committedEvents(),
    };
  })();
  assert.deepEqual(secondRun, firstRun);
});

test('Desktop Simulator auth port fails closed for out-of-order login steps', async () => {
  const engine = createEngineHarness();
  const instance = createInstance(engine, '1:instance:1');
  const auth = instance.bindings.app.commands.auth;
  await instance.bindings.sdk.accountRuntime().account.logout({
    caller: instance.bindings.sdk.accountCaller(), reason: 'desktop_logout',
  });

  await assert.rejects(
    () => auth.runtimeAccountBroker.begin({
      callbackUrl: 'https://example.invalid/oauth/callback',
      timeoutMs: 60_000,
    }),
  );
  await assert.rejects(
    () => auth.runtimeAccountBroker.complete({
      loginAttemptId: 'sim-login-attempt-1',
      code: 'sim-oauth-code-1',
      state: 'sim-oauth-state-1',
      nonce: 'sim-oauth-nonce-1',
      callbackUrl: LOGIN_CALLBACK_URL,
    }),
  );
  await assert.rejects(
    () => auth.oauthBridge.openExternalUrl('https://simulator.invalid/oauth/authorize?state=sim-oauth-state-1'),
    /DESKTOP_SIMULATOR_AUTH_OAUTH_OPEN_REJECTED/,
  );
  // The failed steps committed no state: the session is still anonymous.
  assert.equal(((engine.project('1:instance:1') as JsonRecord).auth as JsonRecord).status, 'anonymous');
  assert.equal(engine.committedEvents().length, 1);
  // Token custody stays Runtime-owned in shape: the kit broker always sends the
  // sealed/empty-token completion payload, never app-held tokens.
  const attempt = await auth.runtimeAccountBroker.begin({ callbackUrl: LOGIN_CALLBACK_URL, timeoutMs: 60_000 });
  const listen = auth.oauthBridge.oauthListenForCode({ redirectUri: LOGIN_CALLBACK_URL, timeoutMs: 60_000 });
  await auth.oauthBridge.openExternalUrl(attempt.authorizationUrl);
  const callback = await listen;
  const completion = await auth.runtimeAccountBroker.complete({
    loginAttemptId: attempt.loginAttemptId,
    code: String(callback.code || ''),
    state: attempt.state,
    nonce: attempt.nonce,
    callbackUrl: LOGIN_CALLBACK_URL,
  });
  assert.equal((completion.user as Record<string, unknown>).id, 'sim-user-linche');
});
