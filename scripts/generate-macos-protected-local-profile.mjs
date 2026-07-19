#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import YAML from 'yaml';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
if (process.argv.slice(2).some((value) => value !== '--check')) {
  throw new Error('macOS protected-local profile generator accepts only --check');
}

const runtimeTables = path.join(repoRoot, '.nimi/spec/runtime/kernel/tables');
const platformTables = path.join(repoRoot, '.nimi/spec/platform/kernel/tables');
const [osTable, principalTable, custodyTable, launchTable, trustTable] = await Promise.all([
  readYAML(path.join(runtimeTables, 'protected-local-os-profiles.yaml')),
  readYAML(path.join(runtimeTables, 'protected-local-runtime-principal-profiles.yaml')),
  readYAML(path.join(runtimeTables, 'protected-local-custody-profiles.yaml')),
  readYAML(path.join(runtimeTables, 'protected-local-launch-session-profiles.yaml')),
  readYAML(path.join(platformTables, 'protected-local-executable-trust-sets.yaml')),
]);

const profile = buildProfile({ custodyTable, launchTable, osTable, principalTable, trustTable });
const launchDaemon = renderLaunchDaemon(profile);
const outputs = new Map([
  ['runtime/internal/protectedlocal/macos_contract_local_development_darwin.go', renderGo(profile)],
  ['kit/shell/protected-local/src/macos_profile_local_development.rs', renderRust(profile)],
  ['kit/shell/protected-local/src/macos_profile_local_development.h', renderHeader(profile)],
  ['apps/desktop/scripts/generated/macos-local-development-profile.mjs', renderJavaScript(profile)],
  ['apps/desktop/macos/generated/macos_local_development_profile.swift', renderSwift(profile, sha256(launchDaemon))],
  ['apps/desktop/macos/generated/ai.nimi.runtime.dev.plist', launchDaemon],
]);

const drift = [];
for (const [relative, expected] of outputs) {
  const target = path.join(repoRoot, relative);
  if (check) {
    const actual = await readFile(target, 'utf8').catch((error) => {
      if (error?.code === 'ENOENT') return undefined;
      throw error;
    });
    if (actual !== expected) drift.push(relative);
  } else {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, expected, 'utf8');
  }
}
if (drift.length > 0) {
  throw new Error(`macOS protected-local generated profile drift: ${drift.join(', ')}`);
}
process.stdout.write(`${JSON.stringify({ status: check ? 'current' : 'generated', outputs: [...outputs.keys()] })}\n`);

async function readYAML(file) {
  return YAML.parse(await readFile(file, 'utf8'));
}

