import Darwin
import Foundation

func requireExactRepairResidue(
    authority: PartialInstallRepairAuthority
) throws -> RuntimeAccountRepairWitness {
    let witness = try requireSourceStatusEligibleExactRepairResidue()
    guard witness.residueClass.sourcePrincipalCarrierContractVersion
        == authority.sourcePrincipalCarrierContractVersion else {
        throw principalDiagnosticFailure(
            "runtime-principal-journal-invalid",
            "inspect the exact source-helper carrier receipt before repair",
            "The source helper carrier does not match the raw exact repair residue class.",
            details: [
                "phase": "repair-authority",
                "probe": "source-carrier-residue-class",
                "state": "mismatch",
                "verifier_pid": getpid(),
            ]
        )
    }
    return witness
}

func requireSourceStatusEligibleExactRepairResidue() throws -> RuntimeAccountRepairWitness {
    try requireNoUnknownRuntimeDevEntries()
    let forbidden = try [
        runtimeActiveRoot,
        runtimeExecutablePath,
        desktopApplicationPath,
        "\(runtimeDevRoot)/installer-ledger.json",
        installationJournalPath,
        runtimePrincipalJournalPath,
        generatedDesktopSocketPath,
        generatedLocalAppSocketPath,
    ].filter { try repairPathPresent($0) }
    guard forbidden.isEmpty else {
        throw repairFailure("The machine contains payload, socket, custody, or transaction state outside the exact repair-only shape: \(forbidden.joined(separator: ", ")).")
    }
    try verifyInstalledLaunchDaemonDefinition()
    let store = try OpenDirectoryRuntimeAccountStore()
    guard let user = try store.observe(.user), let group = try store.observe(.group) else {
        throw repairFailure("The exact repair baseline requires one complete Runtime service user and group.")
    }
    let candidates = [
        diagnoseCurrentV4RuntimeAccountRepairResidue(user: user, group: group),
        diagnoseLegacyV2RuntimeAccountRepairResidue(user: user, group: group),
    ]
    let admitted = candidates.enumerated().compactMap { index, diagnosis -> RuntimeAccountRepairWitness? in
        guard diagnosis.matchesDeleteOnlyResidue, let plan = diagnosis.plan else { return nil }
        return RuntimeAccountRepairWitness(
            residueClass: index == 0 ? .currentV4Exact : .legacyV2DisabledUser,
            plan: plan,
            authenticationEvidenceSHA256: diagnosis.authenticationEvidenceSHA256
        )
    }
    guard admitted.count == 1, let witness = admitted.first,
          runtimeDirectoryRecord(user, matches: witness),
          runtimeDirectoryRecord(group, matches: witness) else {
        throw principalDiagnosticFailure(
            "runtime-principal-journal-invalid",
            "inspect the complete raw Runtime principal before source status",
            "The unjournaled principal is not one unambiguous admitted delete-only residue class.",
            details: [
                "phase": "repair-authority",
                "probe": "pre-status-raw-residue-class",
                "state": admitted.isEmpty ? "unadmitted" : "ambiguous",
                "verifier_pid": getpid(),
            ]
        )
    }
    try store.proveNoExplicitGroupMembership(witness.plan)
    _ = try validateRuntimeAccountPOSIXProjection(witness.plan)
    try requireEmptyRepairDirectory(runtimeStateRoot, owner: witness.plan.identifier, group: witness.plan.identifier, mode: 0o700)
    try requireEmptyRepairDirectory(runtimeTransactionRoot, owner: 0, group: 0, mode: 0o700)
    try requireEmptyRepairDirectory(runtimeRollbackRoot, owner: 0, group: 0, mode: 0o700)
    try requireEmptyRepairDirectory(repairSocketRoot(), owner: 0, group: 0, mode: 0o755)
    return witness
}

func requireRepairQuiescence(plan: RuntimeAccountCreationPlan?) throws {
    let launchd = try inspectLaunchdRuntimeState()
    guard !launchd.loaded, !launchd.running, launchd.pid == nil,
          try !developmentProcessesRunning(),
          try !repairBoundProcessesRunning(plan: plan) else {
        throw repairFailure("The repair-only transaction requires the launchd job and all Nimi development processes to be absent.")
    }
}

