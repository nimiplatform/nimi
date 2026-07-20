#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parse } from 'yaml';

const root = process.cwd();
const gate = String(process.argv[2] || '').trim();

function fail(message) {
  throw new Error(`${gate || 'runtime-account-broker'} gate failed: ${message}`);
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

function realmSDKMethodName(operationID) {
  const separator = operationID.indexOf('_');
  if (separator <= 0 || separator === operationID.length - 1) fail(`Realm operation id has no controller/action boundary: ${operationID}`);
  const controller = operationID.slice(0, separator);
  const action = operationID.slice(separator + 1);
  return `${controller[0].toLowerCase()}${controller.slice(1)}${action[0].toUpperCase()}${action.slice(1)}`;
}

function checkRuntimePermissionMatrix() {
  const document = parse(read('.nimi/spec/runtime/kernel/tables/account-rpc-permission-matrix.yaml'));
  const platformBinding = document.platform_transport_binding;
  const protectedOriginBindings = platformBinding?.protected_origin_bindings ?? {};
  if (document.protected_transport_authority_ref !== 'protected-local-rpc-transport-matrix.yaml') fail('permission matrix protected transport authority ref drift');
  if (document.protected_transport_profile_ref !== 'protected-local-os-profiles.yaml#same-os') fail('permission matrix same-OS transport profile ref drift');
  if (platformBinding?.binding_name !== 'verified_platform_transport') fail('permission matrix platform binding is not verified_platform_transport');
  if (platformBinding?.transport_matrix_ref !== 'protected-local-rpc-transport-matrix.yaml#verified_platform_transport') fail('permission matrix verified transport bundle ref drift');
  if (platformBinding?.profile_resolution !== 'same_os') fail('permission matrix platform profile resolution is not same_os');
  if (Object.keys(protectedOriginBindings).sort().join(',') !== 'protected_desktop_control_origin,protected_local_app_origin') fail('permission matrix protected origin binding vocabulary drift');
  for (const [requirement, transportClass] of [
    ['protected_desktop_control_origin', 'desktop_control'],
    ['protected_local_app_origin', 'local_app_host'],
  ]) {
    const binding = protectedOriginBindings[requirement];
    if (binding?.transport_class !== transportClass || binding?.binding !== 'verified_platform_transport' || binding?.carrier_role !== transportClass) {
      fail(`${requirement} does not resolve to the exact verified platform transport class`);
    }
  }
  if (platformBinding?.coverage?.caller_methods !== 'every_allow_when_method_with_a_resolved_protected_origin_requirement'
    || platformBinding?.coverage?.broker_consumer_admission !== 'every_row_with_a_resolved_protected_origin_requirement'
    || platformBinding?.coverage?.missing_or_ambiguous_binding !== 'fail_generation') {
    fail('permission matrix platform binding coverage is incomplete');
  }
  const preservedBundled = platformBinding?.preserved_non_matrix_requirement;
  if (preservedBundled?.requirement !== 'protected_bundled_origin'
    || preservedBundled?.disposition !== 'existing_bundled_first_party_authority_unchanged'
    || preservedBundled?.protected_local_transport_matrix_membership !== 'excluded') {
    fail('permission matrix bundled first-party authority was reinterpreted as a protected-local transport binding');
  }
  const assertProtectedRequirementsResolve = (label, decision) => {
    for (const requirement of decision?.requirements ?? []) {
      if ((requirement === 'protected_desktop_control_origin' || requirement === 'protected_local_app_origin')
        && !protectedOriginBindings[requirement]) {
        fail(`${label} has no platform transport binding for ${requirement}`);
      }
    }
  };
  for (const caller of document.callers ?? []) {
    for (const [method, decision] of Object.entries(caller.methods ?? {})) {
      if (decision?.decision === 'allow_when') assertProtectedRequirementsResolve(`${caller.caller_class}.${method}`, decision);
    }
  }
  for (const dependency of document.selected_operation_dependencies ?? []) {
    if (dependency?.decision === 'allow_when') assertProtectedRequirementsResolve(dependency.operation_id ?? dependency.method_id, dependency);
  }
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
  assertDecision(desktop, 'InvokeRealmUnary', 'allow_when');
  assertDecision(firstParty, 'InvokeRealmUnary', 'deny');
  assertDecision(localApp, 'InvokeRealmUnary', 'deny');
  assertDecision(localApp, 'GetLocalAppPermissionStatus', 'allow_when');
  assertDecision(localApp, 'RequestLocalAppPermission', 'allow_when');
  assertDecision(desktop, 'GetLocalAppPermissionStatus', 'deny');
  assertDecision(desktop, 'RequestLocalAppPermission', 'deny');
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
  const expectedOperationIDs = [
    'WorldCoreController_discoverPersonaCharacters',
    'WorldCoreController_getPersonaCharacter',
    'WorldCoreController_getWorldCharacter',
    'WorldCoreController_getWorldEntity',
    'WorldCoreController_listPersonaCharacters',
    'WorldCoreController_listWorldRelationships',
    'WorldPublicController_getWorld',
    'WorldPublicController_getWorldDetailWithCharacters',
    'WorldPublicController_listWorlds',
  ];
  if (policy.owner !== 'runtime' || policy.source_rule !== 'K-ACCSVC-023') fail('broker policy owner/source rule drift');
  if (policy.authority_status !== 'admitted_exact_desktop_source_readiness_operations') fail('broker authority status is not exact Desktop source readiness');
  if (policy.production_consumption !== 'admitted_exact_rows_only') fail('broker production consumption is not exact-row-only');
  if (policy.generic_proxy !== 'forbidden') fail('generic Realm proxy posture is not forbidden');
  if (policy.unlisted_operation_disposition !== 'deny_broker_operation_not_admitted') fail('unlisted Realm operations do not fail closed');
  if (operations.length !== expectedOperationIDs.length) fail(`broker operation count ${operations.length} does not match exact source-readiness count ${expectedOperationIDs.length}`);
  const seen = new Set();
  for (const operation of operations) {
    if (seen.has(operation.operation_id)) fail(`duplicate broker operation ${operation.operation_id}`);
    seen.add(operation.operation_id);
    if (operation.authorization_profile !== 'protected_desktop_source_readiness') fail(`${operation.operation_id} has an unadmitted authorization profile`);
    if (operation.allowed_runtime_caller_modes?.length !== 1 || operation.allowed_runtime_caller_modes[0] !== 'ACCOUNT_CALLER_MODE_DESKTOP_SHELL') fail(`${operation.operation_id} is not Desktop-shell-only`);
    if (operation.protected_transport_ref !== '/nimi.runtime.v1.RuntimeAccountService/InvokeRealmUnary') fail(`${operation.operation_id} does not use the protected broker transport`);
    if (operation.credential_response_policy !== 'forbidden') fail(`${operation.operation_id} permits credential responses`);
    if (operation.realm_base_policy !== 'runtime-configured-canonical-exact') fail(`${operation.operation_id} permits non-canonical Realm base`);
    if (!Array.isArray(operation.consumer_refs) || operation.consumer_refs.length === 0) fail(`${operation.operation_id} has no consumer evidence`);
    let consumerSource = '';
    for (const consumerRef of operation.consumer_refs ?? []) {
      if (!existsSync(path.join(root, consumerRef))) fail(`${operation.operation_id} consumer ref is missing: ${consumerRef}`);
      consumerSource += `\n${read(consumerRef)}`;
    }
    const sdkMethod = realmSDKMethodName(operation.operation_id);
    if (!consumerSource.includes(sdkMethod)) {
      fail(`${operation.operation_id} consumer refs do not call ${sdkMethod}`);
    }
  }
  if (expectedOperationIDs.some((operationID) => !seen.has(operationID)) || [...seen].some((operationID) => !expectedOperationIDs.includes(operationID))) {
    fail('broker operation set drifted from the exact Desktop source-readiness vocabulary');
  }
  if (policy.surfaces?.length !== expectedOperationIDs.length || expectedOperationIDs.some((operationID) => !policy.surfaces.includes(operationID))) {
    fail('broker surfaces drifted from the exact Desktop source-readiness vocabulary');
  }
  for (const forbidden of policy.explicitly_not_admitted ?? []) {
    if (seen.has(forbidden.operation_id)) fail(`${forbidden.operation_id} is both admitted and forbidden`);
  }
  run(process.execPath, ['scripts/generate-runtime-realm-broker-policy.mjs', '--check']);
  runGoTest('^(TestRealmBrokerOperationSetIsExactDesktopSourceReadinessVocabulary|TestInvokeRealmUnaryAdmitsExactDesktopSourceReadinessOperationIDs|TestInvokeRealmUnaryRejectsEveryUnlistedOperation|TestInvokeRealmUnaryRejectsNonDesktopCaller|TestInvokeRealmUnaryRejectsSignedUploadCredentialOperations)$');
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
  runGoTest('^(TestInvokeRealmUnaryFailsClosedOnCredentialLikeResponse|TestInvokeRealmUnaryTypedNegativeMatrix|TestInvokeRealmUnaryMediatesDesktopSourceReadinessWithoutReturningToken)$');
}

function checkSdkLocalAppProtectedCarrier() {
  const client = read('sdks/typescript/core/app/local-app-runtime-platform.ts');
  const appIndex = read('sdks/typescript/core/app/index.ts');
  const rootClient = read('sdks/typescript/root-client.ts');
  const realm = read('sdks/typescript/core/app/runtime-account-realm.ts');
  requireMatch(client, /export function createNimiLocalAppClient/u, 'bounded local-app client builder is missing');
  requireMatch(client, /NimiLocalAppStandardShell/u, 'local-app client does not require the typed standard shell');
  requireMatch(rootClient, /createNimiClient[\s\S]*'localApp' in config[\s\S]*createNimiLocalAppClient/u, 'root NimiClient composition does not own the local-app branch');
  requireMatch(client, /session-bound/u, 'local-app client does not project the bound identity session');
  requireMatch(client, /createNimiAppRuntimeStorageClient/u, 'local-app client does not expose app-private base-entitlement storage');
  forbidMatch(client, /readRuntimeBytes|agentInventory|openConversation|transcribeVoice/u, 'local-app client exposes an unadmitted Artifact, Agent, conversation, or voice operation');
  requireMatch(client, /assertExactKeys\(input, \['standardShell'\]/u, 'local-app client does not reject caller-owned authority fields');
  forbidMatch(
    client,
    /createRuntimeAccountMediatedRealmTransport|createRealmWithRuntimeAccountToken|getAccessToken|refreshAccountSession|accountCaller|authMetadata|developerRegistration|readonly\s+trustClass/u,
    'local-app client exposes renderer-owned account, provenance, or Realm authority',
  );
  forbidMatch(appIndex, /createNimiAppRuntimePlatformClient/u, 'SDK app subpath retains the retired platform-client constructor');
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
    'runtime/runtime-account-surface.test.ts',
  ], path.join(root, 'sdks/typescript'));
}

