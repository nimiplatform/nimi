import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNimiRuntimeExternalAgentAccessSurface,
  parseNimiExternalAgentTokenLedgerRecord,
  type NimiRuntimeExternalAgentClient,
} from './index';

const ISSUED_AT = { seconds: '1780617600', nanos: 0 };
const EXPIRES_AT = { seconds: '1780621200', nanos: 0 };

test('Nimi external agent surface projects generated Runtime token and gateway records', async () => {
  const calls: string[] = [];
  const externalAgents: NimiRuntimeExternalAgentClient = {
    async getExternalAgentGatewayStatus() {
      calls.push('status');
      return {
        enabled: true,
        bindAddress: '127.0.0.1:4949',
        issuer: 'runtime',
        actionCount: 2,
        status: 'ready',
        reasonCode: '',
      };
    },
    async issueExternalAgentToken(request) {
      calls.push(`issue:${request.principalId}:${request.actions.join(',')}:${request.ttlSeconds}`);
      return {
        token: 'secret',
        tokenId: 'token-1',
        principalId: request.principalId,
        mode: request.mode,
        subjectAccountId: request.subjectAccountId,
        actions: request.actions,
        scopes: request.scopes,
        issuedAt: ISSUED_AT,
        expiresAt: EXPIRES_AT,
        revokedAt: '',
        issuer: 'runtime',
      };
    },
    async revokeExternalAgentToken(request) {
      calls.push(`revoke:${request.tokenId}`);
      return {};
    },
    async listExternalAgentTokens(request) {
      calls.push(`list:${request.includeRevoked}`);
      return {
        tokens: [{
          tokenId: 'token-1',
          principalId: 'agent.local',
          mode: 'delegated',
          subjectAccountId: 'account-1',
          actions: ['runtime.agent.read'],
          scopes: [{ actionId: 'runtime.agent.read', ops: ['call'] }],
          issuedAt: ISSUED_AT,
          expiresAt: EXPIRES_AT,
          issuer: 'runtime',
        }],
      };
    },
  };
  const surface = createNimiRuntimeExternalAgentAccessSurface({ getExternalAgents: () => externalAgents });

  const status = await surface.getGatewayStatus();
  assert.equal(status.enabled, true);
  assert.equal(status.bindAddress, '127.0.0.1:4949');
  assert.equal(status.reasonCode, undefined);

  const issued = await surface.issueToken({
    principalId: 'agent.local',
    mode: 'delegated',
    subjectAccountId: 'account-1',
    actions: [' runtime.agent.read ', ''],
    scopes: [{ actionId: ' runtime.agent.read ', ops: [' call ', ''] }],
    ttlSeconds: 3600,
  });
  assert.equal(issued.tokenId, 'token-1');
  assert.deepEqual(issued.actions, ['runtime.agent.read']);
  assert.deepEqual(issued.scopes, [{ actionId: 'runtime.agent.read', ops: ['call'] }]);
  assert.equal(issued.expiresAt, '2026-06-05T01:00:00.000Z');

  const tokens = await surface.listTokens();
  assert.equal(tokens[0]?.issuedAt, '2026-06-05T00:00:00.000Z');

  await surface.revokeToken('token-1');
  assert.deepEqual(calls, [
    'status',
    'issue:agent.local:runtime.agent.read:3600',
    'list:false',
    'revoke:token-1',
  ]);
});

test('Nimi external agent token ledger parsing fails closed on malformed Runtime records', () => {
  assert.throws(
    () => parseNimiExternalAgentTokenLedgerRecord({
      tokenId: '',
      principalId: 'agent.local',
      mode: 'unknown',
      subjectAccountId: 'account-1',
      actions: [],
      scopes: [],
      issuedAt: ISSUED_AT,
      expiresAt: EXPIRES_AT,
      issuer: 'runtime',
    }),
    /Runtime external agent token ledger mode is invalid/,
  );
});
