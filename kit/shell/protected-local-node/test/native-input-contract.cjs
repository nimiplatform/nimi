'use strict';

const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const path = require('node:path');

const crateRoot = path.resolve(__dirname, '..');
const targetRoot = process.env.CARGO_TARGET_DIR
  ? path.resolve(process.env.CARGO_TARGET_DIR)
  : path.join(crateRoot, 'target');
const artifactName = process.platform === 'win32'
  ? 'nimi_shell_protected_local_node.dll'
  : process.platform === 'darwin'
    ? 'libnimi_shell_protected_local_node.dylib'
    : 'libnimi_shell_protected_local_node.so';
const buildProfile = process.argv[2] || 'debug';
assert.ok(['debug', 'release'].includes(buildProfile), 'native contract profile must be debug or release');
assert.ok(process.argv.length <= 3, 'native contract accepts only one build profile');
const addonPath = path.join(targetRoot, buildProfile, artifactName);

assert.ok(existsSync(addonPath), `protected-local Node addon is missing: ${addonPath}`);

const nativeModule = { exports: {} };
process.dlopen(nativeModule, addonPath);
const addon = nativeModule.exports;
assert.equal(typeof addon.localAppSessionRebind, 'function', 'Host-private rebind ABI is present');
assert.equal(typeof addon.desktopLocalDevelopmentRunAccess, 'function', 'Host-private execution access ABI is present');
const agentHandle = 'lah_contract_nonexistent';
const embodimentAgentHandle = `agent_ref_${'A'.repeat(43)}`;
const activityPutInput = {
  key: 'contract-key',
  revision: 1,
  kind: 'todo',
  todoState: 'open',
  attention: false,
  title: 'Contract',
  objectRef: 'contract-object',
  activityType: 'com.example.contract.recorded.v1',
  dataJson: '{"contract":true}',
  occurredAtSeconds: '1790000000',
  occurredAtNanos: 0,
};