function checkKitParity() {
  const catalog = read('kit/shell/capabilities/src/catalog.ts');
  const tauriCatalog = read('kit/shell/tauri/src/capabilities/catalog.rs');
  const activeTauriCatalog = tauriCatalog.split('#[cfg(test)]', 1)[0] || tauriCatalog;
  const tauriCommands = read('kit/shell/tauri/src/command_registration.rs');
  const electronHost = read('kit/shell/electron/src/main/host.ts');
  const rendererBridge = read('kit/shell/renderer/src/bridge/tauri-api.ts');
  forbidMatch(catalog, /id: 'auth'|nimi\.shell\.auth\.session/u, 'active standard shell catalog still contains auth.session');
  forbidMatch(activeTauriCatalog, /id: "auth"|nimi\.shell\.auth\.session/u, 'active Tauri standard shell catalog still contains auth.session');
  forbidMatch(tauriCommands, /auth_session_(?:load|save|clear)/u, 'Tauri still registers auth_session commands');
  forbidMatch(rendererBridge, /auth_session_(?:load|save|clear)|auth\.session(?:Load|Save|Clear)/u, 'renderer bridge still aliases auth.session');
  requireMatch(
    electronHost,
    /LOCAL_APP_EXPLICITLY_FORBIDDEN_COMMANDS[\s\S]*auth\.sessionLoad[\s\S]*auth\.sessionSave[\s\S]*auth\.sessionClear/u,
    'Electron local-app host does not keep explicit deny vocabulary for retired auth.session calls',
  );
  requireMatch(electronHost, /unsupported-electron-shell-command/u, 'Electron unknown command path does not fail closed');
  requireMatch(tauriCommands, /runtime_bridge_unary/u, 'Tauri Runtime unary carrier is missing');
  run(process.execPath, [
    path.join(root, 'kit/node_modules/vitest/vitest.mjs'), 'run',
    'shell/renderer/test/runtime-account-broker-hardcut.test.ts',
    'shell/electron/test/electron-shell-bridge-guardrails.test.ts',
    'shell/electron/test/electron-protected-desktop-hosts.test.ts',
  ], path.join(root, 'kit'));
  run('cargo', ['test', '--locked', '--manifest-path', 'kit/shell/tauri/Cargo.toml', 'capabilities::catalog']);
  run('cargo', ['test', '--locked', '--manifest-path', 'kit/shell/tauri/Cargo.toml', 'runtime_bridge']);
}

const gates = {
  'runtime-account-rpc-permission-matrix': checkRuntimePermissionMatrix,
  'runtime-private-refresh-boundary': checkRuntimePrivateRefresh,
  'runtime-caller-envelope-binding': checkRuntimeCallerEnvelope,
  'runtime-broker-operation-policy': checkRuntimeBrokerPolicy,
  'runtime-broker-token-leak': checkRuntimeBrokerTokenLeak,
  'sdk-local-app-protected-carrier': checkSdkLocalAppProtectedCarrier,
  'kit-runtime-account-broker-parity': checkKitParity,
};

const check = gates[gate];
if (!check) fail(`unknown gate ${gate || '<missing>'}`);
check();
process.stdout.write(`${gate} gate passed\n`);
