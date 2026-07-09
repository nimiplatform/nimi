import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import {
  NIMI_ELECTRON_SHELL_FILE_PROTOCOL_SCHEME,
  createElectronShellFileProtocolHost,
  registerNimiElectronRuntimeBridge,
  type NimiElectronFileDialogOpenPayload,
  type NimiElectronStandardShellHost,
} from '../src/main/index.js';
import {
  NIMI_INSTALLED_NIMI_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
  NIMI_STANDARD_SHELL_COMMANDS,
} from '@nimiplatform/kit/shell/capabilities';
import {
  FakeIpcMain,
  createInvokeEvent,
  invokeBridge,
  withTempDir,
} from './electron-shell-test-utils.js';
import { FakeElectronProtocol } from './fake-electron-protocol.js';

function registerFileSurfaceBridge(standardShellHost: NimiElectronStandardShellHost | undefined): FakeIpcMain {
  const ipcMain = new FakeIpcMain();
  const resolvedStandardShellHost = standardShellHost?.capabilitySetRef
    ? standardShellHost
    : standardShellHost
      ? { allowAllStandardShellCommands: true, ...standardShellHost }
      : undefined;
  registerNimiElectronRuntimeBridge({
    appId: 'nimi.tester',
    runtimeEndpoint: '127.0.0.1:46371',
    allowedOrigins: ['http://localhost:1430'],
    ipcMain,
    createGrpcClient: async () => {
      throw new Error('not used');
    },
    standardShellHost: resolvedStandardShellHost,
  });
  return ipcMain;
}

const FLOATING_WINDOW_COMMAND_KEYS = [
  'floating-window.setBounds',
  'floating-window.setIgnoreCursorEvents',
  'floating-window.setAlwaysOnTop',
  'floating-window.hide',
  'floating-window.close',
  'floating-window.beginManualDrag',
  'floating-window.moveManualDrag',
  'floating-window.constrainToVisibleArea',
] as const;

describe('createElectronShellFileProtocolHost', () => {
  it('registers the privileged nimi-shell-file scheme and keeps the desktop URL shape', () => {
    const protocol = new FakeElectronProtocol();
    const protocolHost = createElectronShellFileProtocolHost({ protocol });

    protocolHost.registerPrivilegedSchemes();
    protocolHost.registerProtocolHandler();

    expect(protocol.privilegedSchemes).toEqual([NIMI_ELECTRON_SHELL_FILE_PROTOCOL_SCHEME]);
    expect(protocol.handlers.has(NIMI_ELECTRON_SHELL_FILE_PROTOCOL_SCHEME)).toBe(true);
    const absolutePath = path.resolve('/tmp/nimi shell asset.png');
    const url = new URL(protocolHost.resolveLocalAssetUrl(absolutePath));
    expect(url.protocol).toBe(`${NIMI_ELECTRON_SHELL_FILE_PROTOCOL_SCHEME}:`);
    expect(url.hostname).toBe('local');
    expect(url.pathname).toBe('/');
    expect(url.searchParams.get('path')).toMatch(/^[A-Za-z0-9_-]+$/u);
  });

  it('keeps absolute local paths out of the URL pathname for renderer fetch compatibility', () => {
    const protocolHost = createElectronShellFileProtocolHost({ protocol: new FakeElectronProtocol() });
    const absolutePath = path.resolve('/tmp/nimi shell asset.png');
    const url = new URL(protocolHost.resolveLocalAssetUrl(absolutePath));

    expect(url.protocol).toBe(`${NIMI_ELECTRON_SHELL_FILE_PROTOCOL_SCHEME}:`);
    expect(url.hostname).toBe('local');
    expect(url.pathname).toBe('/');
    expect(url.searchParams.get('path')).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(url.href).not.toContain(encodeURIComponent(absolutePath));
  });

  it('serves root files, rejects out-of-root unregistered files, and honors the readable registry', async () => {
    await withTempDir('file-protocol', async (root) => {
      const assetRoot = path.join(root, 'assets');
      await mkdir(assetRoot, { recursive: true });
      const insidePath = path.join(assetRoot, 'inside.txt');
      await writeFile(insidePath, 'inside bytes', 'utf8');
      const outsidePath = path.join(root, 'outside.txt');
      await writeFile(outsidePath, 'outside bytes', 'utf8');

      const protocol = new FakeElectronProtocol();
      const protocolHost = createElectronShellFileProtocolHost({ protocol, roots: [assetRoot] });
      protocolHost.registerProtocolHandler();

      const inRootResponse = await protocol.request(protocolHost.resolveLocalAssetUrl(insidePath));
      expect(inRootResponse.status).toBe(200);
      expect(await inRootResponse.text()).toBe('inside bytes');
      expect(inRootResponse.headers.get('content-type')).toBe('text/plain; charset=utf-8');

      const outsideResponse = await protocol.request(protocolHost.resolveLocalAssetUrl(outsidePath));
      expect(outsideResponse.status).toBe(403);
      expect(await protocolHost.hasReadableFile(outsidePath)).toBe(false);

      await protocolHost.registerReadableFile(outsidePath);
      expect(await protocolHost.hasReadableFile(outsidePath)).toBe(true);
      const registeredResponse = await protocol.request(protocolHost.resolveLocalAssetUrl(outsidePath));
      expect(registeredResponse.status).toBe(200);
      expect(await registeredResponse.text()).toBe('outside bytes');

      const missingResponse = await protocol.request(
        protocolHost.resolveLocalAssetUrl(path.join(assetRoot, 'missing.txt')),
      );
      expect(missingResponse.status).toBe(404);
    });
  });

  it('resolves standard local asset URLs through the protocol host without an app URL hook', async () => {
    await withTempDir('file-protocol-bridge', async (root) => {
      const assetRoot = path.join(root, 'assets');
      await mkdir(assetRoot, { recursive: true });
      const assetPath = path.join(assetRoot, 'preview.txt');
      await writeFile(assetPath, 'preview', 'utf8');
      const canonicalAssetPath = await realpath(assetPath);

      const protocol = new FakeElectronProtocol();
      const protocolHost = createElectronShellFileProtocolHost({ protocol, roots: [assetRoot] });
      const ipcMain = registerFileSurfaceBridge({
        localAssetRoots: [assetRoot],
        localAssetProtocolHost: protocolHost,
      });

      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['local-assets.resolveUrl'],
        payload: { path: assetPath },
      })).resolves.toEqual({
        path: canonicalAssetPath,
        url: protocolHost.resolveLocalAssetUrl(canonicalAssetPath),
      });
      expect(await protocolHost.hasReadableFile(canonicalAssetPath)).toBe(true);
    });
  });
});

