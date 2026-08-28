import {
  createNimiRealmRealtimeRuntimeClient,
  createNimiRealmChatRuntimeClient,
  createRuntimeAccountMediatedDesktopProductRealmTransport,
  type NimiRealmRealtimeClient,
  type NimiRealmChatClient,
} from '@nimiplatform/sdk/app';
import {
  createNimiDesktopFirstPartyRuntimeClients,
  createNimiDesktopShellRuntimeAccountCaller,
  createNimiHostRuntimeAgentLifecycleSurface,
  type NimiDesktopAccountProductRuntimeClient,
  type NimiDesktopFirstPartyRuntimeClients,
  type NimiDesktopMachineProductRuntimeClient,
  type NimiDesktopRuntimeAgentPurposeClient,
  type NimiDesktopRuntimeAiExecutionClient,
  type NimiHostRuntimeAgentDelegatedControlClient,
  type NimiHostRuntimeAgentLifecycleClient,
  type NimiRuntimeAccountCaller,
  type NimiRuntimeAgentAuthClient,
  type NimiRuntimeAgentLifecycleSurface,
  type NimiRuntimeAgentScopeRunner,
  type RuntimeAccountModule,
} from '@nimiplatform/sdk/runtime';
import {
  ConnectorAuthKind,
  type RuntimeTypedCallOptions,
} from '@nimiplatform/sdk/runtime/generated';
import { Realm } from '@nimiplatform/sdk/realm';
import { createNimiError, ReasonCode } from '@nimiplatform/sdk/types';
import {
  beginRuntimeAccountLogin,
  completeRuntimeAccountLogin,
  getRuntimeAccountSessionStatusResponse,
  invokeRuntimeAccountRealmUnary,
  logoutRuntimeAccount,
  switchRuntimeAccount,
} from '@nimiplatform/kit/shell/renderer/bridge';
import { DESKTOP_RUNTIME_PROTECTED_SCOPES } from '../../../shared/runtime-account-contract';

export interface DesktopNimiClientSession {
  readonly appId: string;
  readonly runtimeTransport?: DesktopRuntimeTransport;
  readonly runtimeClients?: NimiDesktopFirstPartyRuntimeClients;
  readonly accountRuntime?: DesktopAccountRuntime;
  readonly realm: Realm;
  readonly accountCaller?: NimiRuntimeAccountCaller;
}

export interface DesktopRuntimeRealmSession extends DesktopNimiClientSession {
  readonly runtimeTransport: DesktopRuntimeTransport;
  readonly runtimeClients: NimiDesktopFirstPartyRuntimeClients;
  readonly accountRuntime: DesktopAccountRuntime;
  readonly accountCaller: NimiRuntimeAccountCaller;
}

type DesktopProtectedAccountModule = Pick<
  RuntimeAccountModule,
  | 'getAccountSessionStatus'
  | 'beginLogin'
  | 'completeLogin'
  | 'invokeRealmUnary'
  | 'logout'
  | 'switchAccount'
>;

export type DesktopAccountRuntime = {
  readonly auth: NimiRuntimeAgentAuthClient;
  readonly account: DesktopProtectedAccountModule;
};

export type DesktopHostRuntimeAgentClient = {
  readonly appId: string;
  readonly auth: NimiRuntimeAgentAuthClient;
  readonly agent: NimiDesktopRuntimeAgentPurposeClient;
};

type DesktopLifecycleCompatibleHostRuntimeAgentClient = DesktopHostRuntimeAgentClient & {
  readonly agent: NimiDesktopRuntimeAgentPurposeClient & {
    readonly terminateAgent: never;
  };
};

export type DesktopRuntimeAgentDiscoverySurface = Pick<
  NimiRuntimeAgentLifecycleSurface,
  'listLocalAgents' | 'discoverLocalAgentsBySource'
>;

export type DesktopRuntimeTransport = {
  readonly type: 'electron-ipc';
};

export interface ConfigureDesktopRuntimeRealmSessionInput {
  readonly appId: string;
  readonly runtimeTransport: DesktopRuntimeTransport;
}

let currentSession: DesktopNimiClientSession | null = null;

