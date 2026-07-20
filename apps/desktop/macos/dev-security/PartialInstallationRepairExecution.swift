import Darwin
import Foundation
import OpenDirectory

func observePartialInstallRepairTransitionSnapshot(
    _ journal: PartialInstallRepairJournal,
    cacheReset: PartialInstallRepairCacheResetState,
    freshProof: PartialInstallRepairFreshProofState
) throws -> PartialInstallRepairTransitionSnapshot {
    guard let phase = PartialInstallRepairPhase(rawValue: journal.phase) else {
        throw principalDiagnosticFailure(
            "runtime-principal-journal-invalid",
            "inspect the exact partial-install repair journal phase",
            "The partial-install repair journal phase is not admitted.",
            details: [
                "phase": "unrecognized",
                "probe": "repair-transition-phase",
                "state": "unadmitted",
                "verifier_pid": getpid(),
            ]
        )
    }
    let artifactTargets = [
        launchDaemonPath,
        runtimeStateRoot,
        runtimeTransactionRoot,
        runtimeRollbackRoot,
        try repairSocketRoot(),
    ]
    let artifacts: PartialInstallRepairArtifactState = try artifactTargets.contains {
        try repairPathPresent($0)
    } ? .exactResiduePresent : .absent

    // This phase intentionally uses raw OpenDirectory name and identifier
    // projections only. Calling libc passwd/group lookup before deletion would
    // warm Directory Services caches and invalidate the delete-only repair proof.
    let store = try OpenDirectoryRuntimeAccountStore()
    let witness = try partialInstallRepairWitness(journal)
    let userByName = try store.observe(.user)
    let userByIdentifier = try store.observeByIdentifier(.user, identifier: journal.identifier)
    let groupByName = try store.observe(.group)
    let groupByIdentifier = try store.observeByIdentifier(.group, identifier: journal.identifier)
    let userState = partialInstallRepairRecordState(
        kind: .user,
        byName: userByName,
        byIdentifier: userByIdentifier,
        witness: witness
    )
    let groupState = partialInstallRepairRecordState(
        kind: .group,
        byName: groupByName,
        byIdentifier: groupByIdentifier,
        witness: witness
    )
    try store.proveNoExplicitGroupMembership(journal.plan)
    return PartialInstallRepairTransitionSnapshot(
        journalPhase: phase,
        artifacts: artifacts,
        userRecord: userState,
        groupRecord: groupState,
        cacheReset: cacheReset,
        freshProof: freshProof
    )
}

private func partialInstallRepairRecordState(
    kind: RuntimeDirectoryRecordKind,
    byName: RuntimeDirectoryRecord?,
    byIdentifier: RuntimeDirectoryRecord?,
    witness: RuntimeAccountRepairWitness
) -> PartialInstallRepairRecordState {
    if byName == nil, byIdentifier == nil { return .absent }
    guard let byName, let byIdentifier,
          byName.kind == kind, byIdentifier.kind == kind,
          runtimeDirectoryRecord(byName, matches: witness),
          runtimeDirectoryRecord(byIdentifier, matches: witness),
          byName.one(kODAttributeTypeGUID) == byIdentifier.one(kODAttributeTypeGUID) else {
        return .conflicting
    }
    return .exactPresent
}

func partialInstallRepairTransitionFailure(
    _ reason: PartialInstallRepairTransitionFailure,
    journal: PartialInstallRepairJournal,
    snapshot: PartialInstallRepairTransitionSnapshot
) -> DevSecurityFailure {
    principalDiagnosticFailure(
        "runtime-principal-journal-invalid",
        "inspect the exact repair transition evidence before retrying repair",
        "The partial-install repair state does not permit the journal's next transition.",
        details: [
            "phase": journal.phase,
            "probe": "repair-transition",
            "state": reason.rawValue,
            "expected_identifier": journal.identifier,
            "projection_sha256": partialInstallRepairSnapshotDigest(snapshot),
            "verifier_pid": getpid(),
        ]
    )
}

