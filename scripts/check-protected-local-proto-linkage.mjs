import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(scriptDir, '..');

export const SOURCE_PATHS = Object.freeze({
  accountProto: 'proto/runtime/v1/account.proto',
  appProto: 'proto/runtime/v1/app.proto',
  authProto: 'proto/runtime/v1/auth.proto',
  commonProto: 'proto/runtime/v1/common.proto',
  developmentProto: 'proto/runtime/v1/development.proto',
  identityMap: '.nimi/spec/runtime/kernel/tables/rpc-migration-map/methods-identity-app.yaml',
  excludedMap: '.nimi/spec/runtime/kernel/tables/rpc-migration-map/excluded-proto-methods.yaml',
  reasonAuthority: '.nimi/spec/runtime/kernel/tables/reason-codes/10-general-auth-connector.yaml',
});

const RETIRED_PUBLIC_VOCABULARY = Object.freeze([
  'ACCOUNT_CALLER_MODE_LOCAL_DEVELOPER_APP',
  'ACCOUNT_CALLER_MODE_DESKTOP_LAUNCHED_NIMI_APP',
  'OpenDesktopLaunchedAppSession',
  'AdoptLocalApp',
  'ListLocalAppAdoptions',
  'RemoveLocalAppAdoption',
  'OpenApp',
  'BindInstalledLaunchProcess',
  'PrepareLocalDevelopmentLaunch',
  'BindLocalDevelopmentHostProcess',
  'OpenLocalDevelopmentAppSession',
  'GetLocalDevelopmentSessionStatus',
]);

const FINAL_METHOD_MAPPINGS = Object.freeze([
  ['RuntimeAuthService', 'OpenLocalAppSession'],
  ['RuntimeAccountService', 'GetLocalAppGrantStatus'],
  ['RuntimeAccountService', 'RequestLocalAppGrant'],
  ['RuntimeAccountService', 'DecideLocalAppGrant'],
  ['RuntimeAccountService', 'RevokeLocalAppGrant'],
  ['RuntimeAppService', 'PrepareLocalAppLaunch'],
  ['RuntimeAppService', 'BindLocalAppProcess'],
  ['RuntimeDevelopmentService', 'GetDeveloperModeStatus'],
  ['RuntimeDevelopmentService', 'SetDeveloperMode'],
  ['RuntimeDevelopmentService', 'ReactivateLocalDevelopmentProject'],
]);

const LOCAL_APP_REASONS = Object.freeze([
  'LOCAL_APP_PRINCIPAL_REQUIRED',
  'LOCAL_APP_RECORD_NOT_FOUND',
  'LOCAL_APP_RECORD_TOMBSTONED',
  'LOCAL_APP_PROVENANCE_UNAVAILABLE',
  'LOCAL_APP_LAUNCH_LEASE_REQUIRED',
  'LOCAL_APP_LAUNCH_LEASE_MISMATCH',
  'LOCAL_APP_LAUNCH_LEASE_REPLAY',
  'LOCAL_APP_PROCESS_MISMATCH',
  'LOCAL_APP_SESSION_REVOKED',
  'LOCAL_APP_GRANT_REQUIRED',
  'LOCAL_APP_GRANT_REVOKED',
  'LOCAL_APP_GRANT_SUPERSEDED',
  'LOCAL_APP_ACCOUNT_CHANGED',
  'LOCAL_APP_OPERATION_UNAVAILABLE',
  'LOCAL_APP_PRESENCE_REQUIRED',
  'LOCAL_APP_PRESENCE_EXPIRED',
  'LOCAL_APP_DEVELOPER_MODE_DISABLED',
  'LOCAL_APP_REMEMBERED_PROJECT_DORMANT',
  'LOCAL_APP_RISK_DISCLOSURE_REQUIRED',
]);

function stripProtoComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|\s)\/\/.*$/gmu, '$1');
}

function namedBlock(source, keyword, name) {
  const clean = stripProtoComments(source);
  const match = new RegExp(`\\b${keyword}\\s+${name}\\s*\\{`, 'u').exec(clean);
  if (!match) return null;
  const open = clean.indexOf('{', match.index);
  let depth = 0;
  for (let index = open; index < clean.length; index += 1) {
    if (clean[index] === '{') depth += 1;
    if (clean[index] === '}') {
      depth -= 1;
      if (depth === 0) return clean.slice(open + 1, index);
    }
  }
  return null;
}