private func repairBoundProcessesRunning(plan: RuntimeAccountCreationPlan?) throws -> Bool {
    let result = try runFixedCommand(
        "/bin/ps",
        ["-axo", "pid=,ruid=,uid=,svuid=,comm="],
        captureLimit: 8 * 1024 * 1024,
        timeoutSeconds: 30
    )
    guard let output = String(data: result.stdout, encoding: .utf8) else {
        throw repairFailure("The process table is not valid UTF-8.")
    }
    let fixedExecutables = Set([
        runtimeExecutablePath,
        "\(desktopApplicationPath)/Contents/MacOS/Nimi Dev",
        "\(desktopApplicationPath)/Contents/Frameworks/Nimi Local App Host Dev.app/Contents/MacOS/Nimi Local App Host Dev",
    ])
    for line in output.split(separator: "\n", omittingEmptySubsequences: true) {
        let fields = line.split(maxSplits: 4, omittingEmptySubsequences: true, whereSeparator: { $0.isWhitespace })
        guard fields.count == 5,
              let pid = Int32(fields[0]),
              let realUID = UInt32(fields[1]),
              let effectiveUID = UInt32(fields[2]),
              let savedUID = UInt32(fields[3]),
              pid > 0 else {
            throw repairFailure("The process table contains an unrecognized row; quiescence cannot be proven.")
        }
        let executable = String(fields[4])
        if fixedExecutables.contains(executable) { return true }
        if let plan, [realUID, effectiveUID, savedUID].contains(plan.identifier) { return true }
    }
    return false
}

func validatePartialInstallRepairGlobalEnvelope(_ journal: PartialInstallRepairJournal) throws {
    try requireNoUnknownRuntimeDevEntries()
    guard try !repairPathPresent(runtimePrincipalJournalPath) else {
        throw repairFailure("The normal Runtime principal transaction journal must remain absent throughout partial-install repair.")
    }
    let forbiddenPayloads = [
        runtimeActiveRoot,
        runtimeExecutablePath,
        desktopApplicationPath,
        "\(runtimeDevRoot)/installer-ledger.json",
        installationJournalPath,
        runtimePrincipalJournalPath,
        generatedDesktopSocketPath,
        generatedLocalAppSocketPath,
    ]
    let presentPayloads = try forbiddenPayloads.filter { try repairPathPresent($0) }
    guard presentPayloads.isEmpty else {
        throw repairFailure("A payload, socket, or normal installation transaction appeared during partial-install repair: \(presentPayloads.joined(separator: ", ")).")
    }
    switch journal.phase {
    case "prepared":
        try verifyOptionalRepairLaunchDaemon()
        try verifyOptionalEmptyRepairDirectory(runtimeStateRoot, owner: journal.identifier, group: journal.identifier, mode: 0o700)
        try verifyOptionalEmptyRepairDirectory(runtimeTransactionRoot, owner: 0, group: 0, mode: 0o700)
        try verifyOptionalEmptyRepairDirectory(runtimeRollbackRoot, owner: 0, group: 0, mode: 0o700)
        try verifyOptionalEmptyRepairDirectory(repairSocketRoot(), owner: 0, group: 0, mode: 0o755)
    case "artifacts-removed", "user-removed", "group-removed", "principal-removed":
        try requireRepairOwnedArtifactsAbsent()
    default:
        throw repairFailure("The partial-install repair journal phase is not admitted.")
    }
}

func removePartialInstallRepairUser(_ journal: PartialInstallRepairJournal) throws {
    let store = try OpenDirectoryRuntimeAccountStore()
    let witness = try partialInstallRepairWitness(journal)
    _ = try store.validateExactRepairGroup(witness)
    try store.proveNoExplicitGroupMembership(journal.plan)
    try store.deleteExactRepairUser(witness)
    try store.proveRawUserAbsentGroupExact(witness, phase: "user-delete-effect-ahead")
}

func removePartialInstallRepairGroup(_ journal: PartialInstallRepairJournal) throws {
    let store = try OpenDirectoryRuntimeAccountStore()
    let witness = try partialInstallRepairWitness(journal)
    try store.proveRawUserAbsentGroupExact(witness, phase: journal.phase)
    try store.proveNoExplicitGroupMembership(journal.plan)
    try store.deleteExactRepairGroup(witness)
    try store.proveRawAbsent(journal.plan, phase: "group-delete-effect-ahead")
    try store.proveNoExplicitGroupMembership(journal.plan)
}