function buildProfile(input) {
  const select = (table) => exactOne(
    table?.non_product_local_development_profiles,
    (row) => row?.os === 'macos' && row?.profile_id === 'macos_local_development_v1',
    `${table?.protocol_id || 'authority table'} macOS local-development profile`,
  );
  const os = select(input.osTable);
  const principal = select(input.principalTable);
  const custody = select(input.custodyTable);
  const launch = select(input.launchTable);
  const recordSchema = requiredObject(input.trustTable?.release_trust_record_schema, 'release trust record schema');
  const roleRecords = requiredArray(recordSchema.macos_local_development_role_records, 'macOS local-development role records');
  const role = (name) => exactOne(roleRecords, (row) => row?.executable_role === name, `${name} role record`);
  const runtime = role('nimi_runtime_service');
  const desktop = role('nimi_desktop');
  const host = role('nimi_local_app_host');
  const signer = exactOne(
    input.trustTable?.signer_policies,
    (row) => row?.signer_policy_id === 'nimi-macos-local-development-signing-policy',
    'macOS local-development signer policy',
  );
  const identity = requiredObject(recordSchema?.macos_identity_class_rules?.local_development, 'local-development identity rules');
  const principalConstraints = requiredObject(principal?.principal_constraints, 'Runtime principal constraints');
  const legacyRepair = requiredObject(principalConstraints.legacy_delete_only_repair, 'Runtime legacy delete-only repair');
  const legacyRepairClass = exactOne(
    legacyRepair.admitted_residue_classes,
    (row) => row?.residue_class === 'macos_local_development_v2_failed_first_install_disabled_user',
    'Runtime legacy delete-only repair residue class',
  );
  const normalRepairClass = exactOne(
    legacyRepair.admitted_residue_classes,
    (row) => row?.residue_class === 'macos_local_development_v4_failed_first_install_exact_principal',
    'Runtime normal delete-only repair residue class',
  );
  const legacyAuthenticationAuthority = requiredObject(
    legacyRepairClass.authentication_authority,
    'Runtime legacy repair AuthenticationAuthority evidence',
  );

  const result = {
    admission: os.admission,
    desktopApplicationPath: requiredAbsolute(launch.desktop_application_path, 'Desktop application path'),
    desktopExecutablePath: requiredAbsolute(launch.desktop_executable_path, 'Desktop executable path'),
    desktopSigningIdentifier: requiredText(desktop.signing_identifier, 'Desktop signing identifier'),
    desktopSocketActivationName: requiredText(os.desktop_socket_activation_name, 'Desktop socket activation name'),
    desktopSocketPath: requiredAbsolute(os.desktop_socket_path, 'Desktop socket path'),
    desktopTrustSetId: requiredText(desktop.trust_set_id, 'Desktop trust set'),
    environment: requiredText(signer.environment, 'environment'),
    identityClass: requiredText(identity.identity_class, 'identity class'),
    keychainService: requiredText(custody.keychain_service, 'Keychain service'),
    runtimeKeychainAccounts: requiredArray(custody.keychain_accounts, 'Runtime Keychain accounts').map((value) => requiredText(value, 'Runtime Keychain account')),
    runtimeLegacyRepairAuthenticationAuthorityAttribute: requiredText(legacyAuthenticationAuthority.attribute, 'Runtime legacy repair AuthenticationAuthority attribute'),
    runtimeLegacyRepairAuthenticationAuthorityExactValue: requiredText(legacyAuthenticationAuthority.exact_value, 'Runtime legacy repair AuthenticationAuthority exact value'),
    runtimeLegacyRepairAuthenticationAuthorityExactValueCount: requiredInteger(legacyAuthenticationAuthority.exact_value_count, 'Runtime legacy repair AuthenticationAuthority exact value count'),
    runtimeLegacyRepairAuthenticationAuthorityValueType: requiredText(legacyAuthenticationAuthority.value_type, 'Runtime legacy repair AuthenticationAuthority value type'),
    runtimeLegacyRepairDedicatedGroupProjection: requiredText(legacyRepairClass.dedicated_group_projection, 'Runtime legacy repair dedicated group projection'),
    runtimeLegacyRepairDelegatedWriterProjection: requiredText(legacyRepairClass.delegated_writer_projection, 'Runtime legacy repair delegated writer projection'),
    runtimeLegacyRepairDisposition: requiredText(legacyRepairClass.disposition, 'Runtime legacy repair disposition'),
    runtimeLegacyRepairFullLocalGroupMembershipProjection: requiredText(legacyRepairClass.full_local_group_membership_projection, 'Runtime legacy repair full local group membership projection'),
    runtimeLegacyRepairJournalAuthorityBindingRequiredFields: requiredArray(legacyRepair.journal_authority_binding_required_fields, 'Runtime legacy repair journal authority binding fields').map((value) => requiredText(value, 'Runtime legacy repair journal authority binding field')),
    runtimeLegacyRepairJournalOwnership: requiredText(legacyRepair.journal_ownership, 'Runtime legacy repair journal ownership'),
    runtimeLegacyRepairJournalPhases: requiredArray(legacyRepair.journal_phases, 'Runtime legacy repair journal phases').map((value) => requiredText(value, 'Runtime legacy repair journal phase')),
    runtimeLegacyRepairJournalSchemaVersion: requiredText(legacyRepair.journal_schema_version, 'Runtime legacy repair journal schema version'),
    runtimeLegacyRepairJournalStagingRecovery: requiredText(legacyRepair.journal_staging_recovery, 'Runtime legacy repair journal staging recovery'),
    runtimeLegacyRepairNormalCurrentProfileDisposition: requiredText(legacyRepair.normal_current_profile_disposition, 'Runtime legacy repair normal current profile disposition'),
    runtimeLegacyRepairOtherAuthenticationMaterialAttributes: requiredArray(legacyRepairClass.other_authentication_material_attributes, 'Runtime legacy repair other authentication material attributes').map((value) => requiredText(value, 'Runtime legacy repair other authentication material attribute')),
    runtimeLegacyRepairOtherAuthenticationMaterialPosture: requiredText(legacyRepairClass.other_authentication_material_posture, 'Runtime legacy repair other authentication material posture'),
    runtimeLegacyRepairPOSIXProjection: requiredText(legacyRepairClass.posix_projection, 'Runtime legacy repair POSIX projection'),
    runtimeLegacyRepairPositivePrincipalFields: requiredText(legacyRepairClass.positive_principal_fields, 'Runtime legacy repair positive principal fields'),
    runtimeLegacyRepairRecreateDisposition: requiredText(legacyRepairClass.repair_disposition, 'Runtime legacy repair recreate disposition'),
    runtimeLegacyRepairResidueClass: requiredText(legacyRepairClass.residue_class, 'Runtime legacy repair residue class'),
    runtimeLegacyRepairSourceHelperIdentityStability: requiredText(legacyRepair.source_helper_identity_stability, 'Runtime legacy repair source helper identity stability'),
    runtimeLegacyRepairSourceHelperStatus: requiredText(legacyRepairClass.source_helper_status, 'Runtime legacy repair source helper status'),
    runtimeLegacyRepairSourcePrincipalCarrierContractVersion: requiredInteger(legacyRepairClass.source_principal_carrier_contract_version, 'Runtime legacy repair source principal carrier contract version'),
    runtimeLegacyRepairFreshBootstrapAbsenceReceipt: requiredText(legacyRepair.fresh_bootstrap_absence_receipt, 'Runtime legacy repair fresh bootstrap absence receipt'),
    runtimeNormalRepairAuthenticationAuthorityPosture: requiredText(normalRepairClass.authentication_authority_posture, 'Runtime normal repair AuthenticationAuthority posture'),
    runtimeNormalRepairDisposition: requiredText(normalRepairClass.disposition, 'Runtime normal repair disposition'),
    runtimeNormalRepairResidueClass: requiredText(normalRepairClass.residue_class, 'Runtime normal repair residue class'),
    runtimeNormalRepairSourceHelperStatus: requiredText(normalRepairClass.source_helper_status, 'Runtime normal repair source helper status'),
    runtimeNormalRepairSourcePrincipalCarrierContractVersion: requiredInteger(normalRepairClass.source_principal_carrier_contract_version, 'Runtime normal repair source principal carrier contract version'),
    bootstrapHelperPath: requiredAbsolute(custody.signing_bootstrap_helper_path, 'signing bootstrap helper path'),
    signingACLIdentityDigestPolicy: requiredText(custody.signing_acl_identity_digest_policy, 'signing ACL identity digest policy'),
    signingHelperIdentityTransitionPolicy: requiredText(custody.signing_helper_identity_transition_policy, 'signing helper identity transition policy'),
    signingKeychainPasswordCommitPolicy: requiredText(custody.signing_keychain_password_commit_policy, 'signing Keychain password commit policy'),
    signingUnprovisionRepairPolicy: requiredText(custody.signing_unprovision_repair_policy, 'signing unprovision repair policy'),
    signingKeychainPasswordService: requiredText(custody.signing_keychain_password_service, 'signing Keychain password service'),
    signingKeychainPath: requiredAbsolute(custody.signing_keychain_path, 'signing Keychain path'),
    signingCleanupRecordPath: requiredAbsolute(custody.signing_profile_cleanup_record_path, 'signing cleanup record path'),
    unprovisionResidualIdentityClosure: requiredText(custody.unprovision_residual_identity_closure, 'unprovision residual identity closure'),
    launchdDefinitionPath: requiredAbsolute(principal.launchd_definition_path, 'launchd definition path'),
    localAppHostPath: requiredAbsolute(launch.fixed_host_path, 'local-app host path'),
    localAppHostSigningIdentifier: requiredText(host.signing_identifier, 'local-app host signing identifier'),
    localAppHostTrustSetId: requiredText(host.trust_set_id, 'local-app host trust set'),
    localAppSocketActivationName: requiredText(os.local_app_socket_activation_name, 'local-app socket activation name'),
    localAppSocketPath: requiredAbsolute(os.local_app_socket_path, 'local-app socket path'),
    recordRoot: requiredAbsolute(recordSchema.macos_local_development_record_root, 'record root'),
    runtimePrincipalCarrierContractVersion: requiredInteger(principal.principal_carrier_contract_version, 'Runtime principal carrier contract version'),
    runtimeAccount: requiredText(principalConstraints.account_name, 'Runtime account'),
    runtimeAccountUIDMaximum: requiredInteger(principalConstraints.account_uid_gid_maximum, 'Runtime account UID/GID maximum'),
    runtimeAccountUIDMinimum: requiredInteger(principalConstraints.account_uid_gid_minimum, 'Runtime account UID/GID minimum'),
    runtimeAuthenticationAuthorityPosture: requiredText(principalConstraints.authentication_authority_posture, 'Runtime AuthenticationAuthority posture'),
    runtimeDirectoryServiceAPI: requiredText(principalConstraints.directory_service_api, 'Runtime Directory Services API'),
    runtimeDirectoryServiceCommitPolicy: requiredText(principalConstraints.directory_service_commit_policy, 'Runtime Directory Services commit policy'),
    runtimeDirectoryServiceExistingIdentityPolicy: requiredText(principalConstraints.directory_service_existing_identity_policy, 'Runtime Directory Services existing identity policy'),
    runtimeDirectoryServiceHiddenRecordValue: requiredText(principalConstraints.directory_service_hidden_record_value, 'Runtime Directory Services hidden record value'),
    runtimeDirectoryServiceMutationFallbacks: requiredArray(principalConstraints.directory_service_mutation_fallbacks, 'Runtime Directory Services mutation fallbacks'),
    runtimeDirectoryServiceRecoveryPolicy: requiredText(principalConstraints.directory_service_recovery_policy, 'Runtime Directory Services recovery policy'),
    runtimeForbiddenDelegatedWriterAttributePrefix: requiredText(principalConstraints.forbidden_delegated_writer_attribute_prefix, 'Runtime forbidden delegated writer attribute prefix'),
    runtimeForbiddenExplicitGroupMembershipAttributes: requiredArray(principalConstraints.forbidden_explicit_group_membership_attributes, 'Runtime forbidden explicit group membership attributes').map((value) => requiredText(value, 'Runtime forbidden explicit group membership attribute')),
    runtimeForbiddenExplicitGroupMembershipPolicy: requiredText(principalConstraints.forbidden_explicit_group_membership_policy, 'Runtime forbidden explicit group membership policy'),
    runtimeForbiddenAuthenticationMaterialAttributes: requiredArray(principalConstraints.forbidden_authentication_material_attributes, 'Runtime forbidden authentication material attributes').map((value) => requiredText(value, 'Runtime forbidden authentication material attribute')),
    runtimeExecutablePath: requiredAbsolute(principal.runtime_executable_path, 'Runtime executable path'),
    runtimeGeneratedUIDPolicy: requiredText(principalConstraints.generated_uid, 'Runtime GeneratedUID policy'),
    runtimeHomeDirectory: requiredAbsolute(principalConstraints.home_directory, 'Runtime account home directory'),
    runtimeLoginShell: requiredAbsolute(principalConstraints.login_shell, 'Runtime account login shell'),
    runtimeNegativeAttributeValuePolicy: requiredText(principalConstraints.negative_attribute_value_policy, 'Runtime negative attribute value policy'),
    runtimePasswordRecordValue: requiredText(principalConstraints.password_record_value, 'Runtime password record value'),
    runtimePartialInstallRepairJournalPath: requiredAbsolute(principalConstraints.partial_install_repair_journal_path, 'Runtime partial-install repair journal path'),
    runtimePartialInstallRepairJournalStagingPath: requiredAbsolute(principalConstraints.partial_install_repair_journal_staging_path, 'Runtime partial-install repair journal staging path'),
    runtimePartialInstallRepairPolicy: requiredText(principalConstraints.partial_install_repair_policy, 'Runtime partial-install repair policy'),
    runtimeInstallationCommitBoundary: requiredText(principalConstraints.installation_commit_boundary, 'Runtime installation commit boundary'),
    runtimeInstallationJournalPath: requiredAbsolute(principalConstraints.installation_transaction_journal_path, 'Runtime installation transaction journal path'),
    runtimeInstallationRollbackOrder: requiredText(principalConstraints.installation_rollback_order, 'Runtime installation rollback order'),
    runtimeInstallationTransactionScope: requiredText(principalConstraints.installation_transaction_scope, 'Runtime installation transaction scope'),
    runtimeUpdateAdmission: requiredText(principalConstraints.update_admission, 'Runtime update admission'),
    runtimePrincipalJournalPath: requiredAbsolute(principalConstraints.principal_transaction_journal_path, 'Runtime principal transaction journal path'),
    runtimeServiceMutationSerializationPolicy: requiredText(principalConstraints.installer_serialization_policy, 'Runtime service mutation serialization policy'),
    runtimeServiceLabel: requiredText(principal?.service_control?.service_label, 'Runtime service label'),
    runtimeSigningIdentifier: requiredText(runtime.signing_identifier, 'Runtime signing identifier'),
    runtimeStateRoot: requiredAbsolute(principal.runtime_state_root, 'Runtime state root'),
    runtimeTrustSetId: requiredText(runtime.trust_set_id, 'Runtime trust set'),
    signatureAlgorithm: requiredText(identity.signature_algorithm, 'signature algorithm'),
    signerPolicyId: requiredText(signer.signer_policy_id, 'signer policy'),
  };
  if (result.admission !== 'local_development_non_product_admitted'
    || result.environment !== 'local_development'
    || result.identityClass !== 'local_ca'
    || result.signatureAlgorithm !== 'ecdsa_p256_sha256'
    || result.runtimePrincipalCarrierContractVersion !== 4
    || result.runtimeAccountUIDMinimum !== 450
    || result.runtimeAccountUIDMaximum !== 499
    || result.runtimeHomeDirectory !== '/var/empty'
    || result.runtimeLoginShell !== '/usr/bin/false'
    || result.runtimePasswordRecordValue !== '*'
    || result.runtimeAuthenticationAuthorityPosture !== 'absent_required'
    || !equalArray(result.runtimeForbiddenAuthenticationMaterialAttributes, [
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
    || result.runtimeForbiddenDelegatedWriterAttributePrefix !== 'dsAttrTypeNative:_writers'
    || !equalArray(result.runtimeForbiddenExplicitGroupMembershipAttributes, ['dsAttrTypeStandard:GroupMembership', 'dsAttrTypeStandard:GroupMembers', 'dsAttrTypeStandard:NestedGroups'])
    || result.runtimeForbiddenExplicitGroupMembershipPolicy !== 'dedicated_group_membership_fields_absent_and_full_local_group_projection_contains_no_explicit_service_account_name_user_GeneratedUID_or_dedicated_group_GeneratedUID_membership'
    || result.runtimeNegativeAttributeValuePolicy !== 'raw_Any_value_count_nonzero_is_present_and_rejected;_binary_or_malformed_values_must_never_be_coerced_to_empty'
    || result.runtimeDirectoryServiceHiddenRecordValue !== 'YES'
    || result.runtimeGeneratedUIDPolicy !== 'distinct_valid_UUID_required_for_user_and_group'
    || result.runtimeDirectoryServiceAPI !== 'public_OpenDirectory_framework_ODNode_createRecord_only'
    || result.runtimeDirectoryServiceCommitPolicy !== 'fsynced_root_owned_principal_journal_precedes_any_record_mutation_then_ODNode_createRecord_atomically_creates_group_then_user_with_complete_birth_attributes_including_distinct_GeneratedUID_password_star_hidden_state_false_shell_and_empty_home_but_no_AuthenticationAuthority_authentication_material_delegated-writer_or_explicit-group-membership_then_synchronizes_and_a_fresh_exact-signed_real-root_helper_process_reads_raw_OpenDirectory_and_POSIX_identity_and_returns_a_transaction-and-plan-bound_receipt'
    || result.runtimeDirectoryServiceRecoveryPolicy !== 'recovery_reads_the_fsynced_transaction_name_UID_GID_user_GeneratedUID_and_group_GeneratedUID_then_deletes_user_before_group_only_when_every_observed_field_matches_and_proves_both_records_absent;_any_query_delete_mismatch_or_ambiguous_result_preserves_the_journal_and_fails_repair-required'
    || result.runtimeDirectoryServiceExistingIdentityPolicy !== 'both_records_must_exist_and_match_the_complete_admitted_profile_or_both_must_be_absent;_an_existing_exact_identity_is_never_owned_or_deleted_by_a_failed_candidate_update'
    || !equalArray(result.runtimeDirectoryServiceMutationFallbacks, ['dscl_forbidden', 'sysadminctl_forbidden', 'dsimport_forbidden', 'direct_dslocal_write_forbidden'])
    || result.runtimePrincipalJournalPath !== '/Library/Application Support/Nimi/RuntimeDev/principal-transaction.json'
    || result.runtimeInstallationJournalPath !== '/Library/Application Support/Nimi/RuntimeDev/installation-transaction.json'
    || result.runtimeInstallationTransactionScope !== 'one_fsynced_fresh_install_top_level_journal_precedes_service_stop_or_first_mutation_requires_all_service_principal_directory_plist_payload_socket_and_Runtime_custody_baselines_absent_and_owns_every_created_principal_directory_plist_active_Desktop_installer_ledger_custody_and_socket_effect'
    || result.runtimeInstallationRollbackOrder !== 'bootout_and_prove_process_stopped_then_remove_and_prove_sockets_then_reset_transaction-created_Runtime_custody_while_candidate_Runtime_remains_verified_then_remove_plist_active_Desktop_and_ledger_then_remove_staging_then_remove_only_transaction-created_empty_fixed_directories_then_remove_exact_transaction-created_user_before_group_then_prove_full_baseline_absent_then_remove_journal'
    || result.runtimeInstallationCommitBoundary !== 'final_mutually_verified_Runtime_health_after_launchd_bootstrap_and_all_fixed_artifact_checks;_journal_and_rollback_generation_are_retained_until_this_boundary'
    || result.runtimeUpdateAdmission !== 'fail_closed_pending_nonmutating_release_lineage_validation_and_installer-bound_pending_commit_protocol;_current_AdmitReleaseLineage_mutates_anchored_high-water_before_final_health_so_old-candidate_restore_is_forbidden'
    || result.runtimePartialInstallRepairJournalPath !== '/Library/Application Support/Nimi/RuntimeDev/partial-install-repair-transaction.json'
    || result.runtimePartialInstallRepairJournalStagingPath !== '/Library/Application Support/Nimi/RuntimeDev/partial-install-repair-transaction.staging'
    || result.runtimePartialInstallRepairPolicy !== 'explicit_confirmed_current_bootstrap_delete-only_repair_accepts_only_macos_local_development_v4_failed_first_install_exact_principal_from_source_carrier_4_or_macos_local_development_v2_failed_first_install_disabled_user_from_source_carrier_2;_carrier_2_requires_source-helper-status_carrier_2_one_String_AuthenticationAuthority_value_exactly_;DisabledUser;_all_other_authentication_material_absent_and_all_positive_principal_group_POSIX_membership_writer_evidence_exact;_carrier_4_requires_exact_current_absent-authentication_principal_and_never_accepts_the_legacy_class;_both_classes_delete_the_whole_exact_user_then_group_prove_absence_and_require_fresh_distinct_GeneratedUIDs_before_current_carrier_4_creation;_journal_schema_v2_directly_owns_prepared_artifacts-removed_user-removed_group-removed_principal-removed_and_is_bound_to_stable-before-and-after_source-helper_SHA256/CDHash_source-carrier_residue-class_auth-evidence-SHA256_plan/GUID_rootKey/policy;_fixed_single-use_journal_staging_is_recovered_before_unknown-entry_or_phase_evaluation_only_after_same-open-vnode_root-owned_regular-mode-0600-nlink-1-bounded-size_proof;_fresh-bootstrap_absence_receipt_and_final-helper-private-custody-proof_required;_signing_profile_Keychain_CA_and_final_helper_are_preserved'
    || result.runtimeNormalRepairResidueClass !== 'macos_local_development_v4_failed_first_install_exact_principal'
    || result.runtimeNormalRepairDisposition !== 'delete_only_exact_current_principal_never_reuse_existing_GeneratedUIDs'
    || result.runtimeNormalRepairSourcePrincipalCarrierContractVersion !== 4
    || result.runtimeNormalRepairSourceHelperStatus !== 'installed_signed_helper_reports_principal_carrier_contract_version_4'
    || result.runtimeNormalRepairAuthenticationAuthorityPosture !== 'absent_required'
    || normalRepairClass.other_authentication_material_posture !== 'absent_required'
    || normalRepairClass.positive_principal_fields !== result.runtimeLegacyRepairPositivePrincipalFields
    || normalRepairClass.dedicated_group_projection !== result.runtimeLegacyRepairDedicatedGroupProjection
    || normalRepairClass.posix_projection !== result.runtimeLegacyRepairPOSIXProjection
    || normalRepairClass.full_local_group_membership_projection !== result.runtimeLegacyRepairFullLocalGroupMembershipProjection
    || normalRepairClass.delegated_writer_projection !== result.runtimeLegacyRepairDelegatedWriterProjection
    || normalRepairClass.repair_disposition !== result.runtimeLegacyRepairRecreateDisposition
    || result.runtimeLegacyRepairResidueClass !== 'macos_local_development_v2_failed_first_install_disabled_user'
    || result.runtimeLegacyRepairDisposition !== 'delete_only_never_admit_or_normalize_as_current_principal'
    || result.runtimeLegacyRepairSourcePrincipalCarrierContractVersion !== 2
    || result.runtimeLegacyRepairSourceHelperStatus !== 'installed_signed_helper_reports_principal_carrier_contract_version_2'
    || result.runtimeLegacyRepairAuthenticationAuthorityAttribute !== 'dsAttrTypeStandard:AuthenticationAuthority'
    || result.runtimeLegacyRepairAuthenticationAuthorityValueType !== 'String'
    || result.runtimeLegacyRepairAuthenticationAuthorityExactValueCount !== 1
    || result.runtimeLegacyRepairAuthenticationAuthorityExactValue !== ';DisabledUser;'
    || result.runtimeLegacyRepairOtherAuthenticationMaterialPosture !== 'absent_required'
    || !equalArray(result.runtimeLegacyRepairOtherAuthenticationMaterialAttributes, result.runtimeForbiddenAuthenticationMaterialAttributes.slice(1))
    || result.runtimeLegacyRepairPositivePrincipalFields !== 'exact_current_name_uid_gid_password_hidden_home_shell_and_distinct_valid_user_group_GeneratedUID_required'
    || result.runtimeLegacyRepairDedicatedGroupProjection !== 'exact_current_name_gid_GeneratedUID_and_no_explicit_membership_required'
    || result.runtimeLegacyRepairPOSIXProjection !== 'exact_current_name_uid_gid_home_shell_and_nonlogin_projection_required'
    || result.runtimeLegacyRepairFullLocalGroupMembershipProjection !== 'exact_absence_of_service_name_user_GeneratedUID_and_dedicated_group_GeneratedUID_required'
    || result.runtimeLegacyRepairDelegatedWriterProjection !== 'exact_absence_of_every_dsAttrTypeNative:_writers_prefix_attribute_required'
    || result.runtimeLegacyRepairRecreateDisposition !== 'delete_exact_whole_user_then_exact_group_prove_both_records_and_POSIX_projection_absent_then_current_carrier_creation_requires_fresh_distinct_user_and_group_GeneratedUIDs'
    || result.runtimeLegacyRepairNormalCurrentProfileDisposition !== 'carrier_4_requires_AuthenticationAuthority_absent_and_never_accepts_or_normalizes_any_legacy_residue_class'
    || !equalArray(result.runtimeLegacyRepairJournalAuthorityBindingRequiredFields, ['source_helper_sha256', 'source_helper_cdhash', 'source_principal_carrier_contract_version', 'residue_class', 'authentication_evidence_sha256', 'plan_digest', 'user_generated_uid', 'group_generated_uid', 'root_key_id', 'policy_digest'])
    || result.runtimeLegacyRepairSourceHelperIdentityStability !== 'exact_source_helper_SHA256_and_CDHash_recorded_before_journal_creation_and_reverified_unchanged_before_each_phase_and_after_final_absence_proof'
    || result.runtimeLegacyRepairJournalSchemaVersion !== 'nimi.macos-local-development-partial-install-repair/v2'
    || !equalArray(result.runtimeLegacyRepairJournalPhases, ['prepared', 'artifacts-removed', 'user-removed', 'group-removed', 'principal-removed'])
    || result.runtimeLegacyRepairJournalOwnership !== 'parent_repair_journal_directly_owns_artifact_user_group_deletion_and_must_not_delegate_to_or_recover_a_principal_transaction_journal'
    || result.runtimeLegacyRepairJournalStagingRecovery !== 'fixed_single-use_staging_path_is_removed_only_inside_the_final-helper-mutation-lock_after_open-fd_regular_root-root_mode-0600-nlink-1-size-at-most-65536_and_same-device-inode-path_revalidation;_recovery_precedes_every_unknown-entry_or_phase-evaluation_gate_and_the_staging_path_is_never_semantic_authority'
    || result.runtimeLegacyRepairFreshBootstrapAbsenceReceipt !== 'fresh_exact_bootstrap_process_with_new_ODSession_must_prove_both_Directory_Services_records_and_POSIX_projection_absent_and_bind_the_parent_repair_transaction_source-helper_identity_residue-class_plan-and-policy'
    || !equalArray(result.runtimeKeychainAccounts, ['ledger-anchor-v1', 'ledger-record-hmac-v1'])
    || result.runtimeServiceMutationSerializationPolicy !== 'nonblocking_exclusive_flock_on_the_exact_open_root_owned_final_helper_vnode_spans_install_restart_reset_uninstall_release-record-signing_and_unprovision;_lock_contention_fails_before_mutation'
    || result.signingKeychainPasswordCommitPolicy !== 'bootstrap_signing_keychain_password_exists_in_memory_only_and_is_zeroized_after_transaction;_the_final_helper_must_be_locally_CA_signed_and_its_exact_cdhash_known_before_one_System_Keychain_generic_password_insert;_the_item_is_born_with_exact_final-helper-only_decrypt_delete_changeACL_and_partition_ACLs;_bootstrap_helper_never_reads_owns_or_deletes_the_durable_item;_a_fresh_final_signed_helper_process_must_reopen_and_validate_custody_without_interaction;_rollback_and_unprovision_first_verify_the_exact_final-helper_and_item_ACLs_then_delete_the_signing-Keychain_then_delete_the_exact_item_reference_and_prove_absence_before_removing_public_trust_or_unlinking_the_final-helper;_failure_preserves_the_final-helper_cleanup-record_and_public-trust-until_unlock-secret_deletion_is_proven'
    || result.signingUnprovisionRepairPolicy !== 'repair-only_for_the_exact_stranded_shape_public_profile_signing-Keychain_Runtime_Desktop_LaunchDaemon_service-account_and_related-processes_absent_plus_cleanup-record_v2_and_final-helper_and_unlock-secret_present;_the_immutable_bootstrap_may_extract_only_the_public_root_certificate_from_the_stranded_final-helper_embedded_chain_require_its_DER_SHA256_to_equal_the_cleanup-record_fingerprint_and_temporarily_restore_that_certificate_with_one_exact_Apple-CodeSigning_admin-trust_constraint;_the_bootstrap_must_verify_final-helper_fixed-path_strict-signature_empty-Team-ID_hardened-runtime_and_exact_unlock-secret_decrypt-changeACL-partition_binding_but_must_not_read_or_delete_the_secret;_the_stranded_final-helper_then_deletes_its_secret_and_all_repaired_public_trust_material;_any_mismatch_fails_closed_and_this_repair_is_forbidden_as_the_normal_unprovision_path'
    || result.bootstrapHelperPath !== '/usr/local/libexec/nimi-macos-dev-security-bootstrap'
    || result.signingACLIdentityDigestPolicy !== 'bootstrap_SHA-256_records_exact_opaque_SecTrustedApplication_data_for_final_helper_and_/usr/bin/codesign_in_root_owned_public_profile_v4;_fresh_processes_compare_persisted_ACL_entry_digests_to_profile_and_must_not_recreate_or_interpret_opaque_data;_finalizer_removes_only_the_exact_bootstrap_entry_from_the_helper-role_key_in_the_unlocked_signing_Keychain_and_preserves_the_final_entry_bytes;_all_five_role_private_keys_remain_inside_the_fixed_signing_Keychain;_System_Keychain_profile_private_keys_and_any_post-insert_SecKeychainItemSetAccess_on_System_items_are_forbidden'
    || result.signingHelperIdentityTransitionPolicy !== 'immutable_root_owned_linker_signed_bootstrap_at_/usr/local/libexec/nimi-macos-dev-security-bootstrap_runs_the_creation_transaction_while_an_equal-byte_nonexecuted_candidate_at_/usr/local/libexec/nimi-macos-dev-security_is_signed;_bootstrap_vnode_and_code_identity_must_remain_unchanged;_one_non-durable_P256_CA_private_key_exists_only_in_bootstrap_process_memory_and_never_enters_any_Keychain_or_projection;_bootstrap_uses_that_key_to_issue_the_local_CA_certificate_and_all_role_leaves;_the_helper-role_private_key_is_created_in_the_explicitly-unlocked_root-owned_signing_Keychain_with_bootstrap_owner_then_signs_the_distinct_final_helper;_after_final-helper_identity_is_verified_only_that_helper-role_key_may_hold_an_exact_bootstrap-plus-final_changeACL_transition_inside_the_password-unlocked_signing_Keychain;_the_record-signer_Runtime_Desktop_and_local-host_role_keys_are_created_once_inside_that_same_unlocked_signing_Keychain_with_final-helper-only_owner_restricted-and-partition_ACLs_and_are_never_mutated_after_insertion;_zero_profile_private_keys_are_admitted_in_System_Keychain;_the_System_Keychain_unlock-secret_item_is_born-final_and_never_mutated_after_insertion;_one_fresh_final_helper_closes_only_the_helper-role_transition_then_a_second_fresh_final_helper_proves_final-only_custody_absent_System_profile_private_keys_and_absent_durable_CA_private_key;_only_then_may_bootstrap_be_unlinked;_failure_before_unlock-secret_commit_uses_the_still-immutable_bootstrap_for_exact_rollback_while_failure_after_commit_must_preserve_and_execute_the_verified_final_helper_until_that_helper_deletes_its_unlock-secret;_success_requires_bootstrap_absent_zero_transitional_ACLs_zero_System_profile_private_keys_and_no_durable_CA_private_key'
    || result.unprovisionResidualIdentityClosure !== 'explicit_confirmed_unprovision_may_run_with_public_profile_or_cleanup_record_absent_but_a_present_signing-Keychain_unlock-secret_requires_the_exact_verified_final_helper_as_its_noninteractive_cleanup_anchor_and_that_helper_is_unlinked_last;_bootstrap_may_remove_only_public_or_fixed-path_residue_after_the_unlock-secret_is_proven_absent;_unlock-secret_present_with_missing_or_untrusted_final_helper_is_repair-required_and_requires_explicit_OS-authorized_break-glass_instead_of_root_or_API_bypass;_the_single_admitted_System_Keychain_profile_certificate_requires_public_profile_or_cleanup_record_exact_DER_SHA256;_zero_System_Keychain_profile_private_keys_are_admitted_and_any_root_CA_or_role_key_is_invalid_residue_removed_by_exact_label_application-tag_EC-P256_matching;_all_five_role_identities_are_removed_only_by_deleting_the_fixed_root-owned_signing_Keychain_as_one_custody_boundary;_success_requires_zero_fixed_profile_key_certificate_password_trust_bootstrap_helper_final_helper_profile_cleanup_record_or_signing_keychain_residue'
    || principalConstraints.password_authentication !== 'disabled'
    || principalConstraints.directory_service_hidden !== true
    || identity.macos_team_id !== 'exact_empty_required'
    || identity.macos_hardened_runtime_required !== true
    || identity.macos_notarization_required !== false
    || os.compile_time_profile_only !== true
    || os.production_verifier_contains_profile_root !== false) {
    throw new Error('macOS local-development authority no longer matches the admitted non-product compile-time profile');
  }
  return Object.freeze(result);
}

function renderGo(p) {
  return `//go:build darwin && nimi_macos_local_development

// Code generated from .nimi/spec protected-local macOS local-development
// authority tables; DO NOT EDIT outside the guarded profile generator.
package protectedlocal

const (
	MacOSRuntimeServiceLabel = ${q(p.runtimeServiceLabel)}
	MacOSRuntimeAccountName  = ${q(p.runtimeAccount)}

	MacOSRuntimeExecutablePath  = ${q(p.runtimeExecutablePath)}
	MacOSDesktopExecutablePath  = ${q(p.desktopExecutablePath)}
	MacOSDesktopApplicationPath = ${q(p.desktopApplicationPath)}
	MacOSLocalAppHostPath       = ${q(p.localAppHostPath)}
	MacOSRuntimeStateRoot       = ${q(p.runtimeStateRoot)}
	MacOSReleaseTrustRecordRoot = ${q(p.recordRoot)}
	MacOSKeychainService        = ${q(p.keychainService)}

	MacOSDesktopSocketActivationName  = ${q(p.desktopSocketActivationName)}
	MacOSLocalAppSocketActivationName = ${q(p.localAppSocketActivationName)}
	MacOSDesktopSocketPath            = ${q(p.desktopSocketPath)}
	MacOSLocalAppSocketPath           = ${q(p.localAppSocketPath)}

	MacOSRuntimeSigningIdentifier = ${q(p.runtimeSigningIdentifier)}
	MacOSDesktopSigningIdentifier = ${q(p.desktopSigningIdentifier)}
	MacOSLocalAppHostIdentifier   = ${q(p.localAppHostSigningIdentifier)}

	MacOSDesktopTrustSetID    = ${q(p.desktopTrustSetId)}
	MacOSRuntimeTrustSetID    = ${q(p.runtimeTrustSetId)}
	MacOSLocalAppHostTrustSet = ${q(p.localAppHostTrustSetId)}

	macOSProfileRequiresTrustedAnchor = false
	macOSProfileRequiresNotarization  = false
)

func validMacOSProfileTeamID(value string) bool {
	return value == ""
}

func validMacOSProfileLeafSPKI(value string) bool {
	return validLowerHex(value, 64)
}
`;
}

function renderRust(p) {
  return `// Code generated from .nimi/spec protected-local macOS local-development
// authority tables; DO NOT EDIT.

pub(crate) const RECORD_ROOT: &str =
    ${q(p.recordRoot)};
pub(crate) const ENVIRONMENT: &str = ${q(p.environment)};
pub(crate) const IDENTITY_CLASS: &str = ${q(p.identityClass)};
pub(crate) const SIGNATURE_ALGORITHM: &str = ${q(p.signatureAlgorithm)};
pub(crate) const SIGNER_POLICY_ID: &str = ${q(p.signerPolicyId)};
pub(crate) const RUNTIME_TRUST_SET_ID: &str = ${q(p.runtimeTrustSetId)};
pub(crate) const DESKTOP_TRUST_SET_ID: &str = ${q(p.desktopTrustSetId)};
pub(crate) const RUNTIME_SIGNING_IDENTIFIER: &str = ${q(p.runtimeSigningIdentifier)};
pub(crate) const DESKTOP_SIGNING_IDENTIFIER: &str = ${q(p.desktopSigningIdentifier)};
pub(crate) const RUNTIME_SERVICE_PRINCIPAL: &str = ${q(p.runtimeAccount)};
pub(crate) const RUNTIME_SOCKET_PATH: &str = ${q(p.desktopSocketPath)};
pub(crate) const LOCAL_APP_SOCKET_PATH: &str = ${q(p.localAppSocketPath)};
pub(crate) const RUNTIME_EXECUTABLE_PATH: &str =
    ${q(p.runtimeExecutablePath)};
pub(crate) const DESKTOP_APPLICATION_PATH: &str = ${q(p.desktopApplicationPath)};
pub(crate) const LOCAL_APP_HOST_PATH: &str = ${q(p.localAppHostPath)};
pub(crate) const REQUIRE_TRUSTED_ANCHOR: bool = false;
pub(crate) const REQUIRE_NOTARIZATION: bool = false;
pub(crate) const ROOT_KEY_ID: Option<&str> =
    option_env!("NIMI_MACOS_LOCAL_DEVELOPMENT_RELEASE_ROOT_KEY_ID");
pub(crate) const ROOT_PUBLIC_KEY_B64URL: Option<&str> =
    option_env!("NIMI_MACOS_LOCAL_DEVELOPMENT_RELEASE_ROOT_PUBLIC_KEY_B64URL");
`;
}

function renderHeader(p) {
  return `/* Code generated from .nimi/spec protected-local macOS local-development
 * authority tables; DO NOT EDIT. */
#define NIMI_MACOS_RUNTIME_ACCOUNT ${q(p.runtimeAccount)}
#define NIMI_MACOS_RUNTIME_SOCKET_DIRECTORY ${q(path.dirname(p.desktopSocketPath))}
#define NIMI_MACOS_RUNTIME_SOCKET ${q(p.desktopSocketPath)}
#define NIMI_MACOS_LOCAL_APP_SOCKET ${q(p.localAppSocketPath)}
#define NIMI_MACOS_RUNTIME_EXECUTABLE ${q(p.runtimeExecutablePath)}
#define NIMI_MACOS_DESKTOP_APPLICATION ${q(p.desktopApplicationPath)}
#define NIMI_MACOS_LOCAL_APP_HOST ${q(p.localAppHostPath)}
#define NIMI_MACOS_LAUNCHD_PLIST ${q(p.launchdDefinitionPath)}
#define NIMI_MACOS_SMAPP_PLIST ""
`;
}

function renderJavaScript(p) {
  return `// Code generated from .nimi/spec protected-local macOS local-development
// authority tables; DO NOT EDIT.
export const MACOS_LOCAL_DEVELOPMENT_PROFILE = Object.freeze(${JSON.stringify(p, null, 2)});
`;
}

function renderSwift(p, launchDaemonSHA256) {
  const runtimeRoot = path.posix.dirname(path.posix.dirname(path.posix.dirname(p.runtimeExecutablePath)));
  return `// Code generated from .nimi/spec protected-local macOS local-development
// authority tables; DO NOT EDIT.
let generatedRuntimeDevRoot = ${q(runtimeRoot)}
let generatedBootstrapHelperPath = ${q(p.bootstrapHelperPath)}
let generatedRuntimeExecutablePath = ${q(p.runtimeExecutablePath)}
let generatedRuntimeStateRoot = ${q(p.runtimeStateRoot)}
let generatedTrustRecordRoot = ${q(p.recordRoot)}
let generatedDesktopApplicationPath = ${q(p.desktopApplicationPath)}
let generatedDesktopExecutablePath = ${q(p.desktopExecutablePath)}
let generatedLocalAppHostPath = ${q(p.localAppHostPath)}
let generatedLaunchDaemonPath = ${q(p.launchdDefinitionPath)}
let generatedLaunchDaemonLabel = ${q(p.runtimeServiceLabel)}
let generatedLaunchDaemonSHA256 = ${q(launchDaemonSHA256)} // pragma: allowlist secret
let generatedRuntimeAccountName = ${q(p.runtimeAccount)}
let generatedRuntimePrincipalCarrierContractVersion = ${p.runtimePrincipalCarrierContractVersion}
let generatedRuntimeAccountUIDMinimum: UInt32 = ${p.runtimeAccountUIDMinimum}
let generatedRuntimeAccountUIDMaximum: UInt32 = ${p.runtimeAccountUIDMaximum}
let generatedRuntimePrincipalJournalPath = ${q(p.runtimePrincipalJournalPath)}
let generatedRuntimeServiceMutationSerializationPolicy = ${q(p.runtimeServiceMutationSerializationPolicy)}
let generatedRuntimeHomeDirectory = ${q(p.runtimeHomeDirectory)}
let generatedRuntimeLoginShell = ${q(p.runtimeLoginShell)}
let generatedRuntimePasswordRecordValue = ${q(p.runtimePasswordRecordValue)}
let generatedRuntimeDirectoryServiceHiddenRecordValue = ${q(p.runtimeDirectoryServiceHiddenRecordValue)}
let generatedRuntimeAuthenticationAuthorityPosture = ${q(p.runtimeAuthenticationAuthorityPosture)}
let generatedRuntimeForbiddenAuthenticationMaterialAttributes = [${p.runtimeForbiddenAuthenticationMaterialAttributes.map(q).join(', ')}]
let generatedRuntimeForbiddenDelegatedWriterAttributePrefix = ${q(p.runtimeForbiddenDelegatedWriterAttributePrefix)}
let generatedRuntimeForbiddenExplicitGroupMembershipAttributes = [${p.runtimeForbiddenExplicitGroupMembershipAttributes.map(q).join(', ')}]
let generatedRuntimeForbiddenExplicitGroupMembershipPolicy = ${q(p.runtimeForbiddenExplicitGroupMembershipPolicy)}
let generatedRuntimeNegativeAttributeValuePolicy = ${q(p.runtimeNegativeAttributeValuePolicy)}
let generatedRuntimeGeneratedUIDPolicy = ${q(p.runtimeGeneratedUIDPolicy)}
let generatedRuntimeDirectoryServiceAPI = ${q(p.runtimeDirectoryServiceAPI)}
let generatedRuntimeDirectoryServiceCommitPolicy = ${q(p.runtimeDirectoryServiceCommitPolicy)}
let generatedRuntimeDirectoryServiceRecoveryPolicy = ${q(p.runtimeDirectoryServiceRecoveryPolicy)}
let generatedRuntimeDirectoryServiceExistingIdentityPolicy = ${q(p.runtimeDirectoryServiceExistingIdentityPolicy)}
let generatedRuntimeInstallationJournalPath = ${q(p.runtimeInstallationJournalPath)}
let generatedRuntimeInstallationTransactionScope = ${q(p.runtimeInstallationTransactionScope)}
let generatedRuntimeInstallationRollbackOrder = ${q(p.runtimeInstallationRollbackOrder)}
let generatedRuntimeInstallationCommitBoundary = ${q(p.runtimeInstallationCommitBoundary)}
let generatedRuntimeUpdateAdmission = ${q(p.runtimeUpdateAdmission)}
let generatedRuntimePartialInstallRepairJournalPath = ${q(p.runtimePartialInstallRepairJournalPath)}
let generatedRuntimePartialInstallRepairJournalStagingPath = ${q(p.runtimePartialInstallRepairJournalStagingPath)}
let generatedRuntimePartialInstallRepairPolicy = ${q(p.runtimePartialInstallRepairPolicy)}
let generatedRuntimeSigningIdentifier = ${q(p.runtimeSigningIdentifier)}
let generatedDesktopSigningIdentifier = ${q(p.desktopSigningIdentifier)}
let generatedLocalAppHostSigningIdentifier = ${q(p.localAppHostSigningIdentifier)}
let generatedRuntimeTrustSetID = ${q(p.runtimeTrustSetId)}
let generatedDesktopTrustSetID = ${q(p.desktopTrustSetId)}
let generatedLocalAppHostTrustSetID = ${q(p.localAppHostTrustSetId)}
let generatedDesktopSocketPath = ${q(p.desktopSocketPath)}
let generatedLocalAppSocketPath = ${q(p.localAppSocketPath)}
let generatedKeychainService = ${q(p.keychainService)}
let generatedRuntimeKeychainAccounts = [${p.runtimeKeychainAccounts.map(q).join(', ')}]
let generatedRuntimeNormalRepairResidueClass = ${q(p.runtimeNormalRepairResidueClass)}
let generatedRuntimeNormalRepairDisposition = ${q(p.runtimeNormalRepairDisposition)}
let generatedRuntimeNormalRepairSourcePrincipalCarrierContractVersion = ${p.runtimeNormalRepairSourcePrincipalCarrierContractVersion}
let generatedRuntimeNormalRepairSourceHelperStatus = ${q(p.runtimeNormalRepairSourceHelperStatus)}
let generatedRuntimeNormalRepairAuthenticationAuthorityPosture = ${q(p.runtimeNormalRepairAuthenticationAuthorityPosture)}
let generatedRuntimeLegacyRepairResidueClass = ${q(p.runtimeLegacyRepairResidueClass)}
let generatedRuntimeLegacyRepairDisposition = ${q(p.runtimeLegacyRepairDisposition)}
let generatedRuntimeLegacyRepairSourcePrincipalCarrierContractVersion = ${p.runtimeLegacyRepairSourcePrincipalCarrierContractVersion}
let generatedRuntimeLegacyRepairSourceHelperStatus = ${q(p.runtimeLegacyRepairSourceHelperStatus)}
let generatedRuntimeLegacyRepairAuthenticationAuthorityAttribute = ${q(p.runtimeLegacyRepairAuthenticationAuthorityAttribute)}
let generatedRuntimeLegacyRepairAuthenticationAuthorityValueType = ${q(p.runtimeLegacyRepairAuthenticationAuthorityValueType)}
let generatedRuntimeLegacyRepairAuthenticationAuthorityExactValueCount = ${p.runtimeLegacyRepairAuthenticationAuthorityExactValueCount}
let generatedRuntimeLegacyRepairAuthenticationAuthorityExactValue = ${q(p.runtimeLegacyRepairAuthenticationAuthorityExactValue)}
let generatedRuntimeLegacyRepairOtherAuthenticationMaterialPosture = ${q(p.runtimeLegacyRepairOtherAuthenticationMaterialPosture)}
let generatedRuntimeLegacyRepairOtherAuthenticationMaterialAttributes = [${p.runtimeLegacyRepairOtherAuthenticationMaterialAttributes.map(q).join(', ')}]
let generatedRuntimeLegacyRepairPositivePrincipalFields = ${q(p.runtimeLegacyRepairPositivePrincipalFields)}
let generatedRuntimeLegacyRepairDedicatedGroupProjection = ${q(p.runtimeLegacyRepairDedicatedGroupProjection)}
let generatedRuntimeLegacyRepairPOSIXProjection = ${q(p.runtimeLegacyRepairPOSIXProjection)}
let generatedRuntimeLegacyRepairFullLocalGroupMembershipProjection = ${q(p.runtimeLegacyRepairFullLocalGroupMembershipProjection)}
let generatedRuntimeLegacyRepairDelegatedWriterProjection = ${q(p.runtimeLegacyRepairDelegatedWriterProjection)}
let generatedRuntimeLegacyRepairRecreateDisposition = ${q(p.runtimeLegacyRepairRecreateDisposition)}
let generatedRuntimeLegacyRepairNormalCurrentProfileDisposition = ${q(p.runtimeLegacyRepairNormalCurrentProfileDisposition)}
let generatedRuntimeLegacyRepairJournalAuthorityBindingRequiredFields = [${p.runtimeLegacyRepairJournalAuthorityBindingRequiredFields.map(q).join(', ')}]
let generatedRuntimeLegacyRepairSourceHelperIdentityStability = ${q(p.runtimeLegacyRepairSourceHelperIdentityStability)}
let generatedRuntimeLegacyRepairJournalSchemaVersion = ${q(p.runtimeLegacyRepairJournalSchemaVersion)}
let generatedRuntimeLegacyRepairJournalPhases = [${p.runtimeLegacyRepairJournalPhases.map(q).join(', ')}]
let generatedRuntimeLegacyRepairJournalOwnership = ${q(p.runtimeLegacyRepairJournalOwnership)}
let generatedRuntimeLegacyRepairJournalStagingRecovery = ${q(p.runtimeLegacyRepairJournalStagingRecovery)}
let generatedRuntimeLegacyRepairFreshBootstrapAbsenceReceipt = ${q(p.runtimeLegacyRepairFreshBootstrapAbsenceReceipt)}
let generatedSigningKeychainPath = ${q(p.signingKeychainPath)}
let generatedSigningACLIdentityDigestPolicy = ${q(p.signingACLIdentityDigestPolicy)}
let generatedSigningHelperIdentityTransitionPolicy = ${q(p.signingHelperIdentityTransitionPolicy)}
let generatedSigningKeychainPasswordCommitPolicy = ${q(p.signingKeychainPasswordCommitPolicy)}
let generatedSigningUnprovisionRepairPolicy = ${q(p.signingUnprovisionRepairPolicy)}
let generatedSigningKeychainPasswordService = ${q(p.signingKeychainPasswordService)}
let generatedSigningCleanupRecordPath = ${q(p.signingCleanupRecordPath)}
let generatedUnprovisionResidualIdentityClosure = ${q(p.unprovisionResidualIdentityClosure)}
let generatedSignerPolicyID = ${q(p.signerPolicyId)}
`;
}

function renderLaunchDaemon(p) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(p.runtimeServiceLabel)}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(p.runtimeExecutablePath)}</string><string>serve</string></array>
  <key>UserName</key><string>${xml(p.runtimeAccount)}</string>
  <key>GroupName</key><string>${xml(p.runtimeAccount)}</string>
  <key>InitGroups</key><false/>
  <key>Umask</key><integer>63</integer>
  <key>ProcessType</key><string>Standard</string>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ExitTimeOut</key><integer>20</integer>
  <key>AbandonProcessGroup</key><false/>
  <key>Sockets</key>
  <dict>
    <key>${xml(p.desktopSocketActivationName)}</key>
    <dict><key>SockPathName</key><string>${xml(p.desktopSocketPath)}</string><key>SockPathOwner</key><integer>0</integer><key>SockPathGroup</key><integer>20</integer><key>SockPathMode</key><integer>432</integer><key>SockType</key><string>stream</string></dict>
    <key>${xml(p.localAppSocketActivationName)}</key>
    <dict><key>SockPathName</key><string>${xml(p.localAppSocketPath)}</string><key>SockPathOwner</key><integer>0</integer><key>SockPathGroup</key><integer>20</integer><key>SockPathMode</key><integer>432</integer><key>SockType</key><string>stream</string></dict>
  </dict>
</dict>
</plist>
`;
}

function exactOne(values, predicate, label) {
  const matches = requiredArray(values, label).filter(predicate);
  if (matches.length !== 1) throw new Error(`${label} must have exactly one row`);
  return matches[0];
}
function requiredArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} is missing`);
  return value;
}
function equalArray(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}
function requiredObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is missing`);
  return value;
}
function requiredText(value, label) {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.includes('\0')) throw new Error(`${label} is invalid`);
  return value;
}
function requiredInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is invalid`);
  return value;
}
function requiredAbsolute(value, label) {
  const text = requiredText(value, label);
  if (!path.posix.isAbsolute(text) || path.posix.normalize(text) !== text) throw new Error(`${label} must be canonical and absolute`);
  return text;
}
function q(value) { return JSON.stringify(value); }
function sha256(value) { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function xml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