describe('standard storage and local asset bridge', () => {
  it('implements avatar asset resolution through the standard local asset roots', async () => {
    await withTempDir('avatar-asset', async (root) => {
      const assetRoot = path.join(root, 'avatar');
      await mkdir(assetRoot, { recursive: true });
      const assetPath = path.join(assetRoot, 'avatar.vrm');
      await writeFile(assetPath, 'avatar bytes', 'utf8');
      const canonicalAssetPath = await realpath(assetPath);
      const protocolHost = createElectronShellFileProtocolHost({
        protocol: new FakeElectronProtocol(),
        roots: [assetRoot],
      });
      const ipcMain = registerFileSurfaceBridge({
        localAssetRoots: [assetRoot],
        localAssetProtocolHost: protocolHost,
      });

      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['avatar.assetResolve'],
        payload: { path: assetPath },
      })).resolves.toEqual({
        path: canonicalAssetPath,
        url: protocolHost.resolveLocalAssetUrl(canonicalAssetPath),
      });
      expect(await protocolHost.hasReadableFile(canonicalAssetPath)).toBe(true);
    });
  });

  it('implements standard data, storage, and local asset capabilities inside admitted host roots', async () => {
    await withTempDir('standard-roots', async (root) => {
      const dataRoot = path.join(root, 'data');
      const assetRoot = path.join(root, 'assets');
      await mkdir(dataRoot, { recursive: true });
      await mkdir(assetRoot, { recursive: true });
      const assetPath = path.join(assetRoot, 'preview.txt');
      await writeFile(assetPath, 'preview', 'utf8');
      const canonicalDataRoot = await realpath(dataRoot);
      const canonicalAssetPath = await realpath(assetPath);
      const protocolHost = createElectronShellFileProtocolHost({
        protocol: new FakeElectronProtocol(),
        roots: [assetRoot],
      });
      const ipcMain = registerFileSurfaceBridge({
        standardDataRootBinding: {
          source: 'runtime-launch-projection',
          durableDataRoot: dataRoot,
          projectionRef: 'electron-shell-test-fixture',
        },
        localAssetRoots: [assetRoot],
        localAssetProtocolHost: protocolHost,
      });
      const { event } = createInvokeEvent();

      await expect(invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['data.pathResolve'],
        payload: { relativePath: 'settings/profile.json' },
      })).resolves.toMatchObject({
        path: path.join(canonicalDataRoot, 'settings', 'profile.json'),
      });
      await expect(invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['data.pathResolve'],
        payload: { path: 'settings/legacy-alias.json' },
      })).rejects.toMatchObject({
        code: 'invalid-payload',
        reasonCode: 'electron-standard-storage-renderer-field-forbidden',
      });

      const writeResult = await invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson'],
        payload: {
          relativePath: 'settings/profile.json',
          value: { schemaVersion: 1, enabled: true },
        },
      }) as { path: string; value: Record<string, unknown> };
      expect(writeResult.path).toBe(path.join(canonicalDataRoot, 'settings', 'profile.json'));
      expect(JSON.parse(await readFile(writeResult.path, 'utf8'))).toEqual({ schemaVersion: 1, enabled: true });
      expect(await readdir(path.dirname(writeResult.path))).toEqual(['profile.json']);

      await expect(invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['storage.readJson'],
        payload: { relativePath: 'settings/profile.json' },
      })).resolves.toEqual({
        path: path.join(canonicalDataRoot, 'settings', 'profile.json'),
        value: { schemaVersion: 1, enabled: true },
      });

      await expect(invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['storage.removeJson'],
        payload: { relativePath: 'settings/profile.json' },
      })).resolves.toEqual({
        path: path.join(canonicalDataRoot, 'settings', 'profile.json'),
        removed: true,
      });
      await expect(invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['storage.removeJson'],
        payload: { relativePath: 'settings/profile.json' },
      })).resolves.toEqual({
        path: path.join(canonicalDataRoot, 'settings', 'profile.json'),
        removed: false,
      });
      await expect(invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['storage.readJson'],
        payload: { relativePath: 'settings/profile.json' },
      })).rejects.toMatchObject({
        code: 'not-found',
        reasonCode: 'electron-standard-storage-json-not-found',
      });
      await expect(invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['storage.removeJson'],
        payload: { relativePath: '../escape.json' },
      })).rejects.toMatchObject({
        code: 'invalid-path',
      });

      await expect(invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['local-assets.resolveUrl'],
        payload: { path: assetPath },
      })).resolves.toEqual({
        path: canonicalAssetPath,
        url: protocolHost.resolveLocalAssetUrl(canonicalAssetPath),
      });
      expect(await protocolHost.hasReadableFile(canonicalAssetPath)).toBe(true);
    });
  });

  it('accepts renderer standard-shell nested payload envelopes for storage commands', async () => {
    await withTempDir('standard-nested-storage', async (root) => {
      const dataRoot = path.join(root, 'data');
      await mkdir(dataRoot, { recursive: true });
      const canonicalDataRoot = await realpath(dataRoot);
      const ipcMain = registerFileSurfaceBridge({
        standardDataRootBinding: {
          source: 'runtime-launch-projection',
          durableDataRoot: dataRoot,
          projectionRef: 'electron-shell-test-fixture',
        },
      });
      const { event } = createInvokeEvent();

      await expect(invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson'],
        payload: {
          payload: {
            relativePath: 'shijing-space/account.fixture.json',
            value: { user_id: 'fixture', readings: [1] },
          },
        },
      })).resolves.toEqual({
        path: path.join(canonicalDataRoot, 'shijing-space', 'account.fixture.json'),
        value: { user_id: 'fixture', readings: [1] },
      });

      await expect(invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['storage.readJson'],
        payload: {
          payload: {
            relativePath: 'shijing-space/account.fixture.json',
          },
        },
      })).resolves.toEqual({
        path: path.join(canonicalDataRoot, 'shijing-space', 'account.fixture.json'),
        value: { user_id: 'fixture', readings: [1] },
      });
    });
  });
});

