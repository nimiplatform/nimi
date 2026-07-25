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
  osProfiles: 'config/spec-frozen/runtime/tables/protected-local-os-profiles.yaml',
  runtimePrincipals: 'config/spec-frozen/runtime/tables/protected-local-runtime-principal-profiles.yaml',
  custodyProfiles: 'config/spec-frozen/runtime/tables/protected-local-custody-profiles.yaml',
  transport: 'config/spec-frozen/runtime/tables/protected-local-rpc-transport-matrix.yaml',
  launchSession: 'config/spec-frozen/runtime/tables/protected-local-launch-session-profiles.yaml',
  lifecycle: 'config/spec-frozen/runtime/tables/protected-local-lifecycle-intent-protocol.yaml',
  principalRecord: 'config/spec-frozen/runtime/tables/local-app-principal-record-schema.yaml',
  grant: 'config/spec-frozen/runtime/tables/local-app-grant-binding-schema.yaml',
  presence: 'config/spec-frozen/runtime/tables/local-app-presence-protocol.yaml',
  identityPosture: 'config/spec-frozen/runtime/tables/runtime-rpc-auth-posture/identity-access.yaml',
  localPosture: 'config/spec-frozen/runtime/tables/runtime-rpc-auth-posture/local-connector-model.yaml',
  artifactPosture: 'config/spec-frozen/runtime/tables/runtime-rpc-auth-posture/audit-artifact-workflow.yaml',
  rpcMethods: 'config/runtime-rpc-methods.yaml',
  trust: 'config/spec-frozen/platform/tables/protected-local-executable-trust-sets.yaml',
  sdkGroups: 'config/sdks-runtime-method-groups.yaml',
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
  'bundled_avatar_host',
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
    || schema?.local_os_user_anchor?.platform_profile_ref !== 'protected-local-os-profiles.yaml#same-os'
    || schema?.local_os_user_anchor?.profile_field !== 'local_os_user_anchor_derivation'
    || schema?.local_os_user_anchor?.platform_sources?.windows !== 'verified_interactive_user_sid'
    || schema?.local_os_user_anchor?.platform_sources?.linux !== 'verified_peer_uid_and_login_session'
    || schema?.local_os_user_anchor?.platform_sources?.macos !== 'verified_peer_euid_and_audit_session'
    || schema?.local_os_user_anchor?.request_supplied !== 'forbidden'
    || schema?.local_os_user_anchor?.active_anchors_per_data_root !== 1
  ) {
    issues.push(issue(
      'SID_PARTITION_REQUIRED',
      AUTHORITY_PATHS.principalRecord,
      'The local OS user anchor must be Runtime-derived from the same-OS verified-transport profile and never request supplied.',
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
    grant?.current_admission?.store_identity !== 'absent_pre_admission'
    || grant?.current_admission?.positive_mutation_path !== 'absent'
    || !equalArray(grant?.future_owner_lifecycle?.key, [
      'local_os_user_anchor',
      'account_id',
      'local_app_principal_id',
      'permission_id',
      'owner_selector_digest',
    ])
    || grant?.authority_classes?.base_entitlement?.permission_record !== 'forbidden'
    || grant?.authority_classes?.app_owned_authority?.permission_record !== 'forbidden'
    || !hasEvery(grant?.future_owner_lifecycle?.invariants, [
      'catalog_row_alone_is_not_authority',
      'no_trust_tier_permission_effect',
      'account_switch_never_transfers_permission',
      'every_protected_operation_reads_current_owner_decision',
      'no_app_id_only_positive_lookup',
    ])
  ) {
    issues.push(issue(
      'PERMISSION_LIFECYCLE_ADMISSION_REQUIRED',
      AUTHORITY_PATHS.grant,
      'Pre-admission permission storage must remain absent; any admitted owner lifecycle must bind the public permission and owner selector without absorbing base or app-owned authority.',
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
  const osProfiles = parseYaml(bundle, AUTHORITY_PATHS.osProfiles, issues);
  const principals = parseYaml(bundle, AUTHORITY_PATHS.runtimePrincipals, issues);
  const windows = (principals?.profiles ?? []).find((row) => row.os === 'windows');
  const windowsOs = (osProfiles?.profiles ?? []).find((row) => row.os === 'windows');
  const neutral = principals?.neutral_contract;
  const control = principals?.desktop_service_control;
  const windowsControl = windows?.service_control;
  const windowsHost = windows?.principal_constraints;
  if (
    neutral?.production_runtime_execution_mode !== 'isolated_os_service_principal'
    || neutral?.same_interactive_user_daemon_allowed !== false
    || neutral?.service_install_authority !== 'signed_nimi_installer_only'
    || neutral?.environment_or_argv_override !== 'forbidden'
    || control?.operations?.join(',') !== 'status,start,restart'
    || control?.product_stop_operation !== 'absent'
    || control?.desktop_direct_spawn !== 'forbidden'
    || control?.desktop_direct_stop !== 'forbidden'
    || windowsControl?.service_name !== 'NimiRuntime'
    || windowsControl?.service_binary_path_or_arguments_input !== 'forbidden'
    || windowsHost?.scm_account !== 'LocalSystem'
    || windowsHost?.token_user_sid !== 'S-1-5-18'
    || windowsHost?.state_acl_scope !== 'exact_restricted_service_sid_only'
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

  const acceptanceContract = principals?.service_acceptance_contract;
  const acceptance = windows?.acceptance_isolation;
  if (
    acceptance?.service_name !== 'NimiRuntime'
    || acceptance?.service_principal !== 'same_production_local_system_and_restricted_service_sid'
    || acceptance?.development_state_lineage_root_acl !== 'restricted_service_sid_only'
    || acceptance?.account_partition !== 'verified_interactive_sid'
    || acceptance?.runtime_lifecycle_and_restart !== 'real_scm_service'
    || acceptance?.parallel_isolation !== 'development_state_lineage_namespace_for_state_audit_and_child_pipes'
    || acceptanceContract?.service_owned_development_state_lineage_root !== 'required'
    || acceptanceContract?.environment_or_argv_root_selection !== 'forbidden'
    || acceptanceContract?.test_only_service_principal !== 'forbidden'
  ) {
    issues.push(issue(
      'SERVICE_ACCEPTANCE_ISOLATION_REQUIRED',
      AUTHORITY_PATHS.runtimePrincipals,
      'Acceptance must exercise the real fixed service with a service-owned development state lineage root, SID partition, real restart, cleanup, and parallel namespace isolation.',
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
  let invalidRoute = false;
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

  const verifiedTransport = matrix?.verified_platform_transport;
  const classBindings = matrix?.transport_class_bindings ?? {};
  const methodBinding = matrix?.method_platform_binding;
  const g5 = matrix?.g5_supervisor_profile_consistency;
  const g5ByPlatform = rowsBy(g5?.per_platform, 'os');
  if (
    verifiedTransport?.binding_name !== 'verified_platform_transport'
    || verifiedTransport?.profile_key !== 'os'
    || verifiedTransport?.custody_profile_ref !== 'protected-local-custody-profiles.yaml#same-os'
    || verifiedTransport?.service_principal_profile_ref !== 'protected-local-runtime-principal-profiles.yaml#same-os'
    || verifiedTransport?.transport_profile_ref !== 'protected-local-os-profiles.yaml#same-os'
    || verifiedTransport?.executable_trust_profile_ref !== '.nimi/spec/platform/kernel/tables/protected-local-executable-trust-sets.yaml#same-os'
    || verifiedTransport?.launch_session_profile_ref !== 'protected-local-launch-session-profiles.yaml#same-os'
    || verifiedTransport?.cross_platform_profile_mix !== 'forbidden'
    || !equalArray(Object.keys(classBindings), EXPECTED_TRANSPORTS)
    || classBindings.public_tcp?.binding !== 'public_tcp_binding_only'
    || classBindings.public_tcp?.verified_platform_transport_profile !== 'not_applicable'
    || ['desktop_control', 'local_app_bootstrap', 'local_app_host'].some((transportClass) => (
      classBindings[transportClass]?.binding !== 'verified_platform_transport'
      || classBindings[transportClass]?.carrier_role !== transportClass
      || classBindings[transportClass]?.profile_bundle_ref !== 'verified_platform_transport'
    ))
    || methodBinding?.coverage !== 'every_methods_row'
    || methodBinding?.declared_method_count !== matrix?.methods?.length
    || methodBinding?.selector_field !== 'allowed_transport_classes'
    || methodBinding?.resolver !== 'transport_class_bindings'
    || methodBinding?.protected_binding_description !== 'verified_platform_transport'
    || methodBinding?.profile_resolution !== 'same_os'
    || methodBinding?.missing_or_ambiguous_binding !== 'fail_generation'
    || g5?.structure_status !== 'reserved_without_current_assertion_behavior_change'
    || g5?.profile_key !== 'os'
    || !equalArray(g5?.profile_components, [
      'custody_profile_ref',
      'service_principal_profile_ref',
      'transport_profile_ref',
      'executable_trust_profile_ref',
      'launch_session_profile_ref',
    ])
    || g5?.current_assertion?.os !== 'windows'
    || g5?.current_assertion?.command !== 'pnpm check:local-development-supervisor-parity'
    || !equalArray(g5?.current_assertion?.implementation_bindings, [
      'desktop_electron_supervisor',
      'desktop_tauri_supervisor',
    ])
    || g5?.current_assertion?.behavior !== 'unchanged_exact_dual_supervisor_cross_assertion'
    || g5ByPlatform.get('windows')?.assertion_activation !== 'current'
    || g5ByPlatform.get('macos')?.admission !== 'requirements_only_fail_closed_pending_native_admission'
    || !equalArray(g5ByPlatform.get('macos')?.implementation_bindings, [])
    || g5?.consistency_rules?.single_sided_implementation !== 'reject'
    || g5?.consistency_rules?.cross_platform_profile_substitution !== 'forbidden'
    || g5?.consistency_rules?.missing_profile_component !== 'reject'
  ) invalidRoute = true;

  const openWire = matrix?.open_local_app_session_wire;
  const renewWire = matrix?.renew_local_app_session_wire;
  const routeByMethod = rowsBy(matrix?.methods, 'method_id');
  const openRoute = routeByMethod.get('/nimi.runtime.v1.RuntimeAuthService/OpenLocalAppSession');
  const renewRoute = routeByMethod.get('/nimi.runtime.v1.RuntimeAuthService/RenewLocalAppSession');
  if (
    !equalArray(openWire?.request?.fields, [])
    || !equalArray(openWire?.request?.request_metadata_authority_inputs, [])
    || openWire?.request?.unknown_field_disposition !== 'reject'
    || !hasEvery(openWire?.response?.forbidden_fields, [
      'local_app_principal_id',
      'local_record_id',
      'permission_id',
      'permission_state',
      'permission_decision_id',
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
      'OpenLocalAppSession must be request-empty, exact-process/lease bound, non-portable, and atomically create a private base-entitlement-ready session without a permission decision.',
    ));
  }

  if (
    !equalArray(renewWire?.request?.fields, [])
    || !equalArray(renewWire?.request?.request_metadata_authority_inputs, [])
    || renewWire?.request?.unknown_field_disposition !== 'reject'
    || renewWire?.connection_binding !== 'exact_current_local_app_host_connection_and_private_session'
    || renewWire?.atomic_transition !== 'revoke_previous_private_session_and_insert_replacement_on_same_connection'
    || renewWire?.renderer_projection !== 'forbidden'
    || renewWire?.app_projection !== 'forbidden'
    || renewWire?.ordinary_grpc_disposition !== 'deny'
    || !hasEvery(renewWire?.response?.forbidden_fields, [
      'local_app_principal_id',
      'local_record_id',
      'permission_id',
      'permission_state',
      'permission_decision_id',
      'session_id',
      'session_proof',
      'launch_lease',
      'endpoint',
      'token',
      'credential',
    ])
    || renewRoute?.operation_class !== 'local_app_session_renewal'
    || !equalArray(renewRoute?.allowed_transport_classes, ['local_app_host'])
    || !equalArray(renewRoute?.required_origin_roles, ['local_app_session'])
  ) {
    issues.push(issue(
      'LOCAL_APP_SESSION_RENEWAL_WIRE_REQUIRED',
      AUTHORITY_PATHS.transport,
      'RenewLocalAppSession must be request-empty, same-host/session bound, non-portable, renderer-inaccessible, and atomically replace only the current private technical session.',
    ));
  }

  const postureByMethod = rowsBy([...(identity?.methods ?? []), ...(artifact?.methods ?? [])], 'method_id');
  const requiredRoutes = new Map([
    ['/nimi.runtime.v1.RuntimeAuthService/OpenLocalAppSession', [['local_app_bootstrap'], ['local_app_process']]],
    ['/nimi.runtime.v1.RuntimeAuthService/RenewLocalAppSession', [['local_app_host'], ['local_app_session']]],
    ['/nimi.runtime.v1.RuntimeAppService/PrepareLocalAppLaunch', [['desktop_control'], ['local_app_control']]],
    ['/nimi.runtime.v1.RuntimeAppService/BindLocalAppProcess', [['desktop_control'], ['local_app_control']]],
    ['/nimi.runtime.v1.RuntimeAccountService/GetLocalAppPermissionStatus', [['local_app_host'], ['local_app_session']]],
    ['/nimi.runtime.v1.RuntimeAccountService/RequestLocalAppPermission', [['local_app_host'], ['local_app_session']]],
    ['/nimi.runtime.v1.RuntimeAppService/ReadLocalAppStorageJson', [['local_app_host'], ['local_app_session']]],
    ['/nimi.runtime.v1.RuntimeAppService/WriteLocalAppStorageJson', [['local_app_host'], ['local_app_session']]],
    ['/nimi.runtime.v1.RuntimeAppService/RemoveLocalAppStorageJson', [['local_app_host'], ['local_app_session']]],
  ]);
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

  const expectedLocalAppHostMethods = [...requiredRoutes]
    .filter(([, [transports]]) => equalArray(transports, ['local_app_host']))
    .map(([methodId]) => methodId)
    .sort();
  const actualLocalAppHostMethods = (matrix?.methods ?? [])
    .filter((row) => row?.allowed_transport_classes?.includes('local_app_host'))
    .map((row) => row.method_id)
    .sort();
  if (!equalArray(actualLocalAppHostMethods, expectedLocalAppHostMethods)) invalidRoute = true;

  const runtimeLocalService = (rpcMethods?.services ?? [])
    .find((service) => service?.name === 'RuntimeLocalService');
  const desktopProductControlMethods = (runtimeLocalService?.methods ?? [])
    .filter((method) => String(method?.protected_transport_ref || '').startsWith('/nimi.runtime.v1.RuntimeLocalService/'))
    .map((method) => String(method.protected_transport_ref));
  const expectedDesktopProductControlIds = [...desktopProductControlMethods].sort();
  const desktopProductControlRows = (matrix?.methods ?? [])
    .filter((row) => row?.operation_class === 'desktop_product_control');
  const actualDesktopProductControlIds = desktopProductControlRows
    .map((row) => String(row?.method_id || ''))
    .sort();
  const localPostureByMethod = rowsBy(local?.methods, 'method_id');
  const rpcMethodByName = rowsBy(runtimeLocalService?.methods, 'name');
  let desktopProductControlInvalid = !equalArray(
    actualDesktopProductControlIds,
    expectedDesktopProductControlIds,
  );
  for (const methodId of desktopProductControlMethods) {
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
      || transports.some((value) => !classBindings[value])
      || roles.some((value) => !admittedRoles.has(value))
      || row.request_may_select_role !== false
      || row.portable_session_allowed !== false
      || (row.generic_proxy !== undefined && row.generic_proxy !== 'forbidden')
    ) invalidRoute = true;
  }
  if (matrix?.blocked_or_unadmitted?.generic_proxy !== 'forbidden') invalidRoute = true;
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
  const launchSession = parseYaml(bundle, AUTHORITY_PATHS.launchSession, issues);
  const lifecycle = parseYaml(bundle, AUTHORITY_PATHS.lifecycle, issues);
  const grant = parseYaml(bundle, AUTHORITY_PATHS.grant, issues);
  const launchProfiles = rowsBy(launchSession?.profiles, 'os');
  const windowsLaunch = launchProfiles.get('windows');
  const macosLaunch = launchProfiles.get('macos');
  const portableOutputs = ['bearer', 'token', 'permission_decision_id', 'session_proof'];
  if (
    matrix?.portable_privileged_session !== 'forbidden'
    || matrix?.request_role_selection !== 'forbidden'
    || matrix?.public_tcp_privileged_disposition !== 'deny'
    || lifecycle?.local_app_launch?.portable_lease_or_session !== 'forbidden'
    || lifecycle?.local_app_launch?.renderer_projection !== 'forbidden'
    || launchSession?.neutral_contract?.portable_lease_or_session !== 'forbidden'
    || launchSession?.neutral_contract?.renderer_or_app_authority_projection !== 'forbidden'
    || windowsLaunch?.admission !== 'admitted_fixed_service_child_carrier'
    || macosLaunch?.admission !== 'requirements_only_fail_closed_pending_native_admission'
    || !String(macosLaunch?.launch_session_equivalent ?? '').includes('atomically_consumes_bootstrap')
    || !hasEvery(grant?.forbidden_public_fields, portableOutputs)
    || (matrix?.methods ?? []).some((row) => row.portable_session_allowed !== false || row.request_may_select_role !== false)
  ) {
    issues.push(issue(
      'PORTABLE_AUTHORITY_FORBIDDEN',
      AUTHORITY_PATHS.transport,
      'No request field, bearer, token, lease, session proof, renderer projection, or public-TCP session may carry protected local-app authority.',
    ));
  }
}

function validateMacOSLocalDevelopmentProfile(bundle, issues) {
  const osProfiles = parseYaml(bundle, AUTHORITY_PATHS.osProfiles, issues);
  const principals = parseYaml(bundle, AUTHORITY_PATHS.runtimePrincipals, issues);
  const custody = parseYaml(bundle, AUTHORITY_PATHS.custodyProfiles, issues);
  const lifecycle = parseYaml(bundle, AUTHORITY_PATHS.lifecycle, issues);
  const trust = parseYaml(bundle, AUTHORITY_PATHS.trust, issues);
  const osProfile = rowsBy(osProfiles?.non_product_local_development_profiles, 'profile_id').get('macos_local_development_v1');
  const principal = rowsBy(principals?.non_product_local_development_profiles, 'profile_id').get('macos_local_development_v1');
  const custodyProfile = rowsBy(custody?.non_product_local_development_profiles, 'profile_id').get('macos_local_development_v1');
  const status = 'local_development_candidate_fail_closed_pending_real_acceptance';
  const retired = JSON.stringify({ principal, custodyProfile, lifecycle, trust });
  if (osProfile?.production_verifier_contains_profile_root !== false) {
    issues.push(issue('MACOS_LOCAL_DEVELOPMENT_PROFILE_REQUIRED', AUTHORITY_PATHS.osProfiles, 'Production verifiers must never contain the local-development trust root.'));
  }
  if (
    trust?.platform_admission?.macos !== 'requirements_only_fail_closed_pending_native_admission'
    || trust?.platform_admission?.macos_local_development !== status
    || trust?.trust_profile_transitions?.length !== 0
    || principal?.admission !== status
    || principal?.principal_carrier_contract_version !== 4
    || principal?.principal_constraints?.tracked_legacy_repair_or_migration !== 'forbidden'
    || custodyProfile?.admission !== status
    || custodyProfile?.principal_carrier_contract_version !== 4
    || custodyProfile?.tracked_profile_migration !== 'forbidden'
    || custodyProfile?.signing_private_key_access !== 'confirmed_unprivileged_build-sign-release-record-generation-only'
    || !custodyProfile?.signing_private_key_forbidden_consumers?.includes('root_installer')
    || !custodyProfile?.privileged_helper_forbidden_operations?.includes('helper_self_rotation')
    || custodyProfile?.update_admission !== 'dev-runtime-update-not-admitted'
    || lifecycle?.non_product_local_development?.admission !== status
    || !String(lifecycle?.non_product_local_development?.legacy_carrier_disposition ?? '').includes('legacy-local-dev-profile-not-supported')
    || [
      ['trust-helper-', 'rotation'].join(''),
      ['rotation-', 'coordinator'].join(''),
      ['carrier_2_to_4_v1_', 'rotation'].join(''),
    ].some((identifier) => retired.includes(identifier))
  ) {
    issues.push(issue('MACOS_LOCAL_DEVELOPMENT_FRESH_CARRIER_4_INVALID', AUTHORITY_PATHS.custodyProfiles, 'macOS local development must remain a fresh-carrier-4 candidate with user-domain signing, separate Runtime custody, no migration, and fail-closed legacy state.'));
  }
}

function validateTrustIsolation(bundle, issues) {
  const trust = parseYaml(bundle, AUTHORITY_PATHS.trust, issues);
  const rows = rowsBy(trust?.trust_sets, 'trust_set_id');
  const platformProfiles = rowsBy(trust?.platform_verification_profiles, 'os');
  const windowsProfile = platformProfiles.get('windows');
  const macosProfile = platformProfiles.get('macos');
  const neutral = trust?.neutral_contract;
  const required = [
    ['nimi-desktop-production-v1', 'production', 'production_only', true],
    ['nimi-desktop-e2e-fixture-v1', 'non_product_test', 'test_only', false],
    ['nimi-runtime-production-v1', 'production', 'production_only', true],
    ['nimi-local-development-host-macos-production-v1', 'production', 'production_only', true],
    ['nimi-local-development-host-macos-e2e-fixture-v1', 'non_product_test', 'test_only', false],
    ['nimi-desktop-control-carrier-production-v1', 'production', 'production_only', true],
    ['nimi-desktop-control-carrier-e2e-fixture-v1', 'non_product_test', 'test_only', false],
    ['nimi-runtime-macos-local-development-v1', 'local_development', 'compile_time_macos_local_development_only', false],
    ['nimi-desktop-macos-local-development-v1', 'local_development', 'compile_time_macos_local_development_only', false],
    ['nimi-local-development-host-macos-local-development-v1', 'local_development', 'compile_time_macos_local_development_only', false],
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
  const localDevelopmentRows = (trust?.trust_sets ?? []).filter((row) => row.environment === 'local_development');
  if (
    rowsInvalid
    || rows.has('nimi-runtime-e2e-fixture-v1')
    || productionRows.some((row) => row.runtime_build_allowance !== 'production_only' || row.product_readiness_claim_allowed !== true)
    || testRows.some((row) => row.runtime_build_allowance !== 'test_only' || row.product_readiness_claim_allowed !== false)
    || localDevelopmentRows.length !== 3
    || localDevelopmentRows.some((row) => row.runtime_build_allowance !== 'compile_time_macos_local_development_only' || row.product_readiness_claim_allowed !== false)
    || trust?.production_runtime_accepts_test_trust_set !== false
    || trust?.production_runtime_accepts_local_development_trust_set !== false
    || trust?.local_development_runtime_accepts_production_trust_set !== false
    || trust?.local_development_runtime_accepts_external_e2e_fixture_trust_set !== false
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
    || neutral?.same_open_object_required !== true
    || neutral?.caller_selected_path_release_or_policy !== 'forbidden'
    || neutral?.peer_owned_release_generation !== 'forbidden'
    || windowsProfile?.admission !== 'admitted_same_open_object_authenticode'
    || windowsProfile?.client_executable_verification !== 'same_open_hfile_volume_serial_file_id_win_verify_trust_installer_signer_policy'
    || windowsProfile?.server_executable_verification !== 'same_open_hfile_volume_serial_file_id_win_verify_trust_installer_signer_policy_and_service_sid'
    || macosProfile?.admission !== 'requirements_only_fail_closed_pending_native_admission'
    || !String(macosProfile?.native_release_verification ?? '').includes('designated_requirement_team_id_identifier_cdhash')
  ) {
    issues.push(issue(
      'TRUST_SET_ISOLATION_REQUIRED',
      AUTHORITY_PATHS.trust,
      'Production/test trust rows, Runtime custody/endpoints, same-OS native same-object verification, and configuration selection must remain structurally isolated.',
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
    validateMacOSLocalDevelopmentProfile(bundle, issues);
  }
  if (mode === 'protected-rpc-posture') {
    validateRetiredVocabulary(bundle, issues);
    validateTransport(bundle, issues);
    validatePackageSeam(bundle, issues);
    validateMacOSLocalDevelopmentProfile(bundle, issues);
  }
  if (mode === 'no-portable-privileged-session') validatePortableBoundary(bundle, issues);
  if (mode === 'protected-local-trust-set-isolation') {
    validateTrustIsolation(bundle, issues);
    validateMacOSLocalDevelopmentProfile(bundle, issues);
  }
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

