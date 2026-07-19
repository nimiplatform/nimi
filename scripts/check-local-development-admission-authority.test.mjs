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

test('gate rejects manifest permission requirements that claim positive authority', () => {
  const bundle = loadAuthorityBundle();
  const policy = YAML.parse(bundle.policy);
  policy.permission_requirements.creates_scoped_binding = true;
  const issues = validateLocalDevelopmentAuthority({ ...bundle, policy: YAML.stringify(policy) });
  assert.ok(issues.some((entry) => entry.code === 'LOCAL_DEVELOPMENT_PERMISSION_REQUIREMENTS_INVALID'));
});

test('gate rejects a shared Windows app-owned Electron data directory', () => {
  const bundle = loadAuthorityBundle();
  const policy = YAML.parse(bundle.policy);
  policy.electron_user_data_partition.platform_roots.windows = 'shared_electron_default_user_data';
  const issues = validateLocalDevelopmentAuthority({ ...bundle, policy: YAML.stringify(policy) });
  assert.ok(issues.some((entry) => entry.code === 'LOCAL_DEVELOPMENT_USER_DATA_PARTITION_INVALID'));
});

test('gate rejects a missing app-private storage carrier row', () => {
  const bundle = loadAuthorityBundle();
  const matrix = YAML.parse(bundle.transportMatrix);
  matrix.methods = matrix.methods.filter((row) => row.method_id !== '/nimi.runtime.v1.RuntimeAppService/WriteLocalAppStorageJson');
  const issues = validateLocalDevelopmentAuthority({ ...bundle, transportMatrix: YAML.stringify(matrix) });
  assert.ok(issues.some((entry) => entry.code === 'LOCAL_DEVELOPMENT_BASE_SURFACE_INVALID'));
});

test('gate rejects exposing a protected Agent operation on the local-app carrier', () => {
  const bundle = loadAuthorityBundle();
  const matrix = YAML.parse(bundle.transportMatrix);
  matrix.methods.push({
    method_id: '/nimi.runtime.v1.RuntimeAgentService/OpenConversationAnchor',
    operation_class: 'local_app_agent_conversation',
    allowed_transport_classes: ['local_app_host'],
    required_origin_roles: ['local_app_session'],
    request_may_select_role: false,
    portable_session_allowed: false,
    public_tcp_disposition: 'deny',
    generic_proxy: 'forbidden',
  });
  const issues = validateLocalDevelopmentAuthority({ ...bundle, transportMatrix: YAML.stringify(matrix) });
  assert.ok(issues.some((entry) => entry.code === 'LOCAL_DEVELOPMENT_PROTECTED_OPERATION_EXPOSED'));
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
