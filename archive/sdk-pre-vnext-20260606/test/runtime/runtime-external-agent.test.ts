import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createHostRuntimeExternalAgentAccessSurface,
  parseExternalAgentTokenLedgerRecord,
  projectExternalAgentGatewayStatus,
  projectExternalAgentIssueTokenResult,
  projectExternalAgentTokenLedger,
} from '../../src/runtime/index.js';

test('projectExternalAgentIssueTokenResult normalizes Runtime issue response', () => {
  assert.deepEqual(projectExternalAgentIssueTokenResult({
    token: ' token ',
    tokenId: ' token-1 ',
    principalId: ' principal-1 ',
    mode: 'delegated',
    subjectAccountId: ' account-1 ',
    actions: [' chat.send ', '', 'memory.read'],
    scopes: [
      { actionId: ' action-1 ', ops: [' read ', ''] },
      { actionId: '', ops: ['ignored'] },
    ],
    issuedAt: { seconds: '1776124800', nanos: 500_000_000 },
    expiresAt: { seconds: '1776128400', nanos: 0 },
    revokedAt: '',
    issuer: ' runtime ',
  }), {
    token: 'token',
    tokenId: 'token-1',
    principalId: 'principal-1',
    mode: 'delegated',
    subjectAccountId: 'account-1',
    actions: ['chat.send', 'memory.read'],
    scopes: [{ actionId: 'action-1', ops: ['read'] }],
    issuedAt: '2026-04-14T00:00:00.500Z',
    expiresAt: '2026-04-14T01:00:00.000Z',
    issuer: 'runtime',
  });
});

test('parseExternalAgentTokenLedgerRecord fails closed on malformed ledger rows', () => {
  assert.throws(
    () => parseExternalAgentTokenLedgerRecord({
      tokenId: 'token-1',
      principalId: 'principal-1',
      mode: 'unsupported',
      subjectAccountId: 'account-1',
      actions: ['chat.send'],
      scopes: [],
      issuedAt: { seconds: '1776124800', nanos: 0 },
      expiresAt: { seconds: '1776128400', nanos: 0 },
      issuer: 'runtime',
    }, 0),
    /EXTERNAL_AGENT_TOKEN_LEDGER_FIELD_INVALID:tokens\[0\]\.mode/,
  );
  assert.throws(
    () => parseExternalAgentTokenLedgerRecord({
      tokenId: 'token-1',
      principalId: 'principal-1',
      mode: 'delegated',
      subjectAccountId: 'account-1',
      actions: [],
      scopes: [{ actionId: '', ops: ['read'] }],
      issuedAt: { seconds: '1776124800', nanos: 0 },
      expiresAt: { seconds: '1776128400', nanos: 0 },
      issuer: 'runtime',
    }, 0),
    /EXTERNAL_AGENT_TOKEN_LEDGER_FIELD_INVALID:scopes\[0\]\.actionId/,
  );
});

test('projectExternalAgentTokenLedger and gateway status project app-facing rows', () => {
  assert.deepEqual(projectExternalAgentTokenLedger([{
    tokenId: ' token-1 ',
    principalId: ' principal-1 ',
    mode: 'autonomous',
    subjectAccountId: ' account-1 ',
    actions: ['chat.send'],
    scopes: [{ actionId: 'chat.send', ops: ['invoke'] }],
    issuedAt: { seconds: '1776124800', nanos: 0 },
    expiresAt: { seconds: '1776128400', nanos: 0 },
    revokedAt: { seconds: '1776126600', nanos: 0 },
    issuer: ' runtime ',
  }]), [{
    tokenId: 'token-1',
    principalId: 'principal-1',
    mode: 'autonomous',
    subjectAccountId: 'account-1',
    actions: ['chat.send'],
    scopes: [{ actionId: 'chat.send', ops: ['invoke'] }],
    issuedAt: '2026-04-14T00:00:00.000Z',
    expiresAt: '2026-04-14T01:00:00.000Z',
    revokedAt: '2026-04-14T00:30:00.000Z',
    issuer: 'runtime',
  }]);

  assert.deepEqual(projectExternalAgentGatewayStatus({
    enabled: true,
    bindAddress: ' 127.0.0.1:0 ',
    issuer: ' runtime ',
    actionCount: 3,
    status: ' ready ',
    reasonCode: '',
  }), {
    enabled: true,
    bindAddress: '127.0.0.1:0',
    issuer: 'runtime',
    actionCount: 3,
    status: 'ready',
  });
});

test('createHostRuntimeExternalAgentAccessSurface delegates to Runtime and projects app-facing results', async () => {
  const calls: Array<{ method: string; request: unknown }> = [];
  const surface = createHostRuntimeExternalAgentAccessSurface({
    getRuntime: () => ({
      externalAgent: {
        async issueToken(request) {
          calls.push({ method: 'issueToken', request });
          return {
            token: ' issued-token ',
            tokenId: ' issued-id ',
            principalId: request.principalId,
            mode: request.mode,
            subjectAccountId: request.subjectAccountId,
            actions: request.actions,
            scopes: request.scopes,
            issuedAt: { seconds: '1776124800', nanos: 0 },
            expiresAt: { seconds: '1776128400', nanos: 0 },
            revokedAt: '',
            issuer: ' runtime ',
          };
        },
        async revokeToken(request) {
          calls.push({ method: 'revokeToken', request });
          return { ok: true, reasonCode: 0, actionHint: '' };
        },
        async listTokens(request) {
          calls.push({ method: 'listTokens', request });
          return {
            tokens: [{
              tokenId: ' token-1 ',
              principalId: ' principal-1 ',
              mode: 'delegated',
              subjectAccountId: ' account-1 ',
              actions: ['chat.send'],
              scopes: [{ actionId: 'chat.send', ops: ['invoke'] }],
              issuedAt: { seconds: '1776124800', nanos: 0 },
              expiresAt: { seconds: '1776128400', nanos: 0 },
              issuer: ' runtime ',
            }],
            nextPageToken: '',
          };
        },
        async getGatewayStatus(request) {
          calls.push({ method: 'getGatewayStatus', request });
          return {
            enabled: true,
            bindAddress: ' 127.0.0.1:0 ',
            issuer: ' runtime ',
            actionCount: 1,
            status: ' ready ',
            reasonCode: '',
          };
        },
      },
    }),
  });

  const issued = await surface.issueToken({
    principalId: 'principal-1',
    mode: 'delegated',
    subjectAccountId: 'account-1',
    actions: ['chat.send'],
    scopes: [{ actionId: 'chat.send', ops: ['invoke'] }],
    ttlSeconds: 3600,
  });
  await surface.revokeToken('issued-id');
  const tokens = await surface.listTokens();
  const gateway = await surface.getGatewayStatus();

  assert.equal(issued.token, 'issued-token');
  assert.equal(tokens[0]?.tokenId, 'token-1');
  assert.equal(gateway.bindAddress, '127.0.0.1:0');
  assert.deepEqual(calls.map((call) => call.method), [
    'issueToken',
    'revokeToken',
    'listTokens',
    'getGatewayStatus',
  ]);
  assert.deepEqual(calls[0]?.request, {
    principalId: 'principal-1',
    mode: 'delegated',
    subjectAccountId: 'account-1',
    actions: ['chat.send'],
    scopes: [{ actionId: 'chat.send', ops: ['invoke'] }],
    ttlSeconds: 3600,
  });
  assert.deepEqual(calls[2]?.request, {
    pageSize: 0,
    pageToken: '',
    includeRevoked: false,
  });
});