private func partialInstallRepairSnapshotDigest(
    _ snapshot: PartialInstallRepairTransitionSnapshot
) -> String {
    sha256(Data([
        snapshot.journalPhase?.rawValue ?? "zero-residue",
        String(describing: snapshot.artifacts),
        String(describing: snapshot.userRecord),
        String(describing: snapshot.groupRecord),
        String(describing: snapshot.cacheReset),
        String(describing: snapshot.freshProof),
        String(describing: snapshot.authority),
        String(describing: snapshot.globalEnvelope),
    ].joined(separator: "\u{0}").utf8))
}

func partialInstallRepairTerminalProofBinding(
    _ journal: PartialInstallRepairJournal
) -> String {
    sha256(Data([
        "nimi.macos-local-development-partial-install-terminal-proof/v1",
        journal.schemaVersion,
        journal.transactionID,
        journal.accountName,
        String(journal.identifier),
        journal.groupGeneratedUID,
        journal.userGeneratedUID,
        journal.sourceHelperSHA256,
        journal.sourceHelperCDHash,
        String(journal.sourcePrincipalCarrierContractVersion),
        journal.residueClass,
        journal.authenticationEvidenceSHA256,
        journal.planDigest,
        journal.rootKeyId,
        journal.policyDigest,
    ].joined(separator: "\u{0}").utf8))
}

func establishFreshPartialInstallRepairTerminalAbsence(
    _ journal: PartialInstallRepairJournal
) throws {
    let parentBefore = try requireRepairParentSelfWitness()
    let result = try runPartialInstallRepairFreshVerifier(
        command: "verify-partial-install-repair-principal-removal",
        phase: journal.phase
    )
    let parentAfter = try requireRepairParentSelfWitness()
    guard parentAfter == parentBefore else {
        throw principalDiagnosticFailure(
            "process-replaced",
            "restart the exact journal-bound repair parent",
            "The repair parent process changed while waiting for the fresh verifier.",
            details: [
                "phase": journal.phase,
                "probe": "fresh-parent-process",
                "state": "changed-during-child-proof",
                "verifier_pid": getpid(),
            ]
        )
    }
    try validateFreshPartialInstallRepairAbsenceReceipt(
        result,
        journal: journal,
        parentWitness: parentAfter
    )
    try requireRepairQuiescence(plan: journal.plan)
    try requireCurrentPartialInstallRepairAuthority(journal)
}

private func runPartialInstallRepairFreshVerifier(
    command: String,
    phase: String
) throws -> CommandResult {
    do {
        return try runFixedCommand(
            bootstrapHelperInstallPath,
            [command],
            timeoutSeconds: 30,
            processTreePolicy: .bootstrapOwnedProcessGroup
        )
    } catch let failure as DevSecurityFailure {
        if runtimePrincipalDiagnosticReasonCodes.contains(failure.reasonCode) {
            throw failure
        }
        let base: [String: Any] = [
            "phase": phase,
            "probe": command,
            "state": "subprocess-failed",
            "verifier_pid": getpid(),
        ]
        let details = principalSubprocessFailureDetails(base, failure: failure)
        throw principalDiagnosticFailure(
            "runtime-principal-fresh-proof-invalid",
            "inspect the exact fresh-bootstrap verifier failure",
            "The fresh-bootstrap absence verifier did not complete successfully.",
            details: details
        )
    }
}

func requireRepairParentSelfWitness() throws -> RepairProcessWitness {
    let witness = try readRepairProcessWitness(getpid())
    guard witness.realUID == 0,
          witness.effectiveUID == 0,
          witness.savedUID == 0,
          witness.executablePath == bootstrapHelperInstallPath else {
        throw principalDiagnosticFailure(
            "process-replaced",
            "restart the exact root repair bootstrap",
            "The repair parent is not the exact root bootstrap process.",
            details: [
                "phase": "repair-invocation",
                "probe": "repair-parent-process",
                "state": "identity-mismatch",
                "verifier_pid": getpid(),
            ]
        )
    }
    return witness
}
