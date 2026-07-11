import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function stripProtoComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

function namedBlock(source, keyword, name) {
  const clean = stripProtoComments(source);
  const match = new RegExp(`\\b${keyword}\\s+${name}\\s*\\{`).exec(clean);
  assert.ok(match, `missing ${keyword} ${name}`);
  const open = clean.indexOf('{', match.index);
  let depth = 0;
  for (let index = open; index < clean.length; index += 1) {
    if (clean[index] === '{') depth += 1;
    if (clean[index] === '}') {
      depth -= 1;
      if (depth === 0) return clean.slice(open + 1, index);
    }
  }
  assert.fail(`unterminated ${keyword} ${name}`);
}

function messageFields(source, name) {
  const body = namedBlock(source, 'message', name);
  return body
    .split(';')
    .map((statement) => statement.trim())
    .map((statement) => statement.match(/^(?:optional\s+)?(repeated\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\d+)$/))
    .filter(Boolean)
    .map((match) => ({
      repeated: Boolean(match[1]),
      type: match[2],
      name: match[3],
      number: Number(match[4]),
    }))
    .sort((left, right) => left.number - right.number);
}

function enumEntries(source, name) {
  const body = namedBlock(source, 'enum', name);
  return [...body.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(\d+)\s*;/gm)]
    .map((match) => ({ name: match[1], value: Number(match[2]) }));
}

function assertRpc(source, service, method, request, response) {
  const body = namedBlock(source, 'service', service);
  assert.match(
    body,
    new RegExp(`\\brpc\\s+${method}\\s*\\(\\s*${request}\\s*\\)\\s*returns\\s*\\(\\s*${response}\\s*\\)`),
  );
}

const authProto = read('proto/runtime/v1/auth.proto');
const appProto = read('proto/runtime/v1/app.proto');
const commonProto = read('proto/runtime/v1/common.proto');
const developmentProto = read('proto/runtime/v1/development.proto');
const transportAuthority = parseYaml(read('.nimi/spec/runtime/kernel/tables/protected-local-rpc-transport-matrix.yaml'));
const lifecycleAuthority = parseYaml(read('.nimi/spec/runtime/kernel/tables/protected-local-lifecycle-intent-protocol.yaml'));
const reasonAuthority = parseYaml(read('.nimi/spec/runtime/kernel/tables/reason-codes/10-general-auth-connector.yaml'));

test('OpenDesktopSession wire is the frozen empty-request two-byte-field shape', () => {
  assert.deepEqual(messageFields(authProto, transportAuthority.open_desktop_session_wire.request.message), []);
  assert.deepEqual(
    messageFields(authProto, transportAuthority.open_desktop_session_wire.response.message),
    [
      { repeated: false, type: 'bytes', name: 'desktop_session_id', number: 1 },
      { repeated: false, type: 'bytes', name: 'runtime_boot_epoch', number: 2 },
    ],
  );
  assertRpc(
    authProto,
    'RuntimeAuthService',
    'OpenDesktopSession',
    'OpenDesktopSessionRequest',
    'OpenDesktopSessionResponse',
  );
});

