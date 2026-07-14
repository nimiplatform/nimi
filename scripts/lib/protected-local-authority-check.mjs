import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export const MODES = Object.freeze([
  'protected-local-authority',
  'protected-rpc-posture',
  'no-portable-privileged-session',
  'protected-local-trust-set-isolation',
]);

export const AUTHORITY_PATHS = Object.freeze({
  contract: '.nimi/spec/runtime/kernel/protected-local-session-contract.md',
  osProfiles: '.nimi/spec/runtime/kernel/tables/protected-local-os-profiles.yaml',
  runtimePrincipals: '.nimi/spec/runtime/kernel/tables/protected-local-runtime-principal-profiles.yaml',
  transport: '.nimi/spec/runtime/kernel/tables/protected-local-rpc-transport-matrix.yaml',
  lifecycle: '.nimi/spec/runtime/kernel/tables/protected-local-lifecycle-intent-protocol.yaml',
  principalRecord: '.nimi/spec/runtime/kernel/tables/local-app-principal-record-schema.yaml',
  grant: '.nimi/spec/runtime/kernel/tables/local-app-grant-binding-schema.yaml',
  presence: '.nimi/spec/runtime/kernel/tables/local-app-presence-protocol.yaml',
  identityPosture: '.nimi/spec/runtime/kernel/tables/runtime-rpc-auth-posture/identity-access.yaml',
  localPosture: '.nimi/spec/runtime/kernel/tables/runtime-rpc-auth-posture/local-connector-model.yaml',
  artifactPosture: '.nimi/spec/runtime/kernel/tables/runtime-rpc-auth-posture/audit-artifact-workflow.yaml',
  rpcMethods: '.nimi/spec/runtime/kernel/tables/rpc-methods.yaml',
  trust: '.nimi/spec/platform/kernel/tables/protected-local-executable-trust-sets.yaml',
  sdkGroups: '.nimi/spec/sdks/kernel/tables/runtime-method-groups.yaml',
});

const EXPECTED_TRANSPORTS = Object.freeze([
  'public_tcp',
  'desktop_control',
  'local_app_bootstrap',
  'local_app_host',
]);

const EXPECTED_ROLES = Object.freeze([
  'binding_only',
  'verified_desktop_process',
  'desktop_account_host',
  'local_app_control',
  'local_app_process',
  'local_app_session',
]);

const PACKAGE_METHODS = Object.freeze([
  'PrepareAppLifecycleIntent',
  'GetAppLifecycleIntentStatus',
  'InstallApp',
  'UninstallApp',
  'GetAppPackageReadiness',
  'GetAppInstallJob',
  'ListAppInstallJobs',
  'WatchAppInstallJobEvents',
  'UpdateApp',
  'HealthRepairApp',
]);

const PACKAGE_DENY_METHODS = new Set(PACKAGE_METHODS.filter((name) => name !== 'GetAppPackageReadiness'));

const DESKTOP_PRODUCT_CONTROL_METHODS = Object.freeze([
  'CollectDeviceProfile',
  'ResolveLocalEnvironmentPlan',
  'ListLocalEnvironmentDependencyJobs',
  'StartLocalEnvironmentDependencyJob',
  'CancelLocalEnvironmentDependencyJob',
  'RetryLocalEnvironmentDependencyJob',
  'RepairLocalEnvironmentDependency',
  'ResolveRuntimeBaselineReadiness',
  'MintRuntimeBaselineReadiness',
  'ResolveFirstRunExecutionEvidence',
  'MintFirstRunExecutionEvidence',
  'GetProductControlRecord',
  'GetProductControlSelectedDataRoot',
  'EnsureProductControlRecordCreated',
  'SelectProductControlDataRoot',
  'SetProductControlFirstRunInstallLevel',
  'CompleteProductControlFirstRunDeviceEnvironmentScan',
  'AdmitProductControlReadyForUse',
  'RecordProductControlAccountDefaultProfileEvidence',
  'RecordProductControlFirstRunLocalAiReadyEvidence',
  'ReconcileProductControlFirstRunSetupState',
].map((method) => `/nimi.runtime.v1.RuntimeLocalService/${method}`));

