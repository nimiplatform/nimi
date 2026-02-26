import type { ModManifest } from '../contracts/types';
import { ReasonCode } from '@nimiplatform/sdk/types';

const FORBIDDEN_CAPABILITIES = new Set([
  'system.root',
  'kernel.override',
  'audit.suppress',
]);

const MAX_CAPABILITIES = 20;
const MAX_DEPENDENCIES = 50;

export class ManifestEngine {
  private toModDirName(modId: string): string {
    const normalized = String(modId || '').trim().toLowerCase();
    const leaf = normalized.includes('.') ? normalized.split('.').pop() || normalized : normalized;
    const safe = leaf.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    return safe || 'runtime-mod';
  }

  buildDefault(
    modId: string,
    version: string,
    requestedCapabilities: string[] = [],
  ): ModManifest {
    const modDirName = this.toModDirName(modId);
    return {
      id: modId,
      version,
      capabilities: Array.from(new Set(requestedCapabilities)),
      dependencies: [],
      entry: `./dist/mods/${modDirName}/index.js`,
    };
  }

  parse(raw: Record<string, unknown>): ModManifest | null {
    const id = typeof raw['id'] === 'string' ? raw['id'] : '';
    const version = typeof raw['version'] === 'string' ? raw['version'] : '';
    if (!id || !version) {
      return null;
    }

    const capabilities = Array.isArray(raw['capabilities'])
      ? raw['capabilities'].filter((p): p is string => typeof p === 'string')
      : [];
    const dependencies = Array.isArray(raw['dependencies'])
      ? raw['dependencies'].filter((d): d is string => typeof d === 'string')
      : [];
    const entry = typeof raw['entry'] === 'string' ? raw['entry'] : './dist/mods/runtime-mod/index.js';
    const hash = typeof raw['hash'] === 'string' ? raw['hash'] : undefined;

    const nimiRaw =
      raw['nimi'] && typeof raw['nimi'] === 'object' && !Array.isArray(raw['nimi'])
        ? (raw['nimi'] as Record<string, unknown>)
        : {};
    const minVersion = typeof nimiRaw['minVersion'] === 'string' ? nimiRaw['minVersion'] : '';
    const maxVersion = typeof nimiRaw['maxVersion'] === 'string' ? nimiRaw['maxVersion'] : '';

    return {
      id,
      version,
      capabilities,
      dependencies,
      entry,
      hash,
      nimi: minVersion || maxVersion ? { minVersion, maxVersion } : undefined,
    };
  }

  validate(manifest: ModManifest): string[] {
    const issues: string[] = [];

    if (!manifest.id) {
      issues.push('MANIFEST_ID_MISSING');
    }
    if (!manifest.version) {
      issues.push('MANIFEST_VERSION_MISSING');
    }
    if (!manifest.entry) {
      issues.push('MANIFEST_ENTRY_MISSING');
    }

    if (manifest.capabilities.length > MAX_CAPABILITIES) {
      issues.push('MANIFEST_TOO_MANY_CAPABILITIES');
    }

    const forbidden = manifest.capabilities.filter((p) => FORBIDDEN_CAPABILITIES.has(p));
    if (forbidden.length > 0) {
      issues.push(`MANIFEST_FORBIDDEN_CAPABILITY:${forbidden.join(',')}`);
    }

    if (manifest.dependencies.length > MAX_DEPENDENCIES) {
      issues.push('MANIFEST_TOO_MANY_DEPENDENCIES');
    }

    if (manifest.entry && !this.isValidEntryPath(manifest.entry)) {
      issues.push('MANIFEST_ENTRY_PATH_INVALID');
    }

    return issues;
  }

  checkCompatibility(
    manifest: ModManifest,
    runtimeVersion: string,
  ): { compatible: boolean; reasonCode: string } {
    if (!manifest.nimi?.minVersion && !manifest.nimi?.maxVersion) {
      return { compatible: true, reasonCode: ReasonCode.COMPAT_NO_MIN_VERSION };
    }

    const runtime = this.parseVersionParts(runtimeVersion);
    if (manifest.nimi?.minVersion) {
      const min = this.parseVersionParts(manifest.nimi.minVersion);
      if (runtime.major < min.major || (runtime.major === min.major && runtime.minor < min.minor)) {
        return { compatible: false, reasonCode: ReasonCode.COMPAT_RUNTIME_TOO_OLD };
      }
    }

    if (manifest.nimi?.maxVersion && !manifest.nimi.maxVersion.includes('x')) {
      const max = this.parseVersionParts(manifest.nimi.maxVersion);
      if (
        runtime.major > max.major
        || (runtime.major === max.major && runtime.minor > max.minor)
      ) {
        return { compatible: false, reasonCode: ReasonCode.COMPAT_RUNTIME_TOO_NEW };
      }
    }

    return { compatible: true, reasonCode: ReasonCode.COMPAT_OK };
  }

  private isValidEntryPath(entry: string): boolean {
    if (entry.includes('..')) {
      return false;
    }
    if (entry.startsWith('/')) {
      return false;
    }
    return true;
  }

  private parseVersionParts(version: string): { major: number; minor: number; patch: number } {
    const parts = version.replace(/[^0-9.]/g, '').split('.');
    return {
      major: parseInt(parts[0] || '0', 10) || 0,
      minor: parseInt(parts[1] || '0', 10) || 0,
      patch: parseInt(parts[2] || '0', 10) || 0,
    };
  }
}