describe('nimi.shell.fileDialog.open', () => {
  it('fails closed when no host file dialog hook is installed', async () => {
    const ipcMain = registerFileSurfaceBridge({});
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['file-dialog.open'],
      payload: { kind: 'file' },
    })).rejects.toMatchObject({
      code: 'capability-unavailable',
      reasonCode: 'electron-standard-capability-unavailable',
    });
  });

  it('rejects invalid dialog payloads before the host hook runs', async () => {
    const ipcMain = registerFileSurfaceBridge({
      openFileDialog: () => {
        throw new Error('hook must not run for invalid payloads');
      },
    });
    const { event } = createInvokeEvent();

    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['file-dialog.open'],
      payload: { kind: 'anything' },
    })).rejects.toMatchObject({
      code: 'invalid-payload',
      reasonCode: 'electron-file-dialog-kind-invalid',
    });
    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['file-dialog.open'],
      payload: { kind: 'file', multiple: 'yes' },
    })).rejects.toMatchObject({
      code: 'invalid-payload',
      reasonCode: 'electron-file-dialog-multiple-invalid',
    });
    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['file-dialog.open'],
      payload: { kind: 'file', filters: 'images' },
    })).rejects.toMatchObject({
      code: 'invalid-payload',
      reasonCode: 'electron-file-dialog-filters-invalid',
    });
  });

  it('returns selected paths and auto-registers them into the readable-file registry', async () => {
    await withTempDir('file-dialog', async (root) => {
      const selectedPath = path.join(root, 'selected.png');
      await writeFile(selectedPath, 'png bytes', 'utf8');
      const protocolHost = createElectronShellFileProtocolHost({ protocol: new FakeElectronProtocol() });
      const captured: NimiElectronFileDialogOpenPayload[] = [];
      const ipcMain = registerFileSurfaceBridge({
        localAssetProtocolHost: protocolHost,
        openFileDialog: (payload) => {
          captured.push(payload);
          return { canceled: false, paths: [selectedPath] };
        },
      });

      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['file-dialog.open'],
        payload: {
          kind: 'file',
          title: 'Pick an image',
          filters: [{ name: 'Images', extensions: ['png', 'jpg'] }],
          multiple: false,
        },
      })).resolves.toEqual({
        canceled: false,
        paths: [selectedPath],
      });
      expect(captured).toEqual([{
        kind: 'file',
        title: 'Pick an image',
        filters: [{ name: 'Images', extensions: ['png', 'jpg'] }],
        multiple: false,
      }]);
      expect(await protocolHost.hasReadableFile(selectedPath)).toBe(true);
    });
  });
});

