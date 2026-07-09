import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  createElectronCapabilityUnavailableError,
  createElectronExternalDaemonRequiredError,
  createNimiElectronStandardApplicationMenuTemplate,
  createNimiElectronFileAIConfigStore,
  getElectronStandardShellCapabilityIds,
  registerNimiElectronRuntimeBridge,
  type ElectronRuntimeBridgeTrustedMetadataProvider,
  type ElectronRuntimeBridgeUnaryRequest,
  type RuntimeGrpcBridgeClient,
} from '../src/main/index.js';
import { installNimiElectronRuntimeBridge } from '../src/preload/index.js';
import {
  NIMI_INSTALLED_NIMI_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
  NIMI_STANDARD_SHELL_CAPABILITIES,
  NIMI_STANDARD_SHELL_CAPABILITY_IDS,
  NIMI_STANDARD_SHELL_CAPABILITY_SETS,
  NIMI_STANDARD_SHELL_COMMANDS,
} from '@nimiplatform/kit/shell/capabilities';
import {
  FakeIpcMain,
  STANDARD_COMMANDS,
  STANDARD_EVENT_NAMESPACE,
  createInvokeEvent,
  fetchOkText,
  findFreePort,
  fromBase64,
  invokeBridge,
  toBase64,
  withEnvVars,
  withTempDir,
} from './electron-shell-test-utils.js';

describe('Electron standard shell capability catalog', () => {
  it('provides a native application menu template with standard edit roles', () => {
    const template = createNimiElectronStandardApplicationMenuTemplate({
      appName: 'Fixture',
      platform: 'darwin',
    });
    const editMenu = template.find((item) => item.label === 'Edit');
    expect(editMenu).toBeDefined();
    const submenu = editMenu?.submenu as Array<{ role?: string; type?: string }>;
    expect(submenu.map((item) => item.role || item.type)).toEqual([
      'undo',
      'redo',
      'separator',
      'cut',
      'copy',
      'paste',
      'pasteAndMatchStyle',
      'delete',
      'selectAll',
    ]);
  });

  it('exposes the admitted standard capability ids and command names', () => {
    expect(getElectronStandardShellCapabilityIds()).toEqual(NIMI_STANDARD_SHELL_CAPABILITY_IDS);
    expect(STANDARD_COMMANDS).toEqual({
      unary: NIMI_STANDARD_SHELL_COMMANDS['runtime.unary'],
      stream_open: NIMI_STANDARD_SHELL_COMMANDS['runtime.streamOpen'],
      stream_close: NIMI_STANDARD_SHELL_COMMANDS['runtime.streamClose'],
      status: NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.status'],
      start: NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.start'],
      stop: NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.stop'],
      restart: NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.restart'],
      config_get: NIMI_STANDARD_SHELL_COMMANDS['config.get'],
      config_set: NIMI_STANDARD_SHELL_COMMANDS['config.set'],
    });
  });

  it('projects the admitted installed Nimi App standard shell capability set', () => {
    const installedSet = NIMI_STANDARD_SHELL_CAPABILITY_SETS.find((set) =>
      set.setId === NIMI_INSTALLED_NIMI_APP_STANDARD_SHELL_CAPABILITY_SET_ID
    );
    expect(installedSet).toMatchObject({
      setId: 'installed-nimi-app-standard-shell-v1',
      hostClass: 'desktop-electron-installed-app-host',
      appPackageKind: 'nimi-app',
      launchResolution: 'runtime-openapp-attested',
      authBinding: 'host-owned-runtime-app-session',
      sourceRule: 'P-KIT-044',
    });
    expect(installedSet?.allowedCommands).toEqual([
      NIMI_STANDARD_SHELL_COMMANDS['runtime.unary'],
      NIMI_STANDARD_SHELL_COMMANDS['runtime.streamOpen'],
      NIMI_STANDARD_SHELL_COMMANDS['runtime.streamClose'],
      NIMI_STANDARD_SHELL_COMMANDS['data.pathResolve'],
      NIMI_STANDARD_SHELL_COMMANDS['storage.readJson'],
      NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson'],
      NIMI_STANDARD_SHELL_COMMANDS['storage.removeJson'],
      NIMI_STANDARD_SHELL_COMMANDS['config.get'],
      NIMI_STANDARD_SHELL_COMMANDS['config.set'],
      NIMI_STANDARD_SHELL_COMMANDS['ai-config.get'],
      NIMI_STANDARD_SHELL_COMMANDS['ai-config.set'],
      NIMI_STANDARD_SHELL_COMMANDS['local-assets.resolveUrl'],
      NIMI_STANDARD_SHELL_COMMANDS['desktop-open.openIntent'],
      NIMI_STANDARD_SHELL_COMMANDS['shell-ui.confirmDialog'],
      NIMI_STANDARD_SHELL_COMMANDS['shell-ui.startWindowDrag'],
      NIMI_STANDARD_SHELL_COMMANDS['shell-ui.focusMainWindow'],
    ]);
    expect(installedSet?.forbiddenCommands).toContain(NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.status']);
    expect(installedSet?.forbiddenCommands).toContain(NIMI_STANDARD_SHELL_COMMANDS['local-agent.runtimeTrustedCaller']);
    expect(installedSet?.forbiddenCommands).toContain(NIMI_STANDARD_SHELL_COMMANDS['platform-projection.get']);
    expect(installedSet?.forbiddenOperations).toContain('electron.raw-ipc');
    expect(installedSet?.forbiddenOperations).toContain('node.raw-fs');

    const standardCommands = new Set(NIMI_STANDARD_SHELL_CAPABILITIES.flatMap((capability) =>
      capability.operations.map((operation) => operation.command),
    ));
    for (const command of [...installedSet?.allowedCommands ?? [], ...installedSet?.forbiddenCommands ?? []]) {
      expect(standardCommands.has(command), command).toBe(true);
    }
  });

  it('uses the standard unavailable envelope for admitted but unimplemented commands', () => {
    const error = createElectronCapabilityUnavailableError(NIMI_STANDARD_SHELL_COMMANDS['ai-profile.get']);
    expect(error).toMatchObject({
      code: 'capability-unavailable',
      reasonCode: 'electron-standard-capability-unavailable',
      source: 'electron',
    });
    expect(error.envelope).toMatchObject({
      code: 'capability-unavailable',
      reasonCode: 'electron-standard-capability-unavailable',
      source: 'electron',
    });
  });
});