function messageFields(source, name) {
  const body = namedBlock(source, 'message', name);
  if (body === null) return null;
  return body
    .split(';')
    .map((statement) => statement.trim())
    .map((statement) => statement.match(/^(?:optional\s+)?(repeated\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\d+)$/u))
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
  if (body === null) return null;
  return [...body.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(\d+)\s*;/gmu)]
    .map((match) => ({ name: match[1], value: Number(match[2]) }));
}

function enumReservedNames(source, name) {
  const body = namedBlock(source, 'enum', name);
  if (body === null) return null;
  return [...body.matchAll(/\breserved\s+([^;]+);/gu)]
    .flatMap((match) => [...match[1].matchAll(/"([A-Z][A-Z0-9_]*)"/gu)].map((entry) => entry[1]))
    .sort();
}

function stripProtoReservedHistory(source) {
  return source.replace(/\breserved\s+[^;]+;/gu, '');
}

function rpcExists(source, service, method, request, response) {
  const body = namedBlock(source, 'service', service);
  if (body === null) return false;
  return new RegExp(
    `\\brpc\\s+${method}\\s*\\(\\s*${request}\\s*\\)\\s*returns\\s*\\(\\s*${response}\\s*\\)`,
    'u',
  ).test(body);
}

function stable(value) {
  return JSON.stringify(value);
}

function expectedFields(rows) {
  return rows.map(([type, name, number, repeated = false]) => ({ repeated, type, name, number }));
}

function issueSuffix(name) {
  return name.replace(/([a-z0-9])([A-Z])/gu, '$1_$2').toUpperCase();
}

export function loadProtectedLocalProtoLinkageBundle(root = repoRoot) {
  return Object.fromEntries(
    Object.entries(SOURCE_PATHS).map(([key, relativePath]) => [
      key,
      readFileSync(path.join(root, relativePath), 'utf8'),
    ]),
  );
}