const calls = [
  ['desktopLocalDevelopmentRunAccess', {}],
  ['localAppAgentWorkReferenceList', {}],
  ['localAppAgentWorkStart', {}],
  ['localAppAgentWorkGet', {}],
  ['localAppAgentWorkStatus', {}],
  ['localAppAgentWorkToolCallsList', {}],
  ['localAppAgentWorkToolResultSubmit', {}],
  ['localAppAgentWorkCancel', {}],
  ['localAppAgentWorkSubscribe', {}],
  ['localAppIntegrationListCatalog', {}],
  ['localAppIntegrationListConnections', {}],
  ['localAppIntegrationInvoke', {}],
  ['localAppIntegrationGetCall', {}],
  ['localAppIntegrationListCalls', {}],
  ['localAppIntegrationCancelCall', {}],
  ['localAppIntegrationRegisterProvider', {}],
  ['localAppIntegrationUnregisterProvider', {}],
  ['localAppIntegrationPollProvider', {}],
  ['localAppIntegrationCompleteProvider', {}],
  ['localAppIntegrationGetManagement', {}],
  ['localAppIntegrationPutConnection', {}],
  ['localAppIntegrationRemoveConnection', {}],
  ['localAppIntegrationSetPermission', {}],

  ['localAppRealmWorldCreationEligibilityGet'],
  ['localAppRealmWorldCoreGet', { worldId: 'world-1' }],
  ['localAppRealmWorldCoreReplace', { worldId: 'world-1', body: { baseContentHash: 'a'.repeat(64), core: {}, lorebookDeclaration: {}, origin: { kind: 'manual' } } }],
  ['localAppRealmWorldCharacterList', { worldId: 'world-1', take: 10 }],
  ['localAppRealmWorldCharacterGet', { characterId: 'character-1' }],
  ['localAppRealmWorldCharacterCreate', { worldId: 'world-1', body: { profile: {}, lorebookDeclaration: {}, origin: { kind: 'manual' }, worldEntityRef: { kind: 'worldEntity', worldId: 'world-1', entityId: 'entity-1' } } }],
  ['localAppRealmWorldCharacterReplace', { characterId: 'character-1', body: { baseContentHash: 'a'.repeat(64), profile: {}, lorebookDeclaration: {}, origin: { kind: 'manual' }, worldEntityRef: { kind: 'worldEntity', worldId: 'world-1', entityId: 'entity-1' } } }],
  ['localAppRealmWorldEntityList', { worldId: 'world-1', kind: 'person' }],
  ['localAppRealmWorldEntityGet', { entityId: 'entity-1' }],
  ['localAppRealmWorldEntityCreate', { worldId: 'world-1', body: { core: {}, kind: 'person', origin: { kind: 'manual' } } }],
  ['localAppRealmWorldRelationshipList', { worldId: 'world-1', type: 'knows' }],
  ['localAppRealmWorldRelationshipGet', { relationshipId: 'relationship-1' }],
  ['localAppRealmWorldCoreList', { take: 1, visibility: 'private' }],
  ['localAppRealmWorldCoreCreate', {
    body: { core: {}, origin: { kind: 'manual' }, visibility: 'private' },
  }],
  ['localAppConversationOpen', { agentHandle }],
  ['localAppConversationSendTurn', {
    agentHandle,
    conversationAnchorId: 'contract-anchor',
    requestId: 'contract-request',
    parts: [{ kind: 'text', text: 'contract' }],
  }],
  ['localAppConversationAttachmentUpload', {
    agentHandle, conversationAnchorId: 'contract-anchor', mimeType: 'image/png',
    displayName: 'contract.png', bytes: Buffer.from([1]),
  }],
  ['localAppConversationArtifactRead', {
    agentHandle, conversationAnchorId: 'contract-anchor', artifactId: 'artifact-contract',
  }],
  ['localAppConversationVoiceTranscribe', {
    agentHandle, conversationAnchorId: 'contract-anchor', requestId: 'voice-contract',
    mimeType: 'audio/webm', audioBytes: Buffer.from([1]),
  }],
  ['localAppConversationVoiceRender', {
    agentHandle, conversationAnchorId: 'contract-anchor', messageId: 'message-contract',
    requestId: 'voice-render-contract',
  }],
  ['localAppConversationInterruptTurn', { agentHandle, conversationAnchorId: 'contract-anchor' }],
  ['localAppConversationSnapshot', { agentHandle, conversationAnchorId: 'contract-anchor' }],
  ['localAppConversationSubscribe', { agentHandle, conversationAnchorId: 'contract-anchor' }],
  ['localAppEmbodimentSnapshot', {
    agentHandle: embodimentAgentHandle, conversationAnchorId: 'contract-anchor',
  }],
  ['localAppEmbodimentSubscribe', {
    agentHandle: embodimentAgentHandle, conversationAnchorId: 'contract-anchor', afterSequence: '0',
  }],
  ['localAppActivityPut', activityPutInput],
  ['localAppActivityList', {
    kind: 'todo', todoStates: ['open'], occurredAfterSeconds: '1790000000', occurredAfterNanos: 0, pageSize: 50,
  }],
  ['localAppActivitySubscribe', { afterChangeSeq: '0' }],
  ['localAppActivityMarkRead', { activityId: 'act_contract', displayedRevision: 1 }],
  ['localAppActivityOpen', { activityId: 'act_contract' }],
  ['localAppActivityOpenRequestsSubscribe'],
  ['localAppActivityOpenRequestComplete', { deliveryId: 'aod_contract', completion: 'opened' }],
  ['localAppAgentManagerSnapshot', { agentHandle, conversationAnchorId: 'contract-anchor' }],
  ['localAppAgentMemoryInspect', { agentHandle, limit: 2, pageToken: 'opaque-page-2' }],
  ['localAppAgentMemoryCorrect', { agentHandle, memoryId: 'memory-contract', correctedContent: 'corrected' }],
  ['localAppAgentMemoryForget', { agentHandle, memoryIds: ['memory-contract'], confirmed: true }],
  ['localAppAgentMemorySwitch', { agentHandle, enabled: false }],
  ['localAppAgentMemoryDelete', { agentHandle, confirmed: true }],
];

