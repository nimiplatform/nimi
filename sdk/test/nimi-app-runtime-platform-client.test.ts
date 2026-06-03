import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  clearPlatformClient,
  createNimiAppRuntimePlatformClient,
} from '../src/index.js';
import { RuntimeMethodIds, setNodeGrpcBridge } from '../src/runtime/index.js';
import { RegisterAppRequest, RegisterAppResponse } from '../src/runtime/generated/runtime/v1/auth.js';
import { ReasonCode } from '../src/types/index.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const helperSourcePath = path.join(testDir, '..', 'src', 'nimi-app-runtime-platform-client.ts');

test('root SDK exports Nimi App Runtime platform helper', () => {
  assert.equal(typeof createNimiAppRuntimePlatformClient, 'function');
});

test('third-party Nimi App mode fails closed without self-declared first-party Runtime account path', async () => {
  clearPlatformClient();
  let runtimeCalls = 0;
  setNodeGrpcBridge({
    invokeUnary: async () => {
      runtimeCalls += 1;
      throw new Error('third-party helper must not call Runtime account token path');
    },
    openStream: async () => ({
      async *[Symbol.asyncIterator]() {
        // no-op
      },
    }),
    closeStream: async () => {},
  });

  try {
    const projection = await createNimiAppRuntimePlatformClient({
      mode: 'third-party-nimi-app',
      appId: 'nimi.sdk.app.third-party',
      realmBaseUrl: 'https://realm.example',
      runtimeTransport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
    });

    assert.equal(projection.status, 'unavailable');
    assert.equal(projection.reasonCode, ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE);
    assert.equal(runtimeCalls, 0);
  } finally {
    setNodeGrpcBridge(null);
  }
});

test('local-first-party developer registration forwards developer_registration to RegisterApp (K-AUTHSVC-014)', async () => {
  clearPlatformClient();
  let forwardedDeveloperRegistration: boolean | undefined;
  let registerCalls = 0;
  setNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.auth.registerApp) {
        registerCalls += 1;
        const request = RegisterAppRequest.fromBinary(input.request);
        forwardedDeveloperRegistration = request.developerRegistration;
        return RegisterAppResponse.toBinary(RegisterAppResponse.create({
          appInstanceId: request.appInstanceId,
          accepted: true,
        }));
      }
      return new Uint8Array();
    },
    openStream: async () => ({
      async *[Symbol.asyncIterator]() {
        // no-op
      },
    }),
    closeStream: async () => {},
  });

  try {
    const projection = await createNimiAppRuntimePlatformClient({
      mode: 'local-first-party',
      appId: 'app.nimi.shijing',
      realmBaseUrl: 'https://realm.example',
      runtimeTransport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
      developerRegistration: true,
    });

    assert.equal(projection.status, 'ready');
    assert.equal(registerCalls, 1);
    assert.equal(forwardedDeveloperRegistration, true);
  } finally {
    setNodeGrpcBridge(null);
  }
});

test('local-first-party without developer registration sends developer_registration false', async () => {
  clearPlatformClient();
  let forwardedDeveloperRegistration: boolean | undefined;
  setNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.auth.registerApp) {
        const request = RegisterAppRequest.fromBinary(input.request);
        forwardedDeveloperRegistration = request.developerRegistration;
        return RegisterAppResponse.toBinary(RegisterAppResponse.create({
          appInstanceId: request.appInstanceId,
          accepted: true,
        }));
      }
      return new Uint8Array();
    },
    openStream: async () => ({
      async *[Symbol.asyncIterator]() {
        // no-op
      },
    }),
    closeStream: async () => {},
  });

  try {
    const projection = await createNimiAppRuntimePlatformClient({
      mode: 'local-first-party',
      appId: 'app.nimi.shijing',
      realmBaseUrl: 'https://realm.example',
      runtimeTransport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
    });

    assert.equal(projection.status, 'ready');
    assert.equal(forwardedDeveloperRegistration, false);
  } finally {
    setNodeGrpcBridge(null);
  }
});

test('helper input source does not expose app-owned auth custody seams', () => {
  const source = readFileSync(helperSourcePath, 'utf8');
  for (const forbidden of [
    'accessToken?:',
    'accessTokenProvider',
    'refreshTokenProvider',
    'subjectUserIdProvider',
    'sessionStore',
    'password',
    'decodeJwtSubject',
  ]) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must stay out of Nimi App helper input`);
  }

  // The third-party-nimi-app path must fail closed (return unavailable) and must
  // not silently fall back to the local first-party account path or any token
  // access. There is no longer a standalone developer-session mode.
  assert.equal(source.includes("mode: 'dev-standalone'"), false);
  assert.equal(source.includes('developerSession'), false);
  const thirdPartyBranch = source.slice(
    source.indexOf("// mode === 'third-party-nimi-app'"),
  );
  assert.equal(thirdPartyBranch.includes('createLocalFirstPartyRuntimePlatformClient'), false);
  assert.equal(thirdPartyBranch.includes('GetAccessToken'), false);
});

test('local-first-party path auto-issues the ai.spend.meter protected token for AI calls', () => {
  // Runtime ExecuteScenario is authz-gated on the `ai.spend.meter` protected
  // capability. A Nimi App consumes the high-level runtime.ai.* surface, so the
  // local-first-party client must enable autoIssueForAi; otherwise every AI call
  // fails closed with PRINCIPAL_UNAUTHORIZED. Guards the regression where the
  // removed dev-standalone branch dropped the only autoIssueForAi wiring.
  const source = readFileSync(helperSourcePath, 'utf8');
  const localFirstPartyBranch = source.slice(
    source.indexOf("if (mode === 'local-first-party')"),
    source.indexOf("// mode === 'third-party-nimi-app'"),
  );
  assert.match(localFirstPartyBranch, /autoIssueForAi:\s*true/);
  assert.match(localFirstPartyBranch, /const developerRegistration = 'developerRegistration' in input && input\.developerRegistration === true/);
  assert.match(localFirstPartyBranch, /protectedAccess:[\s\S]*developerRegistration,/);
});
