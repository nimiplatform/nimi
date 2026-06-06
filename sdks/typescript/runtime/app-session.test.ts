import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AppMode,
  ReasonCode as RuntimeGeneratedReasonCode,
  WorldRelation,
  type OpenSessionRequest,
  type RegisterAppRequest,
  type RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';
import { ReasonCode as SdkReasonCode } from '../types';
import {
  createNimiRuntimeAppSessionMetadataProvider,
  createNimiRuntimeFullAppRegistration,
} from './app-session';

test('Runtime app registration helper registers full Runtime/Realm mode once', async () => {
  const registrations: RegisterAppRequest[] = [];
  const registrationOptions: RuntimeTypedCallOptions[] = [];
  const ensureRegistered = createNimiRuntimeFullAppRegistration(
    () => ({
      auth: {
        async registerApp(request: RegisterAppRequest, options?: RuntimeTypedCallOptions) {
          registrations.push(request);
          registrationOptions.push(options ?? {});
          return {
            appInstanceId: request.appInstanceId,
            accepted: true,
            reasonCode: RuntimeGeneratedReasonCode.ACTION_EXECUTED,
          };
        },
      },
    }),
    {
      appId: 'nimi.desktop',
      appInstanceId: 'nimi.desktop.local-first-party',
      deviceId: 'desktop-shell',
      capabilities: ['runtime.account', 'runtime.account', ' '],
    },
  );

  await Promise.all([ensureRegistered(), ensureRegistered()]);

  assert.equal(registrations.length, 1);
  assert.equal(registrations[0]?.appId, 'nimi.desktop');
  assert.equal(registrations[0]?.modeManifest?.appMode, AppMode.FULL);
  assert.equal(registrations[0]?.modeManifest?.runtimeRequired, true);
  assert.equal(registrations[0]?.modeManifest?.realmRequired, true);
  assert.equal(registrations[0]?.modeManifest?.worldRelation, WorldRelation.NONE);
  assert.deepEqual(registrations[0]?.capabilities, ['runtime.account']);
  assert.match(registrationOptions[0]?.metadata?.idempotencyKey ?? '', /^runtime-register-app-/);
});

test('Runtime app session metadata provider caches session by subject and emits session headers', async () => {
  const registrations: RegisterAppRequest[] = [];
  const sessions: OpenSessionRequest[] = [];
  const registrationOptions: RuntimeTypedCallOptions[] = [];
  const sessionOptions: RuntimeTypedCallOptions[] = [];
  let subjectUserId = 'user-1';
  let sessionCounter = 0;
  const provider = createNimiRuntimeAppSessionMetadataProvider({
    appId: 'nimi.desktop',
    appInstanceId: 'nimi.desktop.runtime-session',
    deviceId: 'desktop-shell',
    getSubjectUserId: () => subjectUserId,
    auth: {
      async registerApp(request, options) {
        registrations.push(request);
        registrationOptions.push(options ?? {});
        return {
          appInstanceId: request.appInstanceId,
          accepted: true,
          reasonCode: RuntimeGeneratedReasonCode.ACTION_EXECUTED,
        };
      },
      async openSession(request, options) {
        sessions.push(request);
        sessionOptions.push(options ?? {});
        sessionCounter += 1;
        return {
          sessionId: `session-${sessionCounter}`,
          sessionToken: `token-${sessionCounter}`,
          issuedAt: { seconds: String(Math.floor(Date.now() / 1000)), nanos: 0 },
          expiresAt: { seconds: String(Math.floor(Date.now() / 1000) + 3600), nanos: 0 },
          reasonCode: RuntimeGeneratedReasonCode.ACTION_EXECUTED,
        };
      },
    },
  });

  assert.deepEqual(await provider(), {
    'x-nimi-session-id': 'session-1',
    'x-nimi-session-token': 'token-1',
  });
  assert.deepEqual(await provider(), {
    'x-nimi-session-id': 'session-1',
    'x-nimi-session-token': 'token-1',
  });

  subjectUserId = 'user-2';
  assert.deepEqual(await provider(), {
    'x-nimi-session-id': 'session-2',
    'x-nimi-session-token': 'token-2',
  });

  assert.equal(registrations.length, 1);
  assert.match(registrationOptions[0]?.metadata?.idempotencyKey ?? '', /^runtime-register-app-/);
  assert.match(sessionOptions[0]?.metadata?.idempotencyKey ?? '', /^runtime-open-session-/);
  assert.deepEqual(sessions.map((request) => request.subjectUserId), ['user-1', 'user-2']);
});

test('Runtime app session metadata provider fails closed without subject or session token', async () => {
  const missingSubject = createNimiRuntimeAppSessionMetadataProvider({
    appId: 'nimi.desktop',
    appInstanceId: 'nimi.desktop.runtime-session',
    deviceId: 'desktop-shell',
    getSubjectUserId: () => '',
    auth: {
      async registerApp() {
        throw new Error('registerApp should not be called without subject');
      },
      async openSession() {
        throw new Error('openSession should not be called without subject');
      },
    },
  });

  await assert.rejects(
    missingSubject(),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_RUNTIME_APP_SESSION_SUBJECT_REQUIRED',
  );

  const missingToken = createNimiRuntimeAppSessionMetadataProvider({
    appId: 'nimi.desktop',
    appInstanceId: 'nimi.desktop.runtime-session',
    deviceId: 'desktop-shell',
    getSubjectUserId: () => 'user-1',
    auth: {
      async registerApp(request) {
        return {
          appInstanceId: request.appInstanceId,
          accepted: true,
          reasonCode: RuntimeGeneratedReasonCode.ACTION_EXECUTED,
        };
      },
      async openSession() {
        return {
          sessionId: 'session-1',
          sessionToken: '',
          reasonCode: RuntimeGeneratedReasonCode.RUNTIME_CALL_FAILED,
        };
      },
    },
  });

  await assert.rejects(
    missingToken(),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === SdkReasonCode.RUNTIME_CALL_FAILED,
  );
});
