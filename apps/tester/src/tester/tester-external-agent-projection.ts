import {
  parseExternalAgentTokenLedgerRecord,
  projectExternalAgentGatewayStatus,
  projectExternalAgentIssueTokenResult,
  type ExternalAgentGatewayStatusProjection,
  type ExternalAgentIssueTokenProjection,
  type ExternalAgentTokenLedgerRecord,
} from '@nimiplatform/sdk/runtime';

export type TesterExternalAgentProjection = {
  issued: ExternalAgentIssueTokenProjection;
  token: ExternalAgentTokenLedgerRecord;
  gateway: ExternalAgentGatewayStatusProjection;
};

export function createTesterExternalAgentProjection(): TesterExternalAgentProjection {
  const issued = projectExternalAgentIssueTokenResult({
    token: 'tester-token',
    tokenId: 'tester-token-id',
    principalId: 'tester-principal',
    mode: 'delegated',
    subjectAccountId: 'tester-account',
    actions: ['chat.send'],
    scopes: [{ actionId: 'chat.send', ops: ['invoke'] }],
    issuedAt: { seconds: '1776124800', nanos: 0 },
    expiresAt: { seconds: '1776128400', nanos: 0 },
    revokedAt: '',
    issuer: 'tester-runtime',
  });
  const token = parseExternalAgentTokenLedgerRecord({
    tokenId: 'tester-token-id',
    principalId: 'tester-principal',
    mode: 'delegated',
    subjectAccountId: 'tester-account',
    actions: ['chat.send'],
    scopes: [{ actionId: 'chat.send', ops: ['invoke'] }],
    issuedAt: { seconds: '1776124800', nanos: 0 },
    expiresAt: { seconds: '1776128400', nanos: 0 },
    issuer: 'tester-runtime',
  }, 0);
  const gateway = projectExternalAgentGatewayStatus({
    enabled: true,
    bindAddress: '127.0.0.1:0',
    issuer: 'tester-runtime',
    actionCount: 1,
    status: 'ready',
    reasonCode: '',
  });
  return { issued, token, gateway };
}
