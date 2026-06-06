// NimiAppTransport is the typed transport contract that the SDK Nimi App
// client consumes. Concrete implementations live in the host (Desktop,
// web shell). The SDK does not hold its own transport.
//
// T4 Fork B: NimiAppClient is a pure read-projection surface — list / get /
// status only. Every Nimi App lifecycle mutation (install / update /
// uninstall / open / healthRepair / lifecycle event subscription) is owned by
// the runtime-mediated `runtime.appLifecycle` surface
// (`@nimiplatform/sdk/runtime`). The transport carries no mutation methods so
// there is a single typed app-lifecycle surface and no parallel-truth stubs.

import type { NimiAppRow, NimiAppStatus } from './types.js';

export interface NimiAppTransport {
  list(): Promise<readonly NimiAppRow[]>;
  get(appId: string): Promise<NimiAppRow>;
  status(appId: string): Promise<NimiAppStatus>;
}
