import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

import {
  authorityPaths,
  loadAuthorityBundle,
  validateLocalDevelopmentAuthority,
} from './check-local-development-admission-authority.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(scriptDir, 'testdata', 'local-development-admission-authority');

function setPath(root, dottedPath, value) {
  const segments = dottedPath.split('.').map((segment) => /^\d+$/u.test(segment) ? Number(segment) : segment);
  let cursor = root;
  for (const segment of segments.slice(0, -1)) cursor = cursor[segment];
  cursor[segments.at(-1)] = value;
}

function applyNegativeFixture(bundle, fixture) {
  const document = YAML.parse(bundle[fixture.target]);
  for (const mutation of fixture.mutations) setPath(document, mutation.path, mutation.value);
  return { ...bundle, [fixture.target]: YAML.stringify(document) };
}

test('local-development admission authority is complete and internally bounded', () => {
  assert.deepEqual(validateLocalDevelopmentAuthority(loadAuthorityBundle()), []);
});

for (const filename of fs.readdirSync(fixtureDir).filter((entry) => entry.endsWith('.yaml')).sort()) {
  test(`independent negative fixture is rejected: ${filename}`, () => {
    const fixture = YAML.parse(fs.readFileSync(path.join(fixtureDir, filename), 'utf8'));
    const bundle = applyNegativeFixture(loadAuthorityBundle(), fixture);
    const issues = validateLocalDevelopmentAuthority(bundle);
    assert.ok(
      issues.some((entry) => entry.code === fixture.expected_issue),
      `expected ${fixture.expected_issue}, got ${issues.map((entry) => entry.code).join(', ')}`,
    );
  });
}

test('gate rejects loss of required v2 prose rather than accepting a machine-table-only claim', () => {
  const bundle = loadAuthorityBundle();
  bundle.platform = bundle.platform.replace('The global Developer Mode toggle grants nothing.', 'The toggle determines project authority.');
  const issues = validateLocalDevelopmentAuthority(bundle);
  assert.ok(issues.some((entry) => entry.code === 'LOCAL_DEVELOPMENT_AUTHORITY_CLAUSE_MISSING'));
});

test('gate rejects a missing selected RuntimeAgent carrier row', () => {
  const bundle = loadAuthorityBundle();
  const matrix = YAML.parse(bundle.transportMatrix);
  matrix.methods = matrix.methods.filter((row) => row.method_id !== '/nimi.runtime.v1.RuntimeAgentService/OpenConversationAnchor');
  const issues = validateLocalDevelopmentAuthority({ ...bundle, transportMatrix: YAML.stringify(matrix) });
  assert.ok(issues.some((entry) => entry.code === 'LOCAL_DEVELOPMENT_SELECTED_OPERATION_INVALID'));
});

test('gate rejects Desktop/runtime role drift independently of the transport matrix', () => {
  const bundle = loadAuthorityBundle();
  const auth = YAML.parse(bundle.rpcAuth);
  const row = auth.methods.find((entry) => entry.method_id.endsWith('/SetDeveloperMode'));
  row.required_origin_role = 'desktop_account_host';
  const issues = validateLocalDevelopmentAuthority({ ...bundle, rpcAuth: YAML.stringify(auth) });
  assert.ok(issues.some((entry) => entry.code === 'LOCAL_DEVELOPMENT_RPC_AUTH_INVALID'));
});

test('authority paths remain canonical spec files', () => {
  for (const relative of Object.values(authorityPaths)) assert.match(relative, /^\.nimi\/spec\//u);
});
