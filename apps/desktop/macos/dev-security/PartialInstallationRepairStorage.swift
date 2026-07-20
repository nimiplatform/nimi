import Darwin
import Foundation
import Security

private let partialInstallRepairJournalName = "partial-install-repair-transaction.json"
private let partialInstallRepairJournalStagingName = "partial-install-repair-transaction.staging"
private let partialInstallRepairJournalMaximumSize = 64 * 1024

private func partialInstallRepairJournalPersistence(
    phase: String = "storage"
) throws -> PartialInstallRepairJournalPersistence {
    guard runtimePartialInstallRepairJournalPath
            == "\(runtimeDevRoot)/\(partialInstallRepairJournalName)",
          runtimePartialInstallRepairJournalStagingPath
            == "\(runtimeDevRoot)/\(partialInstallRepairJournalStagingName)",
          (runtimePartialInstallRepairJournalPath as NSString).deletingLastPathComponent
            == runtimeDevRoot,
          (runtimePartialInstallRepairJournalStagingPath as NSString).deletingLastPathComponent
            == runtimeDevRoot else {
        throw partialInstallRepairJournalFailure(
            phase: "configuration", probe: "journal-paths", state: "authority-mismatch",
            message: "The authority-derived partial-install repair journal paths are invalid."
        )
    }
    return PartialInstallRepairJournalPersistence(
        parentPath: runtimeDevRoot,
        journalName: partialInstallRepairJournalName,
        stagingName: partialInstallRepairJournalStagingName,
        owner: 0,
        group: 0,
        parentMode: 0o755,
        fileMode: 0o600,
        maximumSize: partialInstallRepairJournalMaximumSize,
        failure: { probe, state, message in
            partialInstallRepairJournalFailure(phase: phase, probe: probe, state: state, message: message)
        },
        posixFailure: { operation, path, errorCode in
            partialInstallRepairJournalFailure(
                phase: phase,
                probe: operation,
                state: "syscall-failed",
                message: "\(operation) failed for \(path): \(String(cString: strerror(errorCode)))",
                returnCode: errorCode
            )
        }
    )
}

func recoverInterruptedPartialInstallRepairJournalWrite() throws {
    try partialInstallRepairJournalPersistence(phase: "staging-recovery").recoverInterruptedWrite()
}

func repairPathPresent(_ path: String) throws -> Bool {
    if path == runtimePartialInstallRepairJournalPath
        || path == runtimePartialInstallRepairJournalStagingPath {
        let name = path == runtimePartialInstallRepairJournalPath
            ? partialInstallRepairJournalName
            : partialInstallRepairJournalStagingName
        return try partialInstallRepairJournalPersistence().contains(name)
    }
    var metadata = stat()
    if lstat(path, &metadata) == 0 { return true }
    if errno == ENOENT { return false }
    throw posixFailure("inspect fixed partial-install repair target", path)
}

func requireRuntimeKeychainCustodyAbsent() throws {
    var opened: SecKeychain?
    let openStatus = SecKeychainOpen(systemKeychainPath, &opened)
    guard openStatus == errSecSuccess, let keychain = opened else {
        throw securityFailure("open System Keychain for Runtime custody absence proof", openStatus)
    }
    let query: [CFString: Any] = [
        kSecClass: kSecClassGenericPassword,
        kSecAttrService: generatedKeychainService,
        kSecUseKeychain: keychain,
        kSecMatchLimit: kSecMatchLimitAll,
        kSecReturnAttributes: true,
    ]
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    result = nil
    if status == errSecItemNotFound { return }
    guard status == errSecSuccess else {
        throw securityFailure("enumerate Runtime Keychain custody namespace", status)
    }
    throw repairFailure("Runtime Keychain custody namespace is not empty; repair will not delete known or unknown items implicitly.")
}

func proveRepairTargetsAbsent() throws {
    let journal = try readPartialInstallRepairJournal()
    guard journal.phase == "principal-removed" else {
        throw partialInstallRepairJournalFailure(
            phase: journal.phase, probe: "final-target-proof", state: "premature",
            message: "Final repair target absence requires the principal-removed journal boundary."
        )
    }
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
    for target in targets {
        var metadata = stat()
        guard lstat(target, &metadata) != 0, errno == ENOENT else {
            throw repairFailure("A fixed partial-install target remains after repair: \(target)")
        }
    }
    let store = try OpenDirectoryRuntimeAccountStore()
    try store.proveRawAbsent(journal.plan, phase: "final-repair-target-proof")
    try store.proveNoExplicitGroupMembership(journal.plan)
    _ = try settleRuntimePOSIXProjectionAbsent(
        journal.plan,
        phase: "final-repair-target-proof"
    )
}

