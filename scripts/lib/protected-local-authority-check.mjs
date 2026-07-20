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
  custodyProfiles: '.nimi/spec/runtime/kernel/tables/protected-local-custody-profiles.yaml',
  transport: '.nimi/spec/runtime/kernel/tables/protected-local-rpc-transport-matrix.yaml',
  launchSession: '.nimi/spec/runtime/kernel/tables/protected-local-launch-session-profiles.yaml',
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

function exactLegacyDeleteOnlyRepair(repair) {
  if (!repair || typeof repair !== 'object' || Array.isArray(repair)) return false;
  const classes = Array.isArray(repair.admitted_residue_classes) ? repair.admitted_residue_classes : [];
  if (classes.length !== 2) return false;
  const rows = rowsBy(classes, 'residue_class');
  const normal = rows.get('macos_local_development_v4_failed_first_install_exact_principal');
  const legacy = rows.get('macos_local_development_v2_failed_first_install_disabled_user');
  const exactPositive = 'exact_current_name_uid_gid_password_hidden_home_shell_and_distinct_valid_user_group_GeneratedUID_required';
  const exactGroup = 'exact_current_name_gid_GeneratedUID_and_no_explicit_membership_required';
  const exactPOSIX = 'exact_current_name_uid_gid_home_shell_and_nonlogin_projection_required';
  const exactMembership = 'exact_absence_of_service_name_user_GeneratedUID_and_dedicated_group_GeneratedUID_required';
  const exactWriters = 'exact_absence_of_every_dsAttrTypeNative:_writers_prefix_attribute_required';
  const deleteDisposition = 'delete_exact_whole_user_then_exact_group_prove_both_records_and_POSIX_projection_absent_then_current_carrier_creation_requires_fresh_distinct_user_and_group_GeneratedUIDs';
  const otherAuthentication = [
    'dsAttrTypeNative:ShadowHashData',
    'dsAttrTypeStandard:PasswordPlus',
    'dsAttrTypeStandard:AltSecurityIdentities',
    'dsAttrTypeStandard:AuthCredential',
    'dsAttrTypeStandard:AuthMethod',
    'dsAttrTypeStandard:AuthenticationHint',
    'dsAttrTypeStandard:KDCAuthKey',
    'dsAttrTypeStandard:KerberosServices',
    'dsAttrTypeStandard:KerberosRealm',
    'dsAttrTypeNative:KerberosKeys',
    'dsAttrTypeNative:HeimdalSRPKey',
    'dsAttrTypeNative:SecureTokenVerifierHistory',
    'dsAttrTypeNative:AutoGrantSecureToken',
    'dsAttrTypeNative:LinkedIdentity',
  ];
  const exactCommon = (row) => row?.other_authentication_material_posture === 'absent_required'
    && row?.positive_principal_fields === exactPositive
    && row?.dedicated_group_projection === exactGroup
    && row?.posix_projection === exactPOSIX
    && row?.full_local_group_membership_projection === exactMembership
    && row?.delegated_writer_projection === exactWriters
    && row?.repair_disposition === deleteDisposition;
  return normal?.disposition === 'delete_only_exact_current_principal_never_reuse_existing_GeneratedUIDs'
    && normal?.source_principal_carrier_contract_version === 4
    && normal?.source_helper_status === 'installed_signed_helper_reports_principal_carrier_contract_version_4'
    && normal?.authentication_authority_posture === 'absent_required'
    && exactCommon(normal)
    && legacy?.disposition === 'delete_only_never_admit_or_normalize_as_current_principal'
    && legacy?.source_principal_carrier_contract_version === 2
    && legacy?.source_helper_status === 'installed_signed_helper_reports_principal_carrier_contract_version_2'
    && legacy?.authentication_authority?.attribute === 'dsAttrTypeStandard:AuthenticationAuthority'
    && legacy?.authentication_authority?.value_type === 'String'
    && legacy?.authentication_authority?.exact_value_count === 1
    && legacy?.authentication_authority?.exact_value === ';DisabledUser;'
    && equalArray(legacy?.other_authentication_material_attributes, otherAuthentication)
    && exactCommon(legacy)
    && repair.normal_current_profile_disposition === 'carrier_4_requires_AuthenticationAuthority_absent_and_never_accepts_or_normalizes_any_legacy_residue_class'
    && repair.source_helper_identity_stability === 'source_status_is_read_once_only_for_one_complete_unjournaled_principal_baseline_before_initial_journal_creation;_clean_partial_or-conflicting_unjournaled-state_never-invokes-status;_an-active-journal_revalidates_the_exact-final-helper_open-vnode-that-matches-the-transaction-lock-device/inode/size/mtime/ctime/flags/SHA256_CDHash_identifier_empty-Team-ID_exact-certificate-requirement_leaf-and-root-certificate-digests_hardened-runtime_signing-profile-root-and-policy_in-process_without-invoking-status_codesign-or-any-final-helper-command;_the-lock-opened-vnode-and-named-path_are-revalidated-before-terminal-commit;_DELETE/WRITE/EXTEND/LINK/RENAME/REVOKE_or_EV_ERROR/EV_EOF_are-hard-rejected-with-exact-event-flags;_NOTE_ATTRIB_is-not-path-replacement-by-itself_and-is-accepted-only-when_device/inode/mode/uid/gid/nlink/size/mtime/ctime/flags_and-opened-vnode-SHA256_remain-exact_and-the-full-static-code-identity-is-revalidated;_atime-is-observer-mutable-and-never-authority;_the-same-static-identity-is-reverified-before-each-phase_after-final-absence-proof_and-at-the-terminal-commit-boundary'
    && repair.parent_private_custody_proof === 'fixed_non-semantic_staging-vnode_recovery_runs_under_the_locked_in-process_static-helper-authority_before_journal-presence_or-OD-classification_and_does-not-authorize-any-platform-mutation;_exact-clean_no-journal_returns_before_private-custody;_an_active-or-newly-committed_prepared-journal_then_obtains_one_fresh_exact_final-helper_private-custody-receipt_before_the_first_artifact-or-principal-effect_in_each-invocation;_the_receipt_is_invocation-local_and_bound-in-memory_to_the_exact-journal-terminal-proof-binding_helper-SHA256_CDHash_root-key_policy_mutation-lock-vnode_and-parent-PID/start-identity;_a_crash_restart_authority-change_parent-change_or-binding-change_invalidates-it_and_requires-a-new-parent-proof'
    && repair.parent_final_helper_process_tree_policy === 'the_parent_uses_posix_spawn-with-POSIX_SPAWN_SETPGROUP_to-establish-a-new-process-group-atomically-before-any-current-bootstrap-instruction-can-run;_the-bootstrap-requires-getpgrp-equals-getpid_and-never-execs-on-mismatch;_the-parent-deadline_owns-that-PGID_signals-the-entire-group-on-timeout-or-output-overflow_reaps-the-direct-child_drains-both-pipes-to-EOF_and-proves-the-PGID-empty-before-child-reaped-true;_this-contains-descendants-of-the-immutable-legacy-helper_without-trusting-their-implementation'
    && repair.fresh_bootstrap_authority_proof === 'the_fresh_bootstrap_child_uses_only_journal-bound_in-process_Security.framework_open-vnode_public-profile_root-trust_OpenDirectory_and_reentrant-libc_proofs;_it_must_not_unlock_private_custody_or_invoke_source-helper-status_codesign_or_any_final-helper_command'
    && repair.fresh_bootstrap_nested_process_policy === 'after_exact_bootstrap_context_entry_the_fresh_absence_verifier_spawns_zero_descendants;_the_parent_brackets_it_with_bounded_quiescence_proofs_before_launch_and_after_the_parent-bound_receipt_before_any_phase-commit_or-success'
    && repair.custody_proof_invalidation === 'invocation-exit_crash_restart_helper-SHA256_CDHash_root-key_policy_mutation-lock-vnode_or-journal-binding-change_invalidates_the_parent_private-custody-proof;_it_is_never_persisted_in_the_v2_journal_or_returned_to_Node'
    && repair.clean_no_journal_disposition === 'exact_clean_state_without_a_v2_repair-journal_is_not_a_repair-success-and_returns_macos-dev-runtime-repair-not-required_before_cache-reset_principal_or-artifact_mutation;_it_never_invokes_source-helper-status_never_invents_source-carrier-or-install-readiness_and_requires_separate_trust-helper-verification-or-rotation_before-install'
    && repair.invocation_deadline === 'root_repair_helper_owns_one_hard_600-second_deadline;_every_child_has_a_shorter_bounded_timeout_and_must_fit_inside_the_remaining_outer_budget;_direct-child_commands_atomically_reserve_one_launch-slot_before_Process.run_and_bind_the_child_PID_before_input_or-wait;_bootstrap-owned_process-group_commands_use_posix_spawn_with_POSIX_SPAWN_SETPGROUP_and_POSIX_SPAWN_CLOEXEC_DEFAULT_while_the_deadline-lock-is-held_so_a-successful-spawn-and-PID/PGID-binding-are-one-atomic-transition;_an-expired-repair-invocation_fails-before-the-next-spawn;_timeout-or-output-overflow_signals-the-whole-owned-PGID_TERM-then-KILL_reaps-the-direct-child_drains-both-pipes-to-EOF_and-requires-kill-minus-PGID-zero-to-return-ESRCH_before-child_reaped-true;_any-unbound-or-unreaped-state_is-quiescence-unproven_and-forbids-wrapper-cleanup;_the_Node-launcher_never-times-out-sudo_or-cleans-up-before-sudo-has-observed-the-root-helper-exit;_deadline-termination_preserves-the-exact-journal-for-effect-ahead-recovery'
    && repair.failure_evidence === 'one_sanitized_non-authoritative_local_JSON_record_under_.nimi/local/acceptance_is_written_after-the_privileged_helper_has_exited;_it-preserves-every-authority-admitted_non-sensitive_diagnostic-field_plus-bounded-subprocess-status_and-never-persists-stderr_Keychain-material_tokens_or-private-keys;_vnode-diagnostics-preserve-exact-event-flags-and-names_lock-device/inode/SHA256_before/after-ctime_journal-phase/presence_completion/bootstrap-state_and-primary-failure-identity;_missing-structured-JSON_or-missing-explicit-child_reaped-true_preserves-the-exact-bootstrap;_only-explicit-child_reaped-true-permits-exact-bootstrap-cleanup;_one-failure-stops-automatic-retry'
    && repair.post_repair_carrier_disposition === 'repair_preserves_the_source_final_helper;_when_its_source_carrier_is_not_current_carrier_4_Runtime_install_remains_fail-closed_until_a_separately_confirmed_trust-helper_rotation_reprovisions_and_proves_one_current_signed_helper;_delete-only_repair_success_is_not_install-readiness'
    && repair.success_receipt?.schema_version === 'nimi.macos-local-development-partial-install-repair-receipt/v1'
    && equalArray(repair.success_receipt?.required_fields, ['schemaVersion', 'status', 'disposition', 'serviceName', 'removed', 'preserved', 'sourcePrincipalCarrierContractVersion', 'requiredInstallPrincipalCarrierContractVersion', 'sourceHelperDisposition', 'installReadiness', 'trustHelperRotationRequired', 'nextPrivilegedAction'])
    && equalArray(repair.success_receipt?.preserved_fields, ['local_CA', 'signing_Keychain', 'signing_profile', 'final_helper'])
    && repair.success_receipt?.source_helper_disposition === 'preserved'
    && repair.success_receipt?.current_carrier_action === 'none'
    && repair.success_receipt?.stale_carrier_action === 'separately_confirmed_trust_helper_rotation'
    && repair.journal_schema_version === 'nimi.macos-local-development-partial-install-repair/v2'
    && equalArray(repair.journal_phases, ['prepared', 'artifacts-removed', 'user-removed', 'group-removed', 'principal-removed'])
    && repair.journal_ownership === 'parent_repair_journal_directly_owns_artifact_user_group_deletion_and_must_not_delegate_to_or_recover_a_principal_transaction_journal'
    && repair.terminal_commit_policy === 'executor-prepares-the-exact-success-receipt-while-the-principal-removed-journal-remains-durable;_outer-final-helper-vnode-and-static-code-proof_then-bootstrap-self-retirement-must-complete-while-that-journal-still-exists;_a-second-final-helper-proof-immediately-precedes-one-exact-journal-unlink-as-the-last-semantic-effect;_any-proof-retirement-or-unlink-failure-preserves-a-journal-or-reaches-the-independent-clean-no-journal-boundary_and-never-emits-repair-success;_no-post-unlink-authority-check-may-turn-a-committed-repair-into-an-unrecoverable-failure'
    && repair.journal_staging_recovery === 'fixed_single-use_staging_path_is_removed_only_inside_the_final-helper-mutation-lock_after_open-fd_regular_root-root_mode-0600-nlink-1-size-at-most-65536_and_same-device-inode-path_revalidation;_recovery_precedes_every_unknown-entry_or_phase-evaluation_gate_and_the_staging_path_is_never_semantic_authority'
    && equalArray(repair.journal_authority_binding_required_fields, ['source_helper_sha256', 'source_helper_cdhash', 'source_principal_carrier_contract_version', 'residue_class', 'authentication_evidence_sha256', 'plan_digest', 'user_generated_uid', 'group_generated_uid', 'root_key_id', 'policy_digest'])
    && repair.fresh_bootstrap_absence_receipt === 'fresh_exact_bootstrap_process_with_new_ODSession_must_prove_both_Directory_Services_records_and_POSIX_projection_absent_bind_the_live_parent_PID-and-start-identity_and_bind_the_parent_repair_transaction_source-helper_identity_residue-class_plan-and-policy;_no-journal_clean-state_has_no_fresh-repair-receipt_and_never_invents_an_unproven_source-carrier';
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
  const principals = parseYaml(bundle, AUTHORITY_PATHS.runtimePrincipals, issues);
  const osProfiles = parseYaml(bundle, AUTHORITY_PATHS.osProfiles, issues);
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
  const launch = parseYaml(bundle, AUTHORITY_PATHS.launchSession, issues);
  const lifecycle = parseYaml(bundle, AUTHORITY_PATHS.lifecycle, issues);
  const transport = parseYaml(bundle, AUTHORITY_PATHS.transport, issues);
  const trust = parseYaml(bundle, AUTHORITY_PATHS.trust, issues);
  const osDevelopment = rowsBy(osProfiles?.non_product_local_development_profiles, 'profile_id')
    .get('macos_local_development_v1');
  const principalDevelopment = rowsBy(principals?.non_product_local_development_profiles, 'profile_id')
    .get('macos_local_development_v1');
  const custodyDevelopment = rowsBy(custody?.non_product_local_development_profiles, 'profile_id')
    .get('macos_local_development_v1');
  const launchDevelopment = rowsBy(launch?.non_product_local_development_profiles, 'profile_id')
    .get('macos_local_development_v1');
  const signer = rowsBy(trust?.signer_policies, 'signer_policy_id')
    .get('nimi-macos-local-development-signing-policy');
  const trustSets = rowsBy(trust?.trust_sets, 'trust_set_id');
  const developmentTrustRows = [
    ['nimi-runtime-macos-local-development-v1', 'nimi_runtime_service'],
    ['nimi-desktop-macos-local-development-v1', 'nimi_desktop'],
    ['nimi-local-development-host-macos-local-development-v1', 'nimi_local_app_host'],
  ];
  const releaseSchema = trust?.release_trust_record_schema;
  const releaseFields = releaseSchema?.fields;
  const profileBundle = transport?.verified_platform_transport?.non_product_local_development_profile_bundle;
  const supervisor = transport?.non_product_local_development_supervisor_consistency;
  const invalid = (
    osProfiles?.version !== 3
    || osProfiles?.platform_admission?.macos !== 'requirements_only_fail_closed_pending_native_admission'
    || osProfiles?.platform_admission?.macos_local_development !== 'local_development_non_product_admitted'
    || osDevelopment?.admission !== 'local_development_non_product_admitted'
    || osDevelopment?.product_admission_promotion !== 'forbidden'
    || osDevelopment?.compile_time_profile_only !== true
    || osDevelopment?.production_verifier_contains_profile_root !== false
    || osDevelopment?.desktop_socket_path !== '/private/var/run/nimi-dev/runtime-desktop.sock'
    || osDevelopment?.local_app_socket_path !== '/private/var/run/nimi-dev/runtime-local-app.sock'
    || !String(osDevelopment?.client_peer_verification ?? '').includes('LOCAL_PEERTOKEN')
    || !String(osDevelopment?.client_peer_verification ?? '').includes('leaf_SPKI')
    || !hasEvery(osDevelopment?.forbidden_fallbacks, ['production_socket', 'localhost_grpc', 'same_user_daemon', 'foreground_runtime', 'environment_profile_selection', 'argv_profile_selection'])
    || principals?.version !== 12
    || principals?.platform_admission?.macos !== 'requirements_only_fail_closed_pending_native_admission'
    || principals?.platform_admission?.macos_local_development !== 'local_development_non_product_admitted'
    || principalDevelopment?.production_principal !== 'dedicated_non_login__nimiruntimedev_launchd_system_daemon_principal'
    || principalDevelopment?.service_manager !== 'launchd_system_domain'
    || principalDevelopment?.principal_carrier_contract_version !== 4
    || principalDevelopment?.principal_constraints?.account_name !== '_nimiruntimedev'
    || principalDevelopment?.principal_constraints?.account_uid_gid_minimum !== 450
    || principalDevelopment?.principal_constraints?.account_uid_gid_maximum !== 499
    || principalDevelopment?.principal_constraints?.login_shell !== '/usr/bin/false'
    || principalDevelopment?.principal_constraints?.home_directory !== '/var/empty'
    || principalDevelopment?.principal_constraints?.password_authentication !== 'disabled'
    || principalDevelopment?.principal_constraints?.password_record_value !== '*'
    || principalDevelopment?.principal_constraints?.authentication_authority_posture !== 'absent_required'
    || !equalArray(principalDevelopment?.principal_constraints?.forbidden_authentication_material_attributes, [
      'dsAttrTypeStandard:AuthenticationAuthority',
      'dsAttrTypeNative:ShadowHashData',
      'dsAttrTypeStandard:PasswordPlus',
      'dsAttrTypeStandard:AltSecurityIdentities',
      'dsAttrTypeStandard:AuthCredential',
      'dsAttrTypeStandard:AuthMethod',
      'dsAttrTypeStandard:AuthenticationHint',
      'dsAttrTypeStandard:KDCAuthKey',
      'dsAttrTypeStandard:KerberosServices',
      'dsAttrTypeStandard:KerberosRealm',
      'dsAttrTypeNative:KerberosKeys',
      'dsAttrTypeNative:HeimdalSRPKey',
      'dsAttrTypeNative:SecureTokenVerifierHistory',
      'dsAttrTypeNative:AutoGrantSecureToken',
      'dsAttrTypeNative:LinkedIdentity',
    ])
    || principalDevelopment?.principal_constraints?.forbidden_delegated_writer_attribute_prefix !== 'dsAttrTypeNative:_writers'
    || !equalArray(principalDevelopment?.principal_constraints?.forbidden_explicit_group_membership_attributes, ['dsAttrTypeStandard:GroupMembership', 'dsAttrTypeStandard:GroupMembers', 'dsAttrTypeStandard:NestedGroups'])
    || principalDevelopment?.principal_constraints?.negative_attribute_value_policy !== 'raw_Any_value_count_nonzero_is_present_and_rejected;_binary_or_malformed_values_must_never_be_coerced_to_empty'
    || principalDevelopment?.principal_constraints?.directory_service_hidden !== true
    || principalDevelopment?.principal_constraints?.directory_service_hidden_record_value !== 'YES'
    || principalDevelopment?.principal_constraints?.generated_uid !== 'distinct_valid_UUID_required_for_user_and_group'
    || principalDevelopment?.principal_constraints?.directory_service_api !== 'public_OpenDirectory_framework_ODNode_createRecord_only'
    || principalDevelopment?.principal_constraints?.directory_service_commit_policy !== 'fsynced_root_owned_principal_journal_precedes_any_record_mutation_then_ODNode_createRecord_atomically_creates_group_then_user_with_complete_birth_attributes_including_distinct_GeneratedUID_password_star_hidden_state_false_shell_and_empty_home_but_no_AuthenticationAuthority_authentication_material_delegated-writer_or_explicit-group-membership_then_synchronizes_and_a_fresh_exact-signed_real-root_helper_process_reads_raw_OpenDirectory_and_POSIX_identity_and_returns_a_transaction-and-plan-bound_receipt'
    || principalDevelopment?.principal_constraints?.directory_service_recovery_policy !== 'recovery_reads_the_fsynced_transaction_name_UID_GID_user_GeneratedUID_and_group_GeneratedUID_then_deletes_user_before_group_only_when_every_observed_field_matches_and_proves_both_records_absent;_any_query_delete_mismatch_or_ambiguous_result_preserves_the_journal_and_fails_repair-required'
    || principalDevelopment?.principal_constraints?.directory_service_existing_identity_policy !== 'both_records_must_exist_and_match_the_complete_admitted_profile_or_both_must_be_absent;_an_existing_exact_identity_is_never_owned_or_deleted_by_a_failed_candidate_update'
    || !equalArray(principalDevelopment?.principal_constraints?.directory_service_mutation_fallbacks, ['dscl_forbidden', 'sysadminctl_forbidden', 'dsimport_forbidden', 'direct_dslocal_write_forbidden'])
    || principalDevelopment?.principal_constraints?.posix_identity_lookup_api !== 'getpwnam_r_getpwuid_r_getgrnam_r_getgrgid_r'
    || principalDevelopment?.principal_constraints?.posix_identity_lookup_result_policy !== 'return_code_0_plus_result_nil_is_the_only_not-found_state;_ERANGE_retries_with_bounded_buffer_growth_to_1048576_bytes;_any_other_return_code_is_lookup-error_and_never_absence'
    || principalDevelopment?.principal_constraints?.directory_cache_reset_executable !== '/usr/bin/odutil'
    || principalDevelopment?.principal_constraints?.directory_cache_reset_policy !== 'macos_local_development_delete-only_repair_runs_exact_/usr/bin/odutil_reset_cache_only_after_journaled_user-then-group_deletion_has_proved_exact_raw_OpenDirectory_name-and-identifier_absence;_an_exact_clean_no-journal_boundary_never_runs_cache-reset_or_enters_the_repair_state-machine;_cache-reset_runs_under_the_final-helper_mutation_lock_resets_all_opendirectoryd_membership-and-kernel-identity-caches_but_not_DNS_or_persistent-configuration_and_is_never_mutation-truth;_success_requires_a_fresh-bootstrap_reentrant-POSIX-and-raw-OD_absence-receipt'
    || principalDevelopment?.principal_constraints?.principal_deletion_projection_policy !== 'raw_OpenDirectory_name-and-identifier_absence_is_mutation_truth;_user-removed_group-present_is_proved_without_POSIX_positive_lookups;_group_deletion_commits_group-removed_before_cache-reset-or-POSIX-proof;_cache-reset_then_fresh-bootstrap_getpwnam_r_getpwuid_r_getgrnam_r_getgrgid_r_all-not-found_is_required_before_final-journal-removal_or_UID-GID-reuse'
    || !equalArray(principalDevelopment?.principal_constraints?.principal_diagnostic_fields, ['phase', 'probe', 'state', 'return_code', 'expected_identifier', 'observed_identifier', 'observed_primary_group_identifier', 'observed_name_sha256', 'projection_sha256', 'attempt', 'elapsed_ms', 'verifier_pid', 'timeout_seconds', 'sent_sigkill', 'child_reaped', 'kevent_event_flags', 'vnode_event_flags', 'vnode_event_names', 'lock_device', 'lock_inode', 'lock_sha256', 'lock_before_ctime', 'lock_after_ctime', 'journal_phase', 'journal_present', 'completion_prepared', 'bootstrap_retired', 'primary_reason_code', 'primary_probe'])
    || !equalArray(principalDevelopment?.principal_constraints?.principal_diagnostic_reason_codes, ['runtime-principal-directory-query-failed', 'runtime-principal-directory-mutation-failed', 'runtime-principal-directory-state-mismatch', 'runtime-principal-posix-query-failed', 'runtime-principal-posix-cache-stale', 'runtime-principal-posix-conflict', 'runtime-principal-cache-reset-failed', 'runtime-principal-fresh-proof-invalid', 'runtime-principal-journal-invalid'])
    || principalDevelopment?.principal_constraints?.principal_transaction_journal_path !== '/Library/Application Support/Nimi/RuntimeDev/principal-transaction.json'
    || principalDevelopment?.principal_constraints?.installation_transaction_journal_path !== '/Library/Application Support/Nimi/RuntimeDev/installation-transaction.json'
    || principalDevelopment?.principal_constraints?.installation_transaction_scope !== 'one_fsynced_fresh_install_top_level_journal_precedes_service_stop_or_first_mutation_requires_all_service_principal_directory_plist_payload_socket_and_Runtime_custody_baselines_absent_and_owns_every_created_principal_directory_plist_active_Desktop_installer_ledger_custody_and_socket_effect'
    || principalDevelopment?.principal_constraints?.installation_rollback_order !== 'bootout_and_prove_process_stopped_then_remove_and_prove_sockets_then_reset_transaction-created_Runtime_custody_while_candidate_Runtime_remains_verified_then_remove_plist_active_Desktop_and_ledger_then_remove_staging_then_remove_only_transaction-created_empty_fixed_directories_then_remove_exact_transaction-created_user_before_group_then_prove_full_baseline_absent_then_remove_journal'
    || !String(principalDevelopment?.principal_constraints?.installation_commit_boundary ?? '').startsWith('final_mutually_verified_Runtime_health')
    || principalDevelopment?.principal_constraints?.update_admission !== 'fail_closed_pending_nonmutating_release_lineage_validation_and_installer-bound_pending_commit_protocol;_current_AdmitReleaseLineage_mutates_anchored_high-water_before_final_health_so_old-candidate_restore_is_forbidden'
    || principalDevelopment?.principal_constraints?.partial_install_repair_journal_path !== '/Library/Application Support/Nimi/RuntimeDev/partial-install-repair-transaction.json'
    || principalDevelopment?.principal_constraints?.partial_install_repair_journal_staging_path !== '/Library/Application Support/Nimi/RuntimeDev/partial-install-repair-transaction.staging'
    || principalDevelopment?.principal_constraints?.partial_install_repair_policy !== 'explicit_confirmed_current_bootstrap_delete-only_repair_accepts_only_macos_local_development_v4_failed_first_install_exact_principal_from_source_carrier_4_or_macos_local_development_v2_failed_first_install_disabled_user_from_source_carrier_2;_carrier_2_requires_source-helper-status_carrier_2_one_String_AuthenticationAuthority_value_exactly_;DisabledUser;_all_other_authentication_material_absent_and_all_positive_principal_group_POSIX_membership_writer_evidence_exact;_carrier_4_requires_exact_current_absent-authentication_principal_and_never_accepts_the_legacy_class;_both_classes_delete_the_whole_exact_user_then_group_prove_absence_and_require_fresh_distinct_GeneratedUIDs_before_current_carrier_4_creation;_journal_schema_v2_directly_owns_prepared_artifacts-removed_user-removed_group-removed_principal-removed_and_is_bound_to_stable-before-and-after_source-helper_SHA256/CDHash_source-carrier_residue-class_auth-evidence-SHA256_plan/GUID_rootKey/policy;_fixed_single-use_journal_staging_is_recovered_before_unknown-entry_or_phase_evaluation_only_after_same-open-vnode_root-owned_regular-mode-0600-nlink-1-bounded-size_proof;_fresh-bootstrap_absence_receipt_and_final-helper-private-custody-proof_required;_principal-removed_journal_remains-durable-through_outer-final-helper-vnode-proof_and-bootstrap-retirement_then_exact-journal-unlink-is-the-last-semantic-effect;_signing_profile_Keychain_CA_and_final_helper_are_preserved'
    || !exactLegacyDeleteOnlyRepair(principalDevelopment?.principal_constraints?.legacy_delete_only_repair)
    || principalDevelopment?.principal_constraints?.installer_serialization_policy !== 'nonblocking_exclusive_flock_on_the_exact_open_root_owned_final_helper_vnode_spans_install_restart_reset_uninstall_release-record-signing_and_unprovision;_lock_contention_fails_before_mutation'
    || principalDevelopment?.acceptance_isolation?.development_state_lineage_root_acl !== 'root_installation_boundary_and_dedicated__nimiruntimedev_state_only'
    || principalDevelopment?.acceptance_isolation?.account_partition !== 'verified_interactive_euid_and_audit_session'
    || principalDevelopment?.acceptance_isolation?.runtime_lifecycle_and_restart !== 'real_launchd_system_daemon'
    || principalDevelopment?.acceptance_isolation?.parallel_isolation !== 'RuntimeDev_state_trust_Keychain_socket_bundle_and_label_namespaces'
    || principalDevelopment?.service_control?.service_label !== 'ai.nimi.runtime.dev'
    || principalDevelopment?.service_control?.production_SMAppService_equivalence_claim !== 'forbidden'
    || custody?.version !== 11
    || custody?.platform_admission?.macos !== 'requirements_only_fail_closed_pending_native_admission'
    || custody?.platform_admission?.macos_local_development !== 'local_development_non_product_admitted'
    || custodyDevelopment?.admission !== 'local_development_non_product_admitted'
    || !String(custodyDevelopment?.protector_or_key_source ?? '').includes('ai.nimi.runtime.protected-local.dev.v1')
    || !equalArray(custodyDevelopment?.keychain_accounts, ['ledger-anchor-v1', 'ledger-record-hmac-v1'])
    || custodyDevelopment?.signing_certificate_lookup !== 'public_root_certificate_requires_unique_exact_System_Keychain_DER_SHA256_from_public_profile_or_root_owned_cleanup_record_while_all_role_certificates_require_unique_exact_DER_SHA256_inside_the_explicitly_unlocked_fixed_signing_Keychain_labels_non_authorizing_public_key_SPKI_optional_witness'
    || custodyDevelopment?.signing_root_admin_trust_settings !== 'one_usage_constraint_exact_Apple_code_signing_policy_OID_derived_policy_name_CodeSigning_result_trustRoot_and_no_other_keys'
    || custodyDevelopment?.signing_profile_cleanup_record_path !== '/Library/Application Support/Nimi/RuntimeDev/dev-signing-cleanup-record.json'
    || custodyDevelopment?.signing_profile_cleanup_record_policy !== 'root_wheel_0600_written_before_the_single_System_Keychain_root_certificate_insert_and_removed_only_after_exact_idempotent_cleanup'
    || custodyDevelopment?.signing_keychain_password_commit_policy !== 'bootstrap_signing_keychain_password_exists_in_memory_only_and_is_zeroized_after_transaction;_the_final_helper_must_be_locally_CA_signed_and_its_exact_cdhash_known_before_one_System_Keychain_generic_password_insert;_the_item_is_born_with_exact_final-helper-only_decrypt_delete_changeACL_and_partition_ACLs;_bootstrap_helper_never_reads_owns_or_deletes_the_durable_item;_a_fresh_final_signed_helper_process_must_reopen_and_validate_custody_without_interaction;_rollback_and_unprovision_first_verify_the_exact_final-helper_and_item_ACLs_then_delete_the_signing-Keychain_then_delete_the_exact_item_reference_and_prove_absence_before_removing_public_trust_or_unlinking_the_final-helper;_failure_preserves_the_final-helper_cleanup-record_and_public-trust-until_unlock-secret_deletion_is_proven'
    || custodyDevelopment?.signing_unprovision_repair_policy !== 'repair-only_for_the_exact_stranded_shape_public_profile_signing-Keychain_Runtime_Desktop_LaunchDaemon_service-account_and_related-processes_absent_plus_cleanup-record_v2_and_final-helper_and_unlock-secret_present;_the_immutable_bootstrap_may_extract_only_the_public_root_certificate_from_the_stranded_final-helper_embedded_chain_require_its_DER_SHA256_to_equal_the_cleanup-record_fingerprint_and_temporarily_restore_that_certificate_with_one_exact_Apple-CodeSigning_admin-trust_constraint;_the_bootstrap_must_verify_final-helper_fixed-path_strict-signature_empty-Team-ID_hardened-runtime_and_exact_unlock-secret_decrypt-changeACL-partition_binding_but_must_not_read_or_delete_the_secret;_the_stranded_final-helper_then_deletes_its_secret_and_all_repaired_public_trust_material;_any_mismatch_fails_closed_and_this_repair_is_forbidden_as_the_normal_unprovision_path'
    || custodyDevelopment?.signing_bootstrap_helper_path !== '/usr/local/libexec/nimi-macos-dev-security-bootstrap'
    || custodyDevelopment?.signing_acl_identity_digest_policy !== 'bootstrap_SHA-256_records_exact_opaque_SecTrustedApplication_data_for_final_helper_and_/usr/bin/codesign_in_root_owned_public_profile_v4;_fresh_processes_compare_persisted_ACL_entry_digests_to_profile_and_must_not_recreate_or_interpret_opaque_data;_finalizer_removes_only_the_exact_bootstrap_entry_from_the_helper-role_key_in_the_unlocked_signing_Keychain_and_preserves_the_final_entry_bytes;_all_five_role_private_keys_remain_inside_the_fixed_signing_Keychain;_System_Keychain_profile_private_keys_and_any_post-insert_SecKeychainItemSetAccess_on_System_items_are_forbidden'
    || custodyDevelopment?.signing_helper_identity_transition_policy !== 'immutable_root_owned_linker_signed_bootstrap_at_/usr/local/libexec/nimi-macos-dev-security-bootstrap_runs_the_creation_transaction_while_an_equal-byte_nonexecuted_candidate_at_/usr/local/libexec/nimi-macos-dev-security_is_signed;_bootstrap_vnode_and_code_identity_must_remain_unchanged;_one_non-durable_P256_CA_private_key_exists_only_in_bootstrap_process_memory_and_never_enters_any_Keychain_or_projection;_bootstrap_uses_that_key_to_issue_the_local_CA_certificate_and_all_role_leaves;_the_helper-role_private_key_is_created_in_the_explicitly-unlocked_root-owned_signing_Keychain_with_bootstrap_owner_then_signs_the_distinct_final_helper;_after_final-helper_identity_is_verified_only_that_helper-role_key_may_hold_an_exact_bootstrap-plus-final_changeACL_transition_inside_the_password-unlocked_signing_Keychain;_the_record-signer_Runtime_Desktop_and_local-host_role_keys_are_created_once_inside_that_same_unlocked_signing_Keychain_with_final-helper-only_owner_restricted-and-partition_ACLs_and_are_never_mutated_after_insertion;_zero_profile_private_keys_are_admitted_in_System_Keychain;_the_System_Keychain_unlock-secret_item_is_born-final_and_never_mutated_after_insertion;_one_fresh_final_helper_closes_only_the_helper-role_transition_then_a_second_fresh_final_helper_proves_final-only_custody_absent_System_profile_private_keys_and_absent_durable_CA_private_key;_only_then_may_bootstrap_be_unlinked;_failure_before_unlock-secret_commit_uses_the_still-immutable_bootstrap_for_exact_rollback_while_failure_after_commit_must_preserve_and_execute_the_verified_final_helper_until_that_helper_deletes_its_unlock-secret;_success_requires_bootstrap_absent_zero_transitional_ACLs_zero_System_profile_private_keys_and_no_durable_CA_private_key'
    || custodyDevelopment?.unprovision_residual_identity_closure !== 'explicit_confirmed_unprovision_may_run_with_public_profile_or_cleanup_record_absent_but_a_present_signing-Keychain_unlock-secret_requires_the_exact_verified_final_helper_as_its_noninteractive_cleanup_anchor_and_that_helper_is_unlinked_last;_bootstrap_may_remove_only_public_or_fixed-path_residue_after_the_unlock-secret_is_proven_absent;_unlock-secret_present_with_missing_or_untrusted_final_helper_is_repair-required_and_requires_explicit_OS-authorized_break-glass_instead_of_root_or_API_bypass;_the_single_admitted_System_Keychain_profile_certificate_requires_public_profile_or_cleanup_record_exact_DER_SHA256;_zero_System_Keychain_profile_private_keys_are_admitted_and_any_root_CA_or_role_key_is_invalid_residue_removed_by_exact_label_application-tag_EC-P256_matching;_all_five_role_identities_are_removed_only_by_deleting_the_fixed_root-owned_signing_Keychain_as_one_custody_boundary;_success_requires_zero_fixed_profile_key_certificate_password_trust_bootstrap_helper_final_helper_profile_cleanup_record_or_signing_keychain_residue'
    || custodyDevelopment?.update_persistence !== 'RuntimeDev_state_and_Keychain_custody_survive_signed_development_candidate_updates'
    || custodyDevelopment?.uninstall_authority !== 'explicit_confirmed_dev_runtime_uninstall_does_not_remove_local_CA'
    || launch?.version !== 2
    || launch?.platform_admission?.macos !== 'requirements_only_fail_closed_pending_native_admission'
    || launch?.platform_admission?.macos_local_development !== 'local_development_non_product_admitted'
    || launchDevelopment?.admission !== 'local_development_non_product_admitted'
    || launchDevelopment?.fixed_host_path !== '/Applications/Nimi Dev.app/Contents/Frameworks/Nimi Local App Host Dev.app/Contents/MacOS/Nimi Local App Host Dev'
    || !String(launchDevelopment?.child_process_witness ?? '').includes('START_SUSPENDED')
    || launchDevelopment?.runtime_restart !== 'old_session_revoked_new_boot_epoch_and_lease_required_inside_same_live_supervisor_run'
    || lifecycle?.version !== 5
    || lifecycle?.platform_admission?.macos !== 'requirements_only_fail_closed_pending_native_admission'
    || lifecycle?.platform_admission?.macos_local_development !== 'local_development_non_product_admitted'
    || lifecycle?.non_product_local_development?.exact_service_label !== 'ai.nimi.runtime.dev'
    || lifecycle?.non_product_local_development?.exact_runtime_path !== '/Library/Application Support/Nimi/RuntimeDev/active/bin/nimi-runtime'
    || lifecycle?.non_product_local_development?.persistent_state_survives_update !== true
    || lifecycle?.non_product_local_development?.uninstall_requires_explicit_confirmation_and_preserves_local_CA !== true
    || transport?.version !== 12
    || transport?.platform_admission?.macos !== 'fail_closed_pending_native_admission'
    || transport?.platform_admission?.macos_local_development !== 'local_development_non_product_admitted'
    || profileBundle?.profile_id !== 'macos_local_development_v1'
    || profileBundle?.compile_time_selection_only !== true
    || profileBundle?.product_admission_promotion !== 'forbidden'
    || supervisor?.implementation_bindings?.length !== 1
    || supervisor?.implementation_bindings?.[0] !== 'desktop_electron_supervisor'
    || supervisor?.electron_positive_does_not_enable_tauri !== true
    || !String(supervisor?.tauri_binding ?? '').startsWith('fail_closed_pending_independent_Rust_WKWebView')
    || trust?.version !== 6
    || trust?.platform_admission?.macos !== 'requirements_only_fail_closed_pending_native_admission'
    || trust?.platform_admission?.macos_local_development !== 'local_development_non_product_admitted'
    || releaseSchema?.schema_version !== 2
    || releaseSchema?.production_signature !== 'Ed25519_over_canonical_record_without_signature'
    || releaseSchema?.local_development_signature !== 'ECDSA_P256_SHA256_DER_over_canonical_record_without_signature'
    || !hasEvery(releaseFields, ['identity_class', 'signature_algorithm', 'macos_leaf_spki_sha256', 'macos_hardened_runtime_required', 'macos_notarization_required'])
    || releaseSchema?.macos_local_development_record_root !== '/Library/Application Support/Nimi/RuntimeDev/active/trust/protected-local/v1'
    || !equalArray(releaseSchema?.macos_fixed_record_path_authority?.system_owned_ancestors, ['/Library', '/Library/Application Support'])
    || releaseSchema?.macos_fixed_record_path_authority?.nimi_owned_subtree_root !== '/Library/Application Support/Nimi'
    || !String(releaseSchema?.macos_fixed_record_path_authority?.system_owned_ancestor_policy ?? '').includes('native_OS_group_and_nonwritable_mode_are_preserved')
    || !String(releaseSchema?.macos_fixed_record_path_authority?.nimi_owned_subtree_policy ?? '').includes('exact_root_wheel_mode_0755')
    || releaseSchema?.macos_fixed_record_path_authority?.system_directory_reownership_or_chmod !== 'forbidden'
    || signer?.environment !== 'local_development'
    || signer?.identity_class !== 'local_ca'
    || signer?.release_record_signature_algorithm !== 'ecdsa_p256_sha256'
    || signer?.team_id_posture !== 'exact_empty_required'
    || signer?.notarization_posture !== 'absent_and_must_not_be_claimed'
    || developmentTrustRows.some(([id, role]) => {
      const row = trustSets.get(id);
      return row?.executable_role !== role
        || row?.environment !== 'local_development'
        || !equalArray(row?.allowed_os_profiles, ['macos_local_development'])
        || row?.platform_code_signing_policy_ref !== 'nimi-macos-local-development-signing-policy'
        || row?.runtime_build_allowance !== 'compile_time_macos_local_development_only'
        || row?.product_readiness_claim_allowed !== false
        || row?.runtime_configuration_mutable !== false;
    })
    || trust?.production_runtime_accepts_local_development_trust_set !== false
    || trust?.local_development_runtime_accepts_production_trust_set !== false
    || trust?.local_development_runtime_accepts_external_e2e_fixture_trust_set !== false
    || trust?.local_development_runtime_accepts_production_realm_endpoints !== false
    || trust?.local_development_runtime_accepts_production_account_custody !== false
  );
  if (invalid) {
    issues.push(issue(
      'MACOS_LOCAL_DEVELOPMENT_PROFILE_REQUIRED',
      AUTHORITY_PATHS.trust,
      'The non-product macOS profile must remain compile-time isolated across service principal, RuntimeDev paths, UDS, System Keychain custody, local-CA release records, Electron-only supervision, production trust and Tauri admission.',
    ));
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