describe('nimi.shell.fileReveal.reveal', () => {
  it('fails closed when no host reveal hook is installed', async () => {
    const ipcMain = registerFileSurfaceBridge({});
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['file-reveal.reveal'],
      payload: { path: '/tmp/anywhere.txt' },
    })).rejects.toMatchObject({
      code: 'capability-unavailable',
      reasonCode: 'electron-standard-capability-unavailable',
    });
  });

  it('rejects paths outside data root, local asset roots, and the readable registry', async () => {
    await withTempDir('file-reveal-invalid', async (root) => {
      const dataRoot = path.join(root, 'data');
      const outsidePath = path.join(root, 'outside.txt');
      await writeFile(outsidePath, 'outside', 'utf8');
      const ipcMain = registerFileSurfaceBridge({
        standardDataRootBinding: {
          source: 'runtime-launch-projection',
          durableDataRoot: dataRoot,
          projectionRef: 'electron-shell-test-fixture',
        },
        revealInOs: () => {
          throw new Error('reveal must not run for non-admitted paths');
        },
      });

      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['file-reveal.reveal'],
        payload: { path: outsidePath },
      })).rejects.toMatchObject({
        code: 'invalid-path',
        reasonCode: 'electron-file-reveal-path-not-admitted',
      });
    });
  });

  it('reports not-found for admitted paths that do not exist', async () => {
    await withTempDir('file-reveal-missing', async (root) => {
      const dataRoot = path.join(root, 'data');
      const ipcMain = registerFileSurfaceBridge({
        standardDataRootBinding: {
          source: 'runtime-launch-projection',
          durableDataRoot: dataRoot,
          projectionRef: 'electron-shell-test-fixture',
        },
        revealInOs: () => {
          throw new Error('reveal must not run for missing files');
        },
      });

      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['file-reveal.reveal'],
        payload: { path: path.join(dataRoot, 'missing.txt') },
      })).rejects.toMatchObject({
        code: 'not-found',
        reasonCode: 'electron-file-reveal-target-not-found',
      });
    });
  });

  it('reveals admitted files inside roots and registered readable files', async () => {
    await withTempDir('file-reveal-ok', async (root) => {
      const dataRoot = path.join(root, 'data');
      await mkdir(dataRoot, { recursive: true });
      const insidePath = path.join(dataRoot, 'artifact.txt');
      await writeFile(insidePath, 'artifact', 'utf8');
      const registeredPath = path.join(root, 'registered.txt');
      await writeFile(registeredPath, 'registered', 'utf8');
      const protocolHost = createElectronShellFileProtocolHost({ protocol: new FakeElectronProtocol() });
      await protocolHost.registerReadableFile(registeredPath);
      const revealed: string[] = [];
      const ipcMain = registerFileSurfaceBridge({
        standardDataRootBinding: {
          source: 'runtime-launch-projection',
          durableDataRoot: dataRoot,
          projectionRef: 'electron-shell-test-fixture',
        },
        localAssetProtocolHost: protocolHost,
        revealInOs: (revealPath) => {
          revealed.push(revealPath);
        },
      });
      const { event } = createInvokeEvent();

      await expect(invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['file-reveal.reveal'],
        payload: { path: insidePath },
      })).resolves.toEqual({
        revealed: true,
        path: await realpath(insidePath),
      });
      await expect(invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['file-reveal.reveal'],
        payload: { path: registeredPath },
      })).resolves.toEqual({
        revealed: true,
        path: await realpath(registeredPath),
      });
      expect(revealed).toEqual([await realpath(insidePath), await realpath(registeredPath)]);
    });
  });
});