func writePartialInstallRepairJournal(_ journal: PartialInstallRepairJournal) throws {
    try validatePartialInstallRepairJournal(journal)
    let data = try canonicalPartialInstallRepairJournalData(journal)
    try partialInstallRepairJournalPersistence().writeAtomically(data) { existingData in
        let existing = try decodeCanonicalPartialInstallRepairJournal(existingData)
        throw partialInstallRepairJournalFailure(
            phase: existing.phase,
            probe: "journal-create",
            state: "destination-exists",
            message: "Initial partial-install repair journal creation requires an absent destination.",
            projectionSHA256: sha256(existingData)
        )
    }
}

func updatePartialInstallRepairJournal(_ journal: PartialInstallRepairJournal, phase: String) throws {
    guard let currentPhase = PartialInstallRepairPhase(rawValue: journal.phase),
          let nextPhase = PartialInstallRepairPhase(rawValue: phase),
          currentPhase.permitsJournalTransition(to: nextPhase) else {
        throw partialInstallRepairJournalFailure(
            phase: journal.phase,
            probe: "journal-phase-transition",
            state: "non-monotonic",
            message: "The partial-install repair journal phase transition is not the one admitted next edge."
        )
    }
    let next = PartialInstallRepairJournal(
        schemaVersion: journal.schemaVersion,
        transactionID: journal.transactionID,
        phase: phase,
        accountName: journal.accountName,
        identifier: journal.identifier,
        groupGeneratedUID: journal.groupGeneratedUID,
        userGeneratedUID: journal.userGeneratedUID,
        sourceHelperSHA256: journal.sourceHelperSHA256,
        sourceHelperCDHash: journal.sourceHelperCDHash,
        sourcePrincipalCarrierContractVersion: journal.sourcePrincipalCarrierContractVersion,
        residueClass: journal.residueClass,
        authenticationEvidenceSHA256: journal.authenticationEvidenceSHA256,
        planDigest: journal.planDigest,
        rootKeyId: journal.rootKeyId,
        policyDigest: journal.policyDigest
    )
    try validatePartialInstallRepairJournal(next)
    let data = try canonicalPartialInstallRepairJournalData(next)
    try partialInstallRepairJournalPersistence(phase: journal.phase).writeAtomically(data) { existingData in
        let existing = try decodeCanonicalPartialInstallRepairJournal(existingData)
        guard partialInstallRepairOpenedWitnessMatches(opened: existing, expected: journal) else {
            throw partialInstallRepairJournalFailure(
                phase: existing.phase,
                probe: "journal-opened-projection",
                state: "caller-witness-mismatch",
                message: "The opened journal does not equal the caller's complete phase witness.",
                projectionSHA256: sha256(existingData)
            )
        }
    }
}

func readPartialInstallRepairJournal() throws -> PartialInstallRepairJournal {
    let data = try partialInstallRepairJournalPersistence().read()
    return try decodeCanonicalPartialInstallRepairJournal(data)
}

private func decodeCanonicalPartialInstallRepairJournal(
    _ data: Data
) throws -> PartialInstallRepairJournal {
    let projection = sha256(data)
    let journal: PartialInstallRepairJournal
    do {
        journal = try decodeCanonicalPartialInstallRepairJournalStructure(data)
    } catch let failure as PartialInstallRepairJournalCodecFailure {
        let state: String
        let message: String
        switch failure {
        case .nonExactFieldSet:
            state = "non-exact"
            message = "The partial-install repair journal field set is not exact."
        case .decodeFailed:
            state = "decode-failed"
            message = "The partial-install repair journal is not valid JSON."
        case .nonCanonicalTransactionID:
            state = "non-canonical"
            message = "The partial-install repair journal transaction identifier is not canonical."
        case .nonCanonicalBytes:
            state = "mismatch"
            message = "The partial-install repair journal bytes are not the exact canonical projection."
        }
        throw partialInstallRepairJournalFailure(
            phase: "decode",
            probe: failure.probe,
            state: state,
            message: message,
            projectionSHA256: projection
        )
    }
    try validatePartialInstallRepairJournal(journal, projectionSHA256: projection)
    return journal
}

