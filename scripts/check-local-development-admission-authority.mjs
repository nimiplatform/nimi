#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

export const authorityPaths = Object.freeze({
  policy: 'config/platform-nimi-app-local-development-admission.yaml',
  platform: '.nimi/spec/platform/app-ecosystem.authority.yaml',
  runtimeSession: '.nimi/spec/runtime/protected-session.authority.yaml',
  account: '.nimi/spec/runtime/protected-session.authority.yaml',
  grant: '.nimi/spec/runtime/security-core.authority.yaml',
  desktop: '.nimi/spec/desktop/bridge-ipc.authority.yaml',
  kit: '.nimi/spec/platform/ui-design-system.authority.yaml',
  sdk: '.nimi/spec/sdks/client-core.authority.yaml',
  principalSchema: 'config/spec-frozen/runtime/tables/local-app-principal-record-schema.yaml',
  grantSchema: 'config/spec-frozen/runtime/tables/local-app-grant-binding-schema.yaml',
  presenceProtocol: 'config/spec-frozen/runtime/tables/local-app-presence-protocol.yaml',
  transportMatrix: 'config/spec-frozen/runtime/tables/protected-local-rpc-transport-matrix.yaml',
  rpcAuth: 'config/spec-frozen/runtime/tables/runtime-rpc-auth-posture/identity-access.yaml',
  desktopControls: 'config/desktop-local-app-control-surfaces.yaml',
});

const yamlKeys = new Set([
  'policy',
  'desktop',
  'grant',
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
  'manifest_permission_requirement_fingerprint',
  'account_id',
  'fixed_shell_entry_policy',
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
  'opaque_app_data_partition',
  'runtime_boot_epoch',
]);

const continuityWithoutReapproval = Object.freeze([
  'renderer_hmr_or_reload',
  'electron_main_or_preload_controlled_rebuild_and_restart',
  'tauri_host_controlled_rebuild_and_restart',
  'controlled_host_replacement_same_authorization',
  'runtime_restart_during_live_supervisor_run',
  'supervisor_run_replacement',
  'desktop_restart',
  'runtime_restart_upgrade_or_reinstall',
  'developer_mode_reenable',
  'original_account_return',
]);

const continuityInvalidators = Object.freeze([
  'permission_requirement_change',
  'declared_app_id_change',
  'canonical_project_file_identity_change',
  'copied_project',
  'shell_or_entry_policy_change',
  'account_id_change',
  'native_execution_risk_or_disclosure_revision_change',
  'authorization_revoke',
  'authority_integrity_or_provenance_failure',
  'host_outside_verified_supervisor',
  'executable_or_renderer_origin_outside_controlled_outputs',
  'remote_or_uncontrolled_dev_server',
]);

const runOnceEnds = Object.freeze([
  'supervisor_run_termination',
  'mode_off',
  'logout_or_account_switch',
  'revoke',
  'identity_permission_requirement_or_shell_mismatch',
]);

const developerMethods = Object.freeze([
  'GetDeveloperModeStatus',
  'SetDeveloperMode',
  'EvaluateLocalDevelopmentProject',
  'DecideLocalDevelopmentProject',
  'ListLocalDevelopmentAuthorizations',
  'RevokeLocalDevelopmentAuthorization',
  'EndLocalDevelopmentRun',
  'GetLocalDevelopmentAuthoritySummary',
]);

const localAppHostMethods = Object.freeze([
  ['/nimi.runtime.v1.RuntimeAccountService/GetLocalAppPermissionStatus', 'local_app_public_permission_projection'],
  ['/nimi.runtime.v1.RuntimeAccountService/RequestLocalAppPermission', 'local_app_public_permission_request'],
  ['/nimi.runtime.v1.RuntimeAppService/ReadLocalAppStorageJson', 'local_app_json_storage'],
  ['/nimi.runtime.v1.RuntimeAppService/WriteLocalAppStorageJson', 'local_app_json_storage'],
  ['/nimi.runtime.v1.RuntimeAppService/RemoveLocalAppStorageJson', 'local_app_json_storage'],
]);

const localAppTechnicalMethods = Object.freeze([
  ['/nimi.runtime.v1.RuntimeAuthService/RenewLocalAppSession', 'local_app_session_renewal'],
]);

