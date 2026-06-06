import {
  createNimiRuntimeExternalAgentAccessSurface,
  parseNimiExternalAgentTokenLedgerRecord,
  projectNimiExternalAgentGatewayStatus,
  projectNimiExternalAgentIssueTokenResult,
  type NimiExternalAgentGatewayStatusProjection,
  type NimiExternalAgentIssueTokenProjection,
  type NimiExternalAgentTokenLedgerRecord,
} from '@nimiplatform/sdk/runtime';

export type TesterExternalAgentProjection = {
  issued: NimiExternalAgentIssueTokenProjection;
  token: NimiExternalAgentTokenLedgerRecord;
  gateway: NimiExternalAgentGatewayStatusProjection;
};

export function createTesterExternalAgentAccessSurface() {
  return createNimiRuntimeExternalAgentAccessSurface({
    getExternalAgents: () => ({
      async issueExternalAgentToken(request) {
        return {
          token: 'tester-token',
          tokenId: 'tester-token-id',
          principalId: request.principalId,
          mode: request.mode,
          subjectAccountId: request.subjectAccountId,
          actions: request.actions,
          scopes: request.scopes,
          issuedAt: { seconds: '1776124800', nanos: 0 },
          expiresAt: { seconds: '1776128400', nanos: 0 },
          revokedAt: '',
          issuer: 'tester-runtime',
        };
      },
      async revokeExternalAgentToken() {
        return {};
      },
      async listExternalAgentTokens() {
        return {
          tokens: [{
            tokenId: 'tester-token-id',
            principalId: 'tester-principal',
            mode: 'delegated',
            subjectAccountId: 'tester-account',
            actions: ['chat.send'],
            scopes: [{ actionId: 'chat.send', ops: ['invoke'] }],
            issuedAt: { seconds: '1776124800', nanos: 0 },
            expiresAt: { seconds: '1776128400', nanos: 0 },
            issuer: 'tester-runtime',
          }],
          nextPageToken: '',
        };
      },
      async getExternalAgentGatewayStatus() {
        return {
          enabled: true,
          bindAddress: '127.0.0.1:0',
          issuer: 'tester-runtime',
          actionCount: 1,
          status: 'ready',
          reasonCode: '',
        };
      },
    }),
  });
}

export async function loadTesterExternalAgentProjection(): Promise<TesterExternalAgentProjection> {
  const surface = createTesterExternalAgentAccessSurface();
  const [issued, tokens, gateway] = await Promise.all([
    surface.issueToken({
      principalId: 'tester-principal',
      mode: 'delegated',
      subjectAccountId: 'tester-account',
      actions: ['chat.send'],
      scopes: [{ actionId: 'chat.send', ops: ['invoke'] }],
      ttlSeconds: 3600,
    }),
    surface.listTokens(),
    surface.getGatewayStatus(),
  ]);
  return {
    issued,
    token: tokens[0]!,
    gateway,
  };
}

export function createTesterExternalAgentProjection(): TesterExternalAgentProjection {
  const issued = projectNimiExternalAgentIssueTokenResult({
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
  const token = parseNimiExternalAgentTokenLedgerRecord({
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
  const gateway = projectNimiExternalAgentGatewayStatus({
    enabled: true,
    bindAddress: '127.0.0.1:0',
    issuer: 'tester-runtime',
    actionCount: 1,
    status: 'ready',
    reasonCode: '',
  });
  return { issued, token, gateway };
}
