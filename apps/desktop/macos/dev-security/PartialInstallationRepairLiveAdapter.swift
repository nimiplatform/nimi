import Foundation

func makeLivePartialInstallRepairOperations(
    parentCustodyProof: PartialInstallRepairParentCustodyProof,
    lockWitness: RuntimeServiceMutationLockWitness
) -> PartialInstallRepairOperations<PartialInstallRepairJournal, [String: Any]> {
    PartialInstallRepairOperations(
        observe: { evidence in
            let current = try readPartialInstallRepairJournal()
            let currentStatic = try requireCurrentPartialInstallRepairAuthority(
                current,
                lockWitness: lockWitness
            )
            try requirePartialInstallRepairParentCustodyProof(
                parentCustodyProof,
                journal: current,
                staticAuthority: currentStatic,
                lockWitness: lockWitness
            )
            try requireRuntimeKeychainCustodyAbsent()
            try requireRepairQuiescence(plan: current.plan)
            try validatePartialInstallRepairGlobalEnvelope(current)
            let immutableBinding = partialInstallRepairTerminalProofBinding(current)
            return PartialInstallRepairObservation(
                context: current,
                immutableJournalBindingSHA256: immutableBinding,
                snapshot: try observePartialInstallRepairTransitionSnapshot(
                    current,
                    cacheReset: evidence.cacheResetState(for: immutableBinding),
                    freshProof: evidence.freshProofState(for: immutableBinding)
                )
            )
        },
        removeExactArtifacts: { current in
            try removeRepairLaunchDaemonIfPresent()
            try removeEmptyRepairDirectoryIfPresent(
                runtimeStateRoot,
                owner: current.plan.identifier,
                group: current.plan.identifier,
                mode: 0o700
            )
            try removeEmptyRepairDirectoryIfPresent(
                runtimeTransactionRoot,
                owner: 0,
                group: 0,
                mode: 0o700
            )
            try removeEmptyRepairDirectoryIfPresent(
                runtimeRollbackRoot,
                owner: 0,
                group: 0,
                mode: 0o700
            )
            try removeEmptyRepairDirectoryIfPresent(
                repairSocketRoot(),
                owner: 0,
                group: 0,
                mode: 0o755
            )
        },
        writeJournalPhase: { current, phase in
            try updatePartialInstallRepairJournal(current, phase: phase.rawValue)
        },
        deleteExactUser: { current in
            try removePartialInstallRepairUser(current)
        },
        deleteExactGroup: { current in
            try removePartialInstallRepairGroup(current)
        },
        resetIdentityCache: { current in
            try resetRuntimeDirectoryIdentityCaches(phase: current.phase)
        },
        requestFreshProof: { current in
            try establishFreshPartialInstallRepairTerminalAbsence(current)
        },
        proveFinalTargetsAbsent: { _ in
            try proveRepairTargetsAbsent()
        },
        revalidateStaticAuthority: { current in
            let finalStatic = try requireCurrentPartialInstallRepairAuthority(
                current,
                lockWitness: lockWitness
            )
            try requirePartialInstallRepairParentCustodyProof(
                parentCustodyProof,
                journal: current,
                staticAuthority: finalStatic,
                lockWitness: lockWitness
            )
        },
        removeJournal: { current in
            try removePartialInstallRepairJournal(expected: current)
        },
        makeSuccessReceipt: { current in
            try makePartialInstallRepairSuccessReceipt(
                disposition: "residue-removed",
                serviceName: launchDaemonLabel,
                removed: [
                    "partial_launchd_definition", "empty_install_directories",
                    "exact_runtime_principal",
                ],
                sourcePrincipalCarrierContractVersion:
                    current.sourcePrincipalCarrierContractVersion,
                requiredInstallPrincipalCarrierContractVersion:
                    runtimePrincipalCarrierContractVersion
            )
        },
        transitionFailure: { current, snapshot, reason in
            partialInstallRepairTransitionFailure(
                reason,
                journal: current,
                snapshot: snapshot
            )
        },
        transitionBudgetFailure: {
            repairFailure(
                "The partial-install repair state machine exceeded its bounded monotonic transition budget."
            )
        }
    )
}
