import Foundation

struct PartialInstallRepairAuthority {
    let rootKeyId: String
    let sourceHelperSHA256: String
    let sourceHelperCDHash: String
    let sourcePrincipalCarrierContractVersion: Int
    let policyDigest: String
}

func requireNoPartialInstallRepairInProgress() throws {
    guard try !repairPathPresent(runtimePartialInstallRepairJournalPath) else {
        throw repairFailure("A partial-install repair journal is active; normal install, lifecycle, and trust removal mutations are forbidden until exact repair completes.")
    }
}

func repairExactPartialRuntimeInstallation(
    lockWitness: RuntimeServiceMutationLockWitness
) throws -> PartialInstallRepairPreparedCompletion<PartialInstallRepairJournal, [String: Any]> {
    guard runtimeLegacyRepairJournalSchemaVersion == "nimi.macos-local-development-partial-install-repair/v2",
          runtimeLegacyRepairJournalPhases == [
              "prepared", "artifacts-removed", "user-removed", "group-removed", "principal-removed",
          ],
          runtimeLegacyRepairJournalOwnership == "parent_repair_journal_directly_owns_artifact_user_group_deletion_and_must_not_delegate_to_or_recover_a_principal_transaction_journal",
          runtimeLegacyRepairTerminalCommitPolicy == "executor-prepares-the-exact-success-receipt-while-the-principal-removed-journal-remains-durable;_outer-final-helper-vnode-and-static-code-proof_then-bootstrap-self-retirement-must-complete-while-that-journal-still-exists;_a-second-final-helper-proof-immediately-precedes-one-exact-journal-unlink-as-the-last-semantic-effect;_any-proof-retirement-or-unlink-failure-preserves-a-journal-or-reaches-the-independent-clean-no-journal-boundary_and-never-emits-repair-success;_no-post-unlink-authority-check-may-turn-a-committed-repair-into-an-unrecoverable-failure",
          runtimeLegacyRepairJournalStagingRecovery == "fixed_single-use_staging_path_is_removed_only_inside_the_final-helper-mutation-lock_after_open-fd_regular_root-root_mode-0600-nlink-1-size-at-most-65536_and_same-device-inode-path_revalidation;_recovery_precedes_every_unknown-entry_or_phase-evaluation_gate_and_the_staging_path_is_never_semantic_authority",
          runtimeLegacyRepairJournalAuthorityBindingRequiredFields == [
              "source_helper_sha256", "source_helper_cdhash", "source_principal_carrier_contract_version",
              "residue_class", "authentication_evidence_sha256", "plan_digest", "user_generated_uid",
              "group_generated_uid", "root_key_id", "policy_digest",
          ],
          runtimeLegacyRepairSourceHelperIdentityStability == "source_status_is_read_once_only_for_one_complete_unjournaled_principal_baseline_before_initial_journal_creation;_clean_partial_or-conflicting_unjournaled-state_never-invokes-status;_an-active-journal_revalidates_the_exact-final-helper_open-vnode-that-matches-the-transaction-lock-device/inode/size/mtime/ctime/flags/SHA256_CDHash_identifier_empty-Team-ID_exact-certificate-requirement_leaf-and-root-certificate-digests_hardened-runtime_signing-profile-root-and-policy_in-process_without-invoking-status_codesign-or-any-final-helper-command;_the-lock-opened-vnode-and-named-path_are-revalidated-before-terminal-commit;_DELETE/WRITE/EXTEND/LINK/RENAME/REVOKE_or_EV_ERROR/EV_EOF_are-hard-rejected-with-exact-event-flags;_NOTE_ATTRIB_is-not-path-replacement-by-itself_and-is-accepted-only-when_device/inode/mode/uid/gid/nlink/size/mtime/ctime/flags_and-opened-vnode-SHA256_remain-exact_and-the-full-static-code-identity-is-revalidated;_atime-is-observer-mutable-and-never-authority;_the-same-static-identity-is-reverified-before-each-phase_after-final-absence-proof_and-at-the-terminal-commit-boundary",
          runtimeLegacyRepairInvocationDeadline == "root_repair_helper_owns_one_hard_600-second_deadline;_every_child_has_a_shorter_bounded_timeout_and_must_fit_inside_the_remaining_outer_budget;_direct-child_commands_atomically_reserve_one_launch-slot_before_Process.run_and_bind_the_child_PID_before_input_or-wait;_bootstrap-owned_process-group_commands_use_posix_spawn_with_POSIX_SPAWN_SETPGROUP_and_POSIX_SPAWN_CLOEXEC_DEFAULT_while_the_deadline-lock-is-held_so_a-successful-spawn-and-PID/PGID-binding-are-one-atomic-transition;_an-expired-repair-invocation_fails-before-the-next-spawn;_timeout-or-output-overflow_signals-the-whole-owned-PGID_TERM-then-KILL_reaps-the-direct-child_drains-both-pipes-to-EOF_and-requires-kill-minus-PGID-zero-to-return-ESRCH_before-child_reaped-true;_any-unbound-or-unreaped-state_is-quiescence-unproven_and-forbids-wrapper-cleanup;_the_Node-launcher_never-times-out-sudo_or-cleans-up-before-sudo-has-observed-the-root-helper-exit;_deadline-termination_preserves-the-exact-journal-for-effect-ahead-recovery",
          runtimeLegacyRepairFailureEvidence == "one_sanitized_non-authoritative_local_JSON_record_under_.nimi/local/acceptance_is_written_after-the_privileged_helper_has_exited;_it-preserves-every-authority-admitted_non-sensitive_diagnostic-field_plus-bounded-subprocess-status_and-never-persists-stderr_Keychain-material_tokens_or-private-keys;_vnode-diagnostics-preserve-exact-event-flags-and-names_lock-device/inode/SHA256_before/after-ctime_journal-phase/presence_completion/bootstrap-state_and-primary-failure-identity;_missing-structured-JSON_or-missing-explicit-child_reaped-true_preserves-the-exact-bootstrap;_only-explicit-child_reaped-true-permits-exact-bootstrap-cleanup;_one-failure-stops-automatic-retry",
          runtimeLegacyRepairPostRepairCarrierDisposition == "repair_preserves_the_source_final_helper;_when_its_source_carrier_is_not_current_carrier_4_Runtime_install_remains_fail-closed_until_a_separately_confirmed_trust-helper_rotation_reprovisions_and_proves_one_current_signed_helper;_delete-only_repair_success_is_not_install-readiness",
          runtimeLegacyRepairParentPrivateCustodyProof == "fixed_non-semantic_staging-vnode_recovery_runs_under_the_locked_in-process_static-helper-authority_before_journal-presence_or-OD-classification_and_does-not-authorize-any-platform-mutation;_exact-clean_no-journal_returns_before_private-custody;_an_active-or-newly-committed_prepared-journal_then_obtains_one_fresh_exact_final-helper_private-custody-receipt_before_the_first_artifact-or-principal-effect_in_each-invocation;_the_receipt_is_invocation-local_and_bound-in-memory_to_the_exact-journal-terminal-proof-binding_helper-SHA256_CDHash_root-key_policy_mutation-lock-vnode_and-parent-PID/start-identity;_a_crash_restart_authority-change_parent-change_or-binding-change_invalidates-it_and_requires-a-new-parent-proof",
          runtimeLegacyRepairParentFinalHelperProcessTreePolicy == "the_parent_uses_posix_spawn-with-POSIX_SPAWN_SETPGROUP_to-establish-a-new-process-group-atomically-before-any-current-bootstrap-instruction-can-run;_the-bootstrap-requires-getpgrp-equals-getpid_and-never-execs-on-mismatch;_the-parent-deadline_owns-that-PGID_signals-the-entire-group-on-timeout-or-output-overflow_reaps-the-direct-child_drains-both-pipes-to-EOF_and-proves-the-PGID-empty-before-child-reaped-true;_this-contains-descendants-of-the-immutable-legacy-helper_without-trusting-their-implementation",
          runtimeLegacyRepairFreshBootstrapNestedProcessPolicy == "after_exact_bootstrap_context_entry_the_fresh_absence_verifier_spawns_zero_descendants;_the_parent_brackets_it_with_bounded_quiescence_proofs_before_launch_and_after_the_parent-bound_receipt_before_any_phase-commit_or-success",
          runtimeLegacyRepairCleanNoJournalDisposition == "exact_clean_state_without_a_v2_repair-journal_is_not_a_repair-success-and_returns_macos-dev-runtime-repair-not-required_before_cache-reset_principal_or-artifact_mutation;_it_never_invokes_source-helper-status_never_invents_source-carrier-or-install-readiness_and_requires_separate_trust-helper-verification-or-rotation_before-install" else {
        throw repairFailure("The authority-derived partial-install repair policy is invalid.")
    }
    let invocationStaticAuthority = try currentPartialInstallRepairStaticAuthority(
        lockWitness: lockWitness
    )
    // The fixed staging vnode is non-semantic crash residue. Recover it under
    // the locked static helper authority before any journal/OD classification.
    try recoverInterruptedPartialInstallRepairJournalWrite()
    try requireRuntimeKeychainCustodyAbsent()

    let journalPresent = try repairPathPresent(runtimePartialInstallRepairJournalPath)
    let entryObservation: PartialInstallRepairEntryObservation
    if journalPresent {
        entryObservation = .activeJournal
    } else if try exactRepairTerminalStateIsClean() {
        entryObservation = .cleanNoJournal
    } else {
        entryObservation = .unjournaledResidue
    }
    var parentCustodyProof: PartialInstallRepairParentCustodyProof?
    try preparePartialInstallRepairEntry(
        observation: entryObservation,
        resumeActiveJournal: {
            let existingJournal = try readPartialInstallRepairJournal()
            let currentStatic = try requireCurrentPartialInstallRepairAuthority(
                existingJournal,
                lockWitness: lockWitness
            )
            try requireRepairQuiescence(plan: existingJournal.plan)
            let proof = try establishPartialInstallRepairParentCustodyProof(
                staticAuthority: currentStatic,
                journal: existingJournal,
                lockWitness: lockWitness
            )
            try requirePartialInstallRepairParentCustodyProof(
                proof,
                journal: existingJournal,
                staticAuthority: currentStatic,
                lockWitness: lockWitness
            )
            parentCustodyProof = proof
        },
        requireCompleteUnjournaledBaseline: {
            let witness = try requireSourceStatusEligibleExactRepairResidue()
            try requireRepairQuiescence(plan: witness.plan)
            return witness
        },
        requestSourceStatus: {
            try currentPartialInstallRepairAuthorityFromSourceStatus(
                lockWitness: lockWitness
            )
        },
        establishJournal: { witness, authority in
            guard witness.residueClass.sourcePrincipalCarrierContractVersion
                      == authority.sourcePrincipalCarrierContractVersion,
                  authority.rootKeyId == invocationStaticAuthority.rootKeyId,
                  authority.sourceHelperSHA256 == invocationStaticAuthority.sourceHelperSHA256,
                  authority.sourceHelperCDHash == invocationStaticAuthority.sourceHelperCDHash,
                  authority.policyDigest == invocationStaticAuthority.policyDigest else {
                throw principalDiagnosticFailure(
                    "runtime-principal-journal-invalid",
                    "inspect the exact pre-journal source authority binding",
                    "The source status, raw residue class, and parent static authority diverged.",
                    details: [
                        "phase": "repair-authority",
                        "probe": "pre-journal-authority-binding",
                        "state": "mismatch",
                        "verifier_pid": getpid(),
                    ]
                )
            }
            let newJournal = PartialInstallRepairJournal(
                schemaVersion: runtimeLegacyRepairJournalSchemaVersion,
                transactionID: UUID().uuidString.lowercased(),
                phase: "prepared",
                accountName: runtimeAccountName,
                identifier: witness.plan.identifier,
                groupGeneratedUID: witness.plan.groupGeneratedUID,
                userGeneratedUID: witness.plan.userGeneratedUID,
                sourceHelperSHA256: authority.sourceHelperSHA256,
                sourceHelperCDHash: authority.sourceHelperCDHash,
                sourcePrincipalCarrierContractVersion:
                    authority.sourcePrincipalCarrierContractVersion,
                residueClass: witness.residueClass.rawValue,
                authenticationEvidenceSHA256: witness.authenticationEvidenceSHA256,
                planDigest: partialInstallRepairPlanDigest(witness.plan),
                rootKeyId: authority.rootKeyId,
                policyDigest: authority.policyDigest
            )
            try writePartialInstallRepairJournal(newJournal)
            let committedJournal = try readPartialInstallRepairJournal()
            guard committedJournal == newJournal else {
                throw principalDiagnosticFailure(
                    "runtime-principal-journal-invalid",
                    "inspect the exact committed prepared repair journal",
                    "The committed prepared journal differs from its complete in-memory authority witness.",
                    details: [
                        "phase": "prepared",
                        "probe": "initial-journal-readback",
                        "state": "mismatch",
                        "projection_sha256": partialInstallRepairTerminalProofBinding(committedJournal),
                        "verifier_pid": getpid(),
                    ]
                )
            }
            let committedStatic = try requireCurrentPartialInstallRepairAuthority(
                committedJournal,
                lockWitness: lockWitness
            )
            let proof = try establishPartialInstallRepairParentCustodyProof(
                staticAuthority: committedStatic,
                journal: committedJournal,
                lockWitness: lockWitness
            )
            try requirePartialInstallRepairParentCustodyProof(
                proof,
                journal: committedJournal,
                staticAuthority: committedStatic,
                lockWitness: lockWitness
            )
            parentCustodyProof = proof
        },
        cleanNoJournalFailure: {
            partialInstallRepairNotRequiredFailure()
        }
    )

    guard let parentCustodyProof else {
        throw principalDiagnosticFailure(
            "runtime-principal-journal-invalid",
            "restart the exact journal-bound repair bootstrap",
            "The repair entry did not establish one invocation-local journal-bound custody proof.",
            details: [
                "phase": "repair-authority",
                "probe": "parent-private-custody-binding",
                "state": "absent",
                "verifier_pid": getpid(),
                "child_reaped": true,
            ]
        )
    }
    return try executePartialInstallRepair(
        operations: makeLivePartialInstallRepairOperations(
            parentCustodyProof: parentCustodyProof,
            lockWitness: lockWitness
        )
    )
}

