import type {
  NimiDesktopAccountProductRuntimeClient,
  NimiDesktopMachineProductRuntimeClient,
  NimiDesktopRuntimeAgentPurposeClient,
  NimiHostRuntimeAgentDelegatedCapabilityClient,
  NimiHostRuntimeAgentPresentationProfileClient,
  NimiRuntimeAccountCaller,
  NimiRuntimeAgentScopeRunner,
  NimiRuntimeAgentTurnsRuntime,
  NimiRuntimeRouteCapabilityRuntime,
  NimiRuntimeCanonicalCapability,
  NimiRuntimeRouteOptionsSnapshot,
} from '@nimiplatform/sdk/runtime';
import type { Realm } from '@nimiplatform/sdk/realm';
import type {
  DesktopAccountRuntime,
  DesktopHostRuntimeAgentClient,
  DesktopRuntimeAgentDiscoverySurface,
  getDesktopAiExecutionClient,
  getDesktopAppLifecycleClient,
  getDesktopAuditAdminClient,
  getDesktopConnectorAdminClient,
  getDesktopExternalAgentClient,
  getDesktopLocalAssetAdminClient,
  getDesktopLocalAuditClient,
  getDesktopRouteHostAccessClient,
  getDesktopRouteOptionsClient,
} from '../infra/sdk/desktop-nimi-client-session.js';
import type {
  RealmApiCaller,
  RealmDataErrorEmitter,
} from '../features/social/data/social-snapshot.js';
import type { RealmSocialOfflinePort } from '../features/social/data/social-offline-port.js';
import type { DesktopRuntimeRouteAccess } from '../infra/runtime-route-host-access.js';
import type { NimiRuntimeHealthCoordinator } from '@nimiplatform/sdk/runtime';
import type { DesktopRendererOfflinePort } from './offline-port.js';
import type { DesktopRendererAIConfigPort } from './ai-config-port.js';

export interface DesktopRendererSdkPort {
  isSessionReady(): boolean;
  isRuntimeAccountSessionReady(): boolean;
  appId(): string;
  machineProduct(): NimiDesktopMachineProductRuntimeClient;
  accountProduct(): NimiDesktopAccountProductRuntimeClient;
  appLifecycle(): ReturnType<typeof getDesktopAppLifecycleClient>;
  connectorAdmin(): ReturnType<typeof getDesktopConnectorAdminClient>;
  localAssetAdmin(): ReturnType<typeof getDesktopLocalAssetAdminClient>;
  localAudit(): ReturnType<typeof getDesktopLocalAuditClient>;
  auditAdmin(): ReturnType<typeof getDesktopAuditAdminClient>;
  aiExecution(): ReturnType<typeof getDesktopAiExecutionClient>;
  routeHostAccessClient(): ReturnType<typeof getDesktopRouteHostAccessClient>;
  routeOptionsClient(): ReturnType<typeof getDesktopRouteOptionsClient>;
  externalAgent(): ReturnType<typeof getDesktopExternalAgentClient>;
  runtimeAgentOwner(): NimiDesktopRuntimeAgentPurposeClient;
  runtimeAgentDiscovery(
    getSubjectUserId: () => string | Promise<string | undefined> | undefined,
  ): DesktopRuntimeAgentDiscoverySurface;
  runtimeAgentTurns(): NimiRuntimeAgentTurnsRuntime;
  hostRuntimeAgent():
    DesktopHostRuntimeAgentClient
    & NimiHostRuntimeAgentPresentationProfileClient
    & NimiHostRuntimeAgentDelegatedCapabilityClient;
  accountRuntime(): DesktopAccountRuntime;
  runtimeRouteAccess(): DesktopRuntimeRouteAccess;
  loadRouteOptions(
    capability: NimiRuntimeCanonicalCapability,
    targetId?: string,
  ): Promise<NimiRuntimeRouteOptionsSnapshot>;
  conversationCapabilityRuntime(): NimiRuntimeRouteCapabilityRuntime | null;
  runtimeHealthCoordinator(): NimiRuntimeHealthCoordinator;
  aiConfig(): DesktopRendererAIConfigPort;
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
