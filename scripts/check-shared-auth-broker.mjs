#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parse } from 'yaml';

const root = process.cwd();
const gate = String(process.argv[2] || '').trim();

function fail(message) {
  throw new Error(`${gate || 'shared-auth-broker'} gate failed: ${message}`);
}

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function requireMatch(source, pattern, message) {
  if (!pattern.test(source)) fail(message);
}

function forbidMatch(source, pattern, message) {
  if (pattern.test(source)) fail(message);
}

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`${command} ${args.join(' ')} exited ${result.status}`);
}

function runGoTest(pattern) {
  run('go', ['test', './internal/services/account', '-run', pattern, '-count=1'], path.join(root, 'runtime'));
}

function matrixCaller(document, callerClass) {
  const caller = document.callers?.find((entry) => entry.caller_class === callerClass);
  if (!caller) fail(`permission matrix is missing ${callerClass}`);
  return caller;
}

function assertDecision(caller, method, expected) {
  const actual = caller.methods?.[method]?.decision;
  if (actual !== expected) {
    fail(`${caller.caller_class}.${method} expected ${expected}, got ${actual || '<missing>'}`);
  }
}

function assertCallerDecision(caller, expected) {
  if (caller.decision !== expected) {
    fail(`${caller.caller_class} expected ${expected}, got ${caller.decision || '<missing>'}`);
  }
}

function checkRuntimePermissionMatrix() {
  const document = parse(read('.nimi/spec/runtime/kernel/tables/account-rpc-permission-matrix.yaml'));
  const desktop = matrixCaller(document, 'desktop_account_and_local_app_control');
  const firstParty = matrixCaller(document, 'local_first_party_app');
  const localApp = matrixCaller(document, 'local_app');
  const avatar = matrixCaller(document, 'binding_only_avatar');
  assertCallerDecision(avatar, 'deny_all');
  for (const method of ['BeginLogin', 'CompleteLogin', 'Logout', 'SwitchAccount']) {
    assertDecision(desktop, method, 'allow_when');
    assertDecision(firstParty, method, 'deny');
    assertDecision(localApp, method, 'deny');
  }
  assertDecision(localApp, 'InvokeRealmUnary', 'deny');
  assertDecision(localApp, 'GetLocalAppGrantStatus', 'allow_when');
  assertDecision(localApp, 'RequestLocalAppGrant', 'allow_when');
  assertDecision(desktop, 'DecideLocalAppGrant', 'allow_when');
  assertDecision(desktop, 'RevokeLocalAppGrant', 'allow_when');
  runGoTest('^TestAccountRPCPermissionMatrixKeepsAccountControlDesktopOwned$');
}

