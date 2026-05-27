export {
  getExternalAgentGatewayStatus,
  issueExternalAgentToken,
  listExternalAgentTokens,
  revokeExternalAgentToken,
} from '@runtime/external-agent';

export type {
  ExternalAgentGatewayStatus,
  ExternalAgentIssueTokenPayload,
  ExternalAgentIssueTokenResult,
  ExternalAgentTokenRecord,
} from '@runtime/external-agent';

export type ExternalAgentRevokeTokenPayload = {
  tokenId: string;
};
