/**
 * App Authorization Lifecycle (ExternalPrincipal)
 *
 * Run: npx tsx docs/examples/app-auth.ts
 */

import { createNimiClient } from '@nimiplatform/sdk';
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

const client = createNimiClient({
  appId: APP_ID,
  runtime: {
    transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
  },
});

const runtime = client.runtime!;

function nowTimestamp() {
  const now = Date.now();
  return {
    seconds: Math.floor(now / 1000).toString(),
    nanos: (now % 1000) * 1_000_000,
  };
}

async function registerApp() {
  const result = await runtime.auth.registerApp(
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

  console.log('registerApp accepted:', result.accepted, 'reason:', RuntimeReasonCode[result.reasonCode]);
}

async function registerPrincipal() {
  const result = await runtime.auth.registerExternalPrincipal(
    {
      appId: APP_ID,
      externalPrincipalId: PRINCIPAL_ID,
      externalPrincipalType: ExternalPrincipalType.AGENT,
      issuer: APP_ID,
      clientId: 'demo-client',
      signatureKeyId: 'demo-key',
      proofType: ExternalProofType.ED25519,
    },
    { idempotencyKey: crypto.randomUUID() },
  );

  console.log('registerPrincipal accepted:', result.accepted, 'reason:', RuntimeReasonCode[result.reasonCode]);
}

async function authorizePreset() {
  const result = await runtime.appAuth.authorizeExternalPrincipal(
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

  console.log('authorized token:', result.tokenId);
  console.log('issuedScopeCatalogVersion:', result.issuedScopeCatalogVersion);
  return result;
}

async function validateToken(tokenId: string) {
  const result = await runtime.appAuth.validateToken({
    appId: APP_ID,
    tokenId,
    subjectUserId: SUBJECT_USER_ID,
    operation: 'ai.generate',
    requestedScopes: ['runtime.ai.generate'],
  });

  console.log('validate valid:', result.valid, 'reason:', RuntimeReasonCode[result.reasonCode]);
}

async function issueDelegatedToken(parentTokenId: string) {
  const result = await runtime.appAuth.issueDelegatedToken(
    {
      appId: APP_ID,
      parentTokenId,
      scopes: ['runtime.model.list'],
      ttlSeconds: 1200,
    },
    { idempotencyKey: crypto.randomUUID() },
  );

  console.log('delegated token:', result.tokenId, 'parent:', result.parentTokenId);
  return result;
}

async function listTokenChain(rootTokenId: string) {
  const result = await runtime.appAuth.listTokenChain({
    appId: APP_ID,
    rootTokenId,
  });

  console.log('token chain nodes:', result.nodes.length);
  for (const node of result.nodes) {
    console.log('-', node.tokenId, 'parent:', node.parentTokenId || '(root)');
  }
}

async function revokeToken(tokenId: string) {
  const result = await runtime.appAuth.revokeToken(
    {
      appId: APP_ID,
      tokenId,
    },
    { idempotencyKey: crypto.randomUUID() },
  );

  console.log('revoke ok:', result.ok, 'reason:', RuntimeReasonCode[result.reasonCode]);
}

async function main() {
  await registerApp();
  await registerPrincipal();

  const authorized = await authorizePreset();
  await validateToken(authorized.tokenId);

  await issueDelegatedToken(authorized.tokenId);
  await listTokenChain(authorized.tokenId);

  await revokeToken(authorized.tokenId);
  await validateToken(authorized.tokenId);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