function checkRuntimePrivateRefresh() {
  const privateRefresh = read('runtime/internal/services/account/refresh_internal.go');
  const realmUnary = read('runtime/internal/services/account/realm_unary.go');
  const accountProto = read('proto/runtime/v1/account.proto');
  requireMatch(privateRefresh, /func \(s \*Service\) refreshAccountSessionInternal\(/u, 'private refresh helper is missing');
  requireMatch(realmUnary, /refreshAccountSessionInternal\(ctx,\s*false\)/u, 'Realm broker does not use private refresh');
  forbidMatch(accountProto, /\bRefreshAccountSession\b/u, 'public refresh RPC remains in the account protocol');
  forbidMatch(privateRefresh, /RefreshAccountSession(?:Request|Response)/u, 'private refresh depends on a public protocol type');
  runGoTest('^(TestRuntimePrivateRefreshIsSingleFlightForTokenProjection|TestAccountRPCPermissionMatrixKeepsAccountControlDesktopOwned)$');
}

function checkRuntimeCallerEnvelope() {
  const envelope = read('runtime/internal/services/account/caller_envelope.go');
  const tauri = read('kit/shell/tauri/src/runtime_bridge/metadata.rs');
  const desktopTauri = read('apps/desktop/src-tauri/src/main_parts/app_bootstrap.rs');
  const desktopElectron = read('apps/desktop/src-electron/main.ts');
  for (const key of ['x-nimi-source-host', 'x-nimi-app-instance-id', 'x-nimi-device-id']) {
    requireMatch(envelope, new RegExp(key, 'u'), `Runtime envelope parser is missing ${key}`);
  }
  requireMatch(envelope, /protected-local-desktop-account-host/u, 'Runtime canonical protected Desktop account host is missing');
  requireMatch(tauri, /renderer_forbidden_metadata_kind[\s\S]*xnimisourcehost[\s\S]*xnimiappinstanceid[\s\S]*xnimideviceid/u, 'Tauri metadata policy does not reserve trusted desktop envelope fields');
  requireMatch(desktopTauri, /DESKTOP_CONTROL_TRANSPORT_REQUIRED/u, 'Tauri ordinary Runtime bridge does not fail closed on account calls');
  forbidMatch(desktopTauri, /desktop-tauri-account-host|RUNTIME_BRIDGE_DESKTOP_TAURI_ACCOUNT_SOURCE_HOST/u, 'Tauri retains the retired account-host carrier');
  forbidMatch(desktopElectron, /trustedRuntimeMetadataProvider|desktop-electron-account-host|runtime-auth\.js/u, 'Electron ordinary Runtime bridge retains account authority metadata');
  if (existsSync(path.join(root, 'kit/shell/electron/src/main/runtime-account-auth.ts'))) {
    fail('retired Electron Runtime account metadata provider still exists');
  }
  runGoTest('^(TestDesktopAccountHostRequiresProtectedDesktopOrigin|TestProductionLocalCallerRequiresRuntimeAppSessionProof)$');
}

function checkRuntimeBrokerPolicy() {
  const policy = parse(read('.nimi/spec/runtime/kernel/tables/realm-broker-operations.yaml'), { merge: true });
  const operations = policy.operations ?? [];
  if (policy.owner !== 'runtime' || policy.source_rule !== 'K-ACCSVC-023') fail('broker policy owner/source rule drift');
  if (operations.length < 1) fail('broker operation policy is empty');
  const seen = new Set();
  for (const operation of operations) {
    if (seen.has(operation.operation_id)) fail(`duplicate broker operation ${operation.operation_id}`);
    seen.add(operation.operation_id);
    if (operation.credential_response_policy !== 'forbidden') fail(`${operation.operation_id} permits credential responses`);
    if (operation.realm_base_policy !== 'runtime-configured-canonical-exact') fail(`${operation.operation_id} permits non-canonical Realm base`);
  }
  for (const forbidden of policy.explicitly_not_admitted ?? []) {
    if (seen.has(forbidden.operation_id)) fail(`${forbidden.operation_id} is both admitted and forbidden`);
  }
  run(process.execPath, ['scripts/generate-runtime-realm-broker-policy.mjs', '--check']);
  runGoTest('^(TestInvokeRealmUnaryAdmitsStudioOperationIDs|TestInvokeRealmUnaryRejectsCrossStudioLaneRequests|TestInvokeRealmUnaryRejectsSignedUploadCredentialOperations)$');
}

function checkRuntimeBrokerTokenLeak() {
  const responseScanner = read('runtime/internal/services/account/realm_broker_response_scanner.go');
  const requestScanner = read('runtime/internal/services/account/realm_broker_request_validation.go');
  const realmUnary = read('runtime/internal/services/account/realm_unary.go');
  for (const key of ['accesstoken', 'refreshtoken', 'authorization', 'sessiontoken', 'signedcredential', 'jwt', 'secret']) {
    requireMatch(responseScanner, new RegExp(`"${key}"`, 'u'), `response scanner is missing ${key}`);
  }
  requireMatch(responseScanner, /realmBrokerJWTValuePattern/u, 'JWT-shaped response scan is missing');
  requireMatch(requestScanner, /scanRealmBrokerJSONValue/u, 'broker request credential scan is missing');
  requireMatch(realmUnary, /scanRealmBrokerResponseForCredentials/u, 'Realm response is not passed through the credential scanner');
  runGoTest('^(TestInvokeRealmUnaryFailsClosedOnCredentialLikeResponse|TestInvokeRealmUnaryTypedNegativeMatrix|TestInvokeRealmUnaryMediatesRealmRequestWithoutReturningToken)$');
}

function checkSdkLocalAppProtectedCarrier() {
  const client = read('sdks/typescript/core/app/local-app-runtime-platform.ts');
  const appIndex = read('sdks/typescript/core/app/index.ts');
  const realm = read('sdks/typescript/core/app/runtime-account-realm.ts');
  requireMatch(client, /export function createNimiAppRuntimePlatformClient/u, 'local-app client constructor is missing');
  requireMatch(client, /NimiAppRuntimePlatformStandardShell/u, 'local-app client does not require the typed standard shell');
  requireMatch(client, /session-bound-zero-grant/u, 'local-app client collapses the zero-grant identity session');
  requireMatch(client, /readRuntimeBytes/u, 'local-app client does not expose the protected artifact reader');
  requireMatch(client, /assertExactKeys\(input, \['standardShell'\]/u, 'local-app client does not reject caller-owned authority fields');
  forbidMatch(
    client,
    /createRuntimeAccountMediatedRealmTransport|createRealmWithRuntimeAccountToken|getAccessToken|refreshAccountSession|accountCaller|authMetadata|developerRegistration|readonly\s+trustClass/u,
    'local-app client exposes renderer-owned account, provenance, or Realm authority',
  );
  forbidMatch(appIndex, /InstalledNimiApp|createInstalledNimiAppBootstrap|installed-app-bootstrap/u, 'SDK app export retains the retired installed-app carrier');
  if (existsSync(path.join(root, 'sdks/typescript/core/app/installed-app-bootstrap.ts'))) {
    fail('retired installed-app bootstrap source still exists');
  }
  forbidMatch(realm, /createRealmWithRuntimeAccountToken|getAccessToken|refreshAccountSession/u, 'SDK Realm helper exposes public account credential access');
  run(process.execPath, [
    '--import', 'tsx', '--test',
    'core/app/local-app-runtime-platform.test.ts',
    'core/app/runtime-account-realm.test.ts',
    'runtime/account-caller.test.ts',
    'runtime/shared-auth-surface.test.ts',
  ], path.join(root, 'sdks/typescript'));
}

function checkKitParity() {
  const catalog = read('kit/shell/capabilities/src/catalog.ts');
  const tauriCatalog = read('kit/shell/tauri/src/capabilities/catalog.rs');
  const activeTauriCatalog = tauriCatalog.split('#[cfg(test)]', 1)[0] || tauriCatalog;
  const tauriCommands = read('kit/shell/tauri/src/command_registration.rs');
  const electronPolicy = read('kit/shell/electron/src/main/auth.ts');
  const rendererBridge = read('kit/shell/renderer/src/bridge/tauri-api.ts');
  forbidMatch(catalog, /id: 'auth'|nimi\.shell\.auth\.session/u, 'active standard shell catalog still contains auth.session');
  forbidMatch(activeTauriCatalog, /id: "auth"|nimi\.shell\.auth\.session/u, 'active Tauri standard shell catalog still contains auth.session');
  forbidMatch(tauriCommands, /auth_session_(?:load|save|clear)/u, 'Tauri still registers auth_session commands');
  forbidMatch(rendererBridge, /auth_session_(?:load|save|clear)|auth\.session(?:Load|Save|Clear)/u, 'renderer bridge still aliases auth.session');
  requireMatch(electronPolicy, /RETIRED_ELECTRON_AUTH_SESSION_COMMAND_SET/u, 'Electron does not keep explicit deny vocabulary for retired auth.session calls');
  requireMatch(tauriCommands, /runtime_bridge_unary/u, 'Tauri Runtime unary carrier is missing');
  run(process.execPath, [
    path.join(root, 'kit/node_modules/vitest/vitest.mjs'), 'run',
    'shell/renderer/test/shared-auth-broker-hardcut.test.ts',
    'shell/electron/test/electron-protected-desktop-hosts.test.ts',
  ], path.join(root, 'kit'));
  run('cargo', ['test', '--manifest-path', 'kit/shell/tauri/Cargo.toml', 'capabilities::catalog']);
  run('cargo', ['test', '--manifest-path', 'kit/shell/tauri/Cargo.toml', 'runtime_bridge']);
}

const gates = {
  'runtime-account-rpc-permission-matrix': checkRuntimePermissionMatrix,
  'runtime-private-refresh-boundary': checkRuntimePrivateRefresh,
  'runtime-caller-envelope-binding': checkRuntimeCallerEnvelope,
  'runtime-broker-operation-policy': checkRuntimeBrokerPolicy,
  'runtime-broker-token-leak': checkRuntimeBrokerTokenLeak,
  'sdk-local-app-protected-carrier': checkSdkLocalAppProtectedCarrier,
  'kit-shared-auth-broker-parity': checkKitParity,
};

const check = gates[gate];
if (!check) fail(`unknown gate ${gate || '<missing>'}`);
check();
process.stdout.write(`${gate} gate passed\n`);