async function main() {
  assert.throws(
    () => addon.localAppRealmWorldRelationshipList({ worldId: 'world-1', type: 123 }),
    /String|string/u,
    'the Rust raw identifier r#type must expose the declared JavaScript type field',
  );
  assert.equal(
    typeof addon.desktopFirstPartyProductUnaryCancel,
    'function',
    'desktopFirstPartyProductUnaryCancel export is missing',
  );
  const invalidUnaryCancellation = await addon.desktopFirstPartyProductUnaryCancel({
    requestId: '',
  });
  assert.equal(invalidUnaryCancellation?.status, 'error');
  assert.equal(invalidUnaryCancellation?.reasonCode, 'runtime-service-untrusted');
  assert.equal(
    typeof addon.desktopFirstPartyProductUnaryRelease,
    'function',
    'desktopFirstPartyProductUnaryRelease export is missing',
  );
  const invalidUnaryRelease = await addon.desktopFirstPartyProductUnaryRelease({ requestId: '' });
  assert.equal(invalidUnaryRelease?.status, 'error');
  assert.equal(invalidUnaryRelease?.reasonCode, 'runtime-service-untrusted');
  assert.equal(
    typeof addon.localAppConversationVoiceTranscribeCancel,
    'function',
    'localAppConversationVoiceTranscribeCancel export is missing',
  );
  const voiceCancellation = await addon.localAppConversationVoiceTranscribeCancel({
    requestId: 'voice-cancel-contract',
  });
  assert.equal(voiceCancellation?.status, 'ok');
  assert.equal(voiceCancellation?.value?.canceled, true);
  for (const name of ['localAppScenarioExecuteCancel', 'localAppScenarioExecuteRelease']) {
    assert.equal(typeof addon[name], 'function', `${name} export is missing`);
  }
  assert.throws(
    () => addon.localAppScenarioExecute({ spec: { type: 'text-embed', inputs: ['x'] } }),
    /Missing field `requestId`/u,
    'localAppScenarioExecute must take the Host-generated requestId',
  );
  for (const input of [
    { spec: {}, requestId: '' },
    { spec: {}, requestId: 'contract-execute', timeoutMs: 0 },
    { spec: {}, requestId: 'contract-execute', timeoutMs: 120001 },
    { spec: {}, requestId: 'contract-execute', timeoutMs: 1.5 },
  ]) {
    const outcome = await addon.localAppScenarioExecute(input);
    assert.equal(outcome?.status, 'error');
    assert.equal(outcome?.reasonCode, 'invalid-payload', 'an invalid call identity or deadline must fail before transport');
  }
  const executeCancellation = await addon.localAppScenarioExecuteCancel({ requestId: 'contract-execute-cancel' });
  assert.equal(executeCancellation?.status, 'ok');
  assert.equal(executeCancellation?.value?.canceled, true);
  const executeRelease = await addon.localAppScenarioExecuteRelease({ requestId: 'contract-execute-cancel' });
  assert.equal(executeRelease?.status, 'ok');
  assert.equal(executeRelease?.value?.released, true);
  const invalidExecuteCancellation = await addon.localAppScenarioExecuteCancel({ requestId: 'has space' });
  assert.equal(invalidExecuteCancellation?.reasonCode, 'invalid-payload');

  for (const retired of [
    'localAppAgentConfigurationSnapshot',
    'localAppAgentUpdateConfiguration',
    'localAppAgentReadinessSnapshot',
    'localAppAgentAIProfilePreview',
    'localAppAgentAIProfileApply',
    'localAppArtifactPut',
    'localAppArtifactReadBytes',
    'localAppSharedAgentAIProfilePreview',
    'localAppSharedAgentAIProfileApply',
  ]) {
    assert.equal(addon[retired], undefined, `${retired} must remain hard-cut`);
  }
  for (const name of [
    'desktopFocusLocalDevelopmentHost',
    'localAppScenarioExecute',
    'localAppScenarioExecuteCancel',
    'localAppScenarioExecuteRelease',
    'localAppScenarioJobSubmit',
    'localAppScenarioJobGet',
    'localAppScenarioJobCancel',
    'localAppArtifactRead',
    'localAppArtifactUpload',
    'localAppVoiceAssetsList',
    'localAppTextTurnSubscribe',
    'localAppTextTurnStreamNext',
    'localAppTextTurnStreamClose',
    'localAppScenarioJobSubscribe',
    'localAppScenarioJobStreamNext',
    'localAppScenarioJobStreamClose',
    'localAppAssetReveal',
    'localAppAIConfigOverwrite',
    'localAppAIConfigLocalOptions',
    'localAppSharedAgentAIConfigGet',
    'localAppSharedAgentAIConfigOverwrite',
    'localAppSharedAgentAIConfigLocalOptions',
    'localAppEmbodimentSnapshot',
    'localAppEmbodimentSubscribe',
    'localAppActivityPut',
    'localAppActivityList',
    'localAppActivitySubscribe',
    'localAppActivityMarkRead',
    'localAppActivityOpen',
    'localAppActivityOpenRequestsSubscribe',
    'localAppActivityOpenRequestComplete',
    'localAppRealtimeStreamNext',
    'localAppRealtimeStreamClose',
  ]) {
    assert.equal(typeof addon[name], 'function', `${name} export is missing`);
  }
  const { occurredAtSeconds: _occurredAtSeconds, ...putWithoutSeconds } = activityPutInput;
  const focus = await addon.desktopFocusLocalDevelopmentHost({ supervisorRunId: 'invalid' });
  assert.equal(focus.status, 'error');
  assert.equal(focus.reasonCode, 'runtime-service-untrusted', 'an invalid focus selector must fail before transport');
  assert.throws(
    () => addon.localAppActivityPut(putWithoutSeconds),
    /Missing field `occurredAtSeconds`/u,
    'localAppActivityPut must take the decimal occurredAtSeconds field',
  );
  const { activityType, ...putWithRendererTypeName } = activityPutInput;
  assert.throws(
    () => addon.localAppActivityPut({ ...putWithRendererTypeName, type: activityType }),
    /Missing field `activityType`/u,
    'localAppActivityPut must take activityType rather than the renderer type field',
  );
  for (const [name, input] of [
    ['localAppActivityPut', { ...activityPutInput, revision: 1.5 }],
    ['localAppActivityPut', { ...activityPutInput, revision: 2 ** 53 }],
    ['localAppActivityPut', { ...activityPutInput, occurredAtSeconds: '01' }],
    ['localAppActivityPut', { ...activityPutInput, occurredAtNanos: 1_000_000_000 }],
    ['localAppActivityList', { todoStates: [], occurredBeforeSeconds: '1', pageSize: 1 }],
    ['localAppActivitySubscribe', { afterChangeSeq: '01' }],
    ['localAppActivityMarkRead', { activityId: 'act_contract', displayedRevision: 0 }],
  ]) {
    const outcome = await addon[name](input);
    assert.equal(outcome?.status, 'error', `${name} must reject a malformed numeric input`);
    assert.equal(outcome?.reasonCode, 'invalid-payload', `${name} must reject before transport`);
  }
  assert.equal(typeof addon.localAppAIConfigGet, 'function', 'localAppAIConfigGet export is missing');
  const aiConfigGet = addon.localAppAIConfigGet();
  assert.equal(typeof aiConfigGet?.then, 'function', 'localAppAIConfigGet must return a Promise');
  const aiConfigOutcomes = [
    addon.localAppAIConfigOverwrite({ expectedRevision: '0', capabilities: [] }),
    addon.localAppAIConfigLocalOptions({
      kind: 'local-loadouts', capabilityContract: 'text.generate', search: '',
    }),
    addon.localAppSharedAgentAIConfigGet(),
    addon.localAppSharedAgentAIConfigOverwrite({ expectedRevision: '0', capabilities: [] }),
    addon.localAppSharedAgentAIConfigLocalOptions({
      kind: 'cloud-connectors', capabilityContract: 'text.generate', search: '',
    }),
  ];
  for (const outcome of aiConfigOutcomes) {
    assert.equal(typeof outcome?.then, 'function', 'AIConfig native operation must return a Promise');
  }
  const outcomes = [aiConfigGet, ...aiConfigOutcomes, ...calls.map(([name, input]) => {
    assert.equal(typeof addon[name], 'function', `${name} export is missing`);
    let operation;
    assert.doesNotThrow(() => {
      operation = addon[name](input);
    }, `${name} must accept the canonical JS agentHandle field`);
    assert.equal(typeof operation?.then, 'function', `${name} must return a Promise`);
    return operation;
  })];

  for (const outcome of await Promise.all(outcomes)) {
    assert.equal(outcome?.status, 'error', 'unavailable protected operations must fail closed');
    assert.equal(typeof outcome.reasonCode, 'string');
    assert.ok(outcome.reasonCode.length > 0);
  }

  assert.equal(typeof addon.localAppConversationToolCallsList, 'undefined');
  assert.equal(typeof addon.localAppConversationToolResultSubmit, 'undefined');
  assert.equal((await addon.localAppConversationSendTurn({ agentHandle, conversationAnchorId: 'anchor', requestId: 'req', parts: [{ kind: 'text', text: 'business' }], work: {} })).reasonCode, 'invalid-payload');

  const removedInputs = [
    ['localAppConversationOpen', { selectedAgentHandle: agentHandle }],
    ['localAppConversationSendTurn', {
      selectedAgentHandle: agentHandle,
      conversationAnchorId: 'contract-anchor',
      requestId: 'contract-request',
      text: 'contract',
    }],
    ['localAppConversationInterruptTurn', {
      selectedAgentHandle: agentHandle,
      conversationAnchorId: 'contract-anchor',
    }],
    ['localAppConversationSnapshot', {
      selectedAgentHandle: agentHandle,
      conversationAnchorId: 'contract-anchor',
    }],
    ['localAppConversationSubscribe', {
      selectedAgentHandle: agentHandle,
      conversationAnchorId: 'contract-anchor',
    }],
  ];
  for (const [name, input] of removedInputs) {
    if (name === 'localAppConversationSendTurn') {
      assert.equal((await addon[name](input)).reasonCode, 'invalid-payload');
      continue;
    }
    assert.throws(
      () => addon[name](input),
      /Missing field `agentHandle`/u,
      `${name} must not retain selectedAgentHandle as a compatibility alias`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
