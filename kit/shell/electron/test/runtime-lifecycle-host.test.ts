import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createElectronRuntimeBridgeCommandNames } from '../src/main/runtime.js';
import { createNimiElectronDeveloperModeStatusProbeForBinding } from '../src/main/developer-mode-host.js';
import {
  createNimiElectronSourceRuntimeLifecycleHostForProbe,
  createNimiElectronSourceRuntimeVersionResolverForTest,
  NIMI_RUNTIME_STORED_DATA_UNSUPPORTED,
} from '../src/main/runtime-lifecycle-host.js';

function createRunningProbe() {
  return vi.fn(async () => ({
    state: 'disabled' as const,
    enabled: false,
    revision: 1,
    reasonCode: 'action-executed',
    retryable: false,
  }));
}

describe('ElectronSourceRuntimeLifecycleHost version projection', () => {
  it('projects the verified source daemon version when live probe succeeds', async () => {
    const probe = createRunningProbe();
    const resolveVersion = vi.fn(async () => '0.0.0-dev');
    const host = createNimiElectronSourceRuntimeLifecycleHostForProbe(
      { probe },
      'protected-desktop-control',
      { resolveVersion },
    );
    const commands = createElectronRuntimeBridgeCommandNames();

    await expect(host.invoke(commands.status, commands)).resolves.toEqual({
      running: true,
      managed: false,
      launchMode: 'SOURCE',
      grpcAddr: 'protected-desktop-control',
      version: '0.0.0-dev',
    });
    expect(probe).toHaveBeenCalledOnce();
    expect(resolveVersion).toHaveBeenCalledOnce();
  });

  it('omits version without failing status when version resolution is unavailable, throws, or returns invalid text', async () => {
    const commands = createElectronRuntimeBridgeCommandNames();
    const invalidResolvers = [
      async () => undefined,
      async () => '',
      async () => '   ',
      async () => '0.0.0-dev with spaces',
      async () => 'v'.repeat(129),
      async () => {
        throw new Error('probe timed out');
      },
    ];

    for (const resolveVersion of invalidResolvers) {
      const host = createNimiElectronSourceRuntimeLifecycleHostForProbe(
        { probe: createRunningProbe() },
        'protected-desktop-control',
        { resolveVersion },
      );
      await expect(host.invoke(commands.status, commands)).resolves.toEqual({
        running: true,
        managed: false,
        launchMode: 'SOURCE',
        grpcAddr: 'protected-desktop-control',
      });
    }
  });

  it('does not query version when the source daemon is in maintenance or unreachable', async () => {
    const commands = createElectronRuntimeBridgeCommandNames();
    const resolveVersion = vi.fn(async () => '0.0.0-dev');

    const maintenanceHost = createNimiElectronSourceRuntimeLifecycleHostForProbe(
      createNimiElectronDeveloperModeStatusProbeForBinding({
        desktopDeveloperModeStatus: async () => ({
          status: 'error' as const,
          reasonCode: NIMI_RUNTIME_STORED_DATA_UNSUPPORTED,
          retryable: false,
        }),
        desktopDeveloperModeSet: async () => ({ status: 'ok' as const, value: {} }),
      }),
      'protected-desktop-control',
      { resolveVersion },
    );

    await expect(maintenanceHost.invoke(commands.status, commands)).resolves.toEqual({
      running: false,
      managed: false,
      launchMode: 'SOURCE',
      grpcAddr: 'protected-desktop-control',
      lastError: NIMI_RUNTIME_STORED_DATA_UNSUPPORTED,
    });
    expect(resolveVersion).not.toHaveBeenCalled();

    const unreachableHost = createNimiElectronSourceRuntimeLifecycleHostForProbe(
      createNimiElectronDeveloperModeStatusProbeForBinding({
        desktopDeveloperModeStatus: async () => ({
          status: 'error' as const,
          reasonCode: 'runtime-service-unavailable',
          retryable: true,
        }),
        desktopDeveloperModeSet: async () => ({ status: 'ok' as const, value: {} }),
      }),
      'protected-desktop-control',
      { resolveVersion },
    );

    await expect(unreachableHost.invoke(commands.status, commands)).rejects.toMatchObject({
      reasonCode: 'runtime-service-unavailable',
    });
    expect(resolveVersion).not.toHaveBeenCalled();
  });
});

