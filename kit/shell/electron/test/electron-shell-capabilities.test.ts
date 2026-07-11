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
      restart: NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.restart'],
    });
  });

  it('hardcuts product Runtime stop from Electron command projections', () => {
    expect(Object.hasOwn(STANDARD_COMMANDS, 'stop')).toBe(false);
    expect(
      NIMI_STANDARD_SHELL_CAPABILITIES.find((capability) => capability.id === 'runtime-lifecycle')?.operations
        .map((operation) => operation.id),
    ).not.toContain('stop');
    expect(Object.values(NIMI_STANDARD_SHELL_COMMANDS)).not.toContain('nimi.shell.runtimeLifecycle.stop');
  });

  it('keeps the installed Nimi App capability set blocked pending A.1', () => {
    const installedSet = NIMI_STANDARD_SHELL_CAPABILITY_SETS.find((set) =>
      set.setId === NIMI_INSTALLED_NIMI_APP_STANDARD_SHELL_CAPABILITY_SET_ID
    );
    expect(installedSet).toMatchObject({
      setId: 'installed-nimi-app-standard-shell-v1',
      hostClass: 'desktop-electron-installed-app-host',
      appPackageKind: 'nimi-app',
      launchResolution: 'blocked_pending_a1_no_product_launch',
      authBinding: 'binding_only_no_protected_session',
      authorityStatus: 'blocked_pending_a1',
      plannedOperationsDisposition: 'deny_until_a1_authority_and_implementation',
      sourceRule: 'P-KIT-044',
    });
    expect(installedSet?.allowedOperations).toEqual([]);
    expect(installedSet?.allowedCommands).toEqual([]);
    expect(installedSet?.plannedOperations).toEqual(expect.arrayContaining([
      'runtime.unary',
      'storage.readJson',
      'ai-config.get',
      'desktop-open.openIntent',
    ]));
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