export function validateProtectedLocalProtoLinkage(bundle) {
  const issues = [];
  const add = (code, detail) => issues.push({ code, detail });
  const expectMessage = (source, name, fields, code) => {
    const actual = messageFields(source, name);
    if (stable(actual) !== stable(fields)) add(code, `${name} fields are ${stable(actual)}`);
  };
  const expectRpc = (source, service, method, request, response, code) => {
    if (!rpcExists(source, service, method, request, response)) {
      add(code, `${service}.${method} is missing or has the wrong request/response types`);
    }
  };

  expectMessage(bundle.authProto, 'OpenLocalAppSessionRequest', [], 'PLINK_AUTH_REQUEST_EMPTY');
  expectMessage(bundle.authProto, 'OpenLocalAppSessionResponse', expectedFields([
    ['LocalAppSessionState', 'state', 1],
    ['LocalAppTrustClass', 'trust_class', 2],
    ['uint64', 'account_generation', 3],
    ['bytes', 'runtime_boot_epoch', 4],
    ['ReasonCode', 'reason_code', 5],
  ]), 'PLINK_AUTH_RESPONSE_SHAPE');
  expectRpc(
    bundle.authProto,
    'RuntimeAuthService',
    'OpenLocalAppSession',
    'OpenLocalAppSessionRequest',
    'OpenLocalAppSessionResponse',
    'PLINK_AUTH_RPC',
  );

  expectMessage(bundle.appProto, 'PrepareLocalAppLaunchRequest', expectedFields([
    ['bytes', 'local_app_handle', 1],
    ['bytes', 'supervisor_run_id', 2],
  ]), 'PLINK_PREPARE_REQUEST_SHAPE');
  expectMessage(bundle.appProto, 'PrepareLocalAppLaunchResponse', expectedFields([
    ['bytes', 'launch_id', 1],
    ['google.protobuf.Timestamp', 'bind_deadline', 2],
    ['ReasonCode', 'reason_code', 3],
  ]), 'PLINK_PREPARE_RESPONSE_SHAPE');
  expectMessage(bundle.appProto, 'BindLocalAppProcessRequest', expectedFields([
    ['bytes', 'launch_id', 1],
    ['uint32', 'child_process_id', 2],
  ]), 'PLINK_BIND_REQUEST_SHAPE');
  expectMessage(bundle.appProto, 'BindLocalAppProcessResponse', expectedFields([
    ['bytes', 'launch_id', 1],
    ['google.protobuf.Timestamp', 'bind_deadline', 2],
    ['ReasonCode', 'reason_code', 3],
  ]), 'PLINK_BIND_RESPONSE_SHAPE');
  expectRpc(bundle.appProto, 'RuntimeAppService', 'PrepareLocalAppLaunch', 'PrepareLocalAppLaunchRequest', 'PrepareLocalAppLaunchResponse', 'PLINK_PREPARE_RPC');
  expectRpc(bundle.appProto, 'RuntimeAppService', 'BindLocalAppProcess', 'BindLocalAppProcessRequest', 'BindLocalAppProcessResponse', 'PLINK_BIND_RPC');

  expectMessage(bundle.developmentProto, 'GetDeveloperModeStatusRequest', [], 'PLINK_DEVELOPER_MODE_STATUS_REQUEST_EMPTY');
  expectMessage(bundle.developmentProto, 'GetDeveloperModeStatusResponse', expectedFields([
    ['DeveloperModeState', 'state', 1],
    ['uint64', 'revision', 2],
    ['uint64', 'account_generation', 3],
    ['ReasonCode', 'reason_code', 4],
  ]), 'PLINK_DEVELOPER_MODE_STATUS_RESPONSE_SHAPE');
  expectMessage(bundle.developmentProto, 'SetDeveloperModeRequest', expectedFields([
    ['bool', 'enabled', 1],
  ]), 'PLINK_DEVELOPER_MODE_SET_REQUEST_SHAPE');
  expectMessage(bundle.developmentProto, 'SetDeveloperModeResponse', expectedFields([
    ['DeveloperModeState', 'state', 1],
    ['uint64', 'revision', 2],
    ['uint64', 'account_generation', 3],
    ['ReasonCode', 'reason_code', 4],
  ]), 'PLINK_DEVELOPER_MODE_SET_RESPONSE_SHAPE');
  expectMessage(bundle.developmentProto, 'DecideLocalDevelopmentProjectRequest', expectedFields([
    ['bytes', 'evaluation_id', 1],
    ['LocalDevelopmentDecision', 'decision', 2],
    ['bool', 'risk_disclosure_acknowledged', 3],
  ]), 'PLINK_DEVELOPMENT_DECISION_RISK_ACK');
  expectMessage(bundle.developmentProto, 'ListLocalDevelopmentAuthorizationsRequest', [], 'PLINK_DEVELOPMENT_LIST_REQUEST_EMPTY');
  expectMessage(bundle.developmentProto, 'ReactivateLocalDevelopmentProjectRequest', expectedFields([
    ['bytes', 'authorization_id', 1],
    ['bool', 'risk_disclosure_acknowledged', 2],
  ]), 'PLINK_DEVELOPMENT_REACTIVATE_REQUEST_SHAPE');
  expectMessage(bundle.developmentProto, 'ReactivateLocalDevelopmentProjectResponse', expectedFields([
    ['LocalDevelopmentAuthorizationProjection', 'authorization', 1],
    ['ReasonCode', 'reason_code', 2],
  ]), 'PLINK_DEVELOPMENT_REACTIVATE_RESPONSE_SHAPE');
  for (const [method, request, response] of [
    ['GetDeveloperModeStatus', 'GetDeveloperModeStatusRequest', 'GetDeveloperModeStatusResponse'],
    ['SetDeveloperMode', 'SetDeveloperModeRequest', 'SetDeveloperModeResponse'],
    ['EvaluateLocalDevelopmentProject', 'EvaluateLocalDevelopmentProjectRequest', 'EvaluateLocalDevelopmentProjectResponse'],
    ['DecideLocalDevelopmentProject', 'DecideLocalDevelopmentProjectRequest', 'DecideLocalDevelopmentProjectResponse'],
    ['ListLocalDevelopmentAuthorizations', 'ListLocalDevelopmentAuthorizationsRequest', 'ListLocalDevelopmentAuthorizationsResponse'],
    ['ReactivateLocalDevelopmentProject', 'ReactivateLocalDevelopmentProjectRequest', 'ReactivateLocalDevelopmentProjectResponse'],
    ['RevokeLocalDevelopmentAuthorization', 'RevokeLocalDevelopmentAuthorizationRequest', 'RevokeLocalDevelopmentAuthorizationResponse'],
    ['EndLocalDevelopmentRun', 'EndLocalDevelopmentRunRequest', 'EndLocalDevelopmentRunResponse'],
  ]) {
    expectRpc(bundle.developmentProto, 'RuntimeDevelopmentService', method, request, response, `PLINK_DEVELOPMENT_RPC_${issueSuffix(method)}`);
  }

  const localAppCaller = enumEntries(bundle.accountProto, 'AccountCallerMode')
    ?.filter(({ name }) => name === 'ACCOUNT_CALLER_MODE_LOCAL_APP') ?? [];
  if (stable(localAppCaller) !== stable([{ name: 'ACCOUNT_CALLER_MODE_LOCAL_APP', value: 9 }])) {
    add('PLINK_ACCOUNT_CALLER_LOCAL_APP', `LOCAL_APP caller entry is ${stable(localAppCaller)}`);
  }
  const reservedCallerNames = enumReservedNames(bundle.accountProto, 'AccountCallerMode');
  const expectedReservedCallerNames = [
    'ACCOUNT_CALLER_MODE_DESKTOP_LAUNCHED_NIMI_APP',
    'ACCOUNT_CALLER_MODE_LOCAL_DEVELOPER_APP',
    'ACCOUNT_CALLER_MODE_MOD',
  ];
  if (stable(reservedCallerNames) !== stable(expectedReservedCallerNames)) {
    add(
      'PLINK_ACCOUNT_CALLER_RETIRED_NAMES_RESERVED',
      `AccountCallerMode reserved names are ${stable(reservedCallerNames)}`,
    );
  }
  expectMessage(bundle.accountProto, 'LocalAppGrantProjection', expectedFields([
    ['LocalAppGrantState', 'state', 1],
    ['string', 'operation_id', 2],
    ['string', 'resource_ref', 3],
    ['bytes', 'request_id', 4],
    ['bytes', 'grant_id', 5],
    ['uint64', 'grant_generation', 6],
    ['uint64', 'grant_revision', 7],
    ['google.protobuf.Timestamp', 'expires_at', 8],
    ['ReasonCode', 'reason_code', 9],
    ['bytes', 'presence_challenge_id', 10],
  ]), 'PLINK_GRANT_PROJECTION_SHAPE');
  const grantMessages = [
    ['GetLocalAppGrantStatusRequest', [['string', 'operation_id', 1], ['string', 'resource_ref', 2]]],
    ['GetLocalAppGrantStatusResponse', [['LocalAppGrantProjection', 'projection', 1]]],
    ['RequestLocalAppGrantRequest', [['string', 'operation_id', 1], ['string', 'resource_ref', 2], ['string', 'purpose', 3]]],
    ['RequestLocalAppGrantResponse', [['LocalAppGrantProjection', 'projection', 1]]],
    ['DecideLocalAppGrantRequest', [['bytes', 'request_id', 1], ['bool', 'approved', 2], ['bytes', 'presence_challenge_id', 3]]],
    ['DecideLocalAppGrantResponse', [['LocalAppGrantProjection', 'projection', 1]]],
    ['RevokeLocalAppGrantRequest', [['bytes', 'grant_id', 1]]],
    ['RevokeLocalAppGrantResponse', [['LocalAppGrantProjection', 'projection', 1]]],
  ];
  for (const [name, fields] of grantMessages) {
    expectMessage(bundle.accountProto, name, expectedFields(fields), `PLINK_GRANT_MESSAGE_${issueSuffix(name)}`);
  }
  for (const method of ['GetLocalAppGrantStatus', 'RequestLocalAppGrant', 'DecideLocalAppGrant', 'RevokeLocalAppGrant']) {
    expectRpc(bundle.accountProto, 'RuntimeAccountService', method, `${method}Request`, `${method}Response`, `PLINK_GRANT_RPC_${issueSuffix(method)}`);
  }

  const authority = parseYaml(bundle.reasonAuthority);
  const authorityReasons = new Map(
    (authority.codes ?? [])
      .filter(({ value }) => Number(value) >= 642 && Number(value) <= 660)
      .map(({ name, value }) => [String(name), Number(value)]),
  );
  const protoReasons = new Map(enumEntries(bundle.commonProto, 'ReasonCode')?.map(({ name, value }) => [name, value]) ?? []);
  const expectedReasonPairs = LOCAL_APP_REASONS.map((name, index) => [name, 642 + index]);
  if (stable([...authorityReasons]) !== stable(expectedReasonPairs)) {
    add('PLINK_REASON_AUTHORITY_RANGE', `authority LOCAL_APP reasons are ${stable([...authorityReasons])}`);
  }
  if (stable(expectedReasonPairs.map(([name, value]) => [name, protoReasons.get(name)])) !== stable(expectedReasonPairs)) {
    add('PLINK_REASON_PROTO_RANGE', 'Proto LOCAL_APP reason names or values diverge from 642..660');
  }

  const identityMap = parseYaml(bundle.identityMap);
  const mappings = Array.isArray(identityMap.method_mappings) ? identityMap.method_mappings : [];
  if (Number(identityMap.method_count) !== mappings.length) {
    add('PLINK_MAPPING_COUNT', `method_count=${identityMap.method_count}, rows=${mappings.length}`);
  }
  for (const [service, method] of FINAL_METHOD_MAPPINGS) {
    const row = mappings.find((candidate) => candidate.design_service === service && candidate.design_method === method);
    if (
      row?.proto_service !== service
      || row?.proto_method !== method
      || row?.mapping_posture !== 'aligned'
    ) {
      add('PLINK_FINAL_MAPPING', `${service}.${method} is not aligned to its final same-name Proto method`);
    }
  }
  if (mappings.some(({ mapping_posture: posture }) => posture === 'proto_target_unassigned')) {
    add('PLINK_UNASSIGNED_MAPPING', 'identity/app migration map still contains proto_target_unassigned');
  }

  const excludedMap = parseYaml(bundle.excludedMap);
  const exclusions = Array.isArray(excludedMap.excluded_proto_methods) ? excludedMap.excluded_proto_methods : [];
  if (Number(excludedMap.excluded_count) !== 0 || exclusions.length !== 0) {
    add('PLINK_EXCLUDED_METHODS_NOT_EMPTY', `excluded_count=${excludedMap.excluded_count}, rows=${exclusions.length}`);
  }

  const retiredSources = [
    bundle.accountProto,
    bundle.appProto,
    bundle.authProto,
    bundle.developmentProto,
    bundle.identityMap,
    bundle.excludedMap,
  ].map((source) => stripProtoReservedHistory(stripProtoComments(source))).join('\n');
  const presentRetired = RETIRED_PUBLIC_VOCABULARY.filter((term) => new RegExp(`\\b${term}\\b`, 'u').test(retiredSources));
  if (presentRetired.length > 0) {
    add('PLINK_RETIRED_PUBLIC_VOCABULARY', `retired terms remain: ${presentRetired.join(', ')}`);
  }

  return issues;
}

export function applyProtectedLocalProtoLinkageFixture(bundle, fixture) {
  const key = Object.entries(SOURCE_PATHS).find(([, relativePath]) => relativePath === fixture.target)?.[0];
  if (!key) throw new Error(`unknown fixture target: ${fixture.target}`);
  const current = bundle[key];
  if (!current.includes(fixture.mutation.from)) {
    throw new Error(`fixture ${fixture.fixture_id} source text not found in ${fixture.target}`);
  }
  return {
    ...bundle,
    [key]: current.replace(fixture.mutation.from, fixture.mutation.to),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const issues = validateProtectedLocalProtoLinkage(loadProtectedLocalProtoLinkageBundle());
  if (issues.length > 0) {
    for (const issue of issues) process.stderr.write(`[${issue.code}] ${issue.detail}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('[check-protected-local-proto-linkage] OK\n');
  }
}