func verifyPartialInstallRepairPrincipalRemovalInFreshProcess() throws -> [String: Any] {
    let parentBefore = try requireLiveRepairBootstrapParent()
    let journal = try readPartialInstallRepairJournal()
    guard ["group-removed", "principal-removed"].contains(journal.phase) else {
        throw repairFailure("Fresh-process partial-install absence verification requires a post-group-removal boundary.")
    }
    try requireCurrentPartialInstallRepairAuthority(journal)
    try requireRuntimeKeychainCustodyAbsent()
    let store = try OpenDirectoryRuntimeAccountStore()
    try store.proveRawAbsent(journal.plan, phase: "fresh-bootstrap")
    try store.proveNoExplicitGroupMembership(journal.plan)
    let posix = try settleRuntimePOSIXProjectionAbsent(
        journal.plan,
        phase: "fresh-bootstrap"
    )
    let parentAfter = try requireLiveRepairBootstrapParent()
    guard parentAfter == parentBefore else {
        throw principalDiagnosticFailure(
            "process-replaced",
            "restart the exact journal-bound fresh verifier",
            "The repair parent process changed while the fresh absence proof was created.",
            details: [
                "phase": journal.phase,
                "probe": "fresh-parent-process",
                "state": "changed-during-proof",
                "verifier_pid": parentAfter.pid,
            ]
        )
    }
    return [
        "status": "absence-verified",
        "accountName": runtimeAccountName,
        "transactionID": journal.transactionID,
        "phase": journal.phase,
        "sourceHelperSHA256": journal.sourceHelperSHA256,
        "sourceHelperCDHash": journal.sourceHelperCDHash,
        "sourcePrincipalCarrierContractVersion": journal.sourcePrincipalCarrierContractVersion,
        "residueClass": journal.residueClass,
        "authenticationEvidenceSHA256": journal.authenticationEvidenceSHA256,
        "planDigest": journal.planDigest,
        "groupGeneratedUID": journal.groupGeneratedUID,
        "userGeneratedUID": journal.userGeneratedUID,
        "rootKeyId": journal.rootKeyId,
        "policyDigest": journal.policyDigest,
        "posixLookupAPI": runtimePOSIXIdentityLookupAPI,
        "posixProjectionSHA256": posix.projectionDigestSHA256,
        "posixProbeStates": posix.probes.map { $0.state.rawValue },
        "parentPID": parentAfter.pid,
        "parentProcessStartIdentity": parentAfter.startIdentity,
        "verifierPID": getpid(),
    ]
}

func validateFreshPartialInstallRepairAbsenceReceipt(
    _ result: CommandResult,
    journal: PartialInstallRepairJournal,
    parentWitness: RepairProcessWitness
) throws {
    let expected = PartialInstallRepairJournalAbsenceReceiptExpectation(
        accountName: runtimeAccountName,
        transactionID: journal.transactionID,
        phase: journal.phase,
        sourceHelperSHA256: journal.sourceHelperSHA256,
        sourceHelperCDHash: journal.sourceHelperCDHash,
        sourcePrincipalCarrierContractVersion: journal.sourcePrincipalCarrierContractVersion,
        residueClass: journal.residueClass,
        authenticationEvidenceSHA256: journal.authenticationEvidenceSHA256,
        planDigest: journal.planDigest,
        groupGeneratedUID: journal.groupGeneratedUID,
        userGeneratedUID: journal.userGeneratedUID,
        rootKeyId: journal.rootKeyId,
        policyDigest: journal.policyDigest,
        posixLookupAPI: runtimePOSIXIdentityLookupAPI,
        parentPID: parentWitness.pid,
        parentProcessStartIdentity: parentWitness.startIdentity
    )
    guard result.stdout.count > 0, result.stdout.count <= 64 * 1024,
          let value = try JSONSerialization.jsonObject(with: result.stdout) as? [String: Any],
          partialInstallRepairJournalAbsenceReceiptMatches(
              value,
              childPID: result.pid,
              parentPID: parentWitness.pid,
              expected: expected
          ) else {
        throw principalDiagnosticFailure(
            "runtime-principal-fresh-proof-invalid",
            "inspect the exact fresh-bootstrap absence receipt",
            "The fresh bootstrap returned an invalid or unbound partial-install absence receipt.",
            details: [
                "phase": journal.phase,
                "probe": "fresh-bootstrap-receipt",
                "state": "invalid",
                "verifier_pid": result.pid,
            ]
        )
    }
}

