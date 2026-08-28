import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RUNTIME_AGENT_METHODS,
  RUNTIME_ROOT_AGENT_FACADE_METHODS,
} from './index';

test('Runtime Agent facade exposes only canonical Local App Cognition Memory operations', () => {
  const publicMethods = new Set<string>(RUNTIME_AGENT_METHODS);
  for (const activeMethod of [
    'inspectLocalAppAgentMemory',
    'correctLocalAppAgentMemory',
    'forgetLocalAppAgentMemory',
    'setLocalAppAgentMemoryEnabled',
    'deleteAllLocalAppAgentMemory',
  ]) {
    assert.equal(publicMethods.has(activeMethod), true);
  }
  for (const removedMethod of [
    'inspectAgentMemory',
    'correctAgentMemory',
    'forgetAgentMemory',
    'setAgentMemoryEnabled',
    'deleteAllAgentMemory',
    'queryAgentMemory',
    'writeAgentMemory',
    'getAgentCanonicalMemoryBankStatus',
    'getAgentCanonicalMemoryReviewStatus',
    'requestAgentCanonicalMemoryBankBind',
    'createSourceMaterializationChallenge',
    'beginSourceMaterializationUpload',
    'putSourceMaterializationChunk',
    'commitSourceMaterialization',
    'abortSourceMaterializationUpload',
  ]) {
    assert.equal(publicMethods.has(removedMethod), false);
  }
  assert.deepEqual(RUNTIME_ROOT_AGENT_FACADE_METHODS, ['materializeRealmSource']);
  assert.equal(publicMethods.has('materializeRealmSource'), false);
});
