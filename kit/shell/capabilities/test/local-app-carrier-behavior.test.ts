import { describe, expect, it } from 'vitest';

import {
  NIMI_STANDARD_SHELL_CAPABILITY_SETS,
  NIMI_STANDARD_SHELL_COMMANDS,
} from '../src/index.js';

const FINAL_LOCAL_APP_OPERATIONS = [
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
  'local-app.conversationVoiceRender',
  'local-app.conversationInterruptTurn',
  'local-app.conversationSubscribe',
  'local-app.conversationSnapshot',
  'local-app.embodimentSnapshot',
  'local-app.embodimentSubscribe',
  'local-app.aiRealtimeOpen',
  'local-app.aiRealtimeAppendInput',
  'local-app.aiRealtimeSubmitOwnerControl',
  'local-app.aiRealtimeSubscribe',
  'local-app.aiRealtimeInterruptOutput',
  'local-app.aiRealtimeClose',
  'local-app.agentRealtimeOpen',
  'local-app.agentRealtimeAppendInput',
  'local-app.agentRealtimeSubscribe',
  'local-app.agentRealtimeStatus',
  'local-app.agentRealtimeInterruptOutput',
  'local-app.agentRealtimeClose',
  'local-app.sharedAgentAIConfigGet',
  'local-app.sharedAgentAIConfigOverwrite',
  'local-app.sharedAgentAIConfigLocalOptions',
  'local-app.agentManagerSnapshot',
  'local-app.agentAutonomySnapshot',
  'local-app.agentUpdateAutonomy',
  'local-app.agentPresentationSnapshot',
  'local-app.agentPresentationReadAsset',
  'local-app.agentCommitPresentation',
  'local-app.agentMemoryInspect',
  'local-app.agentMemoryCorrect',
  'local-app.agentMemoryForget',
  'local-app.agentMemorySwitch',
  'local-app.agentMemoryDelete',
  'local-app.realmWorldCoreList',
  'local-app.realmWorldCoreCreate',
  'local-app.realmPersonaCharacterListOwned',
  'local-app.realmPersonaCharacterGetOwned',
  'local-app.realmPersonaCharacterCreate',
  'local-app.realmPersonaCharacterReplace',
  'local-app.realmPersonaCharacterDelete',
  'local-app.realmChatList',
  'local-app.realmRealtimeOpen',
  'local-app.realmRealtimeSubscribe',
  'local-app.realmRealtimeAck',
  'local-app.realmRealtimeSubscriptionClose',
  'local-app.realmRealtimeChannelClose',
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
  'agent-center.avatarAssetImport',
  'agent-center.backgroundImport',
  'agent-center.resourcePackImport',
  'agent-center.resourcePackOpenZhiyu',
  'desktop-open.openIntent',
  'avatar.hostHandoff',
] as const;

describe('local-app public capability behavior', () => {
  it('projects the exact App Access declaration shell set', () => {
    const set = NIMI_STANDARD_SHELL_CAPABILITY_SETS.find(
      (entry) => entry.setId === 'local-app-standard-shell-v1',
    );
    expect(set).toBeDefined();
    expect(set).toMatchObject({
      hostClass: 'protected-local-app-host',
      authBinding: 'runtime_owned_request_empty_local_app_session',
      authorityStatus: 'app_access_declarations_with_protected_operations_unavailable_until_admission',
      allowedOperations: FINAL_LOCAL_APP_OPERATIONS,
    });
    expect(set?.allowedCommands).toEqual(FINAL_LOCAL_APP_OPERATIONS.map(
      (operation) => NIMI_STANDARD_SHELL_COMMANDS[operation],
    ));
    expect(set?.allowedCommands.every((command) => typeof command === 'string' && command.length > 0)).toBe(true);
    expect(set?.plannedOperations).toEqual(expect.arrayContaining([
      'data.pathResolve',
      'config.get',
    ]));
  });

  it('keeps account, auth, lifecycle, OAuth, generic proxy, filesystem and desktop-private operations denied', () => {
    const set = NIMI_STANDARD_SHELL_CAPABILITY_SETS.find(
      (entry) => entry.setId === 'local-app-standard-shell-v1',
    );
    expect(set?.forbiddenOperations).toEqual(expect.arrayContaining([
      'runtime.unary',
      'runtime.streamOpen',
      'runtime-lifecycle.status',
      'auth.sessionLoad',
      'platform-projection.get',
      'file-dialog.open',
      'desktop-private.product-control',
      'electron.raw-ipc',
      'node.raw-fs',
    ]));
    expect(new Set(set?.allowedOperations).size).toBe(FINAL_LOCAL_APP_OPERATIONS.length);
  });
});
