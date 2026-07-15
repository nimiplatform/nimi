#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

export const authorityPaths = Object.freeze({
  policy: '.nimi/spec/platform/kernel/tables/nimi-app-local-development-admission.yaml',
  platform: '.nimi/spec/platform/kernel/nimi-app-local-admission-contract.md',
  runtimeSession: '.nimi/spec/runtime/kernel/protected-local-session-contract.md',
  account: '.nimi/spec/runtime/kernel/account-session-contract.md',
  grant: '.nimi/spec/runtime/kernel/grant-service.md',
  desktop: '.nimi/spec/desktop/kernel/bridge-ipc-contract.md',
  kit: '.nimi/spec/platform/kernel/kit-contract.md',
  sdk: '.nimi/spec/sdks/kernel/transport-contract.md',
  principalSchema: '.nimi/spec/runtime/kernel/tables/local-app-principal-record-schema.yaml',
  grantSchema: '.nimi/spec/runtime/kernel/tables/local-app-grant-binding-schema.yaml',
  presenceProtocol: '.nimi/spec/runtime/kernel/tables/local-app-presence-protocol.yaml',
  transportMatrix: '.nimi/spec/runtime/kernel/tables/protected-local-rpc-transport-matrix.yaml',
  rpcAuth: '.nimi/spec/runtime/kernel/tables/runtime-rpc-auth-posture/identity-access.yaml',
  desktopControls: '.nimi/spec/desktop/kernel/tables/local-app-control-surfaces.yaml',
});

const yamlKeys = new Set([
  'policy',
  'principalSchema',
  'grantSchema',
  'presenceProtocol',
  'transportMatrix',
  'rpcAuth',
  'desktopControls',
]);

const authorizationBindings = Object.freeze([
  'local_os_user_anchor',
  'local_app_principal_id',
  'canonical_project_file_id',
  'declared_app_id',
  'manifest_capability_fingerprint',
  'account_id',
  'fixed_shell_entry_policy',
]);

const runtimeScopedBindingRequestScopes = Object.freeze([
  'runtime.agent.turn.read',
  'runtime.agent.turn.write',
]);

const sessionBindings = Object.freeze([
  'development_authorization_id',
  'local_app_principal_id',
  'local_app_record_id',
  'provenance_revision',
  'project_generation',
  'launch_lease_id',
  'desktop_supervisor_process',
  'host_process_tuple',
  'executable_and_build_digest',
  'controlled_renderer_origin_and_output_roots',
  'shell_kind',
  'account_generation',
  'account_id',
  'runtime_boot_epoch',
]);

const continuityWithoutReapproval = Object.freeze([
  'renderer_hmr_or_reload',
  'electron_main_or_preload_controlled_rebuild_and_restart',
  'tauri_host_controlled_rebuild_and_restart',
  'controlled_host_replacement_same_authorization',
  'runtime_restart_during_live_supervisor_run',
]);

const continuityInvalidators = Object.freeze([
  'capability_expansion',
  'declared_app_id_change',
  'canonical_project_file_identity_change',
  'copied_project',
  'shell_or_entry_policy_change',
  'account_switch_or_logout',
  'mode_off',
  'authorization_revoke',
  'supervisor_run_termination',
  'host_outside_verified_supervisor',
  'executable_or_renderer_origin_outside_controlled_outputs',
  'remote_or_uncontrolled_dev_server',
]);

const runOnceEnds = Object.freeze([
  'supervisor_run_termination',
  'mode_off',
  'logout_or_account_switch',
  'revoke',
  'identity_capability_or_shell_mismatch',
]);

const developerMethods = Object.freeze([
  'GetDeveloperModeStatus',
  'SetDeveloperMode',
  'EvaluateLocalDevelopmentProject',
  'DecideLocalDevelopmentProject',
  'ListLocalDevelopmentAuthorizations',
  'ReactivateLocalDevelopmentProject',
  'RevokeLocalDevelopmentAuthorization',
  'EndLocalDevelopmentRun',
]);

const selectedOperationMethods = Object.freeze([
  '/nimi.runtime.v1.RuntimeArtifactService/ReadArtifactBytes',
  '/nimi.runtime.v1.RuntimeAgentService/OpenConversationAnchor',
  '/nimi.runtime.v1.RuntimeAppService/SendAppMessage',
  '/nimi.runtime.v1.RuntimeAppService/SubscribeAppMessages',
  '/nimi.runtime.v1.RuntimeAgentService/GetPublicChatSessionSnapshot',
]);