test('lifecycle intent enums and prepare/status messages project the admitted machine table', () => {
  assert.deepEqual(
    enumEntries(appProto, 'AppLifecycleIntentAction'),
    [
      { name: 'APP_LIFECYCLE_INTENT_ACTION_UNSPECIFIED', value: 0 },
      ...lifecycleAuthority.action_enum.map((name, index) => ({
        name: `APP_LIFECYCLE_INTENT_ACTION_${name}`,
        value: index + 1,
      })),
    ],
  );
  assert.deepEqual(
    enumEntries(appProto, 'AppLifecycleIntentStatus'),
    [
      { name: 'APP_LIFECYCLE_INTENT_STATUS_UNSPECIFIED', value: 0 },
      ...lifecycleAuthority.status_enum.map((name, index) => ({
        name: `APP_LIFECYCLE_INTENT_STATUS_${name}`,
        value: index + 1,
      })),
    ],
  );

  assert.deepEqual(messageFields(appProto, 'PrepareAppLifecycleIntentRequest'), [
    { repeated: false, type: 'AppLifecycleIntentAction', name: 'action', number: 1 },
    { repeated: false, type: 'string', name: 'app_id', number: 2 },
    { repeated: false, type: 'string', name: 'expected_release_ref', number: 3 },
    { repeated: false, type: 'string', name: 'expected_artifact_digest', number: 4 },
    { repeated: false, type: 'uint64', name: 'expected_adoption_generation', number: 5 },
    { repeated: false, type: 'AppLifecycleDestructiveOptions', name: 'destructive_options', number: 6 },
  ]);
  assert.deepEqual(messageFields(appProto, 'PrepareAppLifecycleIntentResponse'), [
    { repeated: false, type: 'string', name: 'intent_id', number: 1 },
    { repeated: false, type: 'AppLifecycleCanonicalImpact', name: 'canonical_impact', number: 2 },
    { repeated: false, type: 'string', name: 'canonical_impact_digest', number: 3 },
    { repeated: false, type: 'google.protobuf.Timestamp', name: 'deadline', number: 4 },
    { repeated: false, type: 'ReasonCode', name: 'reason_code', number: 5 },
  ]);
  assert.deepEqual(messageFields(appProto, 'GetAppLifecycleIntentStatusRequest'), [
    { repeated: false, type: 'string', name: 'intent_id', number: 1 },
  ]);
  assert.deepEqual(messageFields(appProto, 'GetAppLifecycleIntentStatusResponse'), [
    { repeated: false, type: 'string', name: 'intent_id', number: 1 },
    { repeated: false, type: 'AppLifecycleIntentStatus', name: 'status', number: 2 },
    { repeated: false, type: 'string', name: 'non_authorizing_job_id', number: 3 },
    { repeated: false, type: 'string', name: 'canonical_result', number: 4 },
    { repeated: false, type: 'ReasonCode', name: 'reason_code', number: 5 },
    { repeated: false, type: 'bool', name: 'retryability', number: 6 },
  ]);
  assertRpc(
    appProto,
    'RuntimeAppService',
    'PrepareAppLifecycleIntent',
    'PrepareAppLifecycleIntentRequest',
    'PrepareAppLifecycleIntentResponse',
  );
  assertRpc(
    appProto,
    'RuntimeAppService',
    'GetAppLifecycleIntentStatus',
    'GetAppLifecycleIntentStatusRequest',
    'GetAppLifecycleIntentStatusResponse',
  );
});

test('every lifecycle mutation carries the same intent id and displayed digest', () => {
  const expectedNumbers = new Map([
    ['InstallAppRequest', [3, 4]],
    ['UninstallAppRequest', [4, 5]],
    ['UpdateAppRequest', [3, 4]],
    ['HealthRepairAppRequest', [4, 5]],
    ['AdoptLocalAppRequest', [3, 4]],
    ['RemoveLocalAppAdoptionRequest', [3, 4]],
    ['OpenAppRequest', [3, 4]],
  ]);
  for (const action of lifecycleAuthority.actions) {
    const requestName = `${action.consuming_rpc}Request`;
    const fields = messageFields(appProto, requestName);
    const [intentNumber, digestNumber] = expectedNumbers.get(requestName);
    assert.deepEqual(
      fields.filter(({ name }) => ['lifecycle_intent_id', 'displayed_impact_digest'].includes(name)),
      [
        { repeated: false, type: 'string', name: 'lifecycle_intent_id', number: intentNumber },
        { repeated: false, type: 'string', name: 'displayed_impact_digest', number: digestNumber },
      ],
      requestName,
    );
  }
});

test('local-development bootstrap is empty-request and exposes no technical session material', () => {
  assert.deepEqual(messageFields(developmentProto, 'OpenLocalDevelopmentAppSessionRequest'), []);
  assert.deepEqual(messageFields(developmentProto, 'OpenLocalDevelopmentAppSessionResponse'), [
    { repeated: false, type: 'LocalDevelopmentBootstrapState', name: 'state', number: 1 },
    { repeated: false, type: 'string', name: 'app_id', number: 2 },
    { repeated: false, type: 'string', name: 'bootstrap_artifact_id', number: 3 },
    { repeated: false, type: 'google.protobuf.Timestamp', name: 'expires_at', number: 4 },
    { repeated: false, type: 'uint64', name: 'account_generation', number: 5 },
    { repeated: false, type: 'bytes', name: 'runtime_boot_epoch', number: 6 },
    { repeated: false, type: 'ReasonCode', name: 'reason_code', number: 7 },
  ]);
  for (const forbidden of ['session_id', 'session_proof', 'session_token', 'launch_ticket', 'credential', 'token']) {
    assert.doesNotMatch(namedBlock(developmentProto, 'message', 'OpenLocalDevelopmentAppSessionResponse'), new RegExp(`\\b${forbidden}\\b`));
  }
  for (const [method, request, response] of [
    ['EvaluateLocalDevelopmentProject', 'EvaluateLocalDevelopmentProjectRequest', 'EvaluateLocalDevelopmentProjectResponse'],
    ['DecideLocalDevelopmentProject', 'DecideLocalDevelopmentProjectRequest', 'DecideLocalDevelopmentProjectResponse'],
    ['ListLocalDevelopmentAuthorizations', 'ListLocalDevelopmentAuthorizationsRequest', 'ListLocalDevelopmentAuthorizationsResponse'],
    ['RevokeLocalDevelopmentAuthorization', 'RevokeLocalDevelopmentAuthorizationRequest', 'RevokeLocalDevelopmentAuthorizationResponse'],
    ['PrepareLocalDevelopmentLaunch', 'PrepareLocalDevelopmentLaunchRequest', 'PrepareLocalDevelopmentLaunchResponse'],
    ['BindLocalDevelopmentHostProcess', 'BindLocalDevelopmentHostProcessRequest', 'BindLocalDevelopmentHostProcessResponse'],
    ['OpenLocalDevelopmentAppSession', 'OpenLocalDevelopmentAppSessionRequest', 'OpenLocalDevelopmentAppSessionResponse'],
    ['GetLocalDevelopmentSessionStatus', 'GetLocalDevelopmentSessionStatusRequest', 'GetLocalDevelopmentSessionStatusResponse'],
    ['EndLocalDevelopmentRun', 'EndLocalDevelopmentRunRequest', 'EndLocalDevelopmentRunResponse'],
  ]) {
    assertRpc(developmentProto, 'RuntimeDevelopmentService', method, request, response);
  }
});