export async function configureDesktopRuntimeRealmSession(
  input: ConfigureDesktopRuntimeRealmSessionInput,
): Promise<DesktopRuntimeRealmSession> {
  const appId = requireText(input.appId, 'appId');
  const runtimeTransport = input.runtimeTransport;
  const accountCaller = createNimiDesktopShellRuntimeAccountCaller({ appId });
  const runtimeClients = createNimiDesktopFirstPartyRuntimeClients({
    appId,
    transport: runtimeTransport,
    getSubjectUserId: async () => {
      const status = await getRuntimeAccountSessionStatusResponse();
      return status.snapshot?.accountProjection?.accountId;
    },
  });
  const accountRuntime = createDesktopProtectedAccountRuntime(runtimeClients.auth);
  const realm = new Realm({
    transport: createRuntimeAccountMediatedDesktopProductRealmTransport({
      runtime: accountRuntime,
      accountCaller,
    }),
  });
  const session: DesktopRuntimeRealmSession = {
    appId,
    runtimeTransport,
    runtimeClients,
    accountRuntime,
    realm,
    accountCaller,
  };
  currentSession = session;
  return session;
}

function runtimeIdempotencyKey(options: RuntimeTypedCallOptions | undefined): string | undefined {
  const metadata = options?.metadata as Record<string, unknown> | undefined;
  const value = String(
    metadata?.idempotencyKey || metadata?.['x-nimi-idempotency-key'] || '',
  ).trim();
  return value || undefined;
}

function createDesktopProtectedAccountRuntime(
  auth: NimiRuntimeAgentAuthClient,
): DesktopAccountRuntime {
  const account: DesktopProtectedAccountModule = {
    getAccountSessionStatus: async () => getRuntimeAccountSessionStatusResponse(),
    beginLogin: async (request) =>
      beginRuntimeAccountLogin({
        redirectUri: request.redirectUri,
        callbackOrigin: request.callbackOrigin,
        requestedScopes: request.requestedScopes,
        ttlSeconds: request.ttlSeconds,
      }),
    completeLogin: async (request) => {
      if (
        String(request.refreshToken || '').trim() ||
        String(request.sealedCompletionTicket || '').trim()
      ) {
        throw createNimiError({
          message: 'Desktop protected account login accepts only a loopback OAuth code.',
          reasonCode: ReasonCode.AUTH_UNSUPPORTED_PROOF_TYPE,
          actionHint: 'complete_with_runtime_owned_oauth_code',
          source: 'runtime',
        });
      }
      return completeRuntimeAccountLogin({
        loginAttemptId: request.loginAttemptId,
        code: request.code,
        state: request.state,
        nonce: request.nonce,
        redirectUri: request.redirectUri,
        callbackOrigin: request.callbackOrigin,
      });
    },
    invokeRealmUnary: async (request, options) =>
      invokeRuntimeAccountRealmUnary({
        methodId: request.methodId,
        requestJson: request.requestJson,
        timeoutMs: request.timeoutMs,
        idempotencyKey: runtimeIdempotencyKey(options),
      }),
    logout: async (request) => logoutRuntimeAccount(request.reason),
    switchAccount: async (request) => switchRuntimeAccount(request.reason),
  };
  return { auth, account };
}

async function getDesktopRuntimeProtectedAccessCallOptions(
  requestedScopes: readonly string[],
): Promise<RuntimeTypedCallOptions> {
  getDesktopRuntimeRealmSession();
  assertDesktopProtectedScopes(requestedScopes);
  return {};
}

export const withDesktopRuntimeProtectedScopes: NimiRuntimeAgentScopeRunner = async (
  scopes,
  operation,
) => operation(await getDesktopRuntimeProtectedAccessCallOptions(scopes));

function assertDesktopProtectedScopes(scopes: readonly string[]): void {
  const allowed = new Set<string>(DESKTOP_RUNTIME_PROTECTED_SCOPES);
  const unsupported = [...new Set(scopes.map(normalizeText).filter(Boolean))].filter(
    (scope) => !allowed.has(scope),
  );
  if (unsupported.length > 0) {
    throw createNimiError({
      message: `Desktop Runtime protected access does not include scopes: ${unsupported.join(', ')}`,
      reasonCode: ReasonCode.PRINCIPAL_UNAUTHORIZED,
      actionHint: 'register_desktop_runtime_protected_scope',
      source: 'runtime',
    });
  }
}

export function clearDesktopNimiClientSession(): void {
  currentSession = null;
}

export function setDesktopNimiClientSessionForTests(session: DesktopNimiClientSession): void {
  currentSession = session;
}

export function isDesktopNimiClientSessionReady(): boolean {
  return Boolean(currentSession?.realm);
}

export function isDesktopRuntimeAccountSessionReady(): boolean {
  return Boolean(currentSession?.accountRuntime && currentSession.accountCaller);
}

