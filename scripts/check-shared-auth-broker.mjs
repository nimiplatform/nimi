#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

function checkRuntimePermissionMatrix() {
  const document = parse(read('.nimi/spec/runtime/kernel/tables/account-rpc-permission-matrix.yaml'));
  const desktop = matrixCaller(document, 'desktop_account_ux');
  const firstParty = matrixCaller(document, 'local_first_party_app');
  const developer = matrixCaller(document, 'local_developer_app');
  const installed = matrixCaller(document, 'desktop_launched_installed_nimi_app');
  const avatar = matrixCaller(document, 'binding_only_avatar');
  for (const method of ['BeginLogin', 'CompleteLogin', 'Logout', 'SwitchAccount']) {
    assertDecision(desktop, method, 'allow_when');
    assertDecision(firstParty, method, 'deny');
    assertDecision(developer, method, 'deny');
    assertDecision(installed, method, 'deny');
    assertDecision(avatar, method, 'deny');
  }
  for (const caller of [desktop, firstParty, developer, installed, avatar]) {
    assertDecision(caller, 'RefreshAccountSession', 'deny');
  }
  assertDecision(firstParty, 'GetAccessToken', 'allow_when');
  for (const caller of [desktop, developer, installed, avatar]) {
    assertDecision(caller, 'GetAccessToken', 'deny');
  }
  assertDecision(developer, 'InvokeRealmUnary', 'allow_when');
  assertDecision(installed, 'InvokeRealmUnary', 'allow_when');
  runGoTest('^TestAccountRPCPermissionMatrixKeepsAccountControlDesktopOwned$');
}

function checkRuntimePrivateRefresh() {
  const privateRefresh = read('runtime/internal/services/account/refresh_internal.go');
  const realmUnary = read('runtime/internal/services/account/realm_unary.go');
  const service = read('runtime/internal/services/account/service.go');
  requireMatch(privateRefresh, /func \(s \*Service\) refreshAccountSessionInternal\(/u, 'private refresh helper is missing');
  requireMatch(realmUnary, /refreshAccountSessionInternal\(ctx,\s*false\)/u, 'Realm broker does not use private refresh');
  requireMatch(service, /GetAccessToken[\s\S]*refreshAccountSessionInternal\(ctx,\s*false\)/u, 'raw token projection does not use private refresh');
  const publicRefresh = service.match(/func \(s \*Service\) RefreshAccountSession[\s\S]*?\n\}\n/u)?.[0] || '';
  requireMatch(publicRefresh, /ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED/u, 'public refresh does not fail closed');
  forbidMatch(publicRefresh, /refreshAccountSessionInternal|refresher\.Refresh|s\.mu\.Lock/u, 'public refresh enters private refresh or mutation');
  runGoTest('^(TestRuntimePrivateRefreshIsSingleFlightForTokenProjection|TestAccountRPCPermissionMatrixKeepsAccountControlDesktopOwned)$');
}

function checkRuntimeCallerEnvelope() {
  const envelope = read('runtime/internal/services/account/caller_envelope.go');
  const electron = read('kit/shell/electron/src/main/runtime-account-auth.ts');
  const tauri = read('kit/shell/tauri/src/runtime_bridge/metadata.rs');
  for (const key of ['x-nimi-source-host', 'x-nimi-app-instance-id', 'x-nimi-device-id', 'x-nimi-launch-nonce', 'x-nimi-release-descriptor-ref', 'x-nimi-capability-set-ref']) {
    requireMatch(envelope, new RegExp(key, 'u'), `Runtime envelope parser is missing ${key}`);
    requireMatch(electron, new RegExp(key, 'u'), `Electron host does not stamp ${key}`);
  }
  requireMatch(tauri, /renderer_forbidden_metadata_kind[\s\S]*xnimilaunchnonce/u, 'Tauri metadata policy does not reserve trusted envelope fields');
  requireMatch(envelope, /ACCOUNT_REASON_CODE_LAUNCH_NONCE_REPLAY/u, 'Runtime launch nonce replay rejection is missing');
  runGoTest('^(TestInstalledAppBrokerRequiresBoundEnvelopeAndRejectsLaunchNonceReplay|TestProductionLocalCallerRequiresRuntimeAppSessionProof)$');
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

function checkSdkInstalledBootstrap() {
  const bootstrap = read('sdks/typescript/core/app/installed-app-bootstrap.ts');
  const realm = read('sdks/typescript/core/app/runtime-account-realm.ts');
  requireMatch(bootstrap, /createRuntimeAccountMediatedRealmTransport/u, 'installed app bootstrap does not use mediated Realm');
  forbidMatch(bootstrap, /createRealmWithRuntimeAccountToken|getAccessToken|refreshAccountSession/u, 'installed app bootstrap exposes raw token or refresh');
  requireMatch(bootstrap, /assertNoRendererOwnedAuthCustody/u, 'installed app bootstrap does not reject renderer auth custody');
  requireMatch(realm, /SDK_RUNTIME_ACCOUNT_RAW_TOKEN_MODE_FORBIDDEN/u, 'SDK raw helper does not reject non-first-party callers');
  run(process.execPath, [
    '--import', 'tsx', '--test',
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
    'shell/electron/test/electron-runtime-account-auth.test.ts',
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
  'sdk-installed-app-broker-bootstrap': checkSdkInstalledBootstrap,
  'kit-shared-auth-broker-parity': checkKitParity,
};

const check = gates[gate];
if (!check) fail(`unknown gate ${gate || '<missing>'}`);
check();
process.stdout.write(`${gate} gate passed\n`);