const RETIRED_PUBLIC_VOCABULARY = Object.freeze([
  'ACCOUNT_CALLER_MODE_LOCAL_DEVELOPER_APP',
  'ACCOUNT_CALLER_MODE_DESKTOP_LAUNCHED_NIMI_APP',
  'OpenLocalDevelopmentAppSession',
  'OpenDesktopLaunchedAppSession',
  'launch_bootstrap',
  'installed_host',
  'verified_local_app_process',
  'desktop_lifecycle_host',
]);

function issue(code, target, reason) {
  return { code, target, reason };
}

function equalArray(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function hasEvery(actual, required) {
  return Array.isArray(actual) && required.every((value) => actual.includes(value));
}

function rowsBy(rows, key) {
  return new Map((Array.isArray(rows) ? rows : []).map((row) => [row?.[key], row]));
}

function parseYaml(bundle, relative, issues) {
  const source = bundle.get(relative);
  if (typeof source !== 'string') {
    issues.push(issue('AUTHORITY_FILE_MISSING', relative, 'Required protected-local authority input is missing.'));
    return null;
  }
  try {
    return YAML.parse(source);
  } catch (error) {
    issues.push(issue('AUTHORITY_YAML_INVALID', relative, `Authority YAML is invalid: ${error.message}`));
    return null;
  }
}

export function loadAuthorityBundle(repoRoot) {
  return new Map(Object.values(AUTHORITY_PATHS).map((relative) => {
    const absolute = path.join(repoRoot, relative);
    return [relative, fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : null];
  }));
}

function validateRetiredVocabulary(bundle, issues) {
  for (const [relative, source] of bundle) {
    if (typeof source !== 'string') continue;
    const found = RETIRED_PUBLIC_VOCABULARY.find((term) => source.includes(term));
    if (found) {
      issues.push(issue(
        'RETIRED_PUBLIC_VOCABULARY_FORBIDDEN',
        relative,
        `Retired protected-local public vocabulary remains active: ${found}.`,
      ));
      return;
    }
  }
}

function validateStores(bundle, issues) {
  const schema = parseYaml(bundle, AUTHORITY_PATHS.principalRecord, issues);
  const grant = parseYaml(bundle, AUTHORITY_PATHS.grant, issues);
  const presence = parseYaml(bundle, AUTHORITY_PATHS.presence, issues);

  if (
    schema?.local_os_user_anchor?.owner !== 'runtime_protected_local'
    || schema?.local_os_user_anchor?.windows_source !== 'verified_interactive_user_sid'
    || schema?.local_os_user_anchor?.request_supplied !== 'forbidden'
    || schema?.local_os_user_anchor?.active_anchors_per_data_root !== 1
  ) {
    issues.push(issue(
      'SID_PARTITION_REQUIRED',
      AUTHORITY_PATHS.principalRecord,
      'The local OS user anchor must be Runtime-derived from the verified interactive Windows SID and never request supplied.',
    ));
  }

  const principalFields = schema?.principal?.fields ?? [];
  const recordFields = schema?.record?.fields ?? [];
  const requiredPrincipalFields = [
    'local_os_user_anchor',
    'local_app_principal_id',
    'principal_kind',
    'app_id',
    'immutable_lineage_id',
    'development_authorization_id',
    'canonical_project_file_id',
    'state',
  ];
  const requiredRecordFields = [
    'local_os_user_anchor',
    'local_app_record_id',
    'local_app_principal_id',
    'trust_class',
    'provenance_attestation_refs',
    'provenance_revision',
    'execution_profile_ref',
    'host_executable_digest',
    'payload_root_digest',
    'lifecycle_state',
  ];
  if (
    schema?.principal?.store_identity !== 'local_app_principals'
    || schema?.record?.store_identity !== 'local_app_records'
    || schema?.principal?.store_identity === schema?.record?.store_identity
    || !hasEvery(principalFields, requiredPrincipalFields)
    || !hasEvery(recordFields, requiredRecordFields)
    || recordFields.includes('immutable_lineage_id')
    || !hasEvery(schema?.principal?.invariants, [
      'local_app_principal_id_is_random_non_reused_and_opaque',
      'app_id_is_not_a_security_or_storage_key',
      'tombstoned_principal_cannot_be_reactivated',
    ])
    || schema?.store_separation?.principal_and_record_are_distinct_records !== true
    || schema?.store_separation?.shared_serialized_record !== 'forbidden'
    || schema?.store_separation?.app_id_positive_key !== 'forbidden'
    || schema?.principal_lineage_binding?.exactly_one_branch_required !== true
  ) {
    issues.push(issue(
      'PRINCIPAL_RECORD_STORE_SEPARATION_REQUIRED',
      AUTHORITY_PATHS.principalRecord,
      'Principal and record must remain separate SID-partitioned stores with random non-reused principal identity and an exclusive lineage branch.',
    ));
  }

  if (
    grant?.grant?.store_identity !== 'local_app_grants'
    || !equalArray(grant?.grant?.key, [
      'local_os_user_anchor',
      'account_id',
      'local_app_principal_id',
      'capability_resource_fingerprint',
    ])
    || grant?.store_separation?.principal_record_store_dependency !== 'reference_only'
    || grant?.store_separation?.launch_session_store_dependency !== 'none'
    || grant?.store_separation?.shared_serialized_record !== 'forbidden'
    || grant?.store_separation?.app_id_positive_key !== 'forbidden'
    || !hasEvery(grant?.grant?.invariants, [
      'install_project_authorization_or_promotion_creates_zero_grant',
      'trust_class_has_no_permission_effect',
      'account_switch_never_transfers_grant',
      'next_protected_operation_reads_current_grant',
      'no_app_id_only_positive_lookup',
    ])
  ) {
    issues.push(issue(
      'GRANT_STORE_SEPARATION_REQUIRED',
      AUTHORITY_PATHS.grant,
      'Grant authority must remain a separate account-and-principal keyed store; trust, install, and app id cannot imply permission.',
    ));
  }

  if (
    presence?.challenge?.owner !== 'runtime_account_service'
    || presence?.challenge?.request_supplied_authority !== 'forbidden'
    || presence?.challenge?.consume !== 'atomic_with_state_change'
    || !hasEvery(presence?.challenge?.required_bindings, [
      'local_os_user_anchor',
      'account_id',
      'account_generation',
      'local_app_principal_id',
      'local_app_record_id',
      'provenance_revision',
      'release_or_project_generation',
      'policy_revision',
      'nonce',
    ])
  ) {
    issues.push(issue(
      'PRESENCE_AUTHORITY_BINDING_REQUIRED',
      AUTHORITY_PATHS.presence,
      'Presence must be Runtime-owned, request-non-authoritative, and atomically bound to the current SID/account/principal/record/revision tuple.',
    ));
  }
}

function validateFixedService(bundle, issues) {
  const principals = parseYaml(bundle, AUTHORITY_PATHS.runtimePrincipals, issues);
  const osProfiles = parseYaml(bundle, AUTHORITY_PATHS.osProfiles, issues);
  const windows = (principals?.profiles ?? []).find((row) => row.os === 'windows');
  const windowsOs = (osProfiles?.profiles ?? []).find((row) => row.os === 'windows');
  const control = principals?.desktop_service_control;
  if (
    principals?.production_runtime_execution_mode !== 'isolated_os_service_principal'
    || principals?.production_same_interactive_user_daemon_allowed !== false
    || principals?.service_install_authority !== 'signed_nimi_installer_only'
    || principals?.production_environment_or_argv_override !== 'forbidden'
    || control?.operations?.join(',') !== 'status,start,restart'
    || control?.product_stop_operation !== 'absent'
    || control?.desktop_direct_spawn !== 'forbidden'
    || control?.desktop_direct_stop !== 'forbidden'
    || control?.windows?.service_name !== 'NimiRuntime'
    || control?.windows?.service_binary_path_or_arguments_input !== 'forbidden'
    || principals?.windows_service_host?.scm_account !== 'LocalSystem'
    || principals?.windows_service_host?.token_user_sid !== 'S-1-5-18'
    || principals?.windows_service_host?.state_acl_scope !== 'exact_restricted_service_sid_only'
    || principals?.windows_service_host?.local_machine_descriptor_allowed !== false
    || windows?.interactive_user_relation !== 'distinct_os_security_principal'
    || windowsOs?.endpoint_kind !== 'named_pipe'
    || !String(windowsOs?.client_peer_verification ?? '').includes('GetNamedPipeClientProcessId')
    || !String(windowsOs?.server_peer_verification ?? '').includes('GetNamedPipeServerProcessId')
  ) {
    issues.push(issue(
      'FIXED_WINDOWS_SERVICE_REQUIRED',
      AUTHORITY_PATHS.runtimePrincipals,
      'Production Windows Runtime must be the fixed NimiRuntime LocalSystem service with restricted service-SID state, mutual process verification, and no Desktop spawn/stop/config selection.',
    ));
  }

  const acceptance = principals?.service_acceptance_isolation;
  if (
    acceptance?.service_name !== 'NimiRuntime'
    || acceptance?.service_principal !== 'same_production_local_system_and_restricted_service_sid'
    || acceptance?.service_owned_candidate_root !== 'required'
    || acceptance?.environment_or_argv_root_selection !== 'forbidden'
    || acceptance?.candidate_root_acl !== 'restricted_service_sid_only'
    || acceptance?.account_partition !== 'verified_interactive_sid'
    || acceptance?.runtime_lifecycle_and_restart !== 'real_scm_service'
    || acceptance?.parallel_isolation !== 'candidate_namespace_for_state_audit_and_child_pipes'
    || acceptance?.test_only_service_principal !== 'forbidden'
  ) {
    issues.push(issue(
      'SERVICE_ACCEPTANCE_ISOLATION_REQUIRED',
      AUTHORITY_PATHS.runtimePrincipals,
      'Acceptance must exercise the real fixed service with a service-owned candidate root, SID partition, real restart, cleanup, and parallel namespace isolation.',
    ));
  }
}

function validatePackageSeam(bundle, issues) {
  const lifecycle = parseYaml(bundle, AUTHORITY_PATHS.lifecycle, issues);
  const identity = parseYaml(bundle, AUTHORITY_PATHS.identityPosture, issues);
  const sdk = parseYaml(bundle, AUTHORITY_PATHS.sdkGroups, issues);
  if (
    !equalArray(lifecycle?.package_seam?.operations, PACKAGE_METHODS)
    || lifecycle?.package_seam?.positive_disposition !== 'typed_unavailable'
    || !equalArray(lifecycle?.package_seam?.opaque_fields, [
      'immutable_lineage_id',
      'provenance_attestation_refs',
      'provenance_revision',
      'execution_profile_ref',
      'host_executable_digest',
      'payload_root_digest',
    ])
    || lifecycle?.package_seam?.fields_authorize !== false
    || lifecycle?.package_seam?.producer_admission !== 'deferred_to_0p_or_p'
    || lifecycle?.platform_admission?.immutable_package_positive !== 'typed_unavailable_until_0p_or_p'
  ) {
    issues.push(issue(
      'OPAQUE_PACKAGE_SEAM_REQUIRED',
      AUTHORITY_PATHS.lifecycle,
      '0K may freeze only the opaque immutable-package seam; positive package/install/update/promotion must remain typed unavailable.',
    ));
  }

  const postureByMethod = rowsBy(identity?.methods, 'method_id');
  const deniedCorrectly = [...PACKAGE_DENY_METHODS].every((name) => {
    const row = postureByMethod.get(`/nimi.runtime.v1.RuntimeAppService/${name}`);
    return row?.posture === 'unavailable_by_authority' && row?.transport_disposition === 'deny_all';
  });
  const readiness = postureByMethod.get('/nimi.runtime.v1.RuntimeAppService/GetAppPackageReadiness');
  const appGroup = (sdk?.groups ?? []).find((row) => row.group === 'app_lifecycle_service_projection');
  const excluded = new Map((appGroup?.excluded_methods ?? []).map((row) => [row.method, row.authority_status]));
  const sdkUnavailable = [...PACKAGE_DENY_METHODS].every((name) => (
    !appGroup?.methods?.includes(name) && excluded.get(name) === 'typed_unavailable_0k_no_sdk_export'
  ));
  if (
    !deniedCorrectly
    || readiness?.posture !== 'authenticated_required'
    || !String(readiness?.rationale ?? '').includes('typed unavailable')
    || !sdkUnavailable
  ) {
    issues.push(issue(
      'PACKAGE_METHODS_MUST_BE_UNAVAILABLE',
      AUTHORITY_PATHS.identityPosture,
      '0K package lifecycle and job methods must deny by authority and remain absent from active SDK exports; readiness may only return typed unavailable.',
    ));
  }
}

function validateTransport(bundle, issues) {
  const matrix = parseYaml(bundle, AUTHORITY_PATHS.transport, issues);
  const identity = parseYaml(bundle, AUTHORITY_PATHS.identityPosture, issues);
  const local = parseYaml(bundle, AUTHORITY_PATHS.localPosture, issues);
  const artifact = parseYaml(bundle, AUTHORITY_PATHS.artifactPosture, issues);
  const rpcMethods = parseYaml(bundle, AUTHORITY_PATHS.rpcMethods, issues);
  if (!equalArray(matrix?.transport_classes, EXPECTED_TRANSPORTS)) {
    issues.push(issue(
      'FINAL_TRANSPORT_CLASSES_REQUIRED',
      AUTHORITY_PATHS.transport,
      `Transport classes must be exactly ${EXPECTED_TRANSPORTS.join(', ')}.`,
    ));
  }
  if (!equalArray(matrix?.origin_roles, EXPECTED_ROLES)) {
    issues.push(issue(
      'FINAL_ORIGIN_ROLES_REQUIRED',
      AUTHORITY_PATHS.transport,
      `Origin roles must be exactly ${EXPECTED_ROLES.join(', ')}.`,
    ));
  }

  const openWire = matrix?.open_local_app_session_wire;
  const routeByMethod = rowsBy(matrix?.methods, 'method_id');
  const openRoute = routeByMethod.get('/nimi.runtime.v1.RuntimeAuthService/OpenLocalAppSession');
  if (
    !equalArray(openWire?.request?.fields, [])
    || !equalArray(openWire?.request?.request_metadata_authority_inputs, [])
    || openWire?.request?.unknown_field_disposition !== 'reject'
    || !hasEvery(openWire?.response?.forbidden_fields, [
      'local_app_principal_id',
      'local_record_id',
      'grant_id',
      'session_id',
      'session_proof',
      'launch_lease',
      'endpoint',
      'token',
      'credential',
    ])
    || openWire?.atomic_transition !== 'launch_lease_consume_and_private_local_app_session_insert'
    || openWire?.ordinary_grpc_disposition !== 'deny'
    || openRoute?.operation_class !== 'local_app_session_bootstrap'
    || !equalArray(openRoute?.allowed_transport_classes, ['local_app_bootstrap'])
    || !equalArray(openRoute?.required_origin_roles, ['local_app_process'])
  ) {
    issues.push(issue(
      'LOCAL_APP_SESSION_WIRE_REQUIRED',
      AUTHORITY_PATHS.transport,
      'OpenLocalAppSession must be request-empty, exact-process/lease bound, non-portable, and atomically create a private zero-grant session.',
    ));
  }

  const postureByMethod = rowsBy([...(identity?.methods ?? []), ...(artifact?.methods ?? [])], 'method_id');
  const requiredRoutes = new Map([
    ['/nimi.runtime.v1.RuntimeAuthService/OpenLocalAppSession', [['local_app_bootstrap'], ['local_app_process']]],
    ['/nimi.runtime.v1.RuntimeAppService/PrepareLocalAppLaunch', [['desktop_control'], ['local_app_control']]],
    ['/nimi.runtime.v1.RuntimeAppService/BindLocalAppProcess', [['desktop_control'], ['local_app_control']]],
    ['/nimi.runtime.v1.RuntimeAccountService/RequestLocalAppGrant', [['local_app_host'], ['local_app_session']]],
    ['/nimi.runtime.v1.RuntimeArtifactService/ReadArtifactBytes', [['local_app_host'], ['local_app_session']]],
  ]);
  let invalidRoute = false;
  for (const [methodId, [transports, roles]] of requiredRoutes) {
    const route = routeByMethod.get(methodId);
    const posture = postureByMethod.get(methodId);
    const postureTransports = posture?.protected_transport_classes ?? [posture?.protected_transport_class];
    const postureRoles = posture?.required_origin_roles ?? [posture?.required_origin_role];
    if (
      !route
      || !posture
      || !equalArray(route.allowed_transport_classes, transports)
      || !equalArray(route.required_origin_roles, roles)
      || !equalArray(postureTransports, transports)
      || !equalArray(postureRoles, roles)
    ) invalidRoute = true;
  }

  const expectedDesktopProductControlIds = [...DESKTOP_PRODUCT_CONTROL_METHODS].sort();
  const desktopProductControlRows = (matrix?.methods ?? [])
    .filter((row) => row?.operation_class === 'desktop_product_control');
  const actualDesktopProductControlIds = desktopProductControlRows
    .map((row) => String(row?.method_id || ''))
    .sort();
  const localPostureByMethod = rowsBy(local?.methods, 'method_id');
  const runtimeLocalService = (rpcMethods?.services ?? [])
    .find((service) => service?.name === 'RuntimeLocalService');
  const rpcMethodByName = rowsBy(runtimeLocalService?.methods, 'name');
  let desktopProductControlInvalid = !equalArray(
    actualDesktopProductControlIds,
    expectedDesktopProductControlIds,
  );
  for (const methodId of DESKTOP_PRODUCT_CONTROL_METHODS) {
    const route = desktopProductControlRows.find((row) => row?.method_id === methodId);
    const posture = localPostureByMethod.get(methodId);
    const methodName = methodId.slice(methodId.lastIndexOf('/') + 1);
    const rpcMethod = rpcMethodByName.get(methodName);
    if (
      !route
      || !equalArray(route.allowed_transport_classes, ['desktop_control'])
      || !equalArray(route.required_origin_roles, ['verified_desktop_process'])
      || route.request_may_select_role !== false
      || route.portable_session_allowed !== false
      || route.public_tcp_disposition !== 'deny'
      || route.source_rule !== 'K-RPC-004'
      || posture?.posture !== 'protected_origin_required'
      || !hasEvery(posture?.kernel_refs, ['K-RPC-004'])
      || rpcMethod?.type !== 'unary'
      || rpcMethod?.protected_transport_ref !== methodId
    ) desktopProductControlInvalid = true;
  }
  if (desktopProductControlInvalid) {
    issues.push(issue(
      'DESKTOP_PRODUCT_CONTROL_ROUTE_CONVERGENCE_REQUIRED',
      AUTHORITY_PATHS.transport,
      'All and only the frozen K-RPC-004 desktop product-control methods must converge across transport, auth posture, and RPC inventory on the verified Desktop protected carrier.',
    ));
  }
  const admittedTransports = new Set(EXPECTED_TRANSPORTS);
  const admittedRoles = new Set(EXPECTED_ROLES);
  for (const row of matrix?.methods ?? []) {
    const transports = row.allowed_transport_classes ?? [];
    const roles = row.required_origin_roles ?? Object.values(row.required_origin_roles_by_transport ?? {}).flat();
    if (
      transports.some((value) => !admittedTransports.has(value))
      || roles.some((value) => !admittedRoles.has(value))
      || row.request_may_select_role !== false
      || row.portable_session_allowed !== false
    ) invalidRoute = true;
  }
  if (invalidRoute) {
    issues.push(issue(
      'LOCAL_APP_ROUTE_POSTURE_REQUIRED',
      AUTHORITY_PATHS.transport,
      'Protected local-app transport rows and auth-posture rows must agree on one closed transport and origin-role vocabulary.',
    ));
  }
}

function validatePortableBoundary(bundle, issues) {
  const matrix = parseYaml(bundle, AUTHORITY_PATHS.transport, issues);
  const lifecycle = parseYaml(bundle, AUTHORITY_PATHS.lifecycle, issues);
  const grant = parseYaml(bundle, AUTHORITY_PATHS.grant, issues);
  const portableOutputs = ['bearer', 'token', 'portable_grant_credential', 'session_proof'];
  if (
    matrix?.portable_privileged_session !== 'forbidden'
    || matrix?.request_role_selection !== 'forbidden'
    || matrix?.public_tcp_privileged_disposition !== 'deny'
    || lifecycle?.local_app_launch?.portable_lease_or_session !== 'forbidden'
    || lifecycle?.local_app_launch?.renderer_projection !== 'forbidden'
    || !hasEvery(grant?.forbidden_outputs, portableOutputs)
    || (matrix?.methods ?? []).some((row) => row.portable_session_allowed !== false || row.request_may_select_role !== false)
  ) {
    issues.push(issue(
      'PORTABLE_AUTHORITY_FORBIDDEN',
      AUTHORITY_PATHS.transport,
      'No request field, bearer, token, lease, session proof, renderer projection, or public-TCP session may carry protected local-app authority.',
    ));
  }
}

function validateTrustIsolation(bundle, issues) {
  const trust = parseYaml(bundle, AUTHORITY_PATHS.trust, issues);
  const rows = rowsBy(trust?.trust_sets, 'trust_set_id');
  const required = [
    ['nimi-desktop-production-v1', 'production', 'production_only', true],
    ['nimi-desktop-e2e-fixture-v1', 'non_product_test', 'test_only', false],
    ['nimi-runtime-production-v1', 'production', 'production_only', true],
    ['nimi-desktop-control-carrier-production-v1', 'production', 'production_only', true],
    ['nimi-desktop-control-carrier-e2e-fixture-v1', 'non_product_test', 'test_only', false],
  ];
  const rowsInvalid = required.some(([id, environment, allowance, productClaim]) => {
    const row = rows.get(id);
    return !row
      || row.environment !== environment
      || row.runtime_build_allowance !== allowance
      || row.product_readiness_claim_allowed !== productClaim
      || row.runtime_configuration_mutable !== false;
  });
  const productionRows = (trust?.trust_sets ?? []).filter((row) => row.environment === 'production');
  const testRows = (trust?.trust_sets ?? []).filter((row) => row.environment === 'non_product_test');
  if (
    rowsInvalid
    || rows.has('nimi-runtime-e2e-fixture-v1')
    || productionRows.some((row) => row.runtime_build_allowance !== 'production_only' || row.product_readiness_claim_allowed !== true)
    || testRows.some((row) => row.runtime_build_allowance !== 'test_only' || row.product_readiness_claim_allowed !== false)
    || trust?.production_runtime_accepts_test_trust_set !== false
    || trust?.test_runtime_accepts_production_realm_endpoints !== false
    || trust?.test_runtime_accepts_production_account_custody !== false
    || trust?.production_runtime_trusts_user_selected_executable !== false
    || !hasEvery(trust?.production_configuration_override_sources_forbidden, [
      'environment_variable',
      'argv',
      'renderer_url',
      'app_manifest',
      'user_writable_config',
    ])
    || trust?.platform_native_release_verification?.same_open_object_required !== true
    || trust?.platform_native_release_verification?.caller_selected_path_release_or_policy !== 'forbidden'
    || trust?.platform_native_release_verification?.peer_owned_release_generation !== 'forbidden'
  ) {
    issues.push(issue(
      'TRUST_SET_ISOLATION_REQUIRED',
      AUTHORITY_PATHS.trust,
      'Production/test trust rows, Runtime custody/endpoints, native same-object verification, and configuration selection must remain structurally isolated.',
    ));
  }
}

export function validateAuthorityBundle(bundle, mode) {
  const issues = [];
  if (mode === 'protected-local-authority') {
    validateRetiredVocabulary(bundle, issues);
    validateStores(bundle, issues);
    validateFixedService(bundle, issues);
    validatePackageSeam(bundle, issues);
  }
  if (mode === 'protected-rpc-posture') {
    validateRetiredVocabulary(bundle, issues);
    validateTransport(bundle, issues);
    validatePackageSeam(bundle, issues);
  }
  if (mode === 'no-portable-privileged-session') validatePortableBoundary(bundle, issues);
  if (mode === 'protected-local-trust-set-isolation') validateTrustIsolation(bundle, issues);
  return issues;
}

export function validateAllModes(bundle) {
  const issues = MODES.flatMap((mode) => validateAuthorityBundle(bundle, mode));
  return issues.filter((candidate, index) => issues.findIndex((other) => (
    other.code === candidate.code && other.target === candidate.target
  )) === index);
}

export function applyFixtureMutation(bundle, fixture) {
  const source = bundle.get(fixture.target);
  if (typeof source !== 'string') throw new Error(`fixture target unavailable: ${fixture.fixture_id}`);
  if (fixture.mutation?.kind !== 'replace_exact') throw new Error(`fixture mutation kind invalid: ${fixture.fixture_id}`);
  const { from, to } = fixture.mutation;
  const first = source.indexOf(from);
  if (first === -1 || source.indexOf(from, first + from.length) !== -1) {
    throw new Error(`fixture replacement must have one exact source match: ${fixture.fixture_id}`);
  }
  bundle.set(fixture.target, source.replace(from, to));
}

export function runNegativeFixtures(baseline, fixtures) {
  return fixtures.map((fixture) => {
    const mutated = new Map(baseline);
    applyFixtureMutation(mutated, fixture);
    const issues = validateAllModes(mutated);
    if (issues.length !== 1 || issues[0].code !== fixture.code) {
      const observed = issues.map((item) => `${item.code}@${item.target}`).join(', ') || '<none>';
      throw new Error(`fixture ${fixture.fixture_id} must produce only ${fixture.code}; observed ${observed}`);
    }
    return {
      fixture_id: fixture.fixture_id,
      code: issues[0].code,
      target: fixture.target,
      issue_count: 1,
      reason: issues[0].reason,
    };
  });
}
