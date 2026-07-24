#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const fixturePath = path.join(scriptDir, 'testdata/public-raw-token-authority/negative-fixtures.json');
const paths = {
  accountContract: 'docs/authority/runtime-protected-session-rationale.md',
  accountMatrix: '.nimi/spec/runtime/kernel/tables/account-rpc-permission-matrix.yaml',
  protectedMatrix: '.nimi/spec/runtime/kernel/tables/protected-local-rpc-transport-matrix.yaml',
  identityAccess: '.nimi/spec/runtime/kernel/tables/runtime-rpc-auth-posture/identity-access.yaml',
  rpcMethods: 'config/runtime-rpc-methods.yaml',
  rpcMigration: '.nimi/spec/runtime/kernel/tables/rpc-migration-map/methods-identity-app.yaml',
  appRegistry: '.nimi/spec/platform/kernel/tables/nimi-app-registry.yaml',
  sdkMethodGroups: '.nimi/spec/sdks/kernel/tables/runtime-method-groups.yaml',
  avatarAcceptance: '.nimi/spec/avatar/kernel/tables/acceptance-recording-matrix.yaml',
};
const accountMethodID = '/nimi.runtime.v1.RuntimeAccountService/GetAccessToken';
const refreshMethodID = '/nimi.runtime.v1.RuntimeAccountService/RefreshAccountSession';

function issue(code, target, reason) {
  return { code, target, reason };
}

function loadBundle() {
  return new Map(Object.values(paths).map((relative) => [
    relative,
    fs.readFileSync(path.join(repoRoot, relative), 'utf8'),
  ]));
}

function parseYaml(bundle, relative, issues) {
  const source = bundle.get(relative);
  try {
    return YAML.parse(source);
  } catch {
    issues.push(issue('PUBLIC_RAW_TOKEN_AUTHORITY_YAML_INVALID', relative, 'Raw-token authority YAML is invalid.'));
    return null;
  }
}

function hasMethod(rows, methodID) {
  return (rows ?? []).some((row) => row?.method_id === methodID);
}

function findServiceMethod(table, serviceName, methodName) {
  const service = table?.services?.find((row) => row?.name === serviceName);
  return service?.methods?.find((row) => row?.name === methodName);
}

