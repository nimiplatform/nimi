import { describe, expect, it } from 'vitest';

import {
  createNimiElectronInstalledHostForBinding,
  resolveNimiElectronProtectedLocalBindingPackage,
} from '../src/main/installed-host.js';

describe('Electron installed Runtime host', () => {
  it('opens one opaque native session and forwards only typed artifact selectors', async () => {
    let opens = 0;
    const reads: string[] = [];
    const host = createNimiElectronInstalledHostForBinding({
      async openInstalledAppSession() {
        opens += 1;
        return { status: 'ok' };
      },
      async readInstalledArtifactBytes(artifactId) {
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
    const host = createNimiElectronInstalledHostForBinding({
      async openInstalledAppSession() {
        opens += 1;
        if (opens === 1) {
          return {
            status: 'error',
            reasonCode: 'runtime-service-unavailable',
            retryable: true,
          };
        }
        return { status: 'ok' };
      },
      async readInstalledArtifactBytes() {
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

  it('preserves typed artifact denial without native detail or portable session material', async () => {
    const host = createNimiElectronInstalledHostForBinding({
      async openInstalledAppSession() {
        return { status: 'ok' };
      },
      async readInstalledArtifactBytes() {
        return {
          status: 'error',
          reasonCode: 'installed-artifact-forbidden',
          retryable: false,
        };
      },
    });

    const error = await host.readArtifactBytes('artifact-denied').catch((caught) => caught);
    expect(error).toMatchObject({
      name: 'NimiElectronInstalledHostError',
      message: 'installed-artifact-forbidden',
      reasonCode: 'installed-artifact-forbidden',
      retryable: false,
    });
    expect(Object.keys(error).sort()).toEqual(['name', 'reasonCode', 'retryable']);
    expect(JSON.stringify(error)).not.toMatch(/session|proof|account|release|grant|token/i);
  });

  it('rejects malformed native success projections as untrusted Runtime output', async () => {
    const host = createNimiElectronInstalledHostForBinding({
      async openInstalledAppSession() {
        return { status: 'ok' };
      },
      async readInstalledArtifactBytes() {
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