private func partialInstallRepairNotRequiredFailure() -> DevSecurityFailure {
    fail(
        "macos-dev-runtime-repair-not-required",
        "verify_or_rotate_the_preserved_trust_helper_before_install",
        "The machine is already at an exact clean no-journal boundary; delete-only repair is not applicable and no source carrier was inferred.",
        details: [
            "phase": "no-journal-clean",
            "probe": "repair-applicability",
            "state": "not-required",
            "verifier_pid": getpid(),
            "child_reaped": true,
        ]
    )
}

func partialInstallRepairWitness(
    _ journal: PartialInstallRepairJournal
) throws -> RuntimeAccountRepairWitness {
    guard let residueClass = RuntimeAccountRepairResidueClass(rawValue: journal.residueClass),
          residueClass.sourcePrincipalCarrierContractVersion
              == journal.sourcePrincipalCarrierContractVersion else {
        throw repairFailure("The partial-install repair journal residue class and source carrier diverge.")
    }
    return RuntimeAccountRepairWitness(
        residueClass: residueClass,
        plan: journal.plan,
        authenticationEvidenceSHA256: journal.authenticationEvidenceSHA256
    )
}

func repairResidueClass(
    for sourcePrincipalCarrierContractVersion: Int
) -> RuntimeAccountRepairResidueClass? {
    switch sourcePrincipalCarrierContractVersion {
    case runtimeNormalRepairSourcePrincipalCarrierContractVersion:
        return RuntimeAccountRepairResidueClass(rawValue: runtimeNormalRepairResidueClass)
    case runtimeLegacyRepairSourcePrincipalCarrierContractVersion:
        return RuntimeAccountRepairResidueClass(rawValue: runtimeLegacyRepairResidueClass)
    default:
        return nil
    }
}

func partialInstallRepairPlanDigest(_ plan: RuntimeAccountCreationPlan) -> String {
    sha256(Data([
        "nimi.macos-local-development-partial-install-plan/v1",
        runtimeAccountName,
        String(plan.identifier),
        plan.groupGeneratedUID,
        plan.userGeneratedUID,
    ].joined(separator: "\u{0}").utf8))
}