const requiredRuleClauses = Object.freeze([
  ['platform', ['P-NAPP-035', /sole mutable third-party provenance/iu, /global Developer Mode toggle grants nothing/iu, /run_once.*remember_project/isu, /runtime_scoped_binding_requests/iu, /request eligibility only/iu, /Every build\/host replacement receives a new lease/iu, /account switch, mode-off,\s*revoke/isu, /no token, bearer/iu, /persistent Nimi-managed logon\/boot autostart/iu, /ordinary Windows rights/iu]],
  ['runtimeSession', ['K-PLOCAL-009', /durable user\s+development authorization/iu, /run_once/iu, /remember_project.*dormant/isu, /actual\s+host PID and creation marker/isu, /new launch lease,\s*process bind and session/isu, /Runtime restart/iu, /never returned through renderer IPC, CLI output/isu, /It never autostarts/iu]],
  ['account', ['K-ACCSVC-026', /exact\s+principal.*local record.*process-bound session/isu, /exact grant revision/iu, /owner.*resource policy/iu, /opening a session grants nothing/iu]],
  ['grant', ['K-GRANT-014', /create zero grant/iu, /Account switch never transfers/iu, /next protected operation reads the\s+current revision/isu, /separate from principal\/record and launch\/session stores/iu]],
  ['desktop', ['D-IPC-019', /production account.*off by default.*grants nothing/isu, /exactly one Dev Trust Set/iu, /remember_project.*dormant.*reactivate/isu, /fresh host\/payload digest.*launch lease.*process bind.*local-app session/isu, /Native\s+Windows execution risk disclosure/isu, /never create persistent/iu]],
  ['desktop', ['D-IPC-020', /local_app_control.*verified\s+Desktop control connection/isu, /PrepareLocalAppLaunch.*process binding.*native supervisor/isu, /must not enter renderer state,\s*storage, network, logs or errors/isu]],
  ['kit', ['P-KIT-046', /common local-app host\/client/iu, /controlled process replacement or Runtime restart/iu, /artifact read.*selected RuntimeAgent conversation/isu, /missing\/untrusted carrier fails closed/iu, /ordinary gRPC/iu]],
  ['sdk', ['S-TRANSPORT-014', /host-injected by Kit.*never\s*renderer-constructed/isu, /request-empty `OpenLocalAppSession`/iu, /controlled host\/Runtime restart/iu, /selected RuntimeAgent open-conversation, send-turn, subscribe-turn and\s*conversation-snapshot/isu, /Missing operation families remain typed\s*unavailable/isu, /localhost gRPC cannot claim/iu]],
]);

function issue(code, target, reason) {
  return { code, target, reason };
}

