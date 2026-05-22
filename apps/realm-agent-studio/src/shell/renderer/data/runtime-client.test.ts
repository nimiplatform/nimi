import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hasTauriIpcRuntime } from './runtime-client.js';

const dataDir = dirname(fileURLToPath(import.meta.url));
const rendererRoot = resolve(dataDir, '..');

describe('studio runtime client gate', () => {
  it('does not treat marker-only Tauri globals as available IPC runtime', () => {
    expect(hasTauriIpcRuntime({
      __TAURI__: {},
      __TAURI_INTERNALS__: {},
      __TAURI_IPC__: {},
      window: {
        __TAURI__: {},
        __TAURI_INTERNALS__: {},
        __TAURI_IPC__: {},
      },
    } as unknown as typeof globalThis)).toBe(false);
  });

  it('accepts test and native invoke hooks as available IPC runtime', () => {
    const invoke = async () => undefined;

    expect(hasTauriIpcRuntime({ __NIMI_TAURI_TEST__: { invoke } } as unknown as typeof globalThis)).toBe(true);
    expect(hasTauriIpcRuntime({ __NIMI_TAURI_RUNTIME__: { invoke } } as unknown as typeof globalThis)).toBe(true);
    expect(hasTauriIpcRuntime({ __TAURI__: { core: { invoke } } } as unknown as typeof globalThis)).toBe(true);
    expect(hasTauriIpcRuntime({ __TAURI_INTERNALS__: { invoke } } as unknown as typeof globalThis)).toBe(true);
    expect(hasTauriIpcRuntime({ __TAURI_IPC__: { invoke } } as unknown as typeof globalThis)).toBe(true);
  });

  it('does not construct app-owned Realm or Runtime clients in renderer data modules', () => {
    const runtimeClientSource = readFileSync(resolve(dataDir, 'runtime-client.ts'), 'utf8');
    const realmClientSource = readFileSync(resolve(dataDir, 'realm-client.ts'), 'utf8');
    const studioPlatformSource = readFileSync(resolve(rendererRoot, 'app-shell', 'studio-platform.ts'), 'utf8');
    const combinedDataSource = `${runtimeClientSource}\n${realmClientSource}`;

    expect(combinedDataSource).not.toMatch(/VITE_REALM_ACCESS_TOKEN|external_principal|allowAnonymousRealm/);
    expect(combinedDataSource).not.toMatch(/createRealmClient|createPlatformClient/);
    expect(studioPlatformSource).toContain('createLocalFirstPartyRuntimePlatformClient');
    expect(studioPlatformSource).not.toMatch(/accessToken|refreshToken|sessionStore|subjectUserIdProvider/);
  });
});