func validatePartialInstallRepairJournal(
    _ journal: PartialInstallRepairJournal,
    projectionSHA256: String? = nil
) throws {
    let admittedPhases = PartialInstallRepairPhase.allCases.map(\.rawValue)
    let safePhase = admittedPhases.contains(journal.phase) ? journal.phase : "unrecognized"
    guard journal.schemaVersion == runtimeLegacyRepairJournalSchemaVersion else {
        throw partialInstallRepairJournalFailure(
            phase: safePhase, probe: "schema-version", state: "mismatch",
            message: "The partial-install repair journal schema version is not admitted.",
            projectionSHA256: projectionSHA256
        )
    }
    guard admittedPhases.contains(journal.phase), runtimeLegacyRepairJournalPhases.contains(journal.phase) else {
        throw partialInstallRepairJournalFailure(
            phase: "unrecognized", probe: "phase", state: "unadmitted",
            message: "The partial-install repair journal phase is not admitted.",
            projectionSHA256: projectionSHA256
        )
    }
    guard journal.accountName == runtimeAccountName,
          journal.sourceHelperSHA256.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil,
          journal.sourceHelperCDHash.range(of: #"^[a-f0-9]{40}$"#, options: .regularExpression) != nil,
          repairResidueClass(for: journal.sourcePrincipalCarrierContractVersion)?.rawValue == journal.residueClass,
          journal.authenticationEvidenceSHA256.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil,
          journal.planDigest.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil,
          journal.rootKeyId.range(of: #"^[a-z0-9][a-z0-9._-]{7,127}$"#, options: .regularExpression) != nil,
          journal.policyDigest.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil else {
        throw partialInstallRepairJournalFailure(
            phase: safePhase, probe: "authority-fields", state: "invalid",
            message: "The partial-install repair journal authority fields are invalid.",
            projectionSHA256: projectionSHA256
        )
    }
    let plan: RuntimeAccountCreationPlan
    do {
        plan = try makeRuntimeAccountCreationPlan(
            identifier: journal.identifier,
            groupGeneratedUID: journal.groupGeneratedUID,
            userGeneratedUID: journal.userGeneratedUID
        )
    } catch {
        throw partialInstallRepairJournalFailure(
            phase: safePhase, probe: "principal-plan", state: "invalid",
            message: "The partial-install repair journal principal plan is invalid.",
            projectionSHA256: projectionSHA256
        )
    }
    guard journal.planDigest == partialInstallRepairPlanDigest(plan) else {
        throw partialInstallRepairJournalFailure(
            phase: safePhase, probe: "plan-digest", state: "mismatch",
            message: "The partial-install repair journal plan digest is invalid.",
            projectionSHA256: projectionSHA256
        )
    }
    do {
        _ = try partialInstallRepairWitness(journal)
    } catch {
        throw partialInstallRepairJournalFailure(
            phase: safePhase, probe: "authority-witness", state: "invalid",
            message: "The partial-install repair journal authority witness is invalid.",
            projectionSHA256: projectionSHA256
        )
    }
}

func removePartialInstallRepairJournal(expected: PartialInstallRepairJournal) throws {
    try partialInstallRepairJournalPersistence().remove { data in
        let projection = sha256(data)
        let journal = try decodeCanonicalPartialInstallRepairJournal(data)
        guard journal == expected else {
            throw partialInstallRepairJournalFailure(
                phase: journal.phase, probe: "final-unlink-witness", state: "mismatch",
                message: "The journal selected for terminal unlink differs from the prepared completion witness.",
                projectionSHA256: projection
            )
        }
        guard journal.phase == "principal-removed" else {
            throw partialInstallRepairJournalFailure(
                phase: journal.phase, probe: "final-unlink-phase", state: "premature",
                message: "The partial-install repair journal cannot be removed before principal-removed.",
                projectionSHA256: projection
            )
        }
    }
}

private func partialInstallRepairJournalFailure(
    phase: String,
    probe: String,
    state: String,
    message: String,
    projectionSHA256: String? = nil,
    returnCode: Int32? = nil
) -> DevSecurityFailure {
    var details: [String: Any] = [
        "phase": phase,
        "probe": probe,
        "state": state,
        "verifier_pid": Int(getpid()),
    ]
    if let projectionSHA256 { details["projection_sha256"] = projectionSHA256 }
    if let returnCode { details["return_code"] = Int(returnCode) }
    return principalDiagnosticFailure(
        "runtime-principal-journal-invalid",
        "inspect and repair the exact partial-install repair journal evidence",
        message,
        details: details
    )
}

func repairFailure(_ message: String) -> DevSecurityFailure {
    fail(
        "runtime-service-repair-required",
        "inspect the exact fixed partial-install residue before retrying repair",
        message
    )
}
