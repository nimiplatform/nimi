// NimiAppTransport is the typed transport contract that the SDK Nimi App
// client consumes. Concrete implementations live in the host (Desktop,
// web shell). The SDK does not hold its own transport.

import type { NimiAppRow, NimiAppStatus } from './types.js';

export interface NimiAppTransport {
  listRegistry(): Promise<readonly NimiAppRow[]>;
  getAppStatus(appId: string): Promise<NimiAppStatus>;
}
