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
  NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
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

  it('admits the exact final local-app command set', () => {
    const localAppSet = NIMI_STANDARD_SHELL_CAPABILITY_SETS.find((set) =>
      set.setId === NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID
    );
    expect(localAppSet).toMatchObject({
      setId: 'local-app-standard-shell-v1',
      hostClass: 'protected-local-app-host',
      appPackageKind: 'nimi-app',
      launchResolution: 'runtime_prepare_local_app_launch_and_verified_process_binding',
      authBinding: 'runtime_owned_request_empty_local_app_session',
      authorityStatus: 'permission_model_v1_base_entitlement_only',
      plannedOperationsDisposition: 'deny_until_separate_operation_admission',
      sourceRule: 'P-KIT-044',
    });
    expect(localAppSet?.allowedOperations).toEqual([
      'local-app.sessionStatus',
      'local-app.permissionStatus',
      'local-app.permissionRequest',
      'storage.readJson',
      'storage.writeJson',
      'storage.removeJson',
      'desktop-open.openIntent',
    ]);
    expect(localAppSet?.allowedCommands).toEqual([
      'nimi.shell.localApp.sessionStatus',
      'nimi.shell.localApp.permissionStatus',
      'nimi.shell.localApp.permissionRequest',
      'nimi.shell.storage.readJson',
      'nimi.shell.storage.writeJson',
      'nimi.shell.storage.removeJson',
      'nimi.shell.desktopOpen.openIntent',
    ]);
    expect(localAppSet?.plannedOperations).toEqual(expect.arrayContaining([
      'ai-config.get',
      'data.pathResolve',
      'config.get',
    ]));
    expect(localAppSet?.plannedOperations).not.toContain('desktop-open.openIntent');
    expect(localAppSet?.forbiddenCommands).toContain(NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.status']);
    expect(localAppSet?.forbiddenCommands).toContain(NIMI_STANDARD_SHELL_COMMANDS['runtime.unary']);
    expect(localAppSet?.forbiddenCommands).toContain(NIMI_STANDARD_SHELL_COMMANDS['local-agent.runtimeTrustedCaller']);
    expect(localAppSet?.forbiddenCommands).toContain(NIMI_STANDARD_SHELL_COMMANDS['platform-projection.get']);
    expect(localAppSet?.forbiddenOperations).toContain('electron.raw-ipc');
    expect(localAppSet?.forbiddenOperations).toContain('node.raw-fs');

    const standardCommands = new Set(NIMI_STANDARD_SHELL_CAPABILITIES.flatMap((capability) =>
      capability.operations.map((operation) => operation.command),
    ));
    for (const command of [...localAppSet?.allowedCommands ?? [], ...localAppSet?.forbiddenCommands ?? []]) {
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
