import type { AccessMode } from '../contracts/types';
import { ReasonCode } from '@nimiplatform/sdk/types';

type RegistryEntry = {
  modId: string;
  version: string;
  source: string;
  mode: AccessMode;
  discoveredAt: string;
};

const MODE_ALLOWED_PREFIXES: Record<AccessMode, string[]> = {
  'local-dev': ['file://', 'http://localhost', 'http://127.0.0.1', 'https://'],
  sideload: ['file://', 'http://localhost', 'http://127.0.0.1', 'https://'],
};

const BLOCKED_SOURCES = [
  'http://0.0.0.0',
  'javascript:',
  'data:',
  'blob:',
];

export class RegistryGateway {
  private readonly discovered = new Map<string, RegistryEntry>();

  verifySource(
    mode: AccessMode,
    ref?: string,
  ): {
    ok: boolean;
    reasonCode: string;
  } {
    const sourceRef = String(ref || '').trim();
    if (!sourceRef) {
      return { ok: false, reasonCode: ReasonCode.DISCOVERY_SOURCE_UNTRUSTED };
    }

    const blocked = BLOCKED_SOURCES.some((prefix) =>
      sourceRef.toLowerCase().startsWith(prefix),
    );
    if (blocked) {
      return { ok: false, reasonCode: ReasonCode.DISCOVERY_SOURCE_BLOCKED };
    }

    const allowList = MODE_ALLOWED_PREFIXES[mode];
    if (!allowList) {
      return { ok: false, reasonCode: ReasonCode.DISCOVERY_MODE_UNKNOWN };
    }

    const matched = allowList.some((prefix) => sourceRef.startsWith(prefix));
    if (!matched) {
      return { ok: false, reasonCode: ReasonCode.DISCOVERY_SOURCE_UNTRUSTED };
    }
    return { ok: true, reasonCode: ReasonCode.DISCOVERY_ALLOWED };
  }

  recordDiscovery(modId: string, version: string, source: string, mode: AccessMode): void {
    const entryKey = `${modId}@${version}`;
    this.discovered.set(entryKey, {
      modId,
      version,
      source,
      mode,
      discoveredAt: new Date().toISOString(),
    });
  }

  getDiscovered(modId: string, version: string): RegistryEntry | undefined {
    return this.discovered.get(`${modId}@${version}`);
  }

  listDiscovered(): RegistryEntry[] {
    return Array.from(this.discovered.values());
  }

  removeDiscovered(modId: string, version: string): void {
    this.discovered.delete(`${modId}@${version}`);
  }
}
