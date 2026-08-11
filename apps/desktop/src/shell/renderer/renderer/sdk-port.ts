import type {
  NimiDesktopMachineProductRuntimeClient,
  NimiDesktopRuntimeAgentPurposeClient,
  NimiHostRuntimeAgentDelegatedControlClient,
  NimiHostRuntimeAgentPresentationProfileClient,
  NimiRuntimeAccountCaller,
  NimiRuntimeAgentScopeRunner,
  NimiRuntimeAgentTurnsRuntime,
} from '@nimiplatform/sdk/runtime';
import type { Realm } from '@nimiplatform/sdk/realm';
import type {
  DesktopAccountRuntime,
  DesktopHostRuntimeAgentClient,
  DesktopRuntimeAgentDiscoverySurface,
  getDesktopAccountProductClient,
  getDesktopAiExecutionClient,
  getDesktopAuditAdminClient,
  getDesktopConnectorAdminClient,
  getDesktopExternalAgentClient,
  getDesktopLocalAssetAdminClient,
  getDesktopLocalAuditClient,
} from '../infra/sdk/desktop-nimi-client-session.js';
import type {
  RealmApiCaller,
  RealmDataErrorEmitter,
} from '../features/social/data/social-snapshot.js';
import type { RealmSocialOfflinePort } from '../features/social/data/social-offline-port.js';
import type { NimiRuntimeHealthCoordinator } from '@nimiplatform/sdk/runtime';
import type { DesktopRendererOfflinePort } from './offline-port.js';

export interface DesktopRendererSdkPort {
  isSessionReady(): boolean;
  isRuntimeAccountSessionReady(): boolean;
  appId(): string;
  machineProduct(): NimiDesktopMachineProductRuntimeClient;
  accountProduct(): ReturnType<typeof getDesktopAccountProductClient>;
  connectorAdmin(): ReturnType<typeof getDesktopConnectorAdminClient>;
  localAssetAdmin(): ReturnType<typeof getDesktopLocalAssetAdminClient>;
  localAudit(): ReturnType<typeof getDesktopLocalAuditClient>;
  auditAdmin(): ReturnType<typeof getDesktopAuditAdminClient>;
  aiExecution(): ReturnType<typeof getDesktopAiExecutionClient>;
  externalAgent(): ReturnType<typeof getDesktopExternalAgentClient>;
  runtimeAgentOwner(): NimiDesktopRuntimeAgentPurposeClient;
  runtimeAgentDiscovery(
    getSubjectUserId: () => string | Promise<string | undefined> | undefined,
  ): DesktopRuntimeAgentDiscoverySurface;
  runtimeAgentTurns(): NimiRuntimeAgentTurnsRuntime;
  hostRuntimeAgent():
    DesktopHostRuntimeAgentClient
    & NimiHostRuntimeAgentPresentationProfileClient
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
