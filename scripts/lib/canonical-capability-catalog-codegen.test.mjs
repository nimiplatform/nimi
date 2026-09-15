import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import YAML from 'yaml';
import {
  renderCanonicalCapabilityCatalogArtifacts,
  renderCanonicalCapabilityCatalogModule,
  validateCanonicalCapabilityCatalog,
} from './canonical-capability-catalog-codegen.mjs';

function catalog() {
  return YAML.parse(fs.readFileSync(new URL('../../config/platform-canonical-capability-catalog.yaml', import.meta.url), 'utf8'));
}

test('canonical catalog rejects execution selectors instead of silently dropping them', () => {
  for (const field of ['provider', 'model', 'engine', 'route', 'bindingPreference']) {
    const value = catalog();
    value.capabilities[0][field] = 'not-catalog-owned';
    assert.ok(validateCanonicalCapabilityCatalog(value).errors.some((error) => error.includes(field)), field);
    assert.throws(() => renderCanonicalCapabilityCatalogModule(value), /invalid canonical capability catalog/);
  }
});

test('canonical catalog rejects unknown nested fields and malformed field mappings', () => {
  for (const field of ['sourceRef', 'i18nKeys', 'governance']) {
    const value = catalog();
    value.capabilities[0][field].provider = 'not-catalog-owned';
    assert.ok(validateCanonicalCapabilityCatalog(value).errors.some((error) => error.includes(field + '.provider')), field);
    value.capabilities[0][field] = [];
    assert.ok(validateCanonicalCapabilityCatalog(value).errors.length > 0, field);
  }
  const value = catalog();
  value.capabilities[0].additionalRuntimeTables = [{ table: 'local-adapter-routing', capability: 'text.generate', model: 'not-catalog-owned' }];
  assert.ok(validateCanonicalCapabilityCatalog(value).errors.some((error) => error.includes('additionalRuntimeTables[0].model')));
});

test('canonical catalog preserves valid rows and requires an explicit editor kind', () => {
  const value = catalog();
  assert.deepEqual(validateCanonicalCapabilityCatalog(value).errors, []);
  delete value.capabilities[0].editorKind;
  assert.ok(validateCanonicalCapabilityCatalog(value).errors.some((error) => error.includes('editorKind')));
});

test('App Tools identities follow active catalog additions without promoting deferred entries', async () => {
  const value = catalog();
  value.capabilities.push({ ...structuredClone(value.capabilities[0]), capabilityId: 'example.analyze' });
  value.deferred.push({ capability: 'example.deferred', table: 'provider-capabilities', reason: 'Not admitted', source_rule: 'P-CAPCAT-003' });
  const artifacts = renderCanonicalCapabilityCatalogArtifacts(value);
  const projection = artifacts.find((artifact) => artifact.path === 'app-tools/lib/canonical-capability-ids.generated.mjs');
  const { CANONICAL_CAPABILITY_IDS } = await import('data:text/javascript,' + encodeURIComponent(projection.content));
  assert.deepEqual(new Set(CANONICAL_CAPABILITY_IDS), new Set(value.capabilities.map((row) => row.capabilityId)));
  assert.equal(CANONICAL_CAPABILITY_IDS.includes('example.deferred'), false);
  assert.equal(Object.isFrozen(CANONICAL_CAPABILITY_IDS), true);
});
