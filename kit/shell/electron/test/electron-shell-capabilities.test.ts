import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  createElectronCapabilityUnavailableError,
  createElectronExternalDaemonRequiredError,
  createNimiElectronStandardApplicationMenuTemplate,
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
      authorityStatus: 'app_access_declarations_with_protected_operations_unavailable_until_admission',
      plannedOperationsDisposition: 'deny_until_separate_operation_admission',
      sourceRule: 'P-KIT-044',
    });
    expect(localAppSet?.allowedOperations).toEqual([
      'local-app.sessionStatus',
      'local-app.aiConfigGet',
      'local-app.aiConfigOverwrite',
      'local-app.aiConfigLocalOptions',
      'local-app.textGenerateCandidate',
      'local-app.textTurnStream',
      'local-app.scenarioExecute',
      'local-app.scenarioJobSubmit',
      'local-app.scenarioJobGet',
      'local-app.scenarioJobSubscribe',
      'local-app.scenarioJobCancel',
      'local-app.artifactRead',
      'local-app.artifactUpload',
      'local-app.voiceAssetsList',
      'local-app.agentReferenceList',
      'local-app.conversationOpen',
      'local-app.conversationSendTurn',
      'local-app.conversationAttachmentUpload',
      'local-app.conversationArtifactRead',
      'local-app.conversationVoiceTranscribe',
      'local-app.conversationInterruptTurn',
      'local-app.conversationSubscribe',
      'local-app.conversationSnapshot',
      'local-app.sharedAgentAIConfigGet',
      'local-app.sharedAgentAIConfigOverwrite',
      'local-app.sharedAgentAIConfigLocalOptions',
      'local-app.agentAutonomySnapshot',
      'local-app.agentUpdateAutonomy',
      'local-app.agentPresentationSnapshot',
      'local-app.agentCommitPresentation',
      'local-app.realmWorldCoreList',
      'local-app.realmWorldCoreCreate',
      'local-app.realmPersonaCharacterListOwned',
      'local-app.realmPersonaCharacterGetOwned',
      'local-app.realmPersonaCharacterCreate',
      'local-app.realmPersonaCharacterReplace',
      'local-app.realmPersonaCharacterDelete',
      'storage.readJson',
      'storage.writeJson',
      'storage.removeJson',
      'storage.assetStat',
      'storage.assetList',
      'storage.assetWriteOpen',
      'storage.assetWriteChunk',
      'storage.assetWriteCommit',
      'storage.assetWriteAbort',
      'storage.assetReadOpen',
      'storage.assetReadNext',
      'storage.assetReadClose',
      'storage.assetRemove',
      'storage.assetMove',
      'storage.assetReveal',
      'storage.assetAdopt',
      'storage.assetMediaOpen',
      'storage.assetMediaRevoke',
      'desktop-open.openIntent',
    ]);
    expect(localAppSet?.allowedCommands).toEqual([
      'nimi.shell.localApp.sessionStatus',
      'nimi.shell.localApp.aiConfigGet',
      'nimi.shell.localApp.aiConfigOverwrite',
      'nimi.shell.localApp.aiConfigLocalOptions',
      'nimi.shell.localApp.textGenerateCandidate',
      'nimi.shell.localApp.textTurnStream',
      'nimi.shell.localApp.scenarioExecute',
      'nimi.shell.localApp.scenarioJobSubmit',
      'nimi.shell.localApp.scenarioJobGet',
      'nimi.shell.localApp.scenarioJobSubscribe',
      'nimi.shell.localApp.scenarioJobCancel',
      'nimi.shell.localApp.artifactRead',
      'nimi.shell.localApp.artifactUpload',
      'nimi.shell.localApp.voiceAssetsList',
      'nimi.shell.localApp.agentReferenceList',
      'nimi.shell.localApp.conversationOpen',
      'nimi.shell.localApp.conversationSendTurn',
      'nimi.shell.localApp.conversationAttachmentUpload',
      'nimi.shell.localApp.conversationArtifactRead',
      'nimi.shell.localApp.conversationVoiceTranscribe',
      'nimi.shell.localApp.conversationInterruptTurn',
      'nimi.shell.localApp.conversationSubscribe',
      'nimi.shell.localApp.conversationSnapshot',
      'nimi.shell.localApp.sharedAgentAIConfigGet',
      'nimi.shell.localApp.sharedAgentAIConfigOverwrite',
      'nimi.shell.localApp.sharedAgentAIConfigLocalOptions',
      'nimi.shell.localApp.agentAutonomySnapshot',
      'nimi.shell.localApp.agentUpdateAutonomy',
      'nimi.shell.localApp.agentPresentationSnapshot',
      'nimi.shell.localApp.agentCommitPresentation',
      'nimi.shell.localApp.realmWorldCoreList',
      'nimi.shell.localApp.realmWorldCoreCreate',
      'nimi.shell.localApp.realmPersonaCharacterListOwned',
      'nimi.shell.localApp.realmPersonaCharacterGetOwned',
      'nimi.shell.localApp.realmPersonaCharacterCreate',
      'nimi.shell.localApp.realmPersonaCharacterReplace',
      'nimi.shell.localApp.realmPersonaCharacterDelete',
      'nimi.shell.storage.readJson',
      'nimi.shell.storage.writeJson',
      'nimi.shell.storage.removeJson',
      'nimi.shell.storage.assetStat',
      'nimi.shell.storage.assetList',
      'nimi.shell.storage.assetWriteOpen',
      'nimi.shell.storage.assetWriteChunk',
      'nimi.shell.storage.assetWriteCommit',
      'nimi.shell.storage.assetWriteAbort',
      'nimi.shell.storage.assetReadOpen',
      'nimi.shell.storage.assetReadNext',
      'nimi.shell.storage.assetReadClose',
      'nimi.shell.storage.assetRemove',
      'nimi.shell.storage.assetMove',
      'nimi.shell.storage.assetReveal',
      'nimi.shell.storage.assetAdopt',
      'nimi.shell.storage.assetMediaOpen',
      'nimi.shell.storage.assetMediaRevoke',
      'nimi.shell.desktopOpen.openIntent',
    ]);
    expect(localAppSet?.plannedOperations).toEqual(expect.arrayContaining([
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
