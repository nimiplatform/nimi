// NimiAppTransport is the typed transport contract that the SDK Nimi App
// client consumes. Concrete implementations live in the host (Desktop,
// web shell). The SDK does not hold its own transport.

import type {
  NimiAppHealthRepairAction,
  NimiAppLifecycleEvent,
  NimiAppLaunchScopeRef,
  NimiAppOperationResult,
  NimiAppRow,
  NimiAppStatus,
  NimiAppSubscription,
} from './types.js';

export interface NimiAppTransport {
  list(): Promise<readonly NimiAppRow[]>;
  get(appId: string): Promise<NimiAppRow>;
  status(appId: string): Promise<NimiAppStatus>;
  install(appId: string): Promise<NimiAppOperationResult>;
  update(appId: string): Promise<NimiAppOperationResult>;
  uninstall(appId: string): Promise<NimiAppOperationResult>;
  launch(appId: string, scopeRef: NimiAppLaunchScopeRef): Promise<NimiAppOperationResult>;
  subscribe(callback: (event: NimiAppLifecycleEvent) => void): NimiAppSubscription;
  healthRepair(appId: string, action: NimiAppHealthRepairAction): Promise<NimiAppOperationResult>;
}
