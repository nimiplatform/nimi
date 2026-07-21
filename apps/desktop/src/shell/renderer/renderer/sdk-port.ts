import type { NimiClient } from '@nimiplatform/sdk';
import type {
  NimiHostRuntimeAgentDelegatedCapabilityClient,
  NimiHostRuntimeAgentLifecycleClient,
  NimiHostRuntimeAgentPresentationProfileClient,
  NimiRuntimeAccountCaller,
  NimiRuntimeAgentScopeRunner,
  NimiRuntimeAgentTurnsRuntime,
  NimiRuntimeRouteCapabilityRuntime,
  NimiRuntimeCanonicalCapability,
  NimiRuntimeRouteOptionsSnapshot,
  Runtime,
} from '@nimiplatform/sdk/runtime';
import type { Realm } from '@nimiplatform/sdk/realm';
import type {
  RealmApiCaller,
  RealmDataErrorEmitter,
} from '../features/social/data/social-snapshot.js';
import type { RealmSocialOfflinePort } from '../features/social/data/social-offline-port.js';
import type { DesktopRuntimeRouteAccess } from '../infra/runtime-route-host-access.js';
import type { NimiRuntimeHealthCoordinator } from '@nimiplatform/sdk/runtime';
import type { DesktopRendererOfflinePort } from './offline-port.js';
import type { DesktopRendererAIConfigPort } from './ai-config-port.js';

type DesktopAccountRuntime = {
  readonly auth: Runtime['auth'];
  readonly account: Pick<
    Runtime['account'],
    | 'getAccountSessionStatus'
    | 'beginLogin'
    | 'completeLogin'
    | 'invokeRealmUnary'
    | 'logout'
    | 'switchAccount'
  >;
};

export interface DesktopRendererSdkPort {
  isSessionReady(): boolean;
  isRuntimeAccountSessionReady(): boolean;
  appId(): string;
  client(): NimiClient;
  runtime(): Runtime;
  runtimeAgentTurns(): NimiRuntimeAgentTurnsRuntime;
  hostRuntimeAgent():
    NimiHostRuntimeAgentLifecycleClient
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