describe('nimi.shell.export.saveFile', () => {
  it('fails closed when no host export directory hook is installed', async () => {
    const ipcMain = registerFileSurfaceBridge({});
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['export.saveFile'],
      payload: { filename: 'report.txt', dataBase64: Buffer.from('report').toString('base64') },
    })).rejects.toMatchObject({
      code: 'capability-unavailable',
      reasonCode: 'electron-standard-capability-unavailable',
    });
  });

  it('rejects empty and undecodable base64 payloads', async () => {
    await withTempDir('export-invalid', async (root) => {
      const ipcMain = registerFileSurfaceBridge({
        exportDirectory: () => path.join(root, 'exports'),
      });
      const { event } = createInvokeEvent();

      for (const dataBase64 of ['', '   ', '!not-base64!', 'abc']) {
        await expect(invokeBridge(ipcMain, event, {
          command: NIMI_STANDARD_SHELL_COMMANDS['export.saveFile'],
          payload: { filename: 'report.txt', dataBase64 },
        })).rejects.toMatchObject({
          code: 'invalid-payload',
        });
      }
    });
  });

  it('sanitizes filenames and avoids overwriting existing artifacts', async () => {
    await withTempDir('export-save', async (root) => {
      const exportDir = path.join(root, 'exports');
      const protocolHost = createElectronShellFileProtocolHost({ protocol: new FakeElectronProtocol() });
      const ipcMain = registerFileSurfaceBridge({
        exportDirectory: () => exportDir,
        localAssetProtocolHost: protocolHost,
      });
      const { event } = createInvokeEvent();
      const payload = {
        filename: '../evil dir/re port?.txt',
        mimeType: 'text/plain',
        dataBase64: Buffer.from('export bytes').toString('base64'),
      };

      const first = await invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['export.saveFile'],
        payload,
      }) as { artifactPath: string; filename: string; byteSize: number; mimeType?: string };
      expect(first.filename).toBe('evil-dir-re-port-.txt');
      expect(first.artifactPath).toBe(path.join(exportDir, 'evil-dir-re-port-.txt'));
      expect(first.byteSize).toBe(Buffer.byteLength('export bytes'));
      expect(first.mimeType).toBe('text/plain');
      expect(await readFile(first.artifactPath, 'utf8')).toBe('export bytes');
      expect(await protocolHost.hasReadableFile(first.artifactPath)).toBe(true);

      const second = await invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['export.saveFile'],
        payload,
      }) as { artifactPath: string; filename: string };
      expect(second.filename).toBe('evil-dir-re-port--1.txt');
      expect(second.artifactPath).toBe(path.join(exportDir, 'evil-dir-re-port--1.txt'));
      expect((await readdir(exportDir)).sort()).toEqual(['evil-dir-re-port--1.txt', 'evil-dir-re-port-.txt']);
    });
  });
});

