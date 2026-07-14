import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  applyProtectedLocalProtoLinkageFixture,
  loadProtectedLocalProtoLinkageBundle,
  repoRoot,
  validateProtectedLocalProtoLinkage,
} from './check-protected-local-proto-linkage.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(scriptDir, 'testdata', 'protected-local-proto-linkage', 'negative-fixtures.json');
const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8'));

test('repository Proto and 0K migration authority are the positive final LOCAL_APP fixture', () => {
  assert.deepEqual(validateProtectedLocalProtoLinkage(loadProtectedLocalProtoLinkageBundle(repoRoot)), []);
});

test('negative fixtures are independent, current-source mutations with stable expected issues', () => {
  assert.ok(fixtures.length >= 8, 'final public wire needs broad negative coverage');
  assert.equal(new Set(fixtures.map(({ fixture_id: id }) => id)).size, fixtures.length);
  assert.equal(new Set(fixtures.map(({ expected_issue: code }) => code)).size, fixtures.length);
  for (const fixture of fixtures) {
    assert.match(fixture.fixture_id, /^[a-z0-9-]+$/u);
    assert.match(fixture.target, /^(?:proto\/runtime\/v1\/|\.nimi\/spec\/runtime\/kernel\/tables\/)/u);
    assert.match(fixture.expected_issue, /^PLINK_[A-Z0-9_]+$/u);
    assert.equal(fixture.mutation.kind, 'replace_exact');
    assert.match(fixture.mutation.from, /\S/u);
    assert.match(fixture.mutation.to, /\S/u);
    assert.notEqual(fixture.mutation.from, fixture.mutation.to);
  }
});

for (const fixture of fixtures) {
  test(`rejects negative fixture: ${fixture.fixture_id}`, () => {
    const positive = loadProtectedLocalProtoLinkageBundle(repoRoot);
    const mutated = applyProtectedLocalProtoLinkageFixture(positive, fixture);
    const issues = validateProtectedLocalProtoLinkage(mutated);
    assert.ok(
      issues.some(({ code }) => code === fixture.expected_issue),
      `expected ${fixture.expected_issue}; got ${issues.map(({ code }) => code).join(', ')}`,
    );
  });
}
