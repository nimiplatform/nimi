import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRuntimeProtectedScopeHelper,
  type RuntimeAppAuthClient,
  type RuntimeAuthClient,
} from '../../src/runtime/index.js';
import { RegisterAppResponse } from '../../src/runtime/generated/runtime/v1/auth.js';
import { AuthorizeExternalPrincipalResponse } from '../../src/runtime/generated/runtime/v1/grant.js';

test('Runtime protected access invalidates all subject cache entries when subject is omitted', async () => {
  const scopes = ['runtime.memory.read'];
  let activeSubjectUserId = 'subject-a';
  let issueCount = 0;

  const auth = {
    registerApp: async () => RegisterAppResponse.create({ accepted: true }),
  } satisfies Pick<RuntimeAuthClient, 'registerApp'>;

  const appAuth = {
    authorizeExternalPrincipal: async (request) => {
      issueCount += 1;
      return AuthorizeExternalPrincipalResponse.create({
        tokenId: `token-${issueCount}`,
        secret: `secret-${issueCount}`,
        appId: request.appId,
        subjectUserId: request.subjectUserId,
        externalPrincipalId: request.externalPrincipalId,
        effectiveScopes: request.scopes,
        policyVersion: request.policyVersion,
        issuedScopeCatalogVersion: request.scopeCatalogVersion,
        canDelegate: false,
      });
    },
  } satisfies Pick<RuntimeAppAuthClient, 'authorizeExternalPrincipal'>;

  const protectedAccess = createRuntimeProtectedScopeHelper({
    runtime: {
      appId: 'nimi.sdk.protected-access.test',
      auth,
      appAuth,
    },
    getSubjectUserId: (explicit) => explicit || activeSubjectUserId,
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });

  assert.equal((await protectedAccess.getCallOptions(scopes)).protectedAccessToken?.tokenId, 'token-1');
  assert.equal((await protectedAccess.getCallOptions(scopes)).protectedAccessToken?.tokenId, 'token-1');

  activeSubjectUserId = 'subject-b';
  assert.equal((await protectedAccess.getCallOptions(scopes)).protectedAccessToken?.tokenId, 'token-2');

  protectedAccess.invalidate(scopes);

  activeSubjectUserId = 'subject-a';
  assert.equal((await protectedAccess.getCallOptions(scopes)).protectedAccessToken?.tokenId, 'token-3');

  activeSubjectUserId = 'subject-b';
  assert.equal((await protectedAccess.getCallOptions(scopes)).protectedAccessToken?.tokenId, 'token-4');
});
