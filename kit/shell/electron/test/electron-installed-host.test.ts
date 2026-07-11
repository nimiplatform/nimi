import { describe, expect, it } from 'vitest';

import {
  createNimiElectronAppHostForBinding,
  resolveNimiElectronProtectedLocalBindingPackage,
} from '../src/main/app-host.js';

describe('Electron protected app host', () => {
  it('opens one opaque native session and forwards only typed bootstrap and artifact selectors', async () => {
    let opens = 0;
    const reads: string[] = [];
    const host = createNimiElectronAppHostForBinding({
      async openAppHostSession() {
        opens += 1;
        return bootstrapOutcome();
      },
      async getAppHostSessionStatus() {
        return bootstrapOutcome();
      },
      async readAppHostArtifactBytes(artifactId) {
        reads.push(artifactId);
        const bytes = new TextEncoder().encode(artifactId);
        return {
          status: 'ok',
          bytes,
          mimeType: 'text/plain',
          sizeBytes: bytes.byteLength,
          mimeInferred: false,
        };
      },
    });

    const [first, second] = await Promise.all([
      host.readArtifactBytes('artifact-one'),
      host.readArtifactBytes('artifact-two'),
    ]);

    expect(opens).toBe(1);
    expect(reads).toEqual(['artifact-one', 'artifact-two']);
    expect(new TextDecoder().decode(first.bytes)).toBe('artifact-one');
    expect(new TextDecoder().decode(second.bytes)).toBe('artifact-two');
    expect(first).toEqual({
      bytes: new TextEncoder().encode('artifact-one'),
      mimeType: 'text/plain',
      sizeBytes: 12,
      mimeInferred: false,
    });
    expect(Object.keys(first).sort()).toEqual(['bytes', 'mimeInferred', 'mimeType', 'sizeBytes']);
  });

  it('retries native session open after fail-closed carrier denial', async () => {
    let opens = 0;
    const host = createNimiElectronAppHostForBinding({
      async openAppHostSession() {
        opens += 1;
        if (opens === 1) {
          return {
            status: 'error',
            reasonCode: 'runtime-service-unavailable',
            retryable: true,
          };
        }
        return bootstrapOutcome();
      },
      async getAppHostSessionStatus() {
        return bootstrapOutcome();
      },
      async readAppHostArtifactBytes() {
        return {
          status: 'ok',
          bytes: new Uint8Array([1]),
          mimeType: 'application/octet-stream',
          sizeBytes: 1,
          mimeInferred: true,
        };
      },
    });

    await expect(host.readArtifactBytes('artifact-retry')).rejects.toMatchObject({
      reasonCode: 'runtime-service-unavailable',
      retryable: true,
    });
    await expect(host.readArtifactBytes('artifact-retry')).resolves.toMatchObject({
      sizeBytes: 1,
    });
    expect(opens).toBe(2);
  });

  it('reopens the native session in the same bootstrap after Runtime restart', async () => {
    let opens = 0;
    let statusChecks = 0;
    const host = createNimiElectronAppHostForBinding({
      async openAppHostSession() {
        opens += 1;
        return {
          ...bootstrapOutcome(),
          bootstrapArtifactId: `bootstrap-artifact-${opens}`,
        };
      },
      async getAppHostSessionStatus() {
        statusChecks += 1;
        return {
          status: 'error',
          reasonCode: 'runtime-service-unavailable',
          retryable: true,
        };
      },
      async readAppHostArtifactBytes() {
        throw new Error('not used');
      },
    });

    await expect(host.bootstrap()).resolves.toMatchObject({
      bootstrapArtifactId: 'bootstrap-artifact-1',
    });
    await expect(host.bootstrap()).resolves.toMatchObject({
      bootstrapArtifactId: 'bootstrap-artifact-2',
    });
    expect({ opens, statusChecks }).toEqual({ opens: 2, statusChecks: 1 });
  });

  it('keeps reapproval and revocation fail-closed after automatic session reopen', async () => {
    let opens = 0;
    const host = createNimiElectronAppHostForBinding({
      async openAppHostSession() {
        opens += 1;
        if (opens === 1) {
          return bootstrapOutcome();
        }
        return {
          status: 'error',
          reasonCode: 'local-development-reapproval-required',
          retryable: false,
        };
      },
      async getAppHostSessionStatus() {
        return {
          status: 'error',
          reasonCode: 'local-development-session-revoked',
          retryable: false,
        };
      },
      async readAppHostArtifactBytes() {
        throw new Error('not used');
      },
    });

    await expect(host.bootstrap()).resolves.toMatchObject({ state: 'ready' });
    await expect(host.bootstrap()).rejects.toMatchObject({
      reasonCode: 'local-development-reapproval-required',
      retryable: false,
    });
    expect(opens).toBe(2);
  });

  it('preserves typed artifact denial without native detail or portable session material', async () => {
    const host = createNimiElectronAppHostForBinding({
      async openAppHostSession() {
        return bootstrapOutcome();
      },
      async getAppHostSessionStatus() {
        return bootstrapOutcome();
      },
      async readAppHostArtifactBytes() {
        return {
          status: 'error',
          reasonCode: 'installed-artifact-forbidden',
          retryable: false,
        };
      },
    });

    const error = await host.readArtifactBytes('artifact-denied').catch((caught) => caught);
    expect(error).toMatchObject({
      name: 'NimiElectronAppHostError',
      message: 'installed-artifact-forbidden',
      reasonCode: 'installed-artifact-forbidden',
      retryable: false,
    });
    expect(Object.keys(error).sort()).toEqual(['name', 'reasonCode', 'retryable']);
    expect(JSON.stringify(error)).not.toMatch(/session|proof|account|release|grant|token/i);
  });

  it('rejects malformed native success projections as untrusted Runtime output', async () => {
    const host = createNimiElectronAppHostForBinding({
      async openAppHostSession() {
        return bootstrapOutcome();
      },
      async getAppHostSessionStatus() {
        return bootstrapOutcome();
      },
      async readAppHostArtifactBytes() {
        return {
          status: 'ok',
          bytes: new Uint8Array([1, 2]),
          mimeType: 'image/png',
          sizeBytes: 1,
          mimeInferred: false,
        };
      },
    });

    await expect(host.readArtifactBytes('artifact-malformed')).rejects.toMatchObject({
      reasonCode: 'runtime-service-untrusted',
      retryable: false,
    });
  });

  it('projects local-development bootstrap without technical session material', async () => {
    const host = createNimiElectronAppHostForBinding({
      async openAppHostSession() {
        return bootstrapOutcome();
      },
      async getAppHostSessionStatus() {
        return bootstrapOutcome();
      },
      async readAppHostArtifactBytes() {
        throw new Error('not used');
      },
    });

    const bootstrap = await host.bootstrap();
    expect(bootstrap).toEqual({
      state: 'ready',
      trustClass: 'local-development',
      appId: 'nimi.thirdparty.fixture',
      bootstrapArtifactId: 'bootstrap-artifact',
      expiresAtUnixMs: 1_800_000_000_000,
    });
    expect(JSON.stringify(bootstrap)).not.toMatch(/session|proof|token|credential|epoch/i);
  });

  it('admits only the packaged Windows x64 native binding', () => {
    expect(resolveNimiElectronProtectedLocalBindingPackage('win32', 'x64')).toBe(
      '@nimiplatform/kit-protected-local-win32-x64',
    );
    for (const [platform, arch] of [
      ['win32', 'arm64'],
      ['darwin', 'arm64'],
      ['linux', 'x64'],
    ] as const) {
      expect(() => resolveNimiElectronProtectedLocalBindingPackage(platform, arch)).toThrowError(
        expect.objectContaining({
          reasonCode: 'protected-carrier-required',
          retryable: false,
        }),
      );
    }
  });
});

function bootstrapOutcome() {
  return {
    status: 'ok' as const,
    state: 'ready' as const,
    trustClass: 'local-development' as const,
    appId: 'nimi.thirdparty.fixture',
    bootstrapArtifactId: 'bootstrap-artifact',
    expiresAtUnixMs: 1_800_000_000_000,
  };
}