describe('source Runtime binary version resolver', () => {
  const macExecutable = '/Users/tester/nimi/.nimi/local/imp3/runtime-local-development/nimi-runtime';
  const windowsExecutable = 'C:\\workspace\\nimi\\.nimi\\local\\imp6\\runtime-local-development\\nimi.exe';

  it('reads version --json from the verified macOS source Runtime binary and caches by file identity', async () => {
    let mtimeMs = 1_700_000_000_000;
    const execFile = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ nimi: '0.0.0-dev', go: 'go1.26.11', osArch: 'darwin/arm64' }))
      .mockResolvedValueOnce(JSON.stringify({ nimi: '0.2.5-dev.1', go: 'go1.26.11', osArch: 'darwin/arm64' }));
    const resolver = createNimiElectronSourceRuntimeVersionResolverForTest({
      platform: 'darwin',
      env: {
        NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT: '1',
        NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT_RUNTIME_EXECUTABLE: macExecutable,
      },
      geteuid: () => 501,
      lstat: () => ({
        isFile: () => true,
        isSymbolicLink: () => false,
        uid: 501,
        mode: 0o100755,
        ino: 42,
        mtimeMs,
        size: 92_000_000,
      }),
      realpath: (candidate) => candidate,
      execFile,
    });

    await expect(resolver()).resolves.toBe('0.0.0-dev');
    await expect(resolver()).resolves.toBe('0.0.0-dev');
    expect(execFile).toHaveBeenCalledOnce();
    expect(execFile).toHaveBeenCalledWith(
      macExecutable,
      ['version', '--json'],
      expect.objectContaining({ windowsHide: true }),
    );

    // Rebuilding the workspace binary updates mtimeMs and refreshes the cached version.
    mtimeMs += 1_000;
    await expect(resolver()).resolves.toBe('0.2.5-dev.1');
    expect(execFile).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent in-flight version probes for the same binary metadata', async () => {
    let releaseProbe!: (value: string) => void;
    const execFile = vi.fn(() => new Promise<string>((resolve) => {
      releaseProbe = resolve;
    }));
    const resolver = createNimiElectronSourceRuntimeVersionResolverForTest({
      platform: 'darwin',
      env: {
        NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT: '1',
        NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT_RUNTIME_EXECUTABLE: macExecutable,
      },
      geteuid: () => 501,
      lstat: () => ({
        isFile: () => true,
        isSymbolicLink: () => false,
        uid: 501,
        mode: 0o100700,
        ino: 99,
        mtimeMs: 1_700_000_000_000,
        size: 1024,
      }),
      realpath: (candidate) => candidate,
      execFile,
    });

    const first = resolver();
    const second = resolver();
    expect(execFile).toHaveBeenCalledOnce();
    releaseProbe(JSON.stringify({ nimi: '0.0.0-dev' }));
    await expect(Promise.all([first, second])).resolves.toEqual(['0.0.0-dev', '0.0.0-dev']);
  });

  it('fails closed without executing untrusted macOS paths or modes', async () => {
    const cases = [
      {
        name: 'source flag absent',
        env: { NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT_RUNTIME_EXECUTABLE: macExecutable },
      },
      {
        name: 'unexpected executable path tail',
        env: {
          NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT: '1',
          NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT_RUNTIME_EXECUTABLE: '/usr/local/bin/nimi-runtime',
        },
      },
      {
        name: 'symlink executable',
        lstat: { isSymbolicLink: () => true },
      },
      {
        name: 'non-canonical realpath',
        realpath: () => '/private/tmp/other/nimi-runtime',
      },
      {
        name: 'root uid',
        geteuid: () => 0,
      },
      {
        name: 'mismatched file owner',
        lstat: { uid: 502 },
      },
      {
        name: 'group-writable executable',
        lstat: { mode: 0o100775 },
      },
      {
        name: 'non-executable file',
        lstat: { mode: 0o100600 },
      },
    ];

    for (const testCase of cases) {
      const execFile = vi.fn(async () => JSON.stringify({ nimi: '0.0.0-dev' }));
      const resolver = createNimiElectronSourceRuntimeVersionResolverForTest({
        platform: 'darwin',
        env: testCase.env ?? {
          NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT: '1',
          NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT_RUNTIME_EXECUTABLE: macExecutable,
        },
        geteuid: testCase.geteuid ?? (() => 501),
        lstat: () => ({
          isFile: () => true,
          isSymbolicLink: () => false,
          uid: 501,
          mode: 0o100755,
          ino: 1,
          mtimeMs: 1,
          size: 1,
          ...testCase.lstat,
        }),
        realpath: testCase.realpath ?? ((candidate) => candidate),
        execFile,
      });

      await expect(resolver(), testCase.name).resolves.toBeUndefined();
      expect(execFile, testCase.name).not.toHaveBeenCalled();
    }
  });

  it('validates and reads version --json from the canonical Windows source Runtime binary', async () => {
    const execFile = vi.fn(async () => JSON.stringify({ nimi: '0.0.0-dev', osArch: 'windows/amd64' }));
    const resolver = createNimiElectronSourceRuntimeVersionResolverForTest({
      platform: 'win32',
      env: {
        NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT: '1',
        NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT_RUNTIME_EXECUTABLE: windowsExecutable,
      },
      lstat: () => ({
        isFile: () => true,
        isSymbolicLink: () => false,
        uid: 0,
        mode: 0o100666,
        ino: 7,
        mtimeMs: 1_700_000_000_000,
        size: 64_000_000,
      }),
      realpath: (candidate) => candidate.toUpperCase(),
      execFile,
    });

    await expect(resolver()).resolves.toBe('0.0.0-dev');
    expect(execFile).toHaveBeenCalledWith(
      windowsExecutable,
      ['version', '--json'],
      expect.objectContaining({ windowsHide: true }),
    );
  });

  it('does not cache malformed version output and succeeds when a later probe returns valid JSON', async () => {
    const execFile = vi.fn()
      .mockResolvedValueOnce('not-json')
      .mockResolvedValueOnce(JSON.stringify({ nimi: '' }))
      .mockResolvedValueOnce(JSON.stringify({ nimi: '0.0.0-dev' }));
    const resolver = createNimiElectronSourceRuntimeVersionResolverForTest({
      platform: 'darwin',
      env: {
        NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT: '1',
        NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT_RUNTIME_EXECUTABLE: macExecutable,
      },
      geteuid: () => 501,
      lstat: () => ({
        isFile: () => true,
        isSymbolicLink: () => false,
        uid: 501,
        mode: 0o100755,
        ino: 12,
        mtimeMs: 1_700_000_000_000,
        size: 1024,
      }),
      realpath: (candidate) => candidate,
      execFile,
    });

    await expect(resolver()).resolves.toBeUndefined();
    await expect(resolver()).resolves.toBeUndefined();
    await expect(resolver()).resolves.toBe('0.0.0-dev');
    expect(execFile).toHaveBeenCalledTimes(3);
  });

  it.skipIf(process.platform !== 'darwin')(
    'executes a real canonical macOS source-dev executable stub and projects its version',
    async () => {
      const tempRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'nimi-rt-version-')));
      try {
        const binaryDir = path.join(tempRoot, '.nimi', 'local', 'imp3', 'runtime-local-development');
        const binaryPath = path.join(binaryDir, 'nimi-runtime');
        mkdirSync(binaryDir, { recursive: true, mode: 0o700 });
        writeFileSync(
          binaryPath,
          '#!/bin/sh\nif [ "$1" = "version" ] && [ "$2" = "--json" ]; then\n  printf \'{"nimi":"0.0.0-dev","osArch":"darwin/arm64"}\\n\'\nelse\n  exit 1\nfi\n',
          { encoding: 'utf8', mode: 0o700 },
        );
        chmodSync(binaryPath, 0o700);

        const resolver = createNimiElectronSourceRuntimeVersionResolverForTest({
          env: {
            NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT: '1',
            NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT_RUNTIME_EXECUTABLE: binaryPath,
          },
        });
        const host = createNimiElectronSourceRuntimeLifecycleHostForProbe(
          { probe: createRunningProbe() },
          'protected-desktop-control',
          { resolveVersion: resolver },
        );
        const commands = createElectronRuntimeBridgeCommandNames();

        await expect(host.invoke(commands.status, commands)).resolves.toEqual({
          running: true,
          managed: false,
          launchMode: 'SOURCE',
          grpcAddr: 'protected-desktop-control',
          version: '0.0.0-dev',
        });
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    },
  );
});
