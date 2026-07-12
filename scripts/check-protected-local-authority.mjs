#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const paths = {
  contract: '.nimi/spec/runtime/kernel/protected-local-session-contract.md',
  osProfiles: '.nimi/spec/runtime/kernel/tables/protected-local-os-profiles.yaml',
  principalProfiles: '.nimi/spec/runtime/kernel/tables/protected-local-runtime-principal-profiles.yaml',
  lifecycleIntent: '.nimi/spec/runtime/kernel/tables/protected-local-lifecycle-intent-protocol.yaml',
  transportMatrix: '.nimi/spec/runtime/kernel/tables/protected-local-rpc-transport-matrix.yaml',
  limits: '.nimi/spec/runtime/kernel/tables/protected-local-security-limits.yaml',
  trustSets: '.nimi/spec/platform/kernel/tables/protected-local-executable-trust-sets.yaml',
  accountMatrix: '.nimi/spec/runtime/kernel/tables/account-rpc-permission-matrix.yaml',
  identityAccess: '.nimi/spec/runtime/kernel/tables/runtime-rpc-auth-posture/identity-access.yaml',
  artifactPosture: '.nimi/spec/runtime/kernel/tables/runtime-rpc-auth-posture/audit-artifact-workflow.yaml',
  interceptorChain: '.nimi/spec/runtime/kernel/tables/interceptor-chain.yaml',
  authService: '.nimi/spec/runtime/kernel/auth-service.md',
  authPosture: '.nimi/spec/runtime/kernel/tables/runtime-rpc-auth-posture.yaml',
  rpcMethods: '.nimi/spec/runtime/kernel/tables/rpc-methods.yaml',
  daemonLifecycle: '.nimi/spec/runtime/kernel/daemon-lifecycle.md',
  configSchema: '.nimi/spec/runtime/kernel/tables/config-schema.yaml',
  reasonCodes: '.nimi/spec/runtime/kernel/tables/reason-codes.yaml',
  reasonCodeFragment: '.nimi/spec/runtime/kernel/tables/reason-codes/10-general-auth-connector.yaml',
  errorMappings: '.nimi/spec/runtime/kernel/tables/error-mapping-matrix.yaml',
  errorMappingFragment: '.nimi/spec/runtime/kernel/tables/error-mapping-matrix/10-core-protocol-auth.yaml',
  sdkMethodGroups: '.nimi/spec/sdks/kernel/tables/runtime-method-groups.yaml',
  kitRegistry: '.nimi/spec/platform/kernel/tables/nimi-kit-registry.yaml',
  standardShellCapabilities: '.nimi/spec/platform/kernel/tables/standard-shell-capabilities.yaml',
};

const modes = new Set([
  'protected-local-authority',
  'protected-rpc-posture',
  'no-portable-privileged-session',
  'protected-local-trust-set-isolation',
]);

const fixturePath = path.join(scriptDir, 'testdata/protected-local-authority/negative-fixtures.json');

const ruleClauses = new Map([
  ['K-PLOCAL-001', [
    /sole authority/iu,
    /RegisterApp.*OpenSession.*BINDING_ONLY/isu,
    /app id.*caller enum.*source host.*manifest.*portable/isu,
    /A\.1.*Windows child channel/isu,
    /isolated OS service.*principal/isu,
  ]],
  ['K-PLOCAL-002', [
    /public_tcp/iu,
    /desktop_control/iu,
    /launch_bootstrap/iu,
    /installed_host/iu,
    /immutable.*origin/isu,
  ]],
  ['K-PLOCAL-003', [
    /mutual/iu,
    /GetNamedPipeClientProcessId/iu,
    /GetNamedPipeServerProcessId/iu,
    /SO_PEERCRED/iu,
    /XPC audit token/iu,
    /before.*credential/isu,
    /signed service definition/iu,
  ]],
  ['K-PLOCAL-004', [
    /creation_marker/iu,
    /pidfd/iu,
    /EVFILT_PROC/iu,
    /NOTE_EXIT/iu,
    /NOTE_EXEC/iu,
    /seccomp.*execve/isu,
  ]],
  ['K-PLOCAL-005', [
    /same running process.*opened executable object/isu,
    /WinVerifyTrust/iu,
    /volume serial/iu,
    /file ID/iu,
    /dynamic.*SecCode/isu,
    /Desktop\/control carrier validates the Runtime/iu,
    /does not introduce a second RFC8785\/Ed25519/iu,
  ]],
  ['K-PLOCAL-006', [
    /OpenDesktopSession/iu,
    /original connection/iu,
    /not.*portable/isu,
    /rebind.*forbidden/isu,
  ]],
  ['K-PLOCAL-007', [
    /service-owned transactional database/isu,
    /durable anchoring is limited/isu,
    /boot epoch/iu,
    /one database transaction/isu,
    /does not HMAC-chain every/iu,
    /generic user-session.*forbidden/isu,
  ]],
]);

const requiredPrivilegedMethods = [
  'GetAccountSessionStatus',
  'SubscribeAccountSessionEvents',
  'BeginLogin',
  'CompleteLogin',
  'RequestPresenceVerification',
  'Logout',
  'SwitchAccount',
  'InvokeRealmUnary',
  'IssueScopedAppBinding',
  'RevokeScopedAppBinding',
  'PrepareAppLifecycleIntent',
  'GetAppLifecycleIntentStatus',
  'InstallApp',
  'UninstallApp',
  'UpdateApp',
  'HealthRepairApp',
  'AdoptLocalApp',
  'RemoveLocalAppAdoption',
  'OpenApp',
];

const protectedReasonCodes = [
  'PROTECTED_LOCAL_TRANSPORT_UNSUPPORTED',
  'PROTECTED_LOCAL_ENDPOINT_OWNERSHIP_FAILED',
  'PROTECTED_LOCAL_SERVER_VERIFICATION_FAILED',
  'DESKTOP_CONTROL_TRANSPORT_REQUIRED',
  'DESKTOP_PROCESS_VERIFICATION_UNAVAILABLE',
  'DESKTOP_EXECUTABLE_TRUST_FAILED',
  'DESKTOP_TEST_TRUST_FORBIDDEN',
  'PROTECTED_ORIGIN_ROLE_MISMATCH',
  'LIFECYCLE_CHALLENGE_REQUIRED',
  'LIFECYCLE_CHALLENGE_MISMATCH',
  'LIFECYCLE_CHALLENGE_REPLAY',
  'PROTECTED_LOCAL_LEDGER_UNAVAILABLE',
  'PROTECTED_LOCAL_LEDGER_ROLLBACK_DETECTED',
  'PROTECTED_LOCAL_BOOT_EPOCH_MISMATCH',
  'PROTECTED_LOCAL_RUNTIME_PRINCIPAL_REQUIRED',
  'PROTECTED_LOCAL_CUSTODY_BOUNDARY_UNAVAILABLE',
  'PROTECTED_LOCAL_PRODUCTION_CONFIG_OVERRIDE_FORBIDDEN',
  'RUNTIME_EXECUTABLE_TRUST_RECORD_INVALID',
  'LIFECYCLE_INTENT_REQUIRED',
  'LIFECYCLE_INTENT_MISMATCH',
  'LIFECYCLE_INTENT_REPLAY',
  'LIFECYCLE_INTENT_EXPIRED',
];

const publicGrantTokenMethods = [
  'AuthorizeExternalPrincipal',
  'ValidateAppAccessToken',
  'RevokeAppAccessToken',
  'IssueDelegatedAccessToken',
  'ListTokenChain',
];

function issue(code, target, reason) {
  return { code, target, reason };
}

function hasExactKeys(value, fields) {
  return value && typeof value === 'object'
    && Object.keys(value).sort().join(',') === [...fields].sort().join(',');
}

function equalArray(value, expected) {
  return Array.isArray(value) && value.join(',') === expected.join(',');
}

