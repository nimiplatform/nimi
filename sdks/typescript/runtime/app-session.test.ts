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
  createNimiRuntimeInstalledAppSessionMetadataProvider,
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

test('Runtime app session metadata provider opens app-only session and emits session headers', async () => {
  const registrations: RegisterAppRequest[] = [];
  const sessions: OpenSessionRequest[] = [];
  const registrationOptions: RuntimeTypedCallOptions[] = [];
  const sessionOptions: RuntimeTypedCallOptions[] = [];
  let sessionCounter = 0;
  const inputWithRetiredSubjectProvider = {
    appId: 'nimi.desktop',
    appInstanceId: 'nimi.desktop.runtime-session',
    deviceId: 'desktop-shell',
    getSubjectUserId() {
      throw new Error('retired subject provider must not be called');
    },
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
      async openSession(request: OpenSessionRequest, options?: RuntimeTypedCallOptions) {
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
  };
  const provider = createNimiRuntimeAppSessionMetadataProvider(inputWithRetiredSubjectProvider);

  assert.deepEqual(await provider(), {
    'x-nimi-session-id': 'session-1',
    'x-nimi-session-token': 'token-1',
  });
  assert.deepEqual(await provider(), {
    'x-nimi-session-id': 'session-1',
    'x-nimi-session-token': 'token-1',
  });

  assert.deepEqual(await provider(), {
    'x-nimi-session-id': 'session-1',
    'x-nimi-session-token': 'token-1',
  });

  assert.equal(registrations.length, 1);
  assert.match(registrationOptions[0]?.metadata?.idempotencyKey ?? '', /^runtime-register-app-/);
  assert.match(sessionOptions[0]?.metadata?.idempotencyKey ?? '', /^runtime-open-session-/);
  assert.deepEqual(sessions.map((request) => request.subjectUserId), ['']);
});

test('Runtime app session metadata provider fails closed without session token', async () => {
  const missingToken = createNimiRuntimeAppSessionMetadataProvider({
    appId: 'nimi.desktop',
    appInstanceId: 'nimi.desktop.runtime-session',
    deviceId: 'desktop-shell',
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

test('Runtime installed app session metadata provider registers without developer registration', async () => {
  const registrations: RegisterAppRequest[] = [];
  const sessions: OpenSessionRequest[] = [];
  const provider = createNimiRuntimeInstalledAppSessionMetadataProvider({
    binding: {
      appId: 'community.nimi.fixture.platform-proof',
      appInstanceId: 'community.nimi.fixture.platform-proof.desktop-host',
      deviceId: 'desktop-installed-app-host-device',
      launchHostId: 'desktop-electron-installed-app-host',
      launchNonce: 'launch-nonce-1',
      releaseDescriptorRef: 'community.nimi.fixture.platform-proof.0.1.0-sandbox',
    },
    capabilities: ['runtime.account.status', 'runtime.account.status', ' '],
    auth: {
      async registerApp(request: RegisterAppRequest) {
        registrations.push(request);
        return {
          appInstanceId: request.appInstanceId,
          accepted: true,
          reasonCode: RuntimeGeneratedReasonCode.ACTION_EXECUTED,
        };
      },
      async openSession(request: OpenSessionRequest) {
        sessions.push(request);
        return {
          sessionId: 'installed-session-1',
          sessionToken: 'installed-token-1',
          issuedAt: { seconds: String(Math.floor(Date.now() / 1000)), nanos: 0 },
          expiresAt: { seconds: String(Math.floor(Date.now() / 1000) + 3600), nanos: 0 },
          reasonCode: RuntimeGeneratedReasonCode.ACTION_EXECUTED,
        };
      },
    },
  });

  assert.deepEqual(await provider(), {
    'x-nimi-session-id': 'installed-session-1',
    'x-nimi-session-token': 'installed-token-1',
  });
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0]?.appId, 'community.nimi.fixture.platform-proof');
  assert.equal(registrations[0]?.appInstanceId, 'community.nimi.fixture.platform-proof.desktop-host');
  assert.equal(registrations[0]?.deviceId, 'desktop-installed-app-host-device');
  assert.equal(registrations[0]?.developerRegistration, false);
  assert.deepEqual(registrations[0]?.capabilities, ['runtime.account.status']);
  assert.deepEqual(sessions.map((request) => request.subjectUserId), ['']);
});

test('Runtime installed app session metadata provider rejects developer registration', async () => {
  await assert.rejects(
    async () => {
      const provider = createNimiRuntimeInstalledAppSessionMetadataProvider({
        binding: {
          appId: 'community.nimi.fixture.platform-proof',
          appInstanceId: 'community.nimi.fixture.platform-proof.desktop-host',
          deviceId: 'desktop-installed-app-host-device',
          launchHostId: 'desktop-electron-installed-app-host',
          launchNonce: '',
          releaseDescriptorRef: 'community.nimi.fixture.platform-proof.0.1.0-sandbox',
        },
        auth: {
          async registerApp() {
            throw new Error('installed app must not register without launch binding evidence');
          },
          async openSession() {
            throw new Error('installed app session must not open without launch binding evidence');
          },
        },
      });
      await provider();
    },
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_RUNTIME_INSTALLED_APP_SESSION_BINDING_REQUIRED',
  );

  await assert.rejects(
    async () => {
      const provider = createNimiRuntimeInstalledAppSessionMetadataProvider({
        binding: {
          appId: 'community.nimi.fixture.platform-proof',
          appInstanceId: 'community.nimi.fixture.platform-proof.desktop-host',
          deviceId: 'desktop-installed-app-host-device',
          launchHostId: 'desktop-electron-installed-app-host',
          launchNonce: 'launch-nonce-1',
          releaseDescriptorRef: 'community.nimi.fixture.platform-proof.0.1.0-sandbox',
        },
        developerRegistration: true,
        auth: {
          async registerApp() {
            throw new Error('installed app must not register through developer mode');
          },
          async openSession() {
            throw new Error('installed app session must not open after rejected developer registration');
          },
        },
      } as never);
      await provider();
    },
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_RUNTIME_INSTALLED_APP_SESSION_DEVELOPER_REGISTRATION_FORBIDDEN',
  );
});
