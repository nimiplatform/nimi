import assert from 'node:assert/strict';
import test from 'node:test';
import { capabilityFlags } from './generate-runtime-provider-registry.mjs';

test('static inventory preserves reviewed custom-catalog capabilities without fake model rows', () => {
  const source = { provider: 'scoped-fixture', runtime: { inventory_mode: 'static_source', capabilities: ['text.generate', 'text.embed'] }, models: [{ model_id: 'chat', capabilities: ['text.generate'] }] };
  assert.equal(capabilityFlags(source).text, true);
  assert.equal(capabilityFlags(source).embed, true);
  assert.equal(source.models.length, 1);
  source.runtime.capabilities = ['text.embed'];
  assert.throws(() => capabilityFlags(source), /omits model capability text.generate/u);
  source.runtime.capabilities = ['text.generate', 'invented'];
  assert.throws(() => capabilityFlags(source), /unique canonical capability tokens/u);
  source.runtime.capabilities = ['text.generate', 'text.generate'];
  assert.throws(() => capabilityFlags(source), /unique canonical capability tokens/u);
  source.runtime = { inventory_mode: 'dynamic_endpoint', capabilities: ['text.generate'], dynamic_inventory: { discovery_transport: 'connector_list_models', cache_ttl_sec: 300, selection_mode: 'pass_through', failure_policy: 'fail_closed', allowed_capabilities: ['text.generate'] } };
  source.models = [];
  assert.throws(() => capabilityFlags(source), /only supported for static_source/u);
});

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