describe('nimi.shell.artifacts.write', () => {
  it('fails closed when no data root is configured', async () => {
    const ipcMain = registerFileSurfaceBridge({});
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['artifacts.write'],
      payload: { relativePath: 'artifacts/report.txt', dataBase64: Buffer.from('x').toString('base64') },
    })).rejects.toMatchObject({
      code: 'capability-unavailable',
      reasonCode: 'electron-standard-data-root-binding-missing',
    });
  });

  it('enforces the artifacts/ subtree prefix and rejects escapes', async () => {
    await withTempDir('artifacts-invalid', async (root) => {
      const dataRoot = path.join(root, 'data');
      const ipcMain = registerFileSurfaceBridge({
        standardDataRootBinding: {
          source: 'runtime-launch-projection',
          durableDataRoot: dataRoot,
          projectionRef: 'electron-shell-test-fixture',
        },
      });
      const { event } = createInvokeEvent();
      const dataBase64 = Buffer.from('artifact').toString('base64');

      for (const relativePath of ['notes/report.txt', 'artifacts', 'artifacts/']) {
        await expect(invokeBridge(ipcMain, event, {
          command: NIMI_STANDARD_SHELL_COMMANDS['artifacts.write'],
          payload: { relativePath, dataBase64 },
        })).rejects.toMatchObject({
          code: 'invalid-path',
          reasonCode: 'electron-standard-artifact-path-outside-artifacts-subtree',
        });
      }
      await expect(invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['artifacts.write'],
        payload: { relativePath: 'artifacts/../escape.txt', dataBase64 },
      })).rejects.toMatchObject({
        code: 'invalid-path',
        reasonCode: 'electron-standard-path-escapes-root',
      });
    });
  });

  it('writes artifact bytes inside the artifacts subtree and registers them as readable', async () => {
    await withTempDir('artifacts-write', async (root) => {
      const dataRoot = path.join(root, 'data');
      const protocolHost = createElectronShellFileProtocolHost({ protocol: new FakeElectronProtocol() });
      const ipcMain = registerFileSurfaceBridge({
        standardDataRootBinding: {
          source: 'runtime-launch-projection',
          durableDataRoot: dataRoot,
          projectionRef: 'electron-shell-test-fixture',
        },
        localAssetProtocolHost: protocolHost,
      });

      const result = await invokeBridge(ipcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['artifacts.write'],
        payload: {
          relativePath: 'artifacts/reports/summary.json',
          mimeType: 'application/json',
          dataBase64: Buffer.from('{"ok":true}').toString('base64'),
        },
      }) as { path: string; byteSize: number; mimeType?: string };

      expect(result.path).toBe(path.join(await realpath(dataRoot), 'artifacts', 'reports', 'summary.json'));
      expect(result.byteSize).toBe(Buffer.byteLength('{"ok":true}'));
      expect(result.mimeType).toBe('application/json');
      expect(await readFile(result.path, 'utf8')).toBe('{"ok":true}');
      expect(await protocolHost.hasReadableFile(result.path)).toBe(true);
    });
  });
});