function exactArray(value, expected) {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

function sameSet(value, expected) {
  return Array.isArray(value)
    && value.length === expected.length
    && expected.every((entry) => value.includes(entry));
}

function includesAll(value, expected) {
  return Array.isArray(value) && expected.every((entry) => value.includes(entry));
}

function extractRule(source, ruleId) {
  const escaped = ruleId.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = new RegExp(`^## ${escaped}\\b`, 'mu').exec(source);
  if (!match) return '';
  const next = source.indexOf('\n## ', match.index + match[0].length);
  return source.slice(match.index, next === -1 ? source.length : next);
}

function methodMap(table) {
  return new Map((table?.methods ?? []).map((row) => [row.method_id, row]));
}

function hasExactProtectedRow(row, transport, role) {
  return row?.posture === 'protected_origin_required'
    && row?.protected_transport_class === transport
    && row?.required_origin_role === role;
}

function hasExactTransportRow(row, operationClass, transport, role) {
  return row?.operation_class === operationClass
    && exactArray(row?.allowed_transport_classes, [transport])
    && exactArray(row?.required_origin_roles, [role])
    && row?.request_may_select_role === false
    && row?.portable_session_allowed === false
    && row?.public_tcp_disposition === 'deny';
}

export function loadAuthorityBundle(root = repoRoot) {
  return Object.fromEntries(Object.entries(authorityPaths).map(([key, relative]) => {
    const absolute = path.join(root, relative);
    return [key, fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : null];
  }));
}

export function validateLocalDevelopmentAuthority(bundle) {
  const issues = [];
  const parsed = {};

  for (const [key, relative] of Object.entries(authorityPaths)) {
    if (bundle[key] === null || bundle[key] === undefined) {
      issues.push(issue('LOCAL_DEVELOPMENT_AUTHORITY_FILE_MISSING', relative, 'Required local-development authority file is missing.'));
      continue;
    }
    if (yamlKeys.has(key)) {
      try {
        parsed[key] = typeof bundle[key] === 'string' ? YAML.parse(bundle[key]) : bundle[key];
      } catch {
        issues.push(issue('LOCAL_DEVELOPMENT_AUTHORITY_YAML_INVALID', relative, 'Required local-development authority YAML is invalid.'));
      }
    }
  }

  for (const [key, [ruleId, ...patterns]] of requiredRuleClauses) {
    const section = extractRule(bundle[key] ?? '', ruleId);
    if (!section) {
      issues.push(issue('LOCAL_DEVELOPMENT_AUTHORITY_RULE_MISSING', `${authorityPaths[key]}#${ruleId}`, `Required rule ${ruleId} is missing.`));
      continue;
    }
    for (const pattern of patterns) {
      if (!pattern.test(section)) {
        issues.push(issue('LOCAL_DEVELOPMENT_AUTHORITY_CLAUSE_MISSING', `${authorityPaths[key]}#${ruleId}`, `Required ${ruleId} clause is missing.`));
      }
    }
  }

  const policy = parsed.policy;
  if (policy) {
    if (
      policy.version !== 2
      || policy.table_family !== 'owner_matrix'
      || policy.owner !== 'platform'
      || policy.matrix_id !== 'nimi_app_local_development_admission'
    ) {
      issues.push(issue('LOCAL_DEVELOPMENT_POLICY_IDENTITY_INVALID', authorityPaths.policy, 'Policy must be the Platform-owned v2 local-development owner matrix.'));
    }

    if (
      policy.trust_class?.id !== 'local_development'
      || policy.trust_class?.taxonomy_ref !== 'tables/nimi-app-local-trust-classes.yaml'
      || policy.trust_class?.mutable_project_allowed !== true
      || policy.trust_class?.product_release_conversion !== 'forbidden_new_immutable_admission_required'
      || policy.trust_class?.app_id_collision_inherits_state !== false
    ) {
      issues.push(issue('LOCAL_DEVELOPMENT_TRUST_CLASS_INVALID', authorityPaths.policy, 'Local development must be the isolated mutable provenance class and cannot convert to or inherit immutable product state.'));
    }

    const mode = policy.developer_mode;
    if (
      mode?.shipped_in_production !== true
      || mode?.default_enabled !== false
      || mode?.global_toggle_grants_capability !== false
      || mode?.hidden_flag_env_or_argv_enablement !== 'forbidden'
      || mode?.disable_effect?.active_sessions !== 'revoke'
      || mode?.disable_effect?.run_once_authorizations !== 'revoke'
      || mode?.disable_effect?.remembered_authorizations !== 'dormant'
      || mode?.disable_effect?.immutable_records !== 'unaffected'
    ) {
      issues.push(issue('LOCAL_DEVELOPMENT_DEVELOPER_MODE_INVALID', authorityPaths.policy, 'Production Developer Mode must default off, grant nothing, reject hidden enablement, and apply the exact mode-off invalidations.'));
    }

    const authorization = policy.user_development_authorization;
    if (
      authorization?.owner !== 'runtime_k_app'
      || !exactArray(authorization?.bindings, authorizationBindings)
      || !exactArray(authorization?.choices, ['run_once', 'remember_project'])
      || authorization?.initial_grant_state !== 'zero'
      || authorization?.remembered_reactivation_requires_fresh_presence !== true
      || authorization?.account_switch_transfers_authorization !== false
      || authorization?.app_owned_or_renderer_storage !== 'forbidden'
    ) {
      issues.push(issue('LOCAL_DEVELOPMENT_USER_AUTHORIZATION_INVALID', authorityPaths.policy, 'Project authorization must use the exact principal/project/account/shell bindings, zero-grant start, and run-once/remember lifetimes.'));
    }

    const bindingRequests = policy.runtime_scoped_binding_requests;
    if (
      bindingRequests?.manifest_field !== 'local_development.runtime_scoped_binding_requests'
      || bindingRequests?.owner !== 'runtime_k_app_request_eligibility'
      || !exactArray(bindingRequests?.admitted_request_scopes, runtimeScopedBindingRequestScopes)
      || !exactArray(bindingRequests?.item_shape?.required_fields, ['scope', 'purpose'])
      || bindingRequests?.item_shape?.qualifier !== 'forbidden'
      || bindingRequests?.item_shape?.duplicate_scope !== 'forbidden'
      || bindingRequests?.item_shape?.unknown_scope !== 'forbidden'
      || bindingRequests?.capability_fingerprint_inclusion !== 'canonical_sorted_set'
      || bindingRequests?.request_eligibility_only !== true
      || bindingRequests?.creates_operation_grant !== false
      || bindingRequests?.creates_scoped_binding !== false
      || bindingRequests?.runtime_issued_binding_still_required !== true
      || bindingRequests?.platform_registry_permission_equivalence !== 'forbidden'
      || bindingRequests?.app_renderer_or_manifest_positive_authority !== 'forbidden'
    ) {
      issues.push(issue('LOCAL_DEVELOPMENT_RUNTIME_BINDING_REQUESTS_INVALID', authorityPaths.policy, 'Runtime scoped binding requests must be a closed fingerprint input that grants no operation or scoped binding authority.'));
    }

    const session = policy.technical_launch_and_session;
    if (
      session?.owner !== 'runtime_k_plocal'
      || session?.transport !== 'local_app_host'
      || session?.session_role !== 'local_app_session'
      || !exactArray(session?.bindings, sessionBindings)
      || session?.new_process_requires_new_lease_and_session !== true
      || session?.material_visibility !== 'runtime_and_native_host_private_only'
      || session?.renderer_cli_terminal_visibility !== 'forbidden'
    ) {
      issues.push(issue('LOCAL_DEVELOPMENT_TECHNICAL_SESSION_INVALID', authorityPaths.policy, 'Each exact supervised process requires a new private lease/session with all principal, record, digest, account, and epoch bindings.'));
    }

    if (!exactArray(policy.continuity_matrix?.no_reapproval_new_lease_and_session_required, continuityWithoutReapproval)) {
      issues.push(issue('LOCAL_DEVELOPMENT_CONTINUITY_INVALID', authorityPaths.policy, 'Controlled edit/build/restart and Runtime restart must rotate lease/session without widening durable authorization.'));
    }
    if (!exactArray(policy.continuity_matrix?.invalidate_or_require_fresh_approval, continuityInvalidators)) {
      issues.push(issue('LOCAL_DEVELOPMENT_INVALIDATION_INVALID', authorityPaths.policy, 'Project, account, mode, revoke, supervisor, process, output, and origin changes must invalidate or require fresh approval.'));
    }

    const lifetimes = policy.lifetimes;
    if (
      !exactArray(lifetimes?.run_once_ends_on, runOnceEnds)
      || lifetimes?.run_once_terminal_transition !== 'tombstone_principal_and_mark_record_removed'
      || lifetimes?.subsequent_run_once !== 'fresh_approval_new_principal_and_record'
      || lifetimes?.remember_project_on_mode_off !== 'dormant'
      || lifetimes?.remember_project_on_supervisor_run_termination !== 'dormant'
      || lifetimes?.remember_project_auto_runs_after_reenable !== false
      || lifetimes?.remembered_account_switch !== 'live_session_revoked_record_remains_bound_to_original_account_and_requires_fresh_presence_after_return'
    ) {
      issues.push(issue('LOCAL_DEVELOPMENT_LIFETIME_INVALID', authorityPaths.policy, 'Run-once must terminate/tombstone while remembered projects remain dormant, account-bound, presence-gated, and never auto-run.'));
    }

    const risk = policy.risk_and_background;
    if (
      risk?.production_account_allowed_through_runtime_mediation !== true
      || risk?.runtime_credential_custody_required !== true
      || risk?.native_os_risk_disclosure_required !== true
      || risk?.nimi_grants_cover_all_windows_rights !== false
      || risk?.nimi_managed_logon_or_boot_autostart !== 'forbidden'
    ) {
      issues.push(issue('LOCAL_DEVELOPMENT_RISK_POSTURE_INVALID', authorityPaths.policy, 'Production-account mediation requires Runtime custody, native Windows risk disclosure, and no Nimi-managed persistent autostart.'));
    }

    const operation = policy.operation_posture;
    if (
      operation?.same_grant_and_owner_policy_as_other_trust_classes !== true
      || !exactArray(operation?.selected_checkpoint_families, ['runtime_artifact_read', 'runtime_agent_conversation'])
      || operation?.missing_families !== 'typed_owner_unavailable'
      || operation?.generic_protected_proxy !== 'forbidden'
    ) {
      issues.push(issue('LOCAL_DEVELOPMENT_OPERATION_POSTURE_INVALID', authorityPaths.policy, 'The checkpoint admits only artifact read and selected RuntimeAgent conversation through common grants/owner policy; missing families stay typed unavailable.'));
    }

    if (
      policy.platform_posture?.windows !== 'final_fixed_service_positive_required'
      || policy.platform_posture?.macos !== 'fail_closed_pending_independent_admission'
      || policy.platform_posture?.linux !== 'fail_closed_pending_independent_admission'
      || policy.platform_posture?.localhost_grpc_or_same_user_daemon_fallback !== 'forbidden'
    ) {
      issues.push(issue('LOCAL_DEVELOPMENT_PLATFORM_POSTURE_INVALID', authorityPaths.policy, 'Windows requires the final fixed service; macOS/Linux and localhost/same-user-daemon fallbacks remain fail closed.'));
    }
  }

  const principal = parsed.principalSchema;
  if (principal) {
    if (
      principal.local_os_user_anchor?.windows_source !== 'verified_interactive_user_sid'
      || principal.local_os_user_anchor?.request_supplied !== 'forbidden'
      || principal.local_os_user_anchor?.active_anchors_per_data_root !== 1
      || !includesAll(principal.principal?.fields, ['local_os_user_anchor', 'local_app_principal_id', 'app_id', 'development_authorization_id', 'canonical_project_file_id', 'state'])
      || !principal.principal?.invariants?.includes('local_app_principal_id_is_random_non_reused_and_opaque')
      || !principal.principal?.invariants?.includes('development_principal_has_only_development_authorization_id_and_canonical_project_file_id')
      || principal.store_separation?.app_id_positive_key !== 'forbidden'
      || principal.invalidation?.run_once_terminal_tombstones_principal_and_removes_record !== true
      || principal.invalidation?.subsequent_run_once_reuses_principal !== false
      || !exactArray(principal.principal_lineage_binding?.development, ['development_authorization_id', 'canonical_project_file_id', 'app_id'])
      || principal.principal_lineage_binding?.exactly_one_branch_required !== true
    ) {
      issues.push(issue('LOCAL_DEVELOPMENT_PRINCIPAL_SCHEMA_INVALID', authorityPaths.principalSchema, 'Development principals must be SID-partitioned, random/non-reused, project-authorized, app-id-non-authorizing, and terminally tombstoned for run-once.'));
    }
  }

  const grant = parsed.grantSchema;
  if (grant) {
    if (
      grant.grant?.owner !== 'runtime_k_grant'
      || !exactArray(grant.grant?.key, ['local_os_user_anchor', 'account_id', 'local_app_principal_id', 'capability_resource_fingerprint'])
      || !grant.grant?.invariants?.includes('install_project_authorization_or_promotion_creates_zero_grant')
      || !grant.grant?.invariants?.includes('account_switch_never_transfers_grant')
      || !grant.grant?.invariants?.includes('next_protected_operation_reads_current_grant')
      || grant.store_separation?.launch_session_store_dependency !== 'none'
      || !includesAll(grant.forbidden_outputs, ['bearer', 'token', 'portable_grant_credential', 'session_proof'])
    ) {
      issues.push(issue('LOCAL_DEVELOPMENT_GRANT_SCHEMA_INVALID', authorityPaths.grantSchema, 'Grant state must be separately keyed by SID/account/principal/resource, start at zero, deny transfer, and expose no portable material.'));
    }
  }

  const presence = parsed.presenceProtocol;
  if (presence) {
    if (
      presence.challenge?.owner !== 'runtime_account_service'
      || !sameSet(presence.challenge?.required_bindings, ['protected_control_session', 'local_os_user_anchor', 'account_id', 'account_generation', 'local_app_principal_id', 'local_app_record_id', 'provenance_revision', 'release_or_project_generation', 'action', 'resource_impact_digest', 'policy_revision', 'nonce', 'issued_at', 'expires_at'])
      || presence.challenge?.request_supplied_authority !== 'forbidden'
      || presence.challenge?.consume !== 'atomic_with_state_change'
      || presence.challenge?.replay !== 'denied'
      || presence.assignments?.developer_project_trust !== 'grant_presence'
      || presence.assignments?.remembered_project_reactivation !== 'grant_presence'
    ) {
      issues.push(issue('LOCAL_DEVELOPMENT_PRESENCE_PROTOCOL_INVALID', authorityPaths.presenceProtocol, 'Project approval and remembered reactivation require an exact Runtime-owned, atomic, non-replayable presence challenge.'));
    }
  }

  const transport = parsed.transportMatrix;
  if (transport) {
    const methods = methodMap(transport);
    const localWire = transport.open_local_app_session_wire;
    if (
      !exactArray(localWire?.request?.fields, [])
      || !exactArray(localWire?.request?.request_metadata_authority_inputs, [])
      || localWire?.request?.unknown_field_disposition !== 'reject'
      || localWire?.connection_binding !== 'exact_bound_local_app_process_and_current_launch_lease'
      || localWire?.atomic_transition !== 'launch_lease_consume_and_private_local_app_session_insert'
      || localWire?.ordinary_grpc_disposition !== 'deny'
      || !includesAll(localWire?.response?.forbidden_fields, ['local_app_principal_id', 'local_record_id', 'grant_id', 'session_id', 'session_proof', 'launch_lease', 'process_proof', 'endpoint', 'token', 'credential'])
    ) {
      issues.push(issue('LOCAL_DEVELOPMENT_OPEN_SESSION_WIRE_INVALID', authorityPaths.transportMatrix, 'OpenLocalAppSession must be request-empty, exact-process/lease-bound, atomic, non-gRPC, and non-portable.'));
    }

    const open = methods.get('/nimi.runtime.v1.RuntimeAuthService/OpenLocalAppSession');
    if (!hasExactTransportRow(open, 'local_app_session_bootstrap', 'local_app_bootstrap', 'local_app_process')) {
      issues.push(issue('LOCAL_DEVELOPMENT_BOOTSTRAP_TRANSPORT_INVALID', authorityPaths.transportMatrix, 'OpenLocalAppSession requires the local-app bootstrap transport and exact bound process role.'));
    }
    const prepare = methods.get('/nimi.runtime.v1.RuntimeAppService/PrepareLocalAppLaunch');
    const bind = methods.get('/nimi.runtime.v1.RuntimeAppService/BindLocalAppProcess');
    if (
      !hasExactTransportRow(prepare, 'local_app_launch_preparation', 'desktop_control', 'local_app_control')
      || !hasExactTransportRow(bind, 'local_app_process_binding', 'desktop_control', 'local_app_control')
    ) {
      issues.push(issue('LOCAL_DEVELOPMENT_LAUNCH_TRANSPORT_INVALID', authorityPaths.transportMatrix, 'Only Desktop local_app_control may prepare a launch and bind the retained native process witness.'));
    }

    for (const name of developerMethods) {
      const row = methods.get(`/nimi.runtime.v1.RuntimeDevelopmentService/${name}`);
      const operationClass = name === 'EndLocalDevelopmentRun' ? 'local_development_run_end' : 'local_development_control';
      if (!hasExactTransportRow(row, operationClass, 'desktop_control', 'local_app_control')) {
        issues.push(issue('LOCAL_DEVELOPMENT_CONTROL_TRANSPORT_INVALID', `${authorityPaths.transportMatrix}#${name}`, 'Developer Mode/project controls must be non-portable Desktop local_app_control operations.'));
      }
    }

    for (const methodId of selectedOperationMethods) {
      if (!hasExactTransportRow(methods.get(methodId), methodId.includes('ReadArtifactBytes') ? 'local_app_artifact_read' : 'local_app_agent_conversation', 'local_app_host', 'local_app_session')) {
        issues.push(issue('LOCAL_DEVELOPMENT_SELECTED_OPERATION_INVALID', `${authorityPaths.transportMatrix}#${methodId}`, 'Selected checkpoint operations must require the exact local-app host/session carrier.'));
      }
    }
    if (
      transport.platform_admission?.windows !== 'admitted_fixed_service_and_process_verification'
      || !sameSet(transport.platform_admission?.forbidden_fallbacks, ['localhost_grpc', 'same_user_daemon', 'direct_tauri_dev', 'manual_electron', 'argv', 'env', 'temp_file', 'renderer_ipc', 'portable_bearer', 'raw_executable_self_auth'])
      || !exactArray(transport.trust_classes?.admitted_positive, ['local_development'])
      || transport.blocked_or_unadmitted?.missing_explicit_method_row !== 'fail_generation'
      || transport.blocked_or_unadmitted?.generic_proxy !== 'forbidden'
    ) {
      issues.push(issue('LOCAL_DEVELOPMENT_TRANSPORT_BOUNDARY_INVALID', authorityPaths.transportMatrix, 'Only local_development is positive on the fixed Windows service; all self-asserted/fallback carriers and generic proxies remain denied.'));
    }
  }

  const rpcAuth = parsed.rpcAuth;
  if (rpcAuth) {
    const methods = methodMap(rpcAuth);
    for (const name of developerMethods) {
      if (!hasExactProtectedRow(methods.get(`/nimi.runtime.v1.RuntimeDevelopmentService/${name}`), 'desktop_control', 'local_app_control')) {
        issues.push(issue('LOCAL_DEVELOPMENT_RPC_AUTH_INVALID', `${authorityPaths.rpcAuth}#${name}`, 'Runtime auth posture must independently require Desktop local_app_control for every development method.'));
      }
    }
    if (
      !hasExactProtectedRow(methods.get('/nimi.runtime.v1.RuntimeAppService/PrepareLocalAppLaunch'), 'desktop_control', 'local_app_control')
      || !hasExactProtectedRow(methods.get('/nimi.runtime.v1.RuntimeAppService/BindLocalAppProcess'), 'desktop_control', 'local_app_control')
      || !hasExactProtectedRow(methods.get('/nimi.runtime.v1.RuntimeAuthService/OpenLocalAppSession'), 'local_app_bootstrap', 'local_app_process')
    ) {
      issues.push(issue('LOCAL_DEVELOPMENT_RPC_LAUNCH_AUTH_INVALID', authorityPaths.rpcAuth, 'Runtime auth posture must match the Desktop prepare/bind and bound-process request-empty bootstrap roles.'));
    }
  }

  const controls = parsed.desktopControls;
  if (controls) {
    const actions = new Map((controls.actions ?? []).map((row) => [row.action, row]));
    const prepare = actions.get('prepare_local_app_launch');
    const bind = actions.get('bind_local_app_process');
    const decide = actions.get('decide_local_development_project');
    const reactivate = actions.get('reactivate_local_development_project');
    if (
      controls.logical_role?.id !== 'local_app_control'
      || controls.logical_role?.current_implementation !== 'protected_desktop_process'
      || controls.logical_role?.portable_credential !== 'forbidden'
      || prepare?.renderer_access !== 'forbidden'
      || prepare?.native_host_only !== true
      || bind?.renderer_access !== 'forbidden'
      || bind?.native_host_only !== true
      || !sameSet(decide?.native_host_attaches, ['current_presence_proof', 'authoritative_risk_disclosure_revision'])
      || !sameSet(reactivate?.native_host_attaches, ['current_presence_proof', 'authoritative_risk_disclosure_revision'])
      || !controls.constraints?.includes('developer_mode_grants_nothing')
      || !controls.constraints?.includes('mode_off_revoke_account_switch_and_runtime_restart_invalidate_live_carrier')
      || !controls.constraints?.includes('native_windows_execution_risk_disclosure_is_required')
      || !controls.constraints?.includes('no_persistent_local_development_autostart')
      || !controls.constraints?.includes('no_endpoint_token_bearer_session_proof_process_tuple_or_trust_override_in_renderer')
    ) {
      issues.push(issue('LOCAL_DEVELOPMENT_DESKTOP_CONTROL_INVALID', authorityPaths.desktopControls, 'Desktop must split renderer-safe decisions from native-only prepare/bind/presence while exposing no portable authority.'));
    }
  }

  return issues;
}

export function formatAuthorityIssues(issues) {
  return issues.map((entry) => `${entry.code}: ${entry.target}: ${entry.reason}`).join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const issues = validateLocalDevelopmentAuthority(loadAuthorityBundle());
  if (issues.length > 0) {
    process.stderr.write(`${formatAuthorityIssues(issues)}\n`);
    process.exit(1);
  }
  process.stdout.write('local-development admission authority gate passed\n');
}
