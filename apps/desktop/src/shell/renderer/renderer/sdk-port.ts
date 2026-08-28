import type {
  NimiDesktopMachineProductRuntimeClient,
  NimiHostRuntimeAgentDelegatedControlClient,
  NimiRuntimeAccountCaller,
  NimiRuntimeAgentScopeRunner,
  NimiRuntimeAgentTurnsRuntime,
} from '@nimiplatform/sdk/runtime';
import type { Realm } from '@nimiplatform/sdk/realm';
import type { NimiLocalAppConversationClient } from '@nimiplatform/sdk/app';
import type {
  DesktopAccountRuntime,
  DesktopHostRuntimeAgentClient,
  DesktopRuntimeAgentDiscoverySurface,
  getDesktopAccountProductClient,
  getDesktopAiExecutionClient,
  getDesktopAuditAdminClient,
  getDesktopConnectorAdminClient,
  getDesktopExternalAgentClient,
  getDesktopLocalEnvironmentRpc,
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
  localEnvironmentRpc(): ReturnType<typeof getDesktopLocalEnvironmentRpc>;
  localAudit(): ReturnType<typeof getDesktopLocalAuditClient>;
  auditAdmin(): ReturnType<typeof getDesktopAuditAdminClient>;
  aiExecution(): ReturnType<typeof getDesktopAiExecutionClient>;
  externalAgent(): ReturnType<typeof getDesktopExternalAgentClient>;
  runtimeAgentDiscovery(
    getSubjectUserId: () => string | Promise<string | undefined> | undefined,
  ): DesktopRuntimeAgentDiscoverySurface;
  runtimeAgentTurns(): NimiRuntimeAgentTurnsRuntime;
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
