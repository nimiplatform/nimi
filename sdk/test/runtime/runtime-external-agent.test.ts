import assert from 'node:assert/strict';
import test from 'node:test';

import {
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
