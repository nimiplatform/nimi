import type { NimiClient } from '@nimiplatform/sdk';
import type {
  NimiHostRuntimeAgentDelegatedCapabilityClient,
  NimiHostRuntimeAgentLifecycleClient,
  NimiHostRuntimeAgentPresentationProfileClient,
  NimiRuntimeAccountCaller,
  NimiRuntimeAgentScopeRunner,
  NimiRuntimeAgentTurnsRuntime,
  Runtime,
} from '@nimiplatform/sdk/runtime';
import type { Realm } from '@nimiplatform/sdk/realm';

import type { DesktopAccountRuntime } from '../infra/sdk/desktop-nimi-client-session.js';
import type {
  RealmApiCaller,
  RealmDataErrorEmitter,
} from '../features/social/data/social-snapshot.js';
import type { RealmSocialOfflinePort } from '../features/social/data/social-offline-port.js';

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
  realm(): Realm;
  readonly socialData: {
    readonly callApi: RealmApiCaller;
    readonly emitDataError: RealmDataErrorEmitter;
    readonly offline: RealmSocialOfflinePort;
  };
  accountCaller(): NimiRuntimeAccountCaller;
  withRuntimeProtectedScopes: NimiRuntimeAgentScopeRunner;
}