function validateBundle(bundle) {
  const issues = [];
  const accountMatrix = parseYaml(bundle, paths.accountMatrix, issues);
  if (
    accountMatrix?.surfaces?.includes('GetAccessToken')
    || (accountMatrix?.callers ?? []).some((caller) => Object.hasOwn(caller?.methods ?? {}, 'GetAccessToken'))
  ) {
    issues.push(issue('PUBLIC_RAW_TOKEN_ACCOUNT_SURFACE_PRESENT', paths.accountMatrix, 'GetAccessToken remains in the account caller-admission surface.'));
  }
  if (
    accountMatrix?.surfaces?.includes('RefreshAccountSession')
    || (accountMatrix?.callers ?? []).some((caller) => Object.hasOwn(caller?.methods ?? {}, 'RefreshAccountSession'))
  ) {
    issues.push(issue('PUBLIC_REFRESH_ACCOUNT_SURFACE_PRESENT', paths.accountMatrix, 'RefreshAccountSession remains in the account caller-admission surface.'));
  }

  const protectedMatrix = parseYaml(bundle, paths.protectedMatrix, issues);
  if (hasMethod(protectedMatrix?.methods, accountMethodID)) {
    issues.push(issue('PUBLIC_RAW_TOKEN_TRANSPORT_SURFACE_PRESENT', paths.protectedMatrix, 'GetAccessToken remains in protected transport admission.'));
  }
  if (hasMethod(protectedMatrix?.methods, refreshMethodID)) {
    issues.push(issue('PUBLIC_REFRESH_TRANSPORT_SURFACE_PRESENT', paths.protectedMatrix, 'RefreshAccountSession remains in protected transport admission.'));
  }

  const identity = parseYaml(bundle, paths.identityAccess, issues);
  if (hasMethod(identity?.methods, accountMethodID)) {
    issues.push(issue('PUBLIC_RAW_TOKEN_IDENTITY_SURFACE_PRESENT', paths.identityAccess, 'GetAccessToken remains in RPC identity posture.'));
  }
  if (hasMethod(identity?.methods, refreshMethodID)) {
    issues.push(issue('PUBLIC_REFRESH_IDENTITY_SURFACE_PRESENT', paths.identityAccess, 'RefreshAccountSession remains in RPC identity posture.'));
  }

  const rpcMethods = parseYaml(bundle, paths.rpcMethods, issues);
  if (findServiceMethod(rpcMethods, 'RuntimeAccountService', 'GetAccessToken')) {
    issues.push(issue('PUBLIC_RAW_TOKEN_RPC_SURFACE_PRESENT', paths.rpcMethods, 'GetAccessToken remains in the Runtime RPC method projection.'));
  }
  if (findServiceMethod(rpcMethods, 'RuntimeAccountService', 'RefreshAccountSession')) {
    issues.push(issue('PUBLIC_REFRESH_RPC_SURFACE_PRESENT', paths.rpcMethods, 'RefreshAccountSession remains in the Runtime RPC method projection.'));
  }

  const migration = parseYaml(bundle, paths.rpcMigration, issues);
  if ((migration?.method_mappings ?? []).some((row) => row?.design_method === 'GetAccessToken' || row?.proto_method === 'GetAccessToken')) {
    issues.push(issue('PUBLIC_RAW_TOKEN_MIGRATION_SURFACE_PRESENT', paths.rpcMigration, 'GetAccessToken remains in the active RPC migration map.'));
  }
  if ((migration?.method_mappings ?? []).some((row) => row?.design_method === 'RefreshAccountSession' || row?.proto_method === 'RefreshAccountSession')) {
    issues.push(issue('PUBLIC_REFRESH_MIGRATION_SURFACE_PRESENT', paths.rpcMigration, 'RefreshAccountSession remains in the active RPC migration map.'));
  }

  const registry = parseYaml(bundle, paths.appRegistry, issues);
  if (JSON.stringify(registry).includes('account.raw-token')) {
    issues.push(issue('PUBLIC_RAW_TOKEN_CAPABILITY_FORBIDDEN', paths.appRegistry, 'Platform registry still grants account.raw-token.'));
  }

  const methodGroups = parseYaml(bundle, paths.sdkMethodGroups, issues);
  const accountGroup = methodGroups?.groups?.find((row) => row?.group === 'account_service_projection');
  if (accountGroup?.methods?.includes('GetAccessToken') || accountGroup?.excluded?.some((row) => row?.name === 'GetAccessToken')) {
    issues.push(issue('PUBLIC_RAW_TOKEN_SDK_EXPORT_FORBIDDEN', paths.sdkMethodGroups, 'SDK account projection retains GetAccessToken in an active or excluded method group.'));
  }
  if (accountGroup?.methods?.includes('RefreshAccountSession') || accountGroup?.excluded?.some((row) => row?.name === 'RefreshAccountSession')) {
    issues.push(issue('PUBLIC_REFRESH_SDK_EXPORT_FORBIDDEN', paths.sdkMethodGroups, 'SDK account projection retains RefreshAccountSession in an active or excluded method group.'));
  }

  const avatar = parseYaml(bundle, paths.avatarAcceptance, issues);
  const absent = avatar?.scenarios?.find((row) => row?.id === 'public_raw_token_surface_absent');
  if (avatar?.scenarios?.some((row) => row?.id === 'first_party_raw_token_posture') || !absent || absent.mode !== 'degraded') {
    issues.push(issue('PUBLIC_RAW_TOKEN_AVATAR_ACCEPTANCE_FORBIDDEN', paths.avatarAcceptance, 'Avatar acceptance must prove public token-surface absence.'));
  }

  const accountContract = bundle.get(paths.accountContract) ?? '';
  if (!/Public `GetAccessToken` and `RefreshAccountSession` have been removed from\s+the public protocol/iu.test(accountContract)) {
    issues.push(issue('PUBLIC_RAW_TOKEN_CANONICAL_CLAUSE_REQUIRED', paths.accountContract, 'Runtime account authority must state public GetAccessToken and RefreshAccountSession removal.'));
  }

  return issues;
}

