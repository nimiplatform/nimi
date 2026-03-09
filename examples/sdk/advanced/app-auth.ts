/**
 * App authorization lifecycle with explicit runtime setup.
 * Run: npx tsx examples/sdk/advanced/app-auth.ts
 */

import { Runtime } from '@nimiplatform/sdk';
import {
  AppMode,
  ExternalPrincipalType,
  ExternalProofType,
  PolicyMode,
  RuntimeAuthorizationPreset,
  RuntimeReasonCode,
  WorldRelation,
} from '@nimiplatform/sdk/runtime';

const APP_ID = 'example.auth';
const PRINCIPAL_ID = 'agent-assistant-1';
const SUBJECT_USER_ID = 'local-user';

const runtime = new Runtime({
  appId: APP_ID,
  transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
});

function nowTimestamp() {
  const now = Date.now();
  return {
    seconds: Math.floor(now / 1000).toString(),
    nanos: (now % 1000) * 1_000_000,
  };
}

await runtime.auth.registerApp(
  {
    appId: APP_ID,
    appInstanceId: 'auth-demo-instance',
    deviceId: 'local-device',
    appVersion: '0.1.0',
    capabilities: ['runtime.ai.generate', 'runtime.model.list'],
    modeManifest: {
      appMode: AppMode.FULL,
      runtimeRequired: true,
      realmRequired: false,
      worldRelation: WorldRelation.NONE,
    },
  },
  { idempotencyKey: crypto.randomUUID() },
);

await runtime.auth.registerExternalPrincipal(
  {
    appId: APP_ID,
    externalPrincipalId: PRINCIPAL_ID,
    externalPrincipalType: ExternalPrincipalType.AGENT,
    issuer: APP_ID,
    clientId: 'demo-client',
    signatureKeyId: 'demo-key',
    proofType: ExternalProofType.JWT,
  },
  { idempotencyKey: crypto.randomUUID() },
);

const authorization = await runtime.appAuth.authorizeExternalPrincipal(
  {
    domain: 'app-auth',
    appId: APP_ID,
    externalPrincipalId: PRINCIPAL_ID,
    externalPrincipalType: ExternalPrincipalType.AGENT,
    subjectUserId: SUBJECT_USER_ID,
    consentId: 'consent-001',
    consentVersion: 'v1',
    decisionAt: nowTimestamp(),
    policyVersion: 'v1',
    policyMode: PolicyMode.PRESET,
    preset: RuntimeAuthorizationPreset.DELEGATE,
    scopes: ['runtime.ai.generate', 'runtime.model.list'],
    canDelegate: true,
    maxDelegationDepth: 1,
    ttlSeconds: 3600,
    scopeCatalogVersion: 'sdk-v1',
    policyOverride: false,
  },
  { idempotencyKey: crypto.randomUUID() },
);

const validation = await runtime.appAuth.validateToken({
  appId: APP_ID,
  tokenId: authorization.tokenId,
  subjectUserId: SUBJECT_USER_ID,
  operation: 'ai.generate',
  requestedScopes: ['runtime.ai.generate'],
});

console.log('token:', authorization.tokenId);
console.log('valid:', validation.valid, RuntimeReasonCode[validation.reasonCode]);