export function getDesktopAppId(): string {
  if (!currentSession?.appId) throw desktopSessionMissingError('appId');
  return currentSession.appId;
}

function getDesktopRuntimeRealmSession(): DesktopRuntimeRealmSession {
  if (
    !currentSession?.runtimeClients ||
    !currentSession.accountRuntime ||
    !currentSession.accountCaller ||
    !currentSession.runtimeTransport
  ) {
    throw desktopSessionMissingError('Runtime Realm session');
  }
  return currentSession as DesktopRuntimeRealmSession;
}

export function getDesktopMachineProductClient(): NimiDesktopMachineProductRuntimeClient {
  return getDesktopRuntimeRealmSession().runtimeClients.machineProduct;
}

export type DesktopRendererAccountProductClient = Omit<
  NimiDesktopAccountProductRuntimeClient,
  'connectors'
>;

export function getDesktopAccountProductClient(): DesktopRendererAccountProductClient {
  const client = getDesktopRuntimeRealmSession().runtimeClients.accountProduct;
  return Object.freeze({
    appAIConfig: client.appAIConfig,
    profiles: client.profiles,
    agents: client.agents,
    appMessages: client.appMessages,
    artifacts: client.artifacts,
    materializeRealmSource: client.materializeRealmSource,
  });
}

export function getDesktopConnectorAdminClient() {
  const clients = getDesktopRuntimeRealmSession().runtimeClients;
  const connectorClient = clients.accountProduct.connectors;
  return {
    listProviderCatalog: clients.machineProduct.connectors.listProviderCatalog,
    listModelCatalogProviders: clients.accountProduct.connectors.listModelCatalogProviders,
    listCatalogProviderModels: clients.accountProduct.connectors.listCatalogProviderModels,
    getCatalogModelDetail: clients.accountProduct.connectors.getCatalogModelDetail,
    upsertModelCatalogProvider: clients.accountProduct.connectors.upsertModelCatalogProvider,
    deleteModelCatalogProvider: clients.accountProduct.connectors.deleteModelCatalogProvider,
    upsertCatalogModelOverlay: clients.accountProduct.connectors.upsertCatalogModelOverlay,
    deleteCatalogModelOverlay: clients.accountProduct.connectors.deleteCatalogModelOverlay,
    listConnectors: clients.accountProduct.connectors.listConnectors,
    createConnector: async (...args: Parameters<typeof connectorClient.createConnector>) => {
      assertDesktopRendererConnectorMutation(args[0]);
      return connectorClient.createConnector(...args);
    },
    updateConnector: async (...args: Parameters<typeof connectorClient.updateConnector>) => {
      assertDesktopRendererConnectorMutation(args[0]);
      return connectorClient.updateConnector(...args);
    },
    deleteConnector: clients.accountProduct.connectors.deleteConnector,
    testConnector: clients.accountProduct.connectors.testConnector,
    listConnectorModels: clients.accountProduct.connectors.listConnectorModels,
  };
}

function assertDesktopRendererConnectorMutation(
  input: Readonly<{
    readonly authKind?: unknown;
    readonly providerAuthProfile?: unknown;
    readonly credentialJson?: unknown;
  }>,
): void {
  const authKind = input.authKind;
  const hasManagedAuthKind =
    authKind !== undefined &&
    authKind !== ConnectorAuthKind.UNSPECIFIED &&
    authKind !== ConnectorAuthKind.API_KEY;
  const hasProviderAuthProfile =
    input.providerAuthProfile !== undefined && input.providerAuthProfile !== '';
  const hasCredentialJson = input.credentialJson !== undefined && input.credentialJson !== '';
  if (!hasManagedAuthKind && !hasProviderAuthProfile && !hasCredentialJson) return;
  throw createNimiError({
    message: 'Managed OAuth credential custody requires the Desktop native host.',
    reasonCode: ReasonCode.AUTH_UNSUPPORTED_PROOF_TYPE,
    actionHint: 'acquire_managed_connector_credential_through_desktop_host',
    source: 'runtime',
  });
}

export function getDesktopLocalEnvironmentRpc(): NimiDesktopMachineProductRuntimeClient['local'] {
  return getDesktopRuntimeRealmSession().runtimeClients.machineProduct.local;
}

export function getDesktopLocalAuditClient(): NimiDesktopMachineProductRuntimeClient['local'] {
  return getDesktopRuntimeRealmSession().runtimeClients.machineProduct.local;
}

