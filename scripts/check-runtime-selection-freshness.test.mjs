import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateSelectionMetadata } from './check-runtime-selection-freshness.mjs';

const source = () => [{ provider: 'fixture', doc: { provider: 'fixture', runtime: { inventory_mode: 'static_source' }, defaults: { default_text_model: 'model' }, models: [{ model_id: 'model', capabilities: ['text.generate'] }], selection_profiles: [{ profile_id: 'text.general', capability: 'text.generate', model_id: 'model', reviewed_at: '2026-10-01', freshness_sla_days: 21 }] } }];
const snapshot = async () => ({ default_text_model: 'model' });

test('expiry is visible maintenance and preserves metadata correctness and saved dates', async () => {
  const input = source();
  const before = structuredClone(input);
  assert.deepEqual(await evaluateSelectionMetadata(input, snapshot, new Date('2026-10-22T23:59:59Z')), { failures: [], expiredReviews: [] });
  const expired = await evaluateSelectionMetadata(input, snapshot, new Date('2026-10-23T00:00:00Z'));
  assert.equal(expired.failures.length, 0);
  assert.equal(expired.expiredReviews.length, 1);
  assert.deepEqual(input, before);
});

test('expired metadata still rejects nonexistent models, wrong capabilities and projection drift', async () => {
  for (const mutation of [
    doc => { doc.models = []; },
    doc => { doc.models[0].capabilities = ['text.embed']; },
    doc => { doc.selection_profiles.push({ ...doc.selection_profiles[0] }); },
  ]) {
    const input = source(); mutation(input[0].doc);
    const result = await evaluateSelectionMetadata(input, snapshot, new Date('2026-10-28T00:00:00Z'));
    assert.ok(result.failures.length > 0);
    assert.ok(result.expiredReviews.length > 0);
  }
  const result = await evaluateSelectionMetadata(source(), async () => ({ default_text_model: 'other' }), new Date('2026-10-28T00:00:00Z'));
  assert.ok(result.failures.some(value => value.includes('does not match')));
});
