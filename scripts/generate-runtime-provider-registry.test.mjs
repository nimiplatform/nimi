import assert from 'node:assert/strict';
import test from 'node:test';
import { capabilityFlags } from './generate-runtime-provider-registry.mjs';

test('voice workflow supply follows valid catalog bindings without extension parameters', () => {
  const source = {
    provider: 'voice-fixture', runtime: { runtime_plane: 'remote' },
    defaults: { capabilities: ['VOICE.CREATE'] },
    models: [{ model_id: 'design' }],
    voice_workflow_models: [{ workflow_model_id: 'prompted', workflow_type: 'text_description' }],
    model_workflow_bindings: [{ model_id: 'design', workflow_model_refs: ['prompted'], workflow_types: ['text_description'] }],
  };
  assert.equal(capabilityFlags(source).voiceTextDescription, true);
  assert.equal(capabilityFlags(source).voiceReferenceAudio, false);
  source.model_workflow_bindings = [];
  assert.equal(capabilityFlags(source).voiceTextDescription, false);
  source.model_workflow_bindings = [{ model_id: 'design', workflow_model_refs: ['missing'], workflow_types: ['text_description'] }];
  assert.throws(() => capabilityFlags(source), /invalid voice workflow binding/u);
});