export function getDesktopAuditAdminClient(): NimiDesktopMachineProductRuntimeClient['audit'] {
  return getDesktopRuntimeRealmSession().runtimeClients.machineProduct.audit;
}

export function getDesktopAiExecutionClient(): {
  readonly ai: NimiDesktopRuntimeAiExecutionClient;
} {
  return { ai: getDesktopRuntimeRealmSession().runtimeClients.aiExecution };
}

export function getDesktopExternalAgentClient(): NimiDesktopMachineProductRuntimeClient['externalAgents'] {
  return getDesktopRuntimeRealmSession().runtimeClients.machineProduct.externalAgents;
}

export function getDesktopRealmRealtimeClient(): NimiRealmRealtimeClient {
	return createNimiRealmRealtimeRuntimeClient(
		getDesktopRuntimeRealmSession().runtimeClients.realmRealtime,
	);
}

export function getDesktopRealmChatClient(): NimiRealmChatClient {
	return createNimiRealmChatRuntimeClient(
		getDesktopRuntimeRealmSession().runtimeClients.realmRealtime,
	);
}

export function getDesktopLocalAgentReferencesClient() {
	return getDesktopRuntimeRealmSession().runtimeClients.localAppProduct.agents;
}

export function getDesktopConversationClient() {
	return getDesktopRuntimeRealmSession().runtimeClients.localAppProduct.conversation;
}

export function getDesktopAgentRealtimeClient() {
	return getDesktopRuntimeRealmSession().runtimeClients.localAppProduct.agentRealtime;
}

export function getDesktopAgentConfigureClient() {
	return getDesktopRuntimeRealmSession().runtimeClients.localAppProduct.agentConfigure;
}

export function getDesktopHostRuntimeAgentClient(): DesktopHostRuntimeAgentClient &
  NimiHostRuntimeAgentDelegatedControlClient;
export function getDesktopHostRuntimeAgentClient(): DesktopLifecycleCompatibleHostRuntimeAgentClient &
  NimiHostRuntimeAgentDelegatedControlClient;
export function getDesktopHostRuntimeAgentClient() {
  const session = getDesktopRuntimeRealmSession();
  return {
    appId: session.appId,
    auth: session.accountRuntime.auth,
    agent: session.runtimeClients.agentPurpose,
  } as DesktopLifecycleCompatibleHostRuntimeAgentClient &
    NimiHostRuntimeAgentDelegatedControlClient;
}

export function createDesktopRuntimeAgentDiscoverySurface(
  getSubjectUserId: () => string | Promise<string | undefined> | undefined,
): DesktopRuntimeAgentDiscoverySurface {
  const lifecycle = createNimiHostRuntimeAgentLifecycleSurface({
    // The SDK lifecycle constructor predates the protected Desktop profiles.
    // Desktop exposes only this read-only projection, and the structural gate
    // rejects lifecycle-only operations and alternate raw-client paths.
    getRuntime:
      getDesktopHostRuntimeAgentClient as unknown as () => NimiHostRuntimeAgentLifecycleClient,
    getSubjectUserId,
    withScopes: withDesktopRuntimeProtectedScopes,
  });
  return Object.freeze({
    listLocalAgents: lifecycle.listLocalAgents,
    discoverLocalAgentsBySource: lifecycle.discoverLocalAgentsBySource,
  });
}

export function getDesktopAccountRuntime(): DesktopAccountRuntime {
  if (!currentSession?.accountRuntime)
    throw desktopSessionMissingError('Runtime account bootstrap');
  return currentSession.accountRuntime;
}

export function getDesktopRealm(): Realm {
  if (!currentSession?.realm) throw desktopSessionMissingError('Realm');
  return currentSession.realm;
}

export function getDesktopRuntimeAccountCaller(): NimiRuntimeAccountCaller {
  if (!currentSession?.accountCaller) throw desktopSessionMissingError('Runtime account caller');
  return currentSession.accountCaller;
}

function desktopSessionMissingError(surface: string): Error {
  return createNimiError({
    message: `Desktop ${surface} session is not ready.`,
    reasonCode: ReasonCode.SDK_PLATFORM_CLIENT_NOT_READY,
    actionHint: 'configure_desktop_nimi_client_session',
    source: 'sdk',
  });
}

function requireText(value: unknown, field: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw createNimiError({
      message: `Desktop Nimi client session requires ${field}.`,
      reasonCode: ReasonCode.SDK_APP_ID_REQUIRED,
      actionHint: 'provide_desktop_nimi_client_session_identity',
      source: 'sdk',
    });
  }
  return normalized;
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}