function applyFixture(bundle, fixture) {
  const source = bundle.get(fixture.path);
  if (typeof source !== 'string') throw new Error(`fixture target missing: ${fixture.fixture_id}`);
  const mutation = fixture.mutation;
  if (!mutation || typeof mutation !== 'object') {
    throw new Error(`fixture ${fixture.fixture_id} is missing a semantic mutation`);
  }

  if (mutation.kind === 'markdown_weaken_public_removal') {
    const pattern = /Public `GetAccessToken` and `RefreshAccountSession` have been removed from\s+the public protocol/iu;
    if (!pattern.test(source)) throw new Error(`fixture ${fixture.fixture_id} canonical clause is absent`);
    bundle.set(fixture.path, source.replace(pattern, 'Public `GetAccessToken` has no public protocol'));
    return;
  }

  const document = YAML.parse(source);
  if (mutation.kind === 'yaml_append') {
    const target = mutation.path.reduce((value, segment) => value?.[segment], document);
    if (!Array.isArray(target)) throw new Error(`fixture ${fixture.fixture_id} target is not an array`);
    target.push(structuredClone(mutation.value));
  } else if (mutation.kind === 'yaml_append_to_match') {
    const rows = mutation.path.reduce((value, segment) => value?.[segment], document);
    if (!Array.isArray(rows)) throw new Error(`fixture ${fixture.fixture_id} row target is not an array`);
    const matches = rows.filter((row) => row?.[mutation.match.field] === mutation.match.value);
    if (matches.length !== 1 || !Array.isArray(matches[0]?.[mutation.field])) {
      throw new Error(`fixture ${fixture.fixture_id} must resolve one array field`);
    }
    matches[0][mutation.field].push(structuredClone(mutation.value));
  } else if (mutation.kind === 'yaml_set_on_match') {
    const rows = mutation.path.reduce((value, segment) => value?.[segment], document);
    if (!Array.isArray(rows)) throw new Error(`fixture ${fixture.fixture_id} row target is not an array`);
    const matches = rows.filter((row) => row?.[mutation.match.field] === mutation.match.value);
    if (matches.length !== 1) throw new Error(`fixture ${fixture.fixture_id} must resolve one row`);
    matches[0][mutation.field] = structuredClone(mutation.value);
  } else {
    throw new Error(`fixture ${fixture.fixture_id} has unknown mutation kind: ${mutation.kind}`);
  }
  bundle.set(fixture.path, YAML.stringify(document));
}

function runNegativeFixtures(baseline) {
  const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  return fixtures.map((fixture) => {
    const bundle = new Map(baseline);
    applyFixture(bundle, fixture);
    const issues = validateBundle(bundle);
    if (issues.length !== 1 || issues[0].code !== fixture.code) {
      const observed = issues.map((entry) => `${entry.code}@${entry.target}`).join(', ') || '<none>';
      throw new Error(`fixture ${fixture.fixture_id} expected only ${fixture.code}; observed ${observed}`);
    }
    return { fixture_id: fixture.fixture_id, code: issues[0].code, target: issues[0].target, issue_count: issues.length };
  });
}

function main() {
  const args = process.argv.slice(2);
  const fixtureReport = args.length === 1 && args[0] === '--fixture-report-json';
  if (!fixtureReport && args.length !== 0) {
    process.stderr.write('[ARGUMENT_ERROR] expected no arguments or --fixture-report-json\n');
    process.exitCode = 1;
    return;
  }
  const bundle = loadBundle();
  const issues = validateBundle(bundle);
  if (issues.length > 0) {
    for (const entry of issues) process.stderr.write(`[${entry.code}] ${entry.reason} (${entry.target})\n`);
    process.exitCode = 1;
    return;
  }
  if (fixtureReport) {
    process.stdout.write(`${JSON.stringify({ fixtures: runNegativeFixtures(bundle) }, null, 2)}\n`);
    return;
  }
  process.stdout.write('public raw-token authority hardcut: OK\n');
}

main();

