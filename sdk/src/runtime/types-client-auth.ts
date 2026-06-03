import type {
  OpenExternalPrincipalSessionRequest,
  OpenExternalPrincipalSessionResponse,
  OpenSessionRequest,
  OpenSessionResponse,
  RefreshSessionRequest,
  RefreshSessionResponse,
  RegisterAppRequest,
  RegisterAppResponse,
  RegisterExternalPrincipalRequest,
  RegisterExternalPrincipalResponse,
  RevokeExternalPrincipalSessionRequest,
  RevokeSessionRequest,
} from './generated/runtime/v1/auth';
import type {
  AccountSessionEvent,
  BeginLoginRequest,
  BeginLoginResponse,
  CompleteLoginRequest,
  CompleteLoginResponse,
  GetAccessTokenRequest,
  GetAccessTokenResponse,
  GetAccountSessionStatusRequest,
  GetAccountSessionStatusResponse,
  IssueScopedAppBindingRequest,
  IssueScopedAppBindingResponse,
  IssueWorkspaceBindingRequest,
  IssueWorkspaceBindingResponse,
  LogoutRequest,
  LogoutResponse,
  RefreshAccountSessionRequest,
  RefreshAccountSessionResponse,
  RevokeScopedAppBindingRequest,
  RevokeScopedAppBindingResponse,
  RevokeWorkspaceBindingRequest,
  RevokeWorkspaceBindingResponse,
  SubscribeAccountSessionEventsRequest,
  SwitchAccountRequest,
  SwitchAccountResponse,
} from './generated/runtime/v1/account';
import type {
  AuthorizeExternalPrincipalRequest,
  AuthorizeExternalPrincipalResponse,
  IssueDelegatedAccessTokenRequest,
  IssueDelegatedAccessTokenResponse,
  ListTokenChainRequest,
  ListTokenChainResponse,
  RevokeAppAccessTokenRequest,
  ValidateAppAccessTokenRequest,
  ValidateAppAccessTokenResponse,
} from './generated/runtime/v1/grant';
import type {
  ExternalAgentGatewayStatusRequest,
  ExternalAgentGatewayStatusResponse,
  ExternalAgentIssueTokenRequest,
  ExternalAgentIssueTokenResponse,
  ExternalAgentListTokensRequest,
  ExternalAgentListTokensResponse,
  ExternalAgentRevokeTokenRequest,
} from './generated/runtime/v1/external_agent';
import type {
  Ack,
} from './generated/runtime/v1/common';
import type {
  RuntimeCallOptions,
  RuntimeStreamCallOptions,
} from './types.js';

export type RuntimeAuthClient = {
  registerApp(request: RegisterAppRequest, options?: RuntimeCallOptions): Promise<RegisterAppResponse>;
  openSession(request: OpenSessionRequest, options?: RuntimeCallOptions): Promise<OpenSessionResponse>;
  refreshSession(request: RefreshSessionRequest, options?: RuntimeCallOptions): Promise<RefreshSessionResponse>;
  revokeSession(request: RevokeSessionRequest, options?: RuntimeCallOptions): Promise<Ack>;
  registerExternalPrincipal(request: RegisterExternalPrincipalRequest, options?: RuntimeCallOptions): Promise<RegisterExternalPrincipalResponse>;
  openExternalPrincipalSession(request: OpenExternalPrincipalSessionRequest, options?: RuntimeCallOptions): Promise<OpenExternalPrincipalSessionResponse>;
  revokeExternalPrincipalSession(request: RevokeExternalPrincipalSessionRequest, options?: RuntimeCallOptions): Promise<Ack>;
};

export type RuntimeAppAuthClient = {
  authorizeExternalPrincipal(request: AuthorizeExternalPrincipalRequest, options?: RuntimeCallOptions): Promise<AuthorizeExternalPrincipalResponse>;
  validateToken(request: ValidateAppAccessTokenRequest, options?: RuntimeCallOptions): Promise<ValidateAppAccessTokenResponse>;
  revokeToken(request: RevokeAppAccessTokenRequest, options?: RuntimeCallOptions): Promise<Ack>;
  issueDelegatedToken(request: IssueDelegatedAccessTokenRequest, options?: RuntimeCallOptions): Promise<IssueDelegatedAccessTokenResponse>;
  listTokenChain(request: ListTokenChainRequest, options?: RuntimeCallOptions): Promise<ListTokenChainResponse>;
};

export type RuntimeExternalAgentClient = {
  getGatewayStatus(request: ExternalAgentGatewayStatusRequest, options?: RuntimeCallOptions): Promise<ExternalAgentGatewayStatusResponse>;
  issueToken(request: ExternalAgentIssueTokenRequest, options?: RuntimeCallOptions): Promise<ExternalAgentIssueTokenResponse>;
  revokeToken(request: ExternalAgentRevokeTokenRequest, options?: RuntimeCallOptions): Promise<Ack>;
  listTokens(request: ExternalAgentListTokensRequest, options?: RuntimeCallOptions): Promise<ExternalAgentListTokensResponse>;
};

export type RuntimeAccountClient = {
  getAccountSessionStatus(request: GetAccountSessionStatusRequest, options?: RuntimeCallOptions): Promise<GetAccountSessionStatusResponse>;
  subscribeAccountSessionEvents(request: SubscribeAccountSessionEventsRequest, options?: RuntimeStreamCallOptions): Promise<AsyncIterable<AccountSessionEvent>>;
  beginLogin(request: BeginLoginRequest, options?: RuntimeCallOptions): Promise<BeginLoginResponse>;
  completeLogin(request: CompleteLoginRequest, options?: RuntimeCallOptions): Promise<CompleteLoginResponse>;
  getAccessToken(request: GetAccessTokenRequest, options?: RuntimeCallOptions): Promise<GetAccessTokenResponse>;
  refreshAccountSession(request: RefreshAccountSessionRequest, options?: RuntimeCallOptions): Promise<RefreshAccountSessionResponse>;
  logout(request: LogoutRequest, options?: RuntimeCallOptions): Promise<LogoutResponse>;
  switchAccount(request: SwitchAccountRequest, options?: RuntimeCallOptions): Promise<SwitchAccountResponse>;
  issueScopedAppBinding(request: IssueScopedAppBindingRequest, options?: RuntimeCallOptions): Promise<IssueScopedAppBindingResponse>;
  revokeScopedAppBinding(request: RevokeScopedAppBindingRequest, options?: RuntimeCallOptions): Promise<RevokeScopedAppBindingResponse>;
  issueWorkspaceBinding(request: IssueWorkspaceBindingRequest, options?: RuntimeCallOptions): Promise<IssueWorkspaceBindingResponse>;
  revokeWorkspaceBinding(request: RevokeWorkspaceBindingRequest, options?: RuntimeCallOptions): Promise<RevokeWorkspaceBindingResponse>;
};