private func requireLiveRepairBootstrapParent() throws -> RepairProcessWitness {
    let parentPID = getppid()
    let before = try readRepairProcessWitness(parentPID)
    guard before.realUID == 0,
          before.effectiveUID == 0,
          before.savedUID == 0,
          before.executablePath == bootstrapHelperInstallPath else {
        throw principalDiagnosticFailure(
            "process-replaced",
            "restart the exact root repair bootstrap",
            "The fresh verifier does not have the exact root bootstrap parent.",
            details: [
                "phase": "fresh-bootstrap",
                "probe": "fresh-parent-process",
                "state": "identity-mismatch",
                "verifier_pid": parentPID,
            ]
        )
    }
    let runningParent = try inspectRunningBootstrapCode(parentPID)
    let installedBootstrap = try inspectBootstrapCode(bootstrapHelperInstallPath)
    guard sameBootstrapIdentity(runningParent, installedBootstrap),
          kill(parentPID, 0) == 0 else {
        throw principalDiagnosticFailure(
            "process-replaced",
            "restart the exact root repair bootstrap",
            "The fresh verifier parent is not the live installed bootstrap code.",
            details: [
                "phase": "fresh-bootstrap",
                "probe": "fresh-parent-code",
                "state": "untrusted-or-exited",
                "verifier_pid": parentPID,
            ]
        )
    }
    let after = try readRepairProcessWitness(parentPID)
    guard after == before else {
        throw principalDiagnosticFailure(
            "process-replaced",
            "restart the exact root repair bootstrap",
            "The fresh verifier parent changed during dynamic code inspection.",
            details: [
                "phase": "fresh-bootstrap",
                "probe": "fresh-parent-process",
                "state": "changed-during-code-check",
                "verifier_pid": parentPID,
            ]
        )
    }
    return after
}

func exactRepairTerminalStateIsClean() throws -> Bool {
    try requireNoUnknownRuntimeDevEntries()
    let targets = [
        launchDaemonPath,
        runtimeStateRoot,
        runtimeTransactionRoot,
        runtimeRollbackRoot,
        try repairSocketRoot(),
        runtimeActiveRoot,
        desktopApplicationPath,
        "\(runtimeDevRoot)/installer-ledger.json",
        installationJournalPath,
        runtimePrincipalJournalPath,
        generatedDesktopSocketPath,
        generatedLocalAppSocketPath,
    ]
    if try targets.contains(where: { try repairPathPresent($0) }) { return false }
    return try !runtimeAccountRecordsPresent()
}

private func requireRepairOwnedArtifactsAbsent() throws {
    let targets = [launchDaemonPath, runtimeStateRoot, runtimeTransactionRoot, runtimeRollbackRoot, try repairSocketRoot()]
    let present = try targets.filter { try repairPathPresent($0) }
    guard present.isEmpty else {
        throw repairFailure("An owned partial-install artifact remains after the artifacts-removed boundary: \(present.joined(separator: ", ")).")
    }
}

private func verifyOptionalRepairLaunchDaemon() throws {
    if try repairPathPresent(launchDaemonPath) { try verifyInstalledLaunchDaemonDefinition() }
}

private func verifyOptionalEmptyRepairDirectory(_ path: String, owner: UInt32, group: UInt32, mode: mode_t) throws {
    if try repairPathPresent(path) {
        try requireEmptyRepairDirectory(path, owner: owner, group: group, mode: mode)
    }
}

private func requireNoUnknownRuntimeDevEntries() throws {
    let allowed = Set([
        (signingProfilePath as NSString).lastPathComponent,
        (signingCleanupRecordPath as NSString).lastPathComponent,
        (signingCustodyRoot as NSString).lastPathComponent,
        (runtimeActiveRoot as NSString).lastPathComponent,
        (runtimeStateRoot as NSString).lastPathComponent,
        (runtimeTransactionRoot as NSString).lastPathComponent,
        (runtimeRollbackRoot as NSString).lastPathComponent,
        (installationJournalPath as NSString).lastPathComponent,
        (runtimePrincipalJournalPath as NSString).lastPathComponent,
        (runtimePartialInstallRepairJournalPath as NSString).lastPathComponent,
        "installer-ledger.json",
    ])
    let entries = try FileManager.default.contentsOfDirectory(atPath: runtimeDevRoot)
    let unknown = entries.filter { !allowed.contains($0) }
    guard unknown.isEmpty else {
        throw repairFailure("The RuntimeDev root contains unknown entries that repair does not own: \(unknown.sorted().joined(separator: ", ")).")
    }
}