const protectedMethodsExcludedFromLocalApp = Object.freeze([
  '/nimi.runtime.v1.RuntimeArtifactService/ReadArtifactBytes',
  '/nimi.runtime.v1.RuntimeAgentService/ListLocalAppAgentInventory',
  '/nimi.runtime.v1.RuntimeAgentService/OpenConversationAnchor',
  '/nimi.runtime.v1.RuntimeAppService/SendAppMessage',
  '/nimi.runtime.v1.RuntimeAppService/SubscribeAppMessages',
  '/nimi.runtime.v1.RuntimeAgentService/GetPublicChatSessionSnapshot',
  '/nimi.runtime.v1.RuntimeAgentService/TranscribeLocalAppAgentAudio',
  '/nimi.runtime.v1.RuntimeAgentService/SubscribeAgentVoiceStream',
]);

const requiredRuleClauses = Object.freeze([
  ['platform', ['rule.nimi.platform.app-ecosystem.p-napp-035a', /sole mutable third-party provenance class/iu, /global Developer Mode grants nothing/iu, /run_once or allow_project consent/iu]],
  ['platform', ['rule.nimi.platform.app-ecosystem.p-napp-035b', /manifest permissions contain only admitted public id and reason requirements/iu, /request eligibility only/iu, /current empty admitted set/iu]],
  ['platform', ['rule.nimi.platform.app-ecosystem.p-napp-035c', /Every build or host replacement receives a new lease, process binding, and local-app session/iu, /Runtime boot epoch and supervisor-run identity remain session inputs rather than durable consent inputs/iu]],
  ['platform', ['rule.nimi.platform.app-ecosystem.p-napp-035f', /receives no token, bearer/iu, /persistent managed logon, or boot autostart/iu, /ordinary OS rights of native code/iu]],
  ['runtimeSession', ['rule.nimi.runtime.protected-session.r022', /durable user development authorization/iu, /run_once/iu, /allow_project preserves the principal and record authorization posture across supervisor, Desktop, and Runtime replacement/iu, /never autostarts/iu]],
  ['runtimeSession', ['rule.nimi.runtime.protected-session.r024', /actual host PID and creation marker/iu, /short-lived technical session binding/iu, /atomically creating common local_app_session state/iu]],
  ['runtimeSession', ['rule.nimi.runtime.protected-session.r025', /never returned through renderer IPC, CLI output/iu, /request-empty RenewLocalAppSession/iu]],
  ['account', ['rule.nimi.runtime.protected-session.r110', /exact principal, local record, process-bound session/iu, /current owner lifecycle/iu, /operation owner's exact resource policy/iu, /creates no synthetic permission/iu]],
  ['grant', ['rule.nimi.runtime.security-core.r045', /admitted third-party public-permission set is empty/iu, /no positive local permission mutation path/iu]],
  ['grant', ['rule.nimi.runtime.security-core.r046', /owner_selector_digest/iu]],
  ['grant', ['rule.nimi.runtime.security-core.r047', /every protected endpoint/iu]],
  ['desktop', ['rule.nimi.desktop.bridge-ipc.r091', /production account.*defaults off.*grants nothing/isu, /exactly one Dev Trust Set/iu, /allow_project consent across supervisor, Desktop, and Runtime replacement/isu]],
  ['desktop', ['rule.nimi.desktop.bridge-ipc.r097', /fresh host and payload digest observation.*launch lease.*verified process bind.*local-app session/isu, /native Windows execution risk disclosure/iu, /never creates persistent local-development autostart/iu]],
  ['desktop', ['rule.nimi.desktop.bridge-ipc.r098', /local_app_control exists outside the verified Desktop control connection/iu, /principal, record, permission, lease, session, account, or operation-policy truth/iu]],
  ['desktop', ['rule.nimi.desktop.bridge-ipc.r099', /PrepareLocalAppLaunch.*process binding.*Desktop native supervisor/isu, /renderer state, storage, network, logs, and errors/iu]],
  ['kit', ['rule.nimi.platform.ui-design-system.p-kit-046', /common verified carrier/iu, /controlled replacement or restart/iu, /session posture, permission posture or request, and app-private JSON storage/iu, /ordinary-RPC fallback/iu]],
  ['sdk', ['rule.nimi.sdks.client-core.r041', /host-injected by Kit and never renderer-constructed/iu, /request-empty OpenLocalAppSession/iu, /controlled host or Runtime restart/iu, /public permission posture and request plus app-private JSON read, write, and remove/iu, /Artifact, Agent, conversation, voice/iu, /missing operation families remain typed unavailable/iu, /localhost gRPC cannot claim/iu]],
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
  if (ruleId.startsWith('rule.')) {
    try {
      const authority = YAML.parse(source);
      const unit = authority?.units?.find((entry) => entry?.id === ruleId);
      return unit ? YAML.stringify(unit, { lineWidth: 0 }) : '';
    } catch {
      return '';
    }
  }
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
      policy.version !== 8
      || policy.table_family !== 'owner_matrix'
      || policy.owner !== 'platform'
      || policy.matrix_id !== 'nimi_app_local_development_admission'
    ) {
      issues.push(issue('LOCAL_DEVELOPMENT_POLICY_IDENTITY_INVALID', authorityPaths.policy, 'Policy must be the Platform-owned v8 local-development owner matrix.'));
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
      || mode?.disable_effect?.allow_project_authorizations !== 'preserve_without_autostart'
      || mode?.disable_effect?.immutable_records !== 'unaffected'
    ) {
      issues.push(issue('LOCAL_DEVELOPMENT_DEVELOPER_MODE_INVALID', authorityPaths.policy, 'Production Developer Mode must default off, grant nothing, reject hidden enablement, and apply the exact mode-off invalidations.'));
    }

    const authorization = policy.user_development_authorization;
    if (
      authorization?.owner !== 'runtime_k_app'
      || !exactArray(authorization?.bindings, authorizationBindings)
      || !exactArray(authorization?.choices, ['run_once', 'allow_project'])
      || authorization?.initial_permission_decision_state !== 'none'
      || authorization?.allow_project_reuse_requires_fresh_presence !== false
      || authorization?.account_switch_transfers_authorization !== false
      || authorization?.permission_requirements_may_be_empty !== true
      || authorization?.app_owned_native_host_storage !== 'allowed'
      || authorization?.nimi_permission_required_for_app_owned_native_host_storage !== false
      || authorization?.renderer_direct_native_filesystem_access !== 'forbidden'
      || authorization?.renderer_storage_or_account_partition_projection !== 'forbidden'
      || authorization?.app_owned_host_commands !== 'exact_app_registered_typed_allowlist'
      || authorization?.app_owned_host_commands_create_nimi_grant !== false
      || authorization?.consent_storage?.owner !== 'runtime_protected_service_authority'
      || authorization?.consent_storage?.root_lifetime !== 'stable_across_runtime_candidate_and_acceptance_round_replacement'
      || authorization?.consent_storage?.candidate_payload_or_selected_product_data_root !== 'forbidden'
      || authorization?.consent_storage?.app_renderer_environment_or_argv_selection !== 'forbidden'
      || authorization?.consent_storage?.candidate_local_principal_projection_rebuild !== 'allowed_from_exact_consent_only'
    ) {
      issues.push(issue('LOCAL_DEVELOPMENT_USER_AUTHORIZATION_INVALID', authorityPaths.policy, 'Project authorization must use the exact principal/project/account/shell bindings, no permission decision, app-owned host authority, and run-once/durable-project lifetimes.'));
    }

    const permissionRequirements = policy.permission_requirements;
    if (
      permissionRequirements?.manifest_field !== 'permissions'
      || permissionRequirements?.owner !== 'platform_permission_catalog'
      || !exactArray(permissionRequirements?.current_admitted_permission_ids, [])
      || !exactArray(permissionRequirements?.item_shape?.required_fields, ['id', 'reason'])
      || !exactArray(permissionRequirements?.item_shape?.optional_fields, [])
      || permissionRequirements?.item_shape?.duplicate_id !== 'forbidden'
      || permissionRequirements?.item_shape?.unknown_or_reserved_id !== 'forbidden'
      || permissionRequirements?.permission_requirement_fingerprint_inclusion !== 'canonical_sorted_id_and_reason_set'
      || permissionRequirements?.empty_list_valid !== true
      || permissionRequirements?.request_eligibility_only !== true
      || permissionRequirements?.creates_operation_grant !== false
      || permissionRequirements?.creates_scoped_binding !== false
      || permissionRequirements?.owner_selector_and_permission_decision_still_required !== true
      || permissionRequirements?.app_owned_authority_or_base_entitlement_inclusion !== 'forbidden'
      || permissionRequirements?.app_renderer_or_manifest_positive_authority !== 'forbidden'
    ) {
      issues.push(issue('LOCAL_DEVELOPMENT_PERMISSION_REQUIREMENTS_INVALID', authorityPaths.policy, 'Manifest permission requirements must use the empty admitted public set and grant no operation, selector, or permission authority.'));
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

    const userDataPartition = policy.electron_user_data_partition;
    if (
      userDataPartition?.owner !== 'desktop_supervisor'
      || userDataPartition?.data_class !== 'app_owned_authority'
      || userDataPartition?.nimi_permission_or_grant !== 'forbidden'
      || userDataPartition?.platform_roots?.windows !== 'active_user_home_app_data_local_nimi_local_app_hosts_v1'
      || userDataPartition?.platform_roots?.macos !== 'active_user_library_application_support_nimi_local_app_hosts_v1'
      || userDataPartition?.leaf !== 'domain_separated_sha256_of_runtime_authorization_id'
      || userDataPartition?.raw_authorization_account_project_app_epoch_or_session_material_in_path_or_argv !== 'forbidden'
      || !exactArray(userDataPartition?.platform_required_checks?.windows, ['canonical_ancestors', 'no_reparse_point_or_symlink', 'directory'])
      || !exactArray(userDataPartition?.platform_required_checks?.macos, ['canonical_ancestors', 'no_symlink', 'active_user_owner', 'directory', 'no_group_or_world_access', 'mode_0700'])
      || userDataPartition?.same_authorization_controlled_restart !== 'reuse'
      || userDataPartition?.new_authorization_reapproval_account_change_or_project_identity_change !== 'new_partition'
      || userDataPartition?.acceptance_cdp_override !== 'isolated_temporary_root_non_authorizing'
    ) {
      issues.push(issue('LOCAL_DEVELOPMENT_USER_DATA_PARTITION_INVALID', authorityPaths.policy, 'Electron app-owned data must use an opaque per-authorization Windows/macOS partition without creating a Nimi permission.'));
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
      || lifetimes?.allow_project_on_mode_off !== 'durable_consent_preserved_live_authority_revoked'
      || lifetimes?.allow_project_on_supervisor_run_termination !== 'durable_consent_preserved_live_authority_revoked'
      || lifetimes?.allow_project_on_runtime_boot_epoch_change !== 'durable_consent_preserved_live_authority_revoked'
      || lifetimes?.allow_project_auto_runs_after_reenable !== false
      || lifetimes?.allow_project_account_switch !== 'live_authority_revoked_consent_remains_bound_to_original_account_and_reuses_without_presence_after_return'
    ) {
      issues.push(issue('LOCAL_DEVELOPMENT_LIFETIME_INVALID', authorityPaths.policy, 'Run-once must terminate/tombstone while allow-project consent remains exact, account-bound, reusable without presence, and never auto-runs.'));
    }

    const risk = policy.risk_and_background;
    if (
      risk?.production_account_allowed_through_runtime_mediation !== true
      || risk?.runtime_credential_custody_required !== true
      || risk?.native_os_risk_disclosure_required !== true
      || risk?.nimi_permissions_cover_all_windows_rights !== false
      || risk?.nimi_managed_logon_or_boot_autostart !== 'forbidden'
    ) {
      issues.push(issue('LOCAL_DEVELOPMENT_RISK_POSTURE_INVALID', authorityPaths.policy, 'Production-account mediation requires Runtime custody, native Windows risk disclosure, and no Nimi-managed persistent autostart.'));
    }

    const operation = policy.operation_posture;
    if (
      operation?.same_permission_and_owner_policy_as_other_trust_classes !== true
      || !exactArray(operation?.selected_checkpoint_families, [])
      || !exactArray(operation?.blocked_until_atomic_public_permission_or_attested_first_party_carrier, ['runtime_artifact_read', 'runtime_agent_conversation', 'runtime_agent_selected_voice'])
      || operation?.app_private_base_entitlement_requires_grant !== false
      || operation?.app_private_base_entitlement_requires_live_principal_session_account_binding !== true
      || operation?.app_owned_host_operations_are_nimi_operations !== false
      || operation?.missing_families !== 'typed_owner_unavailable'
      || operation?.generic_protected_proxy !== 'forbidden'
    ) {
      issues.push(issue('LOCAL_DEVELOPMENT_OPERATION_POSTURE_INVALID', authorityPaths.policy, 'App-private and app-owned operations remain non-permission authority; protected artifact and Runtime Agent families stay unavailable pending atomic permission or attested first-party carrier admission.'));
    }

    const macosDevelopment = policy.platform_posture?.macos?.non_product_local_development;
    if (
      policy.platform_posture?.windows !== 'final_fixed_service_positive_required'
      || policy.platform_posture?.macos?.aggregate !== 'requirements_complete_fail_closed_pending_signed_native_and_live_admission'
      || policy.platform_posture?.macos?.electron !== 'fail_closed_pending_Developer_ID_hardened_notarized_Desktop_Runtime_and_independent_local_app_host_plus_real_DOM_CDP_process_acceptance'
      || policy.platform_posture?.macos?.tauri !== 'fail_closed_pending_independent_Rust_WKWebView_command_install_update_and_live_acceptance'
      || macosDevelopment?.profile_id !== 'macos_local_development_v1'
      || macosDevelopment?.admission !== 'local_development_non_product_admitted'
      || macosDevelopment?.product_admission_promotion !== 'forbidden'
      || !String(macosDevelopment?.electron ?? '').includes('local_CA_signed_hardened_Runtime_Desktop_independent_local_app_host')
      || macosDevelopment?.tauri !== 'fail_closed_pending_independent_Rust_WKWebView_command_install_update_and_live_acceptance'
      || macosDevelopment?.service_lifecycle !== 'root_owned_launchd_system_job_ai.nimi.runtime.dev_with_dedicated__nimiruntimedev_principal'
      || !String(macosDevelopment?.transport ?? '').includes('mutual_audit_token_dynamic_SecCode_exact_local_CA_leaf_SPKI_vnode_and_liveness_verification')
      || macosDevelopment?.custody !== 'Runtime_only_System_Keychain_namespace_ai.nimi.runtime.protected-local.dev.v1'
      || !String(macosDevelopment?.signing ?? '').includes('Team_ID_absent_no_notarization_or_Gatekeeper_claim')
      || macosDevelopment?.realm !== 'compile_time_fixed_local_Realm_broker_http_127.0.0.1_3002_production_endpoints_forbidden'
      || macosDevelopment?.app_owned_sqlite_requires_nimi_permission !== false
      || policy.platform_posture?.linux !== 'fail_closed_pending_independent_admission'
      || policy.platform_posture?.localhost_grpc_or_same_user_daemon_fallback !== 'forbidden'
    ) {
      issues.push(issue('LOCAL_DEVELOPMENT_PLATFORM_POSTURE_INVALID', authorityPaths.policy, 'Production macOS/Linux and all fallback carriers remain fail closed; only the isolated non-product macOS Electron profile may be positive and it cannot enable Tauri or Nimi permissions for app-owned SQLite.'));
    }
  }

  const principal = parsed.principalSchema;
  if (principal) {
    if (
      principal.local_os_user_anchor?.platform_sources?.windows !== 'verified_interactive_user_sid'
      || principal.local_os_user_anchor?.platform_sources?.linux !== 'verified_peer_uid_and_login_session'
      || principal.local_os_user_anchor?.platform_sources?.macos !== 'verified_peer_euid_and_audit_session'
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
      grant.current_admission?.store_identity !== 'absent_pre_admission'
      || grant.current_admission?.positive_mutation_path !== 'absent'
      || !exactArray(grant.future_owner_lifecycle?.key, ['local_os_user_anchor', 'account_id', 'local_app_principal_id', 'permission_id', 'owner_selector_digest'])
      || !grant.future_owner_lifecycle?.invariants?.includes('account_switch_never_transfers_permission')
      || !grant.future_owner_lifecycle?.invariants?.includes('every_protected_operation_reads_current_owner_decision')
      || grant.authority_classes?.base_entitlement?.permission_record !== 'forbidden'
      || grant.authority_classes?.app_owned_authority?.permission_record !== 'forbidden'
      || !includesAll(grant.forbidden_public_fields, ['capability_scope', 'resource_scope', 'bearer', 'token', 'session_proof'])
    ) {
      issues.push(issue('LOCAL_DEVELOPMENT_PERMISSION_SCHEMA_INVALID', authorityPaths.grantSchema, 'Pre-admission permission persistence must be absent; any future lifecycle must bind public permission plus owner selector and never absorb base/app-owned authority.'));
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
      || presence.assignments?.developer_project_first_authorization !== 'user_decision_presence'
      || presence.assignments?.development_capability_expansion !== 'user_decision_presence'
      || presence.assignments?.development_account_shell_entry_or_risk_change !== 'user_decision_presence'
      || presence.assignments?.exact_allow_project_reuse !== 'none'
      || presence.assignments?.base_entitlement_operation !== 'none'
      || presence.assignments?.ordinary_admitted_user_permission_operation !== 'none'
    ) {
      issues.push(issue('LOCAL_DEVELOPMENT_PRESENCE_PROTOCOL_INVALID', authorityPaths.presenceProtocol, 'First approval and authority-bearing expansion require exact Runtime-owned atomic presence; exact allow-project reuse requires none.'));
    }
  }

  const transport = parsed.transportMatrix;
  if (transport) {
    const methods = methodMap(transport);
    const localWire = transport.open_local_app_session_wire;
    const renewWire = transport.renew_local_app_session_wire;
    if (
      !exactArray(localWire?.request?.fields, [])
      || !exactArray(localWire?.request?.request_metadata_authority_inputs, [])
      || localWire?.request?.unknown_field_disposition !== 'reject'
      || localWire?.connection_binding !== 'exact_bound_local_app_process_and_current_launch_lease'
      || localWire?.atomic_transition !== 'launch_lease_consume_and_private_local_app_session_insert'
      || localWire?.ordinary_grpc_disposition !== 'deny'
      || !includesAll(localWire?.response?.forbidden_fields, ['local_app_principal_id', 'local_record_id', 'permission_id', 'permission_state', 'permission_decision_id', 'session_id', 'session_proof', 'launch_lease', 'process_proof', 'endpoint', 'token', 'credential'])
    ) {
      issues.push(issue('LOCAL_DEVELOPMENT_OPEN_SESSION_WIRE_INVALID', authorityPaths.transportMatrix, 'OpenLocalAppSession must be request-empty, exact-process/lease-bound, atomic, non-gRPC, and non-portable.'));
    }

    const open = methods.get('/nimi.runtime.v1.RuntimeAuthService/OpenLocalAppSession');
    if (!hasExactTransportRow(open, 'local_app_session_bootstrap', 'local_app_bootstrap', 'local_app_process')) {
      issues.push(issue('LOCAL_DEVELOPMENT_BOOTSTRAP_TRANSPORT_INVALID', authorityPaths.transportMatrix, 'OpenLocalAppSession requires the local-app bootstrap transport and exact bound process role.'));
    }
    const renew = methods.get('/nimi.runtime.v1.RuntimeAuthService/RenewLocalAppSession');
    if (
      !exactArray(renewWire?.request?.fields, [])
      || !exactArray(renewWire?.request?.request_metadata_authority_inputs, [])
      || renewWire?.request?.unknown_field_disposition !== 'reject'
      || renewWire?.connection_binding !== 'exact_current_local_app_host_connection_and_private_session'
      || renewWire?.atomic_transition !== 'revoke_previous_private_session_and_insert_replacement_on_same_connection'
      || renewWire?.renderer_projection !== 'forbidden'
      || renewWire?.app_projection !== 'forbidden'
      || renewWire?.ordinary_grpc_disposition !== 'deny'
      || !includesAll(renewWire?.response?.forbidden_fields, ['local_app_principal_id', 'local_record_id', 'permission_id', 'permission_state', 'permission_decision_id', 'session_id', 'session_proof', 'launch_lease', 'process_proof', 'endpoint', 'token', 'credential'])
      || !hasExactTransportRow(renew, 'local_app_session_renewal', 'local_app_host', 'local_app_session')
    ) {
      issues.push(issue('LOCAL_DEVELOPMENT_RENEW_SESSION_WIRE_INVALID', authorityPaths.transportMatrix, 'RenewLocalAppSession must be request-empty, exact-current-host/session-bound, atomic, renderer-inaccessible, and non-portable.'));
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
      const operationClass = name === 'EndLocalDevelopmentRun'
        ? 'local_development_run_end'
        : name === 'GetLocalDevelopmentAuthoritySummary'
          ? 'local_development_bounded_diagnostic_projection'
          : 'local_development_control';
      if (!hasExactTransportRow(row, operationClass, 'desktop_control', 'local_app_control')) {
        issues.push(issue('LOCAL_DEVELOPMENT_CONTROL_TRANSPORT_INVALID', `${authorityPaths.transportMatrix}#${name}`, 'Developer Mode/project controls must be non-portable Desktop local_app_control operations.'));
      }
    }

    for (const [methodId, operationClass] of localAppHostMethods) {
      const row = methods.get(methodId);
      if (!hasExactTransportRow(row, operationClass, 'local_app_host', 'local_app_session') || row?.generic_proxy !== 'forbidden') {
        issues.push(issue('LOCAL_DEVELOPMENT_BASE_SURFACE_INVALID', `${authorityPaths.transportMatrix}#${methodId}`, 'The local-app host carrier must expose exactly public permission posture/request and app-private JSON storage.'));
      }
    }
    for (const [methodId, operationClass] of localAppTechnicalMethods) {
      const row = methods.get(methodId);
      if (!hasExactTransportRow(row, operationClass, 'local_app_host', 'local_app_session') || row?.generic_proxy !== 'forbidden') {
        issues.push(issue('LOCAL_DEVELOPMENT_TECHNICAL_SURFACE_INVALID', `${authorityPaths.transportMatrix}#${methodId}`, 'The local-app host technical surface may only renew the exact current private session.'));
      }
    }
    const actualLocalAppHostMethods = (transport.methods ?? [])
      .filter((row) => row.allowed_transport_classes?.includes('local_app_host'))
      .map((row) => row.method_id);
    const expectedLocalAppHostMethods = [...localAppTechnicalMethods, ...localAppHostMethods].map(([methodId]) => methodId);
    if (!sameSet(actualLocalAppHostMethods, expectedLocalAppHostMethods)) {
      issues.push(issue('LOCAL_DEVELOPMENT_BASE_SURFACE_INVALID', authorityPaths.transportMatrix, 'The local-app host carrier contains a missing or extra operation outside technical renewal, permission posture/request, and app-private JSON storage.'));
    }
    for (const methodId of protectedMethodsExcludedFromLocalApp) {
      const row = methods.get(methodId);
      if (row?.allowed_transport_classes?.includes('local_app_host') || row?.required_origin_roles?.includes('local_app_session')) {
        issues.push(issue('LOCAL_DEVELOPMENT_PROTECTED_OPERATION_EXPOSED', `${authorityPaths.transportMatrix}#${methodId}`, 'Artifact, Agent, conversation and voice operations require a future atomic public-permission or first-party carrier admission.'));
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
      || !hasExactProtectedRow(methods.get('/nimi.runtime.v1.RuntimeAuthService/RenewLocalAppSession'), 'local_app_host', 'local_app_session')
    ) {
      issues.push(issue('LOCAL_DEVELOPMENT_RPC_LAUNCH_AUTH_INVALID', authorityPaths.rpcAuth, 'Runtime auth posture must match Desktop prepare/bind, bound-process request-empty bootstrap, and exact-host request-empty renewal roles.'));
    }
  }

  const controls = parsed.desktopControls;
  if (controls) {
    const actions = new Map((controls.actions ?? []).map((row) => [row.action, row]));
    const prepare = actions.get('prepare_local_app_launch');
    const bind = actions.get('bind_local_app_process');
    const decide = actions.get('decide_local_development_project');
    if (
      controls.logical_role?.id !== 'local_app_control'
      || controls.logical_role?.current_implementation !== 'protected_desktop_process'
      || controls.logical_role?.portable_credential !== 'forbidden'
      || prepare?.renderer_access !== 'forbidden'
      || prepare?.native_host_only !== true
      || bind?.renderer_access !== 'forbidden'
      || bind?.native_host_only !== true
      || !sameSet(decide?.native_host_attaches, ['current_presence_proof', 'authoritative_risk_disclosure_revision'])
      || !controls.constraints?.includes('developer_mode_grants_nothing')
      || !controls.constraints?.includes('allow_project_consent_survives_supervisor_desktop_and_runtime_replacement')
      || !controls.constraints?.includes('technical_launch_process_and_session_authority_never_survives_replacement')
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

