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
const addonPath = path.join(targetRoot, 'debug', artifactName);

assert.ok(existsSync(addonPath), `protected-local Node addon is missing: ${addonPath}`);

const nativeModule = { exports: {} };
process.dlopen(nativeModule, addonPath);
const addon = nativeModule.exports;
const agentHandle = 'lah_contract_nonexistent';

const calls = [
  ['localAppAIConfigOverwrite', { capabilities: [] }],
  ['localAppRealmWorldCoreList', { take: 1, visibility: 'private' }],
  ['localAppRealmWorldCoreCreate', {
    body: { core: {}, origin: { kind: 'manual' }, visibility: 'private' },
  }],
  ['localAppConversationOpen', { agentHandle }],
  ['localAppConversationSendTurn', {
    agentHandle,
    conversationAnchorId: 'contract-anchor',
    requestId: 'contract-request',
    text: 'contract',
  }],
  ['localAppConversationInterruptTurn', { agentHandle, conversationAnchorId: 'contract-anchor' }],
  ['localAppConversationSnapshot', { agentHandle, conversationAnchorId: 'contract-anchor' }],
  ['localAppConversationSubscribe', { agentHandle, conversationAnchorId: 'contract-anchor' }],
];

async function main() {
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
    'localAppScenarioExecute',
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
  ]) {
    assert.equal(typeof addon[name], 'function', `${name} export is missing`);
  }
  assert.equal(typeof addon.localAppAIConfigGet, 'function', 'localAppAIConfigGet export is missing');
  const aiConfigGet = addon.localAppAIConfigGet();
  assert.equal(typeof aiConfigGet?.then, 'function', 'localAppAIConfigGet must return a Promise');
  const outcomes = [aiConfigGet, ...calls.map(([name, input]) => {
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