test('all admitted protected-local reason codes preserve their authority values', () => {
  const protectedReasons = reasonAuthority.codes.filter(({ value }) => value >= 620 && value <= 650);
  const commonReasons = new Map(enumEntries(commonProto, 'ReasonCode').map(({ name, value }) => [name, value]));
  assert.equal(protectedReasons.length, 31);
  for (const reason of protectedReasons) {
    assert.equal(commonReasons.get(reason.name), reason.value, reason.name);
  }
});

test('generated Runtime, SDK, and Kit projections carry protected methods and remove public token types', () => {
	const goAuth = read('runtime/gen/runtime/v1/auth.pb.go');
	const goApp = read('runtime/gen/runtime/v1/app.pb.go');
	const goAccount = read('runtime/gen/runtime/v1/account.pb.go');
	const sdkAuth = read('sdks/typescript/core-generated/runtime-protobuf/runtime/v1/auth.ts');
	const sdkApp = read('sdks/typescript/core-generated/runtime-protobuf/runtime/v1/app.ts');
	const sdkAccount = read('sdks/typescript/core-generated/runtime-protobuf/runtime/v1/account.ts');
  const sdkPosture = read('sdks/typescript/core-generated/runtime-rpc-auth-posture.ts');
  const kitBridge = read('kit/shell/tauri/src/runtime_bridge/generated/nimi.runtime.v1.rs');
  const genericBridgeMethods = read('kit/shell/tauri/src/runtime_bridge/generated/method_ids.rs');
  const publicRuntimeBarrel = read('sdks/typescript/runtime/generated.ts');

  for (const source of [goAuth, sdkAuth, kitBridge]) assert.match(source, /OpenDesktopSession/);
  for (const source of [goApp, sdkApp, kitBridge]) {
    assert.match(source, /PrepareAppLifecycleIntent/);
    assert.match(source, /GetAppLifecycleIntentStatus/);
  }

  const denyMethods = [
    'RuntimeGrantService/AuthorizeExternalPrincipal',
    'RuntimeGrantService/ValidateAppAccessToken',
    'RuntimeGrantService/RevokeAppAccessToken',
    'RuntimeGrantService/IssueDelegatedAccessToken',
    'RuntimeGrantService/ListTokenChain',
  ];
	for (const method of denyMethods) {
    assert.match(
      sdkPosture,
      new RegExp(`/nimi\\.runtime\\.v1\\.${method}\\\": \\\"deny_all_tombstone\\\"`),
      method,
    );
	}
	for (const source of [goAccount, sdkAccount, kitBridge, sdkPosture]) {
		assert.doesNotMatch(source, /(?:GetAccessToken|RefreshAccountSession)/, 'public Runtime credential surface remains projected');
	}
  for (const protectedOrDeniedMethod of [
    'RuntimeAuthService/OpenDesktopSession',
    'RuntimeAccountService/BeginLogin',
    'RuntimeAppService/PrepareAppLifecycleIntent',
    'RuntimeAppService/GetAppLifecycleIntentStatus',
    'RuntimeAppService/InstallApp',
    ...denyMethods,
  ]) {
    assert.doesNotMatch(
      genericBridgeMethods,
      new RegExp(`/nimi\\.runtime\\.v1\\.${protectedOrDeniedMethod}\\\"`),
      `generic bridge exposed ${protectedOrDeniedMethod}`,
    );
  }
  for (const credentialType of [
    'AuthorizeExternalPrincipalResponse',
    'GetAccessTokenRequest',
    'GetAccessTokenResponse',
    'RefreshAccountSessionRequest',
    'RefreshAccountSessionResponse',
  ]) {
    assert.doesNotMatch(publicRuntimeBarrel, new RegExp(`\\b${credentialType}\\b`), credentialType);
  }
});
