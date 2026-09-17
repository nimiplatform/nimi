import assert from 'node:assert/strict';
import test from 'node:test';

import { desktopSimulatorBehavior } from '../src/simulator/behavior.js';
import type { DesktopSimulatorCommandEnvelope, DesktopSimulatorJsonValue } from '../src/simulator/protocol.js';

const persona = {
  accountId: 'sim-account-linche',
  userId: 'sim-user-linche',
  displayName: '林澈',
  role: '生态居民 · 早期体验者',
  realmEnvironmentId: 'sim-realm-env-desktop',
} as const;
const initialInput = {
  scenarioId: 'desktop-conformance',
  scenarioRevision: 'authenticated-v1',
  moduleData: {
    locale: 'en',
    auth: { initialStatus: 'authenticated', persona },
    productControl: { initialStatus: 'ready_for_use' },
  },
  sharedProjection: {},
} as const;
const callbackUrl = 'http://127.0.0.1:43110/oauth/callback';
const callbackOrigin = 'http://127.0.0.1:43110';

type State = DesktopSimulatorJsonValue;

function command(type: string, payload: Record<string, DesktopSimulatorJsonValue>, instanceId = '1:instance:1'): DesktopSimulatorCommandEnvelope {
  return {
    type,
    payload,
    issuer: { kind: 'instance', moduleId: 'desktop', instanceId },
  };
}

function reduce(state: State, envelope: DesktopSimulatorCommandEnvelope, now = 42) {
  return desktopSimulatorBehavior.reduce(state, envelope, { now, drawRandom: () => 0.5 });
}

function project(state: State, instanceId: string) {
  return desktopSimulatorBehavior.project(state, {
    instanceId,
    surfaceId: 'main',
    route: { pathname: '/', search: [], fragment: null },
    sharedProjection: {},
  }) as { auth: Record<string, unknown> };
}

function logout(state: State, instanceId = '1:instance:1') {
  return reduce(state, command('desktop.auth.logout', { instanceId, reason: 'desktop_logout' }, instanceId));
}

function begin(state: State, instanceId = '1:instance:1') {
  return reduce(state, command('desktop.auth.begin-login', {
    instanceId,
    redirectUri: callbackUrl,
    callbackOrigin,
    requestedScopes: [],
    ttlSeconds: 600,
  }, instanceId));
}

function complete(state: State, overrides: Record<string, DesktopSimulatorJsonValue> = {}, instanceId = '1:instance:1') {
  return reduce(state, command('desktop.auth.complete-login', {
    instanceId,
    loginAttemptId: 'sim-login-attempt-1',
    code: 'sim-oauth-code-1',
    state: 'sim-oauth-state-1',
    nonce: 'sim-oauth-nonce-1',
    redirectUri: callbackUrl,
    callbackOrigin,
    ...overrides,
  }, instanceId), 777);
}

test('Desktop Simulator defaults every instance to the authenticated Scenario projection', () => {
  const state = desktopSimulatorBehavior.initialState(initialInput);
  for (const instanceId of ['1:instance:1', '1:instance:2']) {
    assert.deepEqual(project(state, instanceId).auth, {
      status: 'authenticated',
      sessionRevision: 0,
      persona,
      authenticatedAt: null,
    });
  }
  assert.equal((state as { productControl: { status: string } }).productControl.status, 'ready_for_use');
});

test('Desktop Simulator logout is isolated and a complete broker flow reauthenticates only that instance', () => {
  const initial = desktopSimulatorBehavior.initialState(initialInput);
  const loggedOut = logout(initial);
  assert.equal(project(loggedOut.state, '1:instance:1').auth.status, 'anonymous');
  assert.equal(project(loggedOut.state, '1:instance:2').auth.status, 'authenticated');

  const begun = begin(loggedOut.state);
  const authorizationUrl = (begun.events[0]?.payload as { authorizationUrl: string }).authorizationUrl;
  assert.match(authorizationUrl, /^https:\/\/simulator\.invalid\/api\/auth\/oauth\/authorize\?/u);
  const opened = reduce(begun.state, command('desktop.auth.oauth.open', {
    instanceId: '1:instance:1', url: authorizationUrl, state: 'sim-oauth-state-1',
  }));
  assert.equal(opened.events[0]?.type, 'desktop.auth.oauth.callback');
  const completed = complete(opened.state);
  assert.deepEqual(project(completed.state, '1:instance:1').auth, {
    status: 'authenticated', sessionRevision: 3, persona, authenticatedAt: 777,
  });
  assert.equal(project(completed.state, '1:instance:2').auth.status, 'authenticated');
  assert.throws(() => complete(completed.state), /AUTH_COMPLETE_REJECTED/);
  assert.throws(() => begin(completed.state), /AUTH_BEGIN_REJECTED/);
});

