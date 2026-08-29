import type {
  NimiDesktopAccountProductRuntimeClient,
  NimiDesktopMachineProductRuntimeClient,
  NimiDesktopRuntimeAgentPurposeClient,
  NimiHostRuntimeAgentDelegatedControlClient,
  NimiRuntimeAgentAuthClient,
  NimiRuntimeAgentLifecycleSurface,
  NimiRuntimeAccountCaller,
  NimiRuntimeAgentScopeRunner,
  RuntimeAccountModule,
} from '@nimiplatform/sdk/runtime';
import type { Realm } from '@nimiplatform/sdk/realm';
import type { NimiLocalAppClient, NimiLocalAppConversationClient } from '@nimiplatform/sdk/app';
import type {
  RealmApiCaller,
  RealmDataErrorEmitter,
} from '../features/social/data/social-snapshot.js';
import type { RealmSocialOfflinePort } from '../features/social/data/social-offline-port.js';
import type { NimiRuntimeHealthCoordinator } from '@nimiplatform/sdk/runtime';
import type { DesktopRendererOfflinePort } from './offline-port.js';

type DesktopAccountRuntime = {
  readonly auth: NimiRuntimeAgentAuthClient;
  readonly account: Pick<RuntimeAccountModule,
    'getAccountSessionStatus' | 'beginLogin' | 'completeLogin' | 'invokeRealmUnary' | 'logout' | 'switchAccount'>;
};

type DesktopHostRuntimeAgentClient = {
  readonly appId: string;
  readonly auth: NimiRuntimeAgentAuthClient;
  readonly agent: NimiDesktopRuntimeAgentPurposeClient;
};

type DesktopRuntimeAgentDiscoverySurface = Pick<
  NimiRuntimeAgentLifecycleSurface,
  'listLocalAgents' | 'discoverLocalAgentsBySource'
>;

type DesktopRendererAccountProductClient = Omit<NimiDesktopAccountProductRuntimeClient, 'connectors'>;
type DesktopConnectorAdminClient = NimiDesktopAccountProductRuntimeClient['connectors']
  & Pick<NimiDesktopMachineProductRuntimeClient['connectors'], 'listProviderCatalog'>;

export interface DesktopRendererSdkPort {
  isSessionReady(): boolean;
  isRuntimeAccountSessionReady(): boolean;
  appId(): string;
  machineProduct(): NimiDesktopMachineProductRuntimeClient;
  accountProduct(): DesktopRendererAccountProductClient;
  connectorAdmin(): DesktopConnectorAdminClient;
  localEnvironmentRpc(): NimiDesktopMachineProductRuntimeClient['local'];
  localAudit(): NimiDesktopMachineProductRuntimeClient['local'];
  auditAdmin(): NimiDesktopMachineProductRuntimeClient['audit'];
  appProduct(): NimiLocalAppClient;
  externalAgent(): NimiDesktopMachineProductRuntimeClient['externalAgents'];
  runtimeAgentDiscovery(
    getSubjectUserId: () => string | Promise<string | undefined> | undefined,
  ): DesktopRuntimeAgentDiscoverySurface;
  conversation(): NimiLocalAppConversationClient;
  hostRuntimeAgent():
    DesktopHostRuntimeAgentClient
    & NimiHostRuntimeAgentDelegatedControlClient;
  accountRuntime(): DesktopAccountRuntime;
  runtimeHealthCoordinator(): NimiRuntimeHealthCoordinator;
  realm(): Realm;
  readonly offline: DesktopRendererOfflinePort;
  readonly socialData: {
    readonly callApi: RealmApiCaller;
    readonly emitDataError: RealmDataErrorEmitter;
    readonly offline: RealmSocialOfflinePort;
  };
  accountCaller(): NimiRuntimeAccountCaller;
  withRuntimeProtectedScopes: NimiRuntimeAgentScopeRunner;
}
