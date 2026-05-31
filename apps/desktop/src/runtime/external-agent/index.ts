import { getPlatformClient } from '@nimiplatform/sdk';
import {
  parseExternalAgentTokenLedgerRecord,
  projectExternalAgentGatewayStatus,
  projectExternalAgentIssueTokenResult,
  projectExternalAgentTokenLedger,
  type ExternalAgentGatewayStatusProjection,
  type ExternalAgentIssueTokenProjection,
  type ExternalAgentTokenLedgerRecord,
} from '@nimiplatform/sdk/runtime';

export type ExternalAgentIssueTokenPayload = {
  principalId: string;
  mode: 'delegated' | 'autonomous';
  subjectAccountId: string;
  actions: string[];
  scopes?: Array<{ actionId: string; ops: string[] }>;
  ttlSeconds?: number;
};

export type ExternalAgentIssueTokenResult = ExternalAgentIssueTokenProjection;
export type ExternalAgentTokenRecord = ExternalAgentTokenLedgerRecord;
export type ExternalAgentGatewayStatus = ExternalAgentGatewayStatusProjection;

export async function issueExternalAgentToken(
  payload: ExternalAgentIssueTokenPayload,
): Promise<ExternalAgentIssueTokenResult> {
  const result = await getPlatformClient().runtime.externalAgent.issueToken({
    principalId: payload.principalId,
    mode: payload.mode,
    subjectAccountId: payload.subjectAccountId,
    actions: payload.actions,
    scopes: (payload.scopes || []).map((scope) => ({
      actionId: scope.actionId,
      ops: scope.ops,
    })),
    ttlSeconds: payload.ttlSeconds || 0,
  });
  return projectExternalAgentIssueTokenResult(result);
}

export async function revokeExternalAgentToken(tokenId: string): Promise<void> {
  await getPlatformClient().runtime.externalAgent.revokeToken({ tokenId });
}

export async function listExternalAgentTokens(): Promise<ExternalAgentTokenRecord[]> {
  const result = await getPlatformClient().runtime.externalAgent.listTokens({
    pageSize: 0,
    pageToken: '',
    includeRevoked: false,
  });
  const tokens = result.tokens;
  if (!Array.isArray(tokens)) {
    throw new Error('EXTERNAL_AGENT_TOKEN_LEDGER_INVALID_RESPONSE');
  }
  return projectExternalAgentTokenLedger(tokens);
}

export async function getExternalAgentGatewayStatus(): Promise<ExternalAgentGatewayStatus> {
  const result = await getPlatformClient().runtime.externalAgent.getGatewayStatus({});
  return projectExternalAgentGatewayStatus(result);
}

export { parseExternalAgentTokenLedgerRecord };