function extractRule(source, ruleId) {
  const escaped = ruleId.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = new RegExp(`^## ${escaped}\\b`, 'mu').exec(source);
  if (!match) return '';
  const next = source.indexOf('\n## ', match.index + match[0].length);
  return source.slice(match.index, next === -1 ? source.length : next);
}

function loadBundle() {
  const bundle = new Map();
  for (const relative of Object.values(paths)) {
    const absolute = path.join(repoRoot, relative);
    if (!fs.existsSync(absolute)) {
      bundle.set(relative, null);
      continue;
    }
    bundle.set(relative, fs.readFileSync(absolute, 'utf8'));
  }
  return bundle;
}

function parseYaml(bundle, relative, issues) {
  const source = bundle.get(relative);
  if (source === null || source === undefined) {
    issues.push(issue('AUTHORITY_FILE_MISSING', relative, 'Required protected-local authority file is missing.'));
    return null;
  }
  try {
    return YAML.parse(source);
  } catch {
    issues.push(issue('AUTHORITY_YAML_INVALID', relative, 'Protected-local authority YAML is invalid.'));
    return null;
  }
}

function validateCore(bundle, issues) {
  const contract = bundle.get(paths.contract);
  if (contract === null || contract === undefined) {
    issues.push(issue('AUTHORITY_FILE_MISSING', paths.contract, 'Protected-local canonical contract is missing.'));
    return;
  }
  for (const [ruleId, patterns] of ruleClauses) {
    const section = extractRule(contract, ruleId);
    if (!section) {
      issues.push(issue('AUTHORITY_RULE_MISSING', `${paths.contract}#${ruleId}`, `Required rule ${ruleId} is missing.`));
      continue;
    }
    for (const pattern of patterns) {
      if (!pattern.test(section)) {
        issues.push(issue('AUTHORITY_CLAUSE_MISSING', `${paths.contract}#${ruleId}`, `Required ${ruleId} clause is missing.`));
      }
    }
  }

  const authService = bundle.get(paths.authService) ?? '';
  const appModeRule = extractRule(authService, 'K-AUTHSVC-009');
  for (const required of [
    /AppMode.*static upper bound/isu,
    /BINDING_ONLY.*effective domains.*effective scopes.*empty/isu,
    /never.*upgrades protected origin/isu,
    /Ordinary.*OpenSession.*no broker.*AI.*artifact.*realtime.*media.*lifecycle/isu,
  ]) {
    if (!required.test(appModeRule)) {
      issues.push(issue('BINDING_ONLY_APP_MODE_CEILING_REQUIRED', `${paths.authService}#K-AUTHSVC-009`, 'AppMode must remain a non-authorizing ceiling for binding-only bootstrap.'));
    }
  }

  const authPosture = parseYaml(bundle, paths.authPosture, issues);
  const postureValues = new Set((authPosture?.posture_enum ?? []).map((row) => row.value));
  for (const value of ['binding_only_bootstrap', 'protected_origin_required', 'deny_all_tombstone', 'blocked_pending_authority']) {
    if (!postureValues.has(value)) {
      issues.push(issue('RPC_POSTURE_VOCABULARY_REQUIRED', paths.authPosture, `Closed RPC posture vocabulary is missing ${value}.`));
    }
  }

  const principalAuthority = parseYaml(bundle, paths.principalProfiles, issues);
  const principalFields = principalAuthority?.profile_schema?.fields ?? [];
  const principalRows = principalAuthority?.profiles ?? [];
  if (
    principalAuthority?.production_runtime_execution_mode !== 'isolated_os_service_principal'
    || principalAuthority?.production_same_interactive_user_daemon_allowed !== false
    || principalAuthority?.interactive_app_state_enumeration !== 'forbidden'
    || principalAuthority?.service_install_authority !== 'signed_nimi_installer_only'
    || principalAuthority?.production_environment_or_argv_override !== 'forbidden'
    || principalRows.length !== 3
    || principalRows.some((row) => row.interactive_user_relation !== 'distinct_os_security_principal')
  ) {
    issues.push(issue('RUNTIME_OS_PRINCIPAL_ISOLATION_REQUIRED', paths.principalProfiles, 'Production Runtime credentials and protected state require a closed distinct OS service-principal profile on every supported OS.'));
  }
  if (
    principalAuthority?.production_user_session_generic_keyring_allowed !== false
    || !equalArray(principalAuthority?.protected_credential_domains, ['account_tokens', 'connector_provider_secrets', 'durable_anchor_keys', 'authenticated_realm_credentials'])
    || !String(principalAuthority?.retired_user_keyring_import ?? '').startsWith('forbidden_hardcut')
  ) {
    issues.push(issue('USER_SCOPED_CUSTODY_FORBIDDEN', paths.principalProfiles, 'Production account/provider credentials and ledger keys cannot use the interactive user keyring or import the retired store.'));
  }
  if (principalFields.length === 0 || principalRows.some((row) => !hasExactKeys(row, principalFields))) {
    issues.push(issue('RUNTIME_PRINCIPAL_PROFILE_SCHEMA_INVALID', paths.principalProfiles, 'Runtime principal profiles must match one closed row schema.'));
  }
  if (
    principalAuthority?.automatic_backup_restore !== 'forbidden'
    || principalAuthority?.ordinary_session_or_lifecycle_row_hmac_chain !== 'forbidden'
    || !equalArray(principalAuthority?.durable_anchor_scope, ['installer_owned_active_release_generation', 'credential_custody_generation', 'explicitly_admitted_revocation_floor'])
  ) {
    issues.push(issue('LIMITED_DURABLE_ANCHOR_REQUIRED', paths.principalProfiles, 'Durable anchors must be limited to release, credential-custody, and explicitly admitted revocation generations; ordinary rows cannot form a second HMAC truth.'));
  }
  if (principalAuthority?.lifecycle_operation_transaction !== 'validate_bindings_consume_idempotency_key_create_operation_atomic_database_commit') {
    issues.push(issue('LIFECYCLE_OPERATION_TRANSACTION_REQUIRED', paths.principalProfiles, 'Lifecycle admission must validate bindings, consume idempotency, and create the operation in one database transaction.'));
  }
  const desktopServiceControl = principalAuthority?.desktop_service_control;
  if (
    desktopServiceControl?.status_authority !== 'os_service_manager_and_verified_runtime_control'
    || desktopServiceControl?.start_or_restart_authority !== 'typed_os_service_control_gateway'
    || desktopServiceControl?.desktop_direct_spawn !== 'forbidden'
    || desktopServiceControl?.desktop_direct_stop !== 'forbidden'
    || desktopServiceControl?.desktop_quit_disposition !== 'service_remains_running'
    || desktopServiceControl?.release_staging_authority !== 'signed_installer_service_updater'
    || desktopServiceControl?.runtime_binary_selection_by_desktop !== 'forbidden'
    || !equalArray(desktopServiceControl?.operations, ['status', 'start', 'restart'])
    || desktopServiceControl?.product_stop_operation !== 'absent'
    || desktopServiceControl?.windows?.service_name !== 'NimiRuntime'
    || desktopServiceControl?.windows?.restart_semantics !== 'runtime_self_exit_then_scm_recovery_start_and_new_boot_epoch_verification'
    || desktopServiceControl?.windows?.desktop_scm_stop_access !== 'forbidden'
    || desktopServiceControl?.windows?.service_binary_path_or_arguments_input !== 'forbidden'
  ) {
    issues.push(issue('DESKTOP_SERVICE_LIFECYCLE_BOUNDARY_REQUIRED', paths.principalProfiles, 'Production Desktop must use typed OS service control, never spawn/stop/select Runtime, and leave the service running on quit.'));
  }

  const principalByOs = new Map(principalRows.map((row) => [row.os, row]));
  const windowsPrincipal = principalByOs.get('windows');
  const linuxPrincipal = principalByOs.get('linux');
  const macosPrincipal = principalByOs.get('macos');
  if (
    (windowsPrincipal?.interactive_user_relation === 'distinct_os_security_principal'
      && windowsPrincipal?.production_principal !== 'NT_SERVICE_NimiRuntime_restricted_service_sid')
    || !String(windowsPrincipal?.process_isolation ?? '').includes('service_process_dacl_denies_interactive')
    || linuxPrincipal?.production_principal !== 'dedicated_nimi_runtime_system_uid'
    || !String(linuxPrincipal?.service_installation ?? '').includes('systemd_system_service')
    || macosPrincipal?.production_principal !== 'dedicated_nimi_runtime_launchdaemon_principal'
    || !String(macosPrincipal?.service_installation ?? '').includes('privileged_xpc_service')
    || !String(macosPrincipal?.custody_store ?? '').includes('code_identity_acl_system_keychain')
  ) {
    issues.push(issue('SUPPORTED_OS_PRINCIPAL_PROFILE_REQUIRED', paths.principalProfiles, 'Every supported OS must use the selected isolated service principal, custody, and process-isolation profile.'));
  }
  if (
    principalAuthority?.windows_service_host?.scm_account !== 'LocalSystem'
    || principalAuthority?.windows_service_host?.token_user_sid !== 'S-1-5-18'
    || principalAuthority?.windows_service_host?.dpapi_ng_descriptor !== 'LOCAL=user'
    || principalAuthority?.windows_service_host?.cryptographic_scope !== 'fixed_noninteractive_service_host_user'
    || principalAuthority?.windows_service_host?.authorization_scope !== 'exact_restricted_service_sid_acl_and_process_dacl'
    || principalAuthority?.windows_service_host?.local_machine_descriptor_allowed !== false
    || windowsPrincipal?.custody_store !== 'dpapi_ng_local_user_fixed_local_system_host_plus_exact_service_sid_acl_state'
  ) {
    issues.push(issue('WINDOWS_CUSTODY_PRINCIPAL_BINDING_REQUIRED', paths.principalProfiles, 'Windows custody must combine fixed non-interactive LocalSystem user encryption with exact restricted service-SID ACL and process isolation; local-machine or AD-only SID descriptors are forbidden.'));
  }

  const lifecycleIntent = parseYaml(bundle, paths.lifecycleIntent, issues);
  const lifecycleActionRows = lifecycleIntent?.actions ?? [];
  const lifecycleActionFields = lifecycleIntent?.action_schema?.fields ?? [];
  const requiredLifecycleActions = ['INSTALL', 'UNINSTALL', 'UPDATE', 'HEALTH_REPAIR', 'ADOPT_LOCAL_APP', 'REMOVE_LOCAL_APP_ADOPTION', 'OPEN_APP'];
  if (
    lifecycleIntent?.rpc_vocabulary?.transitional_prepare !== 'PrepareAppLifecycleIntent'
    || lifecycleIntent?.rpc_vocabulary?.operation_status !== 'GetAppLifecycleIntentStatus'
    || !equalArray(lifecycleIntent?.action_enum, requiredLifecycleActions)
    || !equalArray(lifecycleIntent?.status_enum, ['PREPARED', 'CONSUMED', 'SIDE_EFFECT_STARTED', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'])
    || lifecycleIntent?.platform_admission?.closeout_unit !== 'os_platform'
    || lifecycleIntent?.platform_admission?.unadmitted_platform_disposition !== 'fail_closed'
    || lifecycleIntent?.transitional_prepare_projection?.intent_id_authorizes !== false
    || lifecycleIntent?.transitional_prepare_projection?.required_for_open_app !== false
    || lifecycleIntent?.operation_admission?.security_authority !== 'live_protected_desktop_connection'
    || lifecycleIntent?.operation_admission?.database_transaction !== 'validate_bindings_consume_idempotency_key_create_operation'
    || lifecycleIntent?.operation_admission?.hmac_chain_required !== false
    || lifecycleIntent?.operation_admission?.anti_rollback_anchor_required !== false
    || lifecycleIntent?.operation_admission?.side_effect_before_transaction_commit !== 'forbidden'
    || lifecycleIntent?.status_query?.identifier_authorizes_mutation !== false
    || lifecycleIntent?.renderer_projection?.renderer_receives_authorizing_material !== false
    || lifecycleActionRows.length !== requiredLifecycleActions.length
    || lifecycleActionRows.some((row) => !hasExactKeys(row, lifecycleActionFields))
  ) {
    issues.push(issue('LIFECYCLE_OPERATION_PROTOCOL_REQUIRED', paths.lifecycleIntent, 'Lifecycle mutation requires live protected bindings, transactional idempotency, non-authorizing UX/status projections, and no per-row anchor chain.'));
  }

  const osProfiles = parseYaml(bundle, paths.osProfiles, issues);
  const profileFields = osProfiles?.profile_schema?.fields ?? [];
  const profiles = osProfiles?.profiles ?? [];
  if (profiles.length !== 3 || profileFields.length === 0 || profiles.some((row) => !hasExactKeys(row, profileFields))) {
    issues.push(issue('OS_PROFILE_MATRIX_INVALID', paths.osProfiles, 'OS profiles must match one closed row schema.'));
  }
  for (const osId of ['windows', 'linux', 'macos']) {
    const row = profiles.find((profile) => profile.os === osId);
    if (!row || !row.client_peer_verification || !row.server_peer_verification || !row.client_executable_verification || !row.server_executable_verification || row.runtime_principal_profile_ref !== osId) {
      issues.push(issue('OS_PROFILE_INCOMPLETE', paths.osProfiles, `OS profile ${osId} is incomplete.`));
    }
  }
  const windowsProfile = profiles.find((row) => row.os === 'windows');
  const windowsRestrictedBootstrap = osProfiles?.windows_restricted_service_bootstrap;
  if (
    windowsRestrictedBootstrap?.active_identity_source !== 'WTSGetActiveConsoleSessionId_and_WTSSessionInfo'
    || windowsRestrictedBootstrap?.user_token_preopen !== 'forbidden'
    || windowsRestrictedBootstrap?.endpoint_acl_subject !== 'active_account_sid_connect_only'
    || windowsRestrictedBootstrap?.account_partition !== 'user_sid_terminal_session_id_wts_logon_time'
    || windowsRestrictedBootstrap?.active_session_revalidation !== 'before_each_native_process_admission'
    || windowsRestrictedBootstrap?.post_connect_identity !== 'GetNamedPipeClientProcessId_then_process_token_user_sid_session_id_logon_luid'
    || windowsRestrictedBootstrap?.post_connect_executable !== 'same_open_hfile_native_trust'
    || windowsRestrictedBootstrap?.mismatch_disposition !== 'reject_close_and_reopen'
    || windowsProfile?.endpoint_ownership !== 'first_pipe_instance_service_owned_dacl_connect_only_active_account_sid_remote_clients_rejected'
    || windowsProfile?.client_peer_verification !== 'GetNamedPipeClientProcessId_active_user_sid_terminal_session_token_logon_luid_and_same_file_executable_trust'
    || windowsPrincipal?.endpoint_connect_boundary !== 'named_pipe_acl_grants_connect_only_to_active_account_sid_and_service_sid_then_verifies_client_token_logon_luid'
  ) {
    issues.push(issue('WINDOWS_RESTRICTED_PIPE_BOOTSTRAP_REQUIRED', paths.osProfiles, 'The restricted Windows service must bootstrap only the active account/session marker, then derive token logon identity and executable trust from the connected native client process.'));
  }
  if (!String(windowsProfile?.server_peer_verification ?? '').includes('service_sid_and_same_file_runtime_trust')) {
    issues.push(issue('MUTUAL_ENDPOINT_AUTH_REQUIRED', paths.osProfiles, 'The protected client must verify Runtime service identity and live executable trust, not only its PID.'));
  }
  if (!String(windowsProfile?.client_executable_verification ?? '').startsWith('same_open_hfile_')) {
    issues.push(issue('SAME_FILE_EXECUTABLE_VERIFICATION_REQUIRED', paths.osProfiles, 'Windows client signature, digest, and file identity must use one opened executable object.'));
  }
  const linuxProfile = profiles.find((row) => row.os === 'linux');
  if (linuxProfile?.post_bind_exec_control !== 'signed_static_control_carrier_seccomp_denies_execve_execveat_and_channel_is_cloexec') {
    issues.push(issue('PROCESS_LIVENESS_REQUIRED', paths.osProfiles, 'Linux pidfd exit monitoring must be paired with a kernel-enforced no-exec protected control carrier.'));
  }
  const macosProfile = profiles.find((row) => row.os === 'macos');
  if (
    macosProfile?.endpoint_kind !== 'privileged_xpc_service'
    || macosProfile?.endpoint_ownership !== 'launchdaemon_privileged_xpc_mach_service'
    || !String(macosProfile?.client_peer_verification ?? '').includes('audit_token')
    || !String(macosProfile?.server_peer_verification ?? '').includes('dynamic_code_identity')
  ) {
    issues.push(issue('MACOS_PRIVILEGED_XPC_REQUIRED', paths.osProfiles, 'macOS production control must use the LaunchDaemon privileged-XPC service with audit-token and dynamic-code mutual identity.'));
  }

  const configSchema = parseYaml(bundle, paths.configSchema, issues);
  const fieldKeys = (configSchema?.fields ?? []).map((row) => row.key);
  const fieldClasses = configSchema?.production_authority?.field_classes;
  const classNames = ['boot_security_immutable', 'service_owned_immutable', 'service_owned_mutable', 'service_secret'];
  const classifiedFields = classNames.flatMap((name) => fieldClasses?.[name] ?? []);
  const forbiddenSources = configSchema?.production_authority?.forbidden_input_sources ?? [];
  const providerFieldKeys = (configSchema?.provider_value_schema?.fields ?? []).map((row) => row.key);
  if (
    configSchema?.production_authority?.closed_field_partition !== true
    || new Set(classifiedFields).size !== classifiedFields.length
    || [...fieldKeys].sort().join(',') !== [...classifiedFields].sort().join(',')
    || !['environment_variable', 'argv', 'user_writable_config', 'renderer_metadata', 'app_manifest'].every((source) => forbiddenSources.includes(source))
    || configSchema?.production_authority?.unknown_fields !== 'reject'
    || configSchema?.production_authority?.interactive_user_config_file !== 'forbidden'
    || configSchema?.production_authority?.retired_import !== 'forbidden_pre_release_hardcut'
    || providerFieldKeys.includes('apiKey')
    || providerFieldKeys.includes('apiKeyEnv')
    || !providerFieldKeys.includes('credentialRef')
  ) {
    issues.push(issue('PRODUCTION_CONFIG_AUTHORITY_REQUIRED', paths.configSchema, 'Production config must be a closed field partition with signed boot authority, service-owned mutable/secret state, no user/env/argv authority, and opaque provider credential refs.'));
  }

  const reasonRoot = parseYaml(bundle, paths.reasonCodes, issues);
  const reasonFragment = parseYaml(bundle, paths.reasonCodeFragment, issues);
  const errorRoot = parseYaml(bundle, paths.errorMappings, issues);
  const errorFragment = parseYaml(bundle, paths.errorMappingFragment, issues);
  const protectedRows = (reasonFragment?.codes ?? []).filter((row) => row.family === 'PROTECTED_LOCAL');
  const protectedNames = protectedRows.map((row) => row.name);
  const protectedValues = protectedRows.map((row) => row.value);
  const mappedNames = (errorFragment?.mappings ?? [])
    .filter((row) => protectedReasonCodes.includes(row.reason_code))
    .map((row) => row.reason_code);
  if (
    !equalArray(protectedNames, protectedReasonCodes)
    || !equalArray(protectedValues, protectedReasonCodes.map((_, index) => 620 + index))
    || !equalArray(mappedNames, protectedReasonCodes)
    || !protectedReasonCodes.every((name) => reasonRoot?.values?.includes(name))
    || !protectedReasonCodes.every((name) => errorRoot?.rows?.includes(name))
  ) {
    issues.push(issue('PROTECTED_REASON_CODE_PROJECTION_REQUIRED', paths.reasonCodeFragment, 'Protected-local and lifecycle reason codes must be a closed one-to-one constants and error-mapping projection.'));
  }

  const kitRegistry = parseYaml(bundle, paths.kitRegistry, issues);
  const kitModules = new Map((kitRegistry?.modules ?? []).map((row) => [row.id, row]));
  const protectedCarrier = kitModules.get('kit.shell.protected-local');
  const tauriModule = kitModules.get('kit.shell.tauri');
  const electronModule = kitModules.get('kit.shell.electron');
  const standardShell = parseYaml(bundle, paths.standardShellCapabilities, issues);
  const lifecycleCapability = (standardShell?.capabilities ?? []).find((row) => row.id === 'runtime-lifecycle');
  const installedSet = (standardShell?.capability_sets ?? []).find((row) => row.set_id === 'installed-nimi-app-standard-shell-v1');
  if (
    protectedCarrier?.adapter_contract !== 'NimiProtectedLocalHostCarrier'
    || protectedCarrier?.admission_status !== 'authority_admitted_implementation_pending'
    || (protectedCarrier?.exports ?? []).length !== 0
    || !(tauriModule?.dependencies ?? []).includes('kit.shell.protected-local')
    || !(electronModule?.dependencies ?? []).includes('kit.shell.protected-local')
    || !equalArray((lifecycleCapability?.operations ?? []).map((row) => row.id), ['status', 'start', 'restart'])
    || standardShell?.protected_service_control_policy?.product_stop_operation !== 'absent'
    || installedSet?.authority_status !== 'a4_windows_x64_artifact_read_admitted'
    || !equalArray(installedSet?.allowed_operations ?? [], ['artifacts.readRuntimeBytes'])
    || installedSet?.planned_operations_disposition !== 'deny_until_separate_operation_admission'
  ) {
    issues.push(issue('KIT_PROTECTED_LOCAL_CARRIER_REQUIRED', paths.kitRegistry, 'Kit must register one shared native protected carrier, expose only typed status/start/restart plus the exact installed artifact read, and keep every other installed operation denied.'));
  }

  const limits = parseYaml(bundle, paths.limits, issues);
  const limitFields = limits?.limit_schema?.fields ?? [];
  const limitRows = limits?.limits ?? [];
  const expectedLimitIds = limits?.entries ?? [];
  const enumValues = new Set(limits?.bound_kind_enum ?? []);
  let limitsValid = limitFields.length > 0
    && equalArray([...enumValues], ['exact', 'minimum', 'maximum', 'exact_enum'])
    && limitRows.length === expectedLimitIds.length
    && expectedLimitIds.every((id) => limitRows.some((row) => row.limit_id === id));
  for (const row of limitRows) {
    if (!hasExactKeys(row, limitFields) || !enumValues.has(row.bound_kind) || row.hard_bound === null || row.hard_bound === undefined) limitsValid = false;
    const selected = row.bound_kind === 'minimum' ? 'minimum' : row.bound_kind === 'maximum' ? 'maximum' : 'exact';
    for (const field of ['exact', 'minimum', 'maximum']) {
      if (field === selected ? row[field] === null || row[field] === undefined : row[field] !== null) limitsValid = false;
    }
    if (row[selected] !== row.hard_bound) limitsValid = false;
    if (typeof row.default === 'number' && typeof row.hard_bound === 'number') {
      if (row.bound_kind === 'maximum' && row.default > row.hard_bound) limitsValid = false;
      if (row.bound_kind === 'minimum' && row.default < row.hard_bound) limitsValid = false;
      if (row.bound_kind === 'exact' && row.default !== row.hard_bound) limitsValid = false;
    }
  }
  if (!limitsValid) {
    issues.push(issue('SECURITY_LIMIT_SCHEMA_INVALID', paths.limits, 'Every protected-local security limit must match the closed conditional schema and hard bound.'));
  }
}

function validateRpcPosture(bundle, issues) {
  const matrix = parseYaml(bundle, paths.transportMatrix, issues);
  const rows = matrix?.methods;
  if (!Array.isArray(rows)) {
    if (matrix) issues.push(issue('TRANSPORT_ROLE_MATRIX_REQUIRED', paths.transportMatrix, 'Transport matrix methods must be a closed row list.'));
    return;
  }
  if (matrix?.request_role_selection !== 'forbidden') {
    issues.push(issue('TRANSPORT_ROLE_MATRIX_REQUIRED', paths.transportMatrix, 'Request data cannot select or upgrade a protected origin role.'));
  }
  const a5 = matrix?.a5_local_development_admission;
  const sharedCarrier = matrix?.installed_host_carrier;
  const expectedOriginRoles = [
    'binding_only',
    'verified_desktop_process',
    'desktop_account_host',
    'desktop_lifecycle_host',
    'verified_installed_process',
    'installed_host_session',
    'verified_local_development_process',
    'local_development_host_session',
  ];
  if (
    !equalArray(matrix?.transport_classes, ['public_tcp', 'desktop_control', 'launch_bootstrap', 'installed_host'])
    || !equalArray(matrix?.origin_roles, expectedOriginRoles)
    || a5?.windows?.authority_status !== 'admitted'
    || a5?.windows?.implementation_status !== 'pending_live_e2e'
    || a5?.windows?.closeout_status !== 'blocked'
    || a5?.macos?.authority_status !== 'pending_independent_admission'
    || a5?.macos?.implementation_status !== 'fail_closed_not_implemented'
    || a5?.macos?.closeout_status !== 'blocked'
    || a5?.linux?.authority_status !== 'pending_independent_admission'
    || a5?.linux?.implementation_status !== 'fail_closed_not_implemented'
    || a5?.linux?.closeout_status !== 'blocked'
    || a5?.trust_class !== 'local-development-installed-admission'
    || !equalArray(sharedCarrier?.physical_transport_shared_by, ['production_installed', 'local_development'])
    || sharedCarrier?.trust_classes_mutually_exclusive !== true
    || sharedCarrier?.process_roles_mutually_exclusive !== true
    || sharedCarrier?.session_handles_mutually_exclusive !== true
    || sharedCarrier?.operation_authorization_revalidated_per_call !== true
    || sharedCarrier?.cross_class_conversion !== 'forbidden'
  ) {
    issues.push(issue('LOCAL_DEVELOPMENT_CARRIER_AUTHORITY_REQUIRED', paths.transportMatrix, 'Local development and production may share only the installed_host physical carrier; their trust, process roles, sessions, and per-operation authorization must remain explicit, mutually exclusive, and non-convertible.'));
  }
  const desktopWire = matrix?.open_desktop_session_wire;
  if (
    desktopWire?.request?.message !== 'OpenDesktopSessionRequest'
    || desktopWire?.request?.fields?.length !== 0
    || desktopWire?.request?.request_metadata_authority_inputs?.length !== 0
    || desktopWire?.request?.unknown_field_disposition !== 'reject'
    || !equalArray((desktopWire?.response?.fields ?? []).map((row) => row.name), ['desktop_session_id', 'runtime_boot_epoch'])
    || (desktopWire?.response?.fields ?? []).some((row) => row.type !== 'bytes' || row.exact_length !== 32)
    || desktopWire?.renderer_projection !== 'forbidden'
    || desktopWire?.app_projection !== 'forbidden'
    || desktopWire?.session_reuse_or_rebind !== 'forbidden'
  ) {
    issues.push(issue('DESKTOP_SESSION_WIRE_SHAPE_REQUIRED', paths.transportMatrix, 'OpenDesktopSession must keep the frozen empty request and two-field process-bound response outside renderer/app IPC.'));
  }
  if (matrix?.public_tcp_privileged_disposition !== 'deny') {
    issues.push(issue('PUBLIC_PRIVILEGED_RPC_FORBIDDEN', paths.transportMatrix, 'Public TCP cannot admit account-control, lifecycle, broker, binding, or OpenApp privilege.'));
  }
  if (!equalArray(matrix?.reserved_not_admitted_in_a0, ['launch_bootstrap', 'installed_host'])) {
    issues.push(issue('A1_CHILD_CHANNEL_DEPENDENCY_REQUIRED', paths.transportMatrix, 'A.1 child transports must remain reserved and unadmitted in A.0.'));
  }
  const matrixFields = matrix?.matrix_schema?.fields;
  if (!Array.isArray(matrixFields) || matrixFields.length === 0) {
    issues.push(issue('TRANSPORT_ROLE_MATRIX_REQUIRED', paths.transportMatrix, 'Transport matrix must declare a closed row schema.'));
  } else {
    const expectedKeys = [...matrixFields].sort().join(',');
    for (const row of rows) {
      if (Object.keys(row).sort().join(',') !== expectedKeys) {
        issues.push(issue('TRANSPORT_ROLE_ROW_NOT_EXACT', paths.transportMatrix, `Transport row ${row.method_id ?? '<unknown>'} does not match the closed schema.`));
      }
    }
  }
  for (const method of ['RegisterApp', 'OpenSession']) {
    const row = rows.find((candidate) => candidate.method_id?.endsWith(`/${method}`));
    if (!row || row.operation_class !== 'binding_bootstrap' || !equalArray(row.allowed_transport_classes, ['public_tcp']) || !equalArray(row.required_origin_roles, ['binding_only'])) {
      issues.push(issue('BINDING_ONLY_REQUIRED', paths.transportMatrix, `${method} must remain a non-privileged binding-only bootstrap row.`));
    }
  }
  for (const method of requiredPrivilegedMethods) {
    const row = rows.find((candidate) => candidate.method_id?.endsWith(`/${method}`));
    if (
      !row
      || !Array.isArray(row.allowed_transport_classes)
      || !row.allowed_transport_classes.includes('desktop_control')
      || row.allowed_transport_classes.includes('public_tcp')
      || row.request_may_select_role !== false
      || row.portable_session_allowed !== false
      || row.public_tcp_disposition !== 'deny'
    ) {
      issues.push(issue('PRIVILEGED_METHOD_TRANSPORT_INVALID', paths.transportMatrix, `Privileged method ${method} lacks a closed Desktop-control transport row.`));
    }
  }
  for (const method of ['PrepareAppLifecycleIntent', 'GetAppLifecycleIntentStatus']) {
    const row = rows.find((candidate) => candidate.method_id?.endsWith(`/${method}`));
    if (!row || row.operation_class !== 'desktop_lifecycle_ux_projection' || !equalArray(row.required_origin_roles, ['desktop_lifecycle_host']) || row.lifecycle_challenge_required !== false) {
      issues.push(issue('LIFECYCLE_OPERATION_PROTOCOL_REQUIRED', paths.transportMatrix, `${method} must remain a non-authorizing protected Desktop UX/status projection.`));
    }
  }
  for (const method of ['InstallApp', 'UninstallApp', 'UpdateApp', 'HealthRepairApp', 'AdoptLocalApp', 'RemoveLocalAppAdoption']) {
    const row = rows.find((candidate) => candidate.method_id?.endsWith(`/${method}`));
    if (!row || row.lifecycle_challenge_required !== true || row.source_rule !== 'K-PLOCAL-007') {
      issues.push(issue('LIFECYCLE_OPERATION_PROTOCOL_REQUIRED', paths.transportMatrix, `${method} must retain transactional lifecycle-operation binding while the legacy field name is migrated.`));
    }
  }
  const openApp = rows.find((candidate) => candidate.method_id?.endsWith('/OpenApp'));
  if (!openApp || openApp.lifecycle_challenge_required !== false || openApp.source_rule !== 'K-PLOCAL-007') {
    issues.push(issue('LIFECYCLE_OPERATION_PROTOCOL_REQUIRED', paths.transportMatrix, 'OpenApp must use direct protected transactional admission without a prepare challenge.'));
  }
  const readArtifact = rows.find((candidate) => candidate.method_id?.endsWith('/ReadArtifactBytes'));
  const openDevelopment = rows.find((candidate) => candidate.method_id?.endsWith('/OpenLocalDevelopmentAppSession'));
  const developmentStatus = rows.find((candidate) => candidate.method_id?.endsWith('/GetLocalDevelopmentSessionStatus'));
  const artifactPosture = parseYaml(bundle, paths.artifactPosture, issues);
  const artifactPostureRow = artifactPosture?.methods?.find((candidate) => candidate.method_id?.endsWith('/ReadArtifactBytes'));
  if (
    !readArtifact
    || !equalArray(readArtifact.allowed_transport_classes, ['installed_host'])
    || !equalArray(readArtifact.required_origin_roles, ['installed_host_session', 'local_development_host_session'])
    || !openDevelopment
    || !equalArray(openDevelopment.allowed_transport_classes, ['installed_host'])
    || !equalArray(openDevelopment.required_origin_roles, ['verified_local_development_process'])
    || !developmentStatus
    || !equalArray(developmentStatus.allowed_transport_classes, ['installed_host'])
    || !equalArray(developmentStatus.required_origin_roles, ['local_development_host_session'])
    || artifactPostureRow?.protected_transport_class !== 'installed_host'
    || !equalArray(artifactPostureRow?.required_origin_roles, ['installed_host_session', 'local_development_host_session'])
  ) {
    issues.push(issue('LOCAL_DEVELOPMENT_CARRIER_AUTHORITY_REQUIRED', paths.transportMatrix, 'Runtime development bootstrap/status and artifact reads must use explicit mutually exclusive installed_host origin roles with no fictional union role.'));
  }
  const refresh = rows.find((candidate) => candidate.method_id?.endsWith('/RefreshAccountSession'));
  if (refresh) {
    issues.push(issue('PUBLIC_REFRESH_FORBIDDEN', paths.transportMatrix, 'A.3d removes the public RefreshAccountSession RPC from every transport projection.'));
  }
  const rawToken = rows.find((candidate) => candidate.method_id?.endsWith('/GetAccessToken'));
  if (rawToken) {
    issues.push(issue('PUBLIC_RAW_TOKEN_FORBIDDEN', paths.transportMatrix, 'A.3d removes the public raw-token RPC from every transport projection.'));
  }
  for (const method of publicGrantTokenMethods) {
    const row = rows.find((candidate) => candidate.method_id?.endsWith(`/${method}`));
    if (
      !row
      || row.operation_class !== 'blocked_pending_separate_authority'
      || row.allowed_transport_classes?.length !== 0
      || row.required_origin_roles?.length !== 0
      || row.public_tcp_disposition !== 'deny'
      || row.portable_session_allowed !== false
    ) {
      issues.push(issue('PUBLIC_PROTECTED_CREDENTIAL_ISSUANCE_FORBIDDEN', paths.transportMatrix, `${method} must be a deny-all A.3d-removal tombstone with no public or protected transport.`));
    }
  }
  for (const method of ['IssueWorkspaceBinding', 'RevokeWorkspaceBinding']) {
    const transportRow = rows.find((candidate) => candidate.method_id?.endsWith(`/${method}`));
    if (
      !transportRow
      || transportRow.operation_class !== 'blocked_pending_separate_authority'
      || transportRow.allowed_transport_classes?.length !== 0
      || transportRow.required_origin_roles?.length !== 0
      || transportRow.public_tcp_disposition !== 'deny'
      || transportRow.portable_session_allowed !== false
    ) {
      issues.push(issue('WORKSPACE_BINDING_PROTECTED_ORIGIN_REQUIRED', paths.transportMatrix, `${method} must have an explicit empty transport/origin admission.`));
    }
  }

  const accountMatrix = parseYaml(bundle, paths.accountMatrix, issues);
  const accountCallers = accountMatrix?.callers ?? [];
  for (const callerClass of [
    'local_first_party_app',
    'local_developer_app',
    'desktop_launched_installed_nimi_app',
    'binding_only_avatar',
  ]) {
    const caller = accountCallers.find((row) => row.caller_class === callerClass);
    const decisions = Object.values(caller?.methods ?? {});
    if (!caller || decisions.length === 0 || decisions.some((decision) => decision?.decision !== 'deny')) {
      issues.push(issue('A1_CALLER_PREMATURELY_ADMITTED', paths.accountMatrix, `${callerClass} must deny every account RPC until its A.1 protected child channel is admitted.`));
    }
  }
  const desktop = accountCallers.find((row) => row.caller_class === 'desktop_account_ux');
  for (const method of [
    'GetAccountSessionStatus',
    'SubscribeAccountSessionEvents',
    'BeginLogin',
    'CompleteLogin',
    'RequestPresenceVerification',
    'Logout',
    'SwitchAccount',
    'InvokeRealmUnary',
    'IssueScopedAppBinding',
    'RevokeScopedAppBinding',
  ]) {
    const requirements = desktop?.methods?.[method]?.requirements ?? [];
    if (!requirements.includes('protected_desktop_control_origin') || !requirements.includes('desktop_account_host_origin')) {
      issues.push(issue('DESKTOP_ACCOUNT_ORIGIN_REQUIRED', paths.accountMatrix, `${method} must require the verified Desktop account origin.`));
    }
  }

  const identityAccess = parseYaml(bundle, paths.identityAccess, issues);
  const identityMethods = identityAccess?.methods ?? [];
  for (const methodId of [
    '/nimi.runtime.v1.RuntimeAuthService/RegisterApp',
    '/nimi.runtime.v1.RuntimeAuthService/OpenSession',
  ]) {
    const row = identityMethods.find((candidate) => candidate.method_id === methodId);
    if (!row || row.posture !== 'binding_only_bootstrap' || row.required_origin_role !== 'binding_only') {
      issues.push(issue('BINDING_ONLY_REQUIRED', paths.identityAccess, `${methodId} must project binding_only_bootstrap only.`));
    }
  }
  const desktopSession = identityMethods.find((candidate) => candidate.method_id?.endsWith('/OpenDesktopSession'));
  if (!desktopSession || desktopSession.posture !== 'protected_origin_required' || desktopSession.required_origin_role !== 'verified_desktop_process') {
    issues.push(issue('DESKTOP_SESSION_POSTURE_REQUIRED', paths.identityAccess, 'OpenDesktopSession must require verified Desktop process origin.'));
  }
  for (const method of publicGrantTokenMethods) {
    const row = identityMethods.find((candidate) => candidate.method_id?.endsWith(`/${method}`));
    if (
      !row
      || row.posture !== 'deny_all_tombstone'
      || row.authority_status !== 'tombstone_pending_a3d_removal'
      || row.transport_disposition !== 'deny_all'
      || 'protected_transport_class' in row
      || 'required_origin_role' in row
    ) {
      issues.push(issue('PUBLIC_PROTECTED_CREDENTIAL_ISSUANCE_FORBIDDEN', paths.identityAccess, `${method} cannot issue, validate, revoke, delegate, or enumerate a portable protected credential for a public caller.`));
    }
  }
  for (const method of ['IssueWorkspaceBinding', 'RevokeWorkspaceBinding']) {
    const row = identityMethods.find((candidate) => candidate.method_id?.endsWith(`/${method}`));
    if (
      !row
      || row.posture !== 'blocked_pending_authority'
      || row.authority_status !== 'blocked_pending_separate_authority'
      || row.transport_disposition !== 'deny_all'
      || 'protected_transport_class' in row
      || 'required_origin_role' in row
    ) {
      issues.push(issue('WORKSPACE_BINDING_PROTECTED_ORIGIN_REQUIRED', paths.identityAccess, `${method} must remain deny-all until an exact protected origin and operation authority are independently admitted.`));
    }
  }
  for (const method of [
    'GetAccountSessionStatus',
    'SubscribeAccountSessionEvents',
    'BeginLogin',
    'CompleteLogin',
    'RequestPresenceVerification',
    'InvokeRealmUnary',
    'Logout',
    'SwitchAccount',
    'IssueScopedAppBinding',
    'RevokeScopedAppBinding',
  ]) {
    const row = identityMethods.find((candidate) => candidate.method_id?.endsWith(`/${method}`));
    if (!row || row.posture !== 'protected_origin_required' || row.protected_transport_class !== 'desktop_control' || row.required_origin_role !== 'desktop_account_host') {
      issues.push(issue('DESKTOP_ACCOUNT_ORIGIN_REQUIRED', paths.identityAccess, `${method} identity posture must require the verified Desktop account origin.`));
    }
  }
  for (const method of ['PrepareAppLifecycleIntent', 'GetAppLifecycleIntentStatus', 'InstallApp', 'UninstallApp', 'UpdateApp', 'HealthRepairApp', 'AdoptLocalApp', 'RemoveLocalAppAdoption', 'OpenApp']) {
    const row = identityMethods.find((candidate) => candidate.method_id?.endsWith(`/${method}`));
    const mustConsumeIntent = !['PrepareAppLifecycleIntent', 'GetAppLifecycleIntentStatus', 'OpenApp'].includes(method);
    if (!row || row.posture !== 'protected_origin_required' || row.protected_transport_class !== 'desktop_control' || row.required_origin_role !== 'desktop_lifecycle_host' || row.lifecycle_challenge_required !== mustConsumeIntent) {
      issues.push(issue('LIFECYCLE_OPERATION_PROTOCOL_REQUIRED', paths.identityAccess, `${method} identity posture must match the protected Desktop lifecycle operation protocol.`));
    }
  }

  const interceptorChain = parseYaml(bundle, paths.interceptorChain, issues);
  const firstInterceptor = interceptorChain?.interceptors?.[0];
  if (!firstInterceptor || firstInterceptor.name !== 'protected-origin' || firstInterceptor.order !== 1) {
    issues.push(issue('PROTECTED_ORIGIN_INTERCEPTOR_REQUIRED', paths.interceptorChain, 'Protected origin derivation must precede protocol/authn/authz processing.'));
  }
  const daemonLifecycle = bundle.get(paths.daemonLifecycle) ?? '';
  if (!/gRPC 请求经过 9 层有序拦截器/u.test(daemonLifecycle) || !/\| 1 \| protected-origin \|/u.test(daemonLifecycle) || !/\| 9 \| audit \|/u.test(daemonLifecycle)) {
    issues.push(issue('PROTECTED_ORIGIN_INTERCEPTOR_REQUIRED', paths.daemonLifecycle, 'Human Runtime authority must project the same nine-stage protected-origin-first chain.'));
  }

  const rpcMethods = parseYaml(bundle, paths.rpcMethods, issues);
  const projectedMethods = new Map();
  for (const service of rpcMethods?.services ?? []) {
    for (const method of service.methods ?? []) {
      projectedMethods.set(`/${service.name}/${method.name}`, method);
    }
  }
  const pendingProtoMethods = new Set(matrix?.authority_admitted_pending_proto_projection ?? []);
  const physicallyRemovedPublicCredentialMethods = new Set(['GetAccessToken', 'RefreshAccountSession']);
  for (const row of rows) {
    const suffix = row.method_id.replace('/nimi.runtime.v1.', '/');
    const methodName = row.method_id.slice(row.method_id.lastIndexOf('/') + 1);
    if (pendingProtoMethods.has(methodName) || physicallyRemovedPublicCredentialMethods.has(methodName)) continue;
    const projected = projectedMethods.get(suffix);
    if (!projected || projected.protected_transport_ref !== row.method_id) {
      issues.push(issue('RPC_TRANSPORT_PROJECTION_MISSING', paths.rpcMethods, `${row.method_id} must reference its unique protected transport row.`));
    }
  }
  const grantRpcService = (rpcMethods?.services ?? []).find((service) => service.name === 'RuntimeGrantService');
  for (const method of publicGrantTokenMethods) {
    const row = grantRpcService?.methods?.find((candidate) => candidate.name === method);
    if (row?.authority_status !== 'tombstone_pending_a3d_removal' || row?.transport_disposition !== 'deny_all') {
      issues.push(issue('PUBLIC_PROTECTED_CREDENTIAL_ISSUANCE_FORBIDDEN', paths.rpcMethods, `${method} must remain only as a deny-all wire tombstone pending A.3d removal.`));
    }
  }

  const sdkMethodGroups = parseYaml(bundle, paths.sdkMethodGroups, issues);
  const grantGroup = sdkMethodGroups?.groups?.find((group) => group.group === 'grant_service_projection');
  const excludedGrantMethods = new Map((grantGroup?.excluded ?? []).map((row) => [row.name, row]));
  if (
    grantGroup?.status !== 'tombstone_pending_a3d_removal'
    || (grantGroup?.methods ?? []).length !== 0
    || publicGrantTokenMethods.some((method) => excludedGrantMethods.get(method)?.authority_status !== 'tombstone_pending_a3d_removal')
  ) {
    issues.push(issue('PUBLIC_PROTECTED_CREDENTIAL_SDK_EXPORT_FORBIDDEN', paths.sdkMethodGroups, 'SDK method groups must export none of the public protected-token family and retain only A.3d removal tombstones.'));
  }
}

function validatePortableBoundary(bundle, issues) {
  const contract = bundle.get(paths.contract) ?? '';
  const firstRule = extractRule(contract, 'K-PLOCAL-001');
  if (!/RegisterApp.*OpenSession.*BINDING_ONLY/isu.test(firstRule)) {
    issues.push(issue('BINDING_ONLY_REQUIRED', `${paths.contract}#K-PLOCAL-001`, 'Registration surfaces must remain binding-only.'));
  }
  if (!/portable.*(?:cannot|MUST NOT|never).*privilege/isu.test(firstRule)) {
    issues.push(issue('PORTABLE_PRIVILEGE_FORBIDDEN', `${paths.contract}#K-PLOCAL-001`, 'Portable material must be explicitly non-authorizing.'));
  }
  const matrix = parseYaml(bundle, paths.transportMatrix, issues);
  if (matrix?.portable_privileged_session !== 'forbidden') {
    issues.push(issue('PORTABLE_PRIVILEGE_FORBIDDEN', paths.transportMatrix, 'Portable material cannot establish or rebind a protected caller session.'));
  }
  for (const row of matrix?.methods ?? []) {
    if (row.portable_session_allowed !== false || row.request_may_select_role !== false) {
      issues.push(issue('PORTABLE_PRIVILEGE_FORBIDDEN', paths.transportMatrix, `${row.method_id ?? 'unknown method'} must reject portable or request-selected protected authority.`));
    }
  }
}

function validateTrustIsolation(bundle, issues) {
  const trust = parseYaml(bundle, paths.trustSets, issues);
  const rows = trust?.trust_sets;
  if (!Array.isArray(rows)) {
    if (trust) issues.push(issue('TRUST_SET_TABLE_INVALID', paths.trustSets, 'Executable trust sets must be a closed row list.'));
    return;
  }
  const fields = trust?.trust_set_schema?.fields ?? [];
  if (fields.length === 0 || rows.some((row) => !hasExactKeys(row, fields))) {
    issues.push(issue('TRUST_SET_TABLE_INVALID', paths.trustSets, 'Executable trust-set rows must match one closed schema.'));
  }
  const requiredRows = new Map([
    ['nimi-desktop-production-v1', ['nimi_desktop', 'production', 'production_only', true]],
    ['nimi-desktop-e2e-fixture-v1', ['nimi_desktop', 'non_product_test', 'test_only', false]],
    ['nimi-runtime-production-v1', ['nimi_runtime_service', 'production', 'production_only', true]],
    ['nimi-runtime-e2e-fixture-v1', ['nimi_runtime_service', 'non_product_test', 'test_only', false]],
    ['nimi-desktop-control-carrier-production-v1', ['nimi_desktop_control_carrier', 'production', 'production_only', true]],
    ['nimi-desktop-control-carrier-e2e-fixture-v1', ['nimi_desktop_control_carrier', 'non_product_test', 'test_only', false]],
  ]);
  for (const [trustSetId, [role, environment, build, productClaim]] of requiredRows) {
    const row = rows.find((candidate) => candidate.trust_set_id === trustSetId);
    if (
      !row
      || row.executable_role !== role
      || row.environment !== environment
      || row.runtime_build_allowance !== build
      || row.product_readiness_claim_allowed !== productClaim
      || row.runtime_configuration_mutable !== false
      || !String(row.launch_authority ?? '').trim()
      || !String(row.configuration_authority ?? '').trim()
      || !String(row.platform_code_signing_policy_ref ?? '').trim()
      || !String(row.installer_release_authority ?? '').trim()
    ) {
      const code = role === 'nimi_runtime_service' ? 'RUNTIME_EXECUTABLE_TRUST_REQUIRED' : environment === 'production' ? 'PRODUCTION_TRUST_SET_INVALID' : 'TEST_TRUST_SET_INVALID';
      issues.push(issue(code, paths.trustSets, `Required executable trust row ${trustSetId} is missing or unsafe.`));
    }
  }
  const nativeVerification = trust?.platform_native_release_verification;
  if (
    trust?.platform_admission?.closeout_unit !== 'os_platform'
    || trust?.platform_admission?.independent_admission_allowed !== true
    || trust?.platform_admission?.unadmitted_platform_disposition !== 'fail_closed'
    || trust?.platform_admission?.cross_platform_parity_required_before_first_platform_positive_chain !== false
    || trust?.trust_direction_requirements?.desktop_or_control_carrier_verifies_runtime !== 'required'
    || !String(nativeVerification?.windows ?? '').includes('WinVerifyTrust')
    || !String(nativeVerification?.macos ?? '').includes('SecCode')
    || !String(nativeVerification?.linux ?? '').includes('signed_package_repository_identity')
    || nativeVerification?.caller_selected_path_release_or_policy !== 'forbidden'
    || nativeVerification?.peer_owned_release_generation !== 'forbidden'
    || nativeVerification?.custom_peer_release_record !== 'absent'
    || nativeVerification?.same_open_object_required !== true
  ) {
    issues.push(issue('RUNTIME_EXECUTABLE_TRUST_REQUIRED', paths.trustSets, 'Client-side Runtime trust requires platform-native same-object code-signing verification, installer-owned rollback authority, and per-platform fail-close admission.'));
  }
  if (trust?.production_runtime_accepts_test_trust_set !== false) {
    issues.push(issue('PRODUCTION_TEST_TRUST_ISOLATION_REQUIRED', paths.trustSets, 'Production Runtime must structurally reject test trust sets.'));
  }
  if (trust?.test_runtime_accepts_production_realm_endpoints !== false) {
    issues.push(issue('PRODUCTION_TEST_TRUST_ISOLATION_REQUIRED', paths.trustSets, 'Test Runtime must reject production account and Realm endpoints.'));
  }
  if (trust?.test_runtime_accepts_production_account_custody !== false || trust?.production_runtime_trusts_user_selected_executable !== false) {
    issues.push(issue('PRODUCTION_TEST_TRUST_ISOLATION_REQUIRED', paths.trustSets, 'Test Runtime cannot consume production custody and production Runtime cannot trust user-selected executables.'));
  }
  const signerPolicies = new Map((trust?.signer_policies ?? []).map((row) => [row.signer_policy_id, row]));
  for (const row of rows) {
    const policy = signerPolicies.get(row.platform_code_signing_policy_ref);
    if (!policy || policy.environment !== row.environment || policy.runtime_build_allowance !== row.runtime_build_allowance || !policy.platform_native_constraints) {
      issues.push(issue('SIGNER_POLICY_REFERENCE_INVALID', paths.trustSets, `${row.trust_set_id} must resolve a same-environment closed signer policy.`));
    }
  }
}

function validateBundle(bundle, mode) {
  const issues = [];
  if (mode === 'protected-local-authority') validateCore(bundle, issues);
  if (mode === 'protected-rpc-posture') validateRpcPosture(bundle, issues);
  if (mode === 'no-portable-privileged-session') validatePortableBoundary(bundle, issues);
  if (mode === 'protected-local-trust-set-isolation') validateTrustIsolation(bundle, issues);
  return issues;
}

function applyFixtureMutation(bundle, fixture) {
  const relative = fixture.target;
  const source = bundle.get(relative);
  if (typeof source !== 'string') throw new Error(`fixture target unavailable: ${fixture.fixture_id}`);
  if (fixture.mutation?.kind !== 'replace_exact') throw new Error(`fixture mutation kind invalid: ${fixture.fixture_id}`);
  const from = fixture.mutation.from;
  const first = source.indexOf(from);
  if (first === -1 || source.indexOf(from, first + from.length) !== -1) {
    throw new Error(`fixture replacement must have one exact source match: ${fixture.fixture_id}`);
  }
  bundle.set(relative, source.replace(from, fixture.mutation.to));
}

function runNegativeFixtures(baseline) {
  const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  return fixtures.map((fixture) => {
    const bundle = new Map(baseline);
    applyFixtureMutation(bundle, fixture);
    const issues = [];
    for (const mode of modes) issues.push(...validateBundle(bundle, mode));
    const unique = issues.filter((candidate, index) => issues.findIndex((other) => other.code === candidate.code && other.target === candidate.target) === index);
    const expected = unique.filter((candidate) => candidate.code === fixture.code);
    if (unique.length !== 1 || expected.length !== 1) {
      const observed = unique.map((candidate) => `${candidate.code}@${candidate.target}`).join(', ') || '<none>';
      throw new Error(`fixture ${fixture.fixture_id} must produce only ${fixture.code}; observed ${observed}`);
    }
    return {
      fixture_id: fixture.fixture_id,
      code: expected[0].code,
      target: fixture.target,
      issue_count: unique.length,
      reason: expected[0].reason,
    };
  });
}

function printIssues(issues) {
  for (const item of issues) {
    process.stderr.write(`[${item.code}] ${item.reason} (${item.target})\n`);
  }
}

function readArguments(argv) {
  if (argv.length === 1 && argv[0] === '--fixture-report-json') {
    return { fixtureReport: true };
  }
  if (argv.length !== 2 || argv[0] !== '--mode' || !modes.has(argv[1])) {
    return { argumentError: true };
  }
  return { mode: argv[1] };
}

function main() {
  const options = readArguments(process.argv.slice(2));
  if (options.argumentError) {
    process.stderr.write('[ARGUMENT_ERROR] expected --mode <known-mode> or --fixture-report-json\n');
    process.exitCode = 1;
    return;
  }
  const bundle = loadBundle();
  if (options.fixtureReport) {
    const baselineIssues = [];
    for (const mode of modes) baselineIssues.push(...validateBundle(bundle, mode));
    if (baselineIssues.length > 0) {
      printIssues(baselineIssues);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`${JSON.stringify({ fixtures: runNegativeFixtures(bundle) }, null, 2)}\n`);
    return;
  }
  const issues = validateBundle(bundle, options.mode);
  if (issues.length > 0) {
    printIssues(issues);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${options.mode}: OK\n`);
}

main();