test('Desktop Simulator auth rejects stale fields, overlap, redirect mismatch, and wrong issuer instance', () => {
  const anonymous = logout(desktopSimulatorBehavior.initialState(initialInput)).state;
  const begun = begin(anonymous);
  for (const [field, value] of [
    ['loginAttemptId', 'sim-login-attempt-stale'],
    ['code', 'sim-oauth-code-stale'],
    ['state', 'sim-oauth-state-stale'],
    ['nonce', 'sim-oauth-nonce-stale'],
    ['redirectUri', 'http://127.0.0.1:43110/oauth/other'],
    ['callbackOrigin', 'http://localhost:43110'],
  ] as const) {
    assert.throws(() => complete(begun.state, { [field]: value }), /AUTH_(COMPLETE_REJECTED|REDIRECT_URI_INVALID)/);
  }
  assert.throws(() => begin(begun.state), /AUTH_BEGIN_REJECTED/);
  assert.throws(() => reduce(anonymous, command('desktop.auth.begin-login', {
    instanceId: '1:instance:2', redirectUri: callbackUrl, callbackOrigin, requestedScopes: [], ttlSeconds: 600,
  }, '1:instance:1')), /AUTH_INSTANCE_REJECTED/);
  assert.throws(() => reduce(begun.state, command('desktop.auth.oauth.open', {
    instanceId: '1:instance:1', url: 'https://simulator.invalid/api/auth/oauth/authorize?state=wrong', state: 'wrong',
  })), /AUTH_OAUTH_REJECTED/);
});

test('Desktop Simulator reset reconstruction restores authenticated defaults and clears overrides', () => {
  const initial = desktopSimulatorBehavior.initialState(initialInput);
  const changed = logout(initial).state;
  assert.equal(project(changed, '1:instance:1').auth.status, 'anonymous');
  const reset = desktopSimulatorBehavior.initialState(initialInput);
  assert.equal(project(reset, '1:instance:1').auth.status, 'authenticated');
  assert.equal(project(reset, '1:instance:2').auth.status, 'authenticated');
  assert.deepEqual((reset as { auth: { sessions: object } }).auth.sessions, {});
});

test('Desktop Simulator initial auth data fails closed for malformed status and simulated identifiers', () => {
  assert.throws(() => desktopSimulatorBehavior.initialState({
    ...initialInput,
    moduleData: { ...initialInput.moduleData, auth: { ...initialInput.moduleData.auth, initialStatus: 'pending' } },
  } as never), /AUTH_INITIAL_STATUS_INVALID/);
  for (const field of ['accountId', 'userId', 'realmEnvironmentId'] as const) {
    assert.throws(() => desktopSimulatorBehavior.initialState({
      ...initialInput,
      moduleData: {
        ...initialInput.moduleData,
        auth: { ...initialInput.moduleData.auth, persona: { ...persona, [field]: 'real-looking-id' } },
      },
    }), /AUTH_PERSONA_INVALID/);
  }
});

test('Desktop Simulator non-auth commands remain deterministic and undeclared commands fail closed', () => {
  const initial = desktopSimulatorBehavior.initialState(initialInput);
  const locale = reduce(initial, command('desktop.locale.apply', { locale: 'zh', lang: 'zh-CN', title: 'Nimi' }));
  assert.equal((locale.state as { locale: string }).locale, 'zh');
  assert.equal((locale.state as { appliedAt: number }).appliedAt, 42);
  const timer = reduce(initial, command('desktop.renderer.timer.fire', { token: 'sim-timer-1' }));
  assert.equal(timer.events[0]?.type, 'desktop.renderer.timer.fired');
  assert.throws(() => reduce(initial, command('desktop.mock.success', {})), /COMMAND_UNDECLARED/);
});