describe('nimi.shell.floatingWindow.*', () => {
  it('fails closed for all floating-window commands until host hooks are injected', async () => {
    const ipcMain = registerFileSurfaceBridge({});
    for (const key of FLOATING_WINDOW_COMMAND_KEYS) {
      const command = NIMI_STANDARD_SHELL_COMMANDS[key];
      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command,
        payload: {},
      })).rejects.toMatchObject({
        code: 'capability-unavailable',
        reasonCode: 'electron-standard-capability-unavailable',
        details: { command },
      });
    }
  });

  it('dispatches floating-window commands to injected host hooks', async () => {
    const calls: Array<{ method: string; payload: unknown }> = [];
    const hook = (method: string) => (payload: Readonly<Record<string, unknown>>) => {
      calls.push({ method, payload });
      return method === 'setBounds' ? { applied: true } : undefined;
    };
    const ipcMain = registerFileSurfaceBridge({
      floatingWindow: {
        setBounds: hook('setBounds'),
        hide: hook('hide'),
      },
    });
    const { event } = createInvokeEvent();

    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['floating-window.setBounds'],
      payload: { x: 10, y: 20, width: 320, height: 480 },
    })).resolves.toEqual({ applied: true });
    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['floating-window.hide'],
      payload: {},
    })).resolves.toEqual({});
    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['floating-window.close'],
      payload: {},
    })).rejects.toMatchObject({
      code: 'capability-unavailable',
      reasonCode: 'electron-standard-capability-unavailable',
    });
    expect(calls).toEqual([
      { method: 'setBounds', payload: { x: 10, y: 20, width: 320, height: 480 } },
      { method: 'hide', payload: {} },
    ]);
  });

  it('returns the manual-drag origin envelope from the beginManualDrag hook', async () => {
    const seen: Array<{ method: string; payload: unknown }> = [];
    const ipcMain = registerFileSurfaceBridge({
      floatingWindow: {
        beginManualDrag: (payload) => {
          seen.push({ method: 'beginManualDrag', payload });
          // App reads BrowserWindow.getPosition() and reports manual origin.
          return { mode: 'manual', originX: 42, originY: 84 };
        },
        moveManualDrag: (payload) => {
          seen.push({ method: 'moveManualDrag', payload });
          return undefined;
        },
        constrainToVisibleArea: (payload) => {
          seen.push({ method: 'constrainToVisibleArea', payload });
          return { constrained: true };
        },
      },
    });
    const { event } = createInvokeEvent();

    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['floating-window.beginManualDrag'],
      payload: {},
    })).resolves.toEqual({ mode: 'manual', originX: 42, originY: 84 });
    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['floating-window.moveManualDrag'],
      payload: { originX: 42, originY: 84, totalDeltaX: 5, totalDeltaY: -3 },
    })).resolves.toEqual({});
    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['floating-window.constrainToVisibleArea'],
      payload: { minVisibleRatio: 0.2 },
    })).resolves.toEqual({ constrained: true });

    expect(seen).toEqual([
      { method: 'beginManualDrag', payload: {} },
      { method: 'moveManualDrag', payload: { originX: 42, originY: 84, totalDeltaX: 5, totalDeltaY: -3 } },
      { method: 'constrainToVisibleArea', payload: { minVisibleRatio: 0.2 } },
    ]);
  });

  it('propagates the command input context to the floating-window hook', async () => {
    let receivedCommand: string | undefined;
    const ipcMain = registerFileSurfaceBridge({
      floatingWindow: {
        setAlwaysOnTop: (_payload, input) => {
          receivedCommand = input.command;
          return undefined;
        },
      },
    });
    const { event } = createInvokeEvent();
    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['floating-window.setAlwaysOnTop'],
      payload: { alwaysOnTop: true },
    })).resolves.toEqual({});
    expect(receivedCommand).toBe(NIMI_STANDARD_SHELL_COMMANDS['floating-window.setAlwaysOnTop']);
  });
});

describe('installed Nimi App capability set for file surfaces', () => {
  it('desktop-installed-app-denies-file-system-handoff: denies fileDialog/fileReveal/export/artifacts commands', async () => {
    const ipcMain = registerFileSurfaceBridge({
      capabilitySetRef: NIMI_INSTALLED_NIMI_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
      standardDataRootBinding: {
        source: 'runtime-launch-projection',
        durableDataRoot: '/tmp/never-used',
        projectionRef: 'electron-shell-test-fixture',
      },
      openFileDialog: () => ({ canceled: true, paths: [] }),
      revealInOs: () => undefined,
      exportDirectory: () => '/tmp/never-used',
    });

    for (const command of [
      NIMI_STANDARD_SHELL_COMMANDS['file-dialog.open'],
      NIMI_STANDARD_SHELL_COMMANDS['file-reveal.reveal'],
      NIMI_STANDARD_SHELL_COMMANDS['export.saveFile'],
      NIMI_STANDARD_SHELL_COMMANDS['artifacts.write'],
    ]) {
      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command,
        payload: {},
      })).rejects.toMatchObject({
        code: 'capability-unavailable',
        reasonCode: 'electron-standard-capability-not-in-host-set',
        details: {
          command,
          capabilitySetRef: NIMI_INSTALLED_NIMI_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
        },
      });
    }
  });

  it('desktop-installed-app-denies-floating-window: denies all floating-window commands', async () => {
    const ipcMain = registerFileSurfaceBridge({
      capabilitySetRef: NIMI_INSTALLED_NIMI_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
      floatingWindow: {
        hide: () => undefined,
      },
    });

    for (const key of FLOATING_WINDOW_COMMAND_KEYS) {
      const command = NIMI_STANDARD_SHELL_COMMANDS[key];
      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command,
        payload: {},
      })).rejects.toMatchObject({
        code: 'capability-unavailable',
        reasonCode: 'electron-standard-capability-not-in-host-set',
        details: {
          command,
          capabilitySetRef: NIMI_INSTALLED_NIMI_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
        },
      });
    }
  });
});
