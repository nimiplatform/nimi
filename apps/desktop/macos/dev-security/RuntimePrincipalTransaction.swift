import Darwin
import Foundation

private struct RuntimePrincipalJournal: Codable {
    let schemaVersion: String
    let transactionID: String
    let operation: String
    let phase: String
    let accountName: String
    let identifier: UInt32
    let groupGeneratedUID: String
    let userGeneratedUID: String
    let directoryServiceAPI: String

    var plan: RuntimeAccountCreationPlan {
        RuntimeAccountCreationPlan(
            identifier: identifier,
            groupGeneratedUID: groupGeneratedUID,
            userGeneratedUID: userGeneratedUID
        )
    }
}

func planFreshRuntimeAccountCreation() throws -> RuntimeAccountCreationPlan {
    try recoverInterruptedRuntimePrincipalTransactionIfNeeded()
    let store = try OpenDirectoryRuntimeAccountStore()
    let user = try store.observe(.user)
    let group = try store.observe(.group)
    guard user == nil, group == nil else {
        throw principalDirectoryStateFailure(
            phase: "fresh-install-baseline",
            probe: "raw-od-user-and-group",
            state: user != nil && group != nil ? "principal-present" : "partial-principal",
            expectedIdentifier: nil,
            observed: user ?? group
        )
    }
    return try makeRuntimeAccountCreationPlan(
        identifier: store.selectUnusedIdentifier(),
        groupGeneratedUID: UUID().uuidString,
        userGeneratedUID: UUID().uuidString
    )
}

func ensureRuntimeAccount(plannedPlan: RuntimeAccountCreationPlan? = nil) throws -> (uid: uid_t, gid: gid_t) {
    try recoverInterruptedRuntimePrincipalTransactionIfNeeded()
    let store = try OpenDirectoryRuntimeAccountStore()
    let user = try store.observe(.user)
    let group = try store.observe(.group)
    if user != nil || group != nil {
        guard let user, let group else {
            throw principalDirectoryStateFailure(
                phase: "ensure-runtime-principal",
                probe: "raw-od-user-and-group",
                state: "partial-principal-without-journal",
                expectedIdentifier: plannedPlan?.identifier,
                observed: user ?? group
            )
        }
        let plan = try runtimeAccountPlan(user: user, group: group)
        if let plannedPlan, plan != plannedPlan {
            throw principalDirectoryStateFailure(
                phase: "ensure-runtime-principal",
                probe: "raw-od-user-and-group",
                state: "installation-witness-conflict",
                expectedIdentifier: plannedPlan.identifier,
                observed: user
            )
        }
        try store.proveNoExplicitGroupMembership(plan)
        return try validateRuntimeAccountPOSIXProjection(plan)
    }

    let plan = try plannedPlan ?? makeRuntimeAccountCreationPlan(
        identifier: store.selectUnusedIdentifier(),
        groupGeneratedUID: UUID().uuidString,
        userGeneratedUID: UUID().uuidString
    )
    let journal = RuntimePrincipalJournal(
        schemaVersion: "nimi.macos-local-development-principal-transaction/v1",
        transactionID: UUID().uuidString.lowercased(),
        operation: "create",
        phase: "create-prepared",
        accountName: runtimeAccountName,
        identifier: plan.identifier,
        groupGeneratedUID: plan.groupGeneratedUID,
        userGeneratedUID: plan.userGeneratedUID,
        directoryServiceAPI: runtimeDirectoryServiceAPI
    )
    try writeRuntimePrincipalJournal(journal)
    do {
        let group = try store.createGroup(plan)
        guard runtimeDirectoryRecord(group, matches: plan) else {
            throw principalDirectoryStateFailure(
                phase: "group-created",
                probe: "raw-od-group",
                state: "birth-attributes-conflict",
                expectedIdentifier: plan.identifier,
                observed: group
            )
        }
        try updateRuntimePrincipalJournal(journal, phase: "group-created")

        let user = try store.createUser(plan)
        guard runtimeDirectoryRecord(user, matches: plan) else {
            throw principalDirectoryStateFailure(
                phase: "user-created",
                probe: "raw-od-user",
                state: "birth-attributes-conflict",
                expectedIdentifier: plan.identifier,
                observed: user
            )
        }
        try updateRuntimePrincipalJournal(journal, phase: "user-created")

        let verification = try runFixedCommand(helperInstallPath, ["verify-runtime-principal-transaction"])
        try validateFreshRuntimePrincipalReceipt(verification, journal: journal)
        let identity = try validateRuntimeAccountPOSIXProjection(plan)
        try updateRuntimePrincipalJournal(journal, phase: "fresh-process-verified")
        try removeRuntimePrincipalJournal()
        return identity
    } catch {
        let original = error
        do {
            try recoverInterruptedRuntimePrincipalTransactionIfNeeded()
        } catch let rollbackFailure as DevSecurityFailure {
            throw rollbackFailure
        } catch {
            throw fail(
                "runtime-service-repair-required",
                "inspect the root-owned Runtime principal journal before retrying installation",
                "Runtime principal creation failed and exact rollback could not complete: \(diagnosticMessage(original)); rollback: \(diagnosticMessage(error))"
            )
        }
        throw original
    }
}

func verifyRuntimePrincipalTransactionInFreshProcess() throws -> [String: Any] {
    try requireRootMutationContext()
    let journal = try readRuntimePrincipalJournal()
    guard journal.operation == "create", journal.phase == "user-created" else {
        throw accountFailure("Fresh-process verification requires one exact user-created principal transaction.")
    }
    let store = try OpenDirectoryRuntimeAccountStore()
    let candidateUser = try store.observe(.user)
    let candidateGroup = try store.observe(.group)
    guard let user = candidateUser,
          let group = candidateGroup,
          runtimeDirectoryRecord(user, matches: journal.plan),
          runtimeDirectoryRecord(group, matches: journal.plan) else {
        throw principalDirectoryStateFailure(
            phase: journal.phase,
            probe: "fresh-raw-od-user-and-group",
            state: "transaction-witness-conflict",
            expectedIdentifier: journal.identifier,
            observed: candidateUser ?? candidateGroup
        )
    }
    try store.proveNoExplicitGroupMembership(journal.plan)
    _ = try validateRuntimeAccountPOSIXProjection(journal.plan)
    return [
        "status": "verified",
        "accountName": runtimeAccountName,
        "authenticationAuthority": runtimeAuthenticationAuthorityPosture,
        "forbiddenAuthenticationMaterialCount": runtimeForbiddenAuthenticationMaterialAttributes.count,
        "transactionID": journal.transactionID,
        "planDigest": runtimePrincipalPlanDigest(journal),
        "verifierPID": getpid(),
    ]
}

func verifyRuntimePrincipalRemovalTransactionInFreshProcess() throws -> [String: Any] {
    _ = try requireCleanupMutationContext()
    let journal = try readRuntimePrincipalJournal()
    let validRemovalBoundary = (journal.operation == "remove" && journal.phase == "group-removed")
        || (journal.operation == "create" && journal.phase == "rollback-group-removed")
    guard validRemovalBoundary else {
        throw accountFailure("Fresh-process absence verification requires one exact completed principal deletion transaction.")
    }
    let store = try OpenDirectoryRuntimeAccountStore()
    try store.proveRawAbsent(journal.plan, phase: "fresh-principal-removal")
    try store.proveNoExplicitGroupMembership(journal.plan)
    let posix = try settleRuntimePOSIXProjectionAbsent(
        journal.plan,
        phase: "fresh-principal-removal"
    )
    return [
        "status": "absence-verified",
        "accountName": runtimeAccountName,
        "operation": journal.operation,
        "transactionID": journal.transactionID,
        "planDigest": runtimePrincipalPlanDigest(journal),
        "posixLookupAPI": runtimePOSIXIdentityLookupAPI,
        "posixProjectionSHA256": posix.projectionDigestSHA256,
        "posixProbeStates": posix.probes.map { $0.state.rawValue },
        "verifierPID": getpid(),
    ]
}

private func validateFreshRuntimePrincipalReceipt(
    _ result: CommandResult,
    journal: RuntimePrincipalJournal
) throws {
    let value = try parseFreshRuntimePrincipalReceipt(
        result,
        phase: journal.phase,
        probe: "fresh-principal-creation-receipt",
        expectedKeys: [
            "status", "accountName", "authenticationAuthority",
            "forbiddenAuthenticationMaterialCount", "transactionID", "planDigest", "verifierPID",
        ]
    )
    guard value["status"] as? String == "verified",
          value["accountName"] as? String == runtimeAccountName,
          value["authenticationAuthority"] as? String == "absent_required",
          (value["forbiddenAuthenticationMaterialCount"] as? NSNumber)?.intValue == runtimeForbiddenAuthenticationMaterialAttributes.count,
          value["transactionID"] as? String == journal.transactionID,
          value["planDigest"] as? String == runtimePrincipalPlanDigest(journal),
          (value["verifierPID"] as? NSNumber)?.int32Value == result.pid else {
        throw freshRuntimePrincipalProofFailure(
            phase: journal.phase,
            probe: "fresh-principal-creation-receipt",
            state: "authority-binding-mismatch",
            verifierPID: result.pid,
            expectedIdentifier: journal.identifier
        )
    }
}

private func runtimePrincipalPlanDigest(_ journal: RuntimePrincipalJournal) -> String {
    let fields = [
        journal.transactionID,
        journal.operation,
        journal.accountName,
        String(journal.identifier),
        journal.groupGeneratedUID,
        journal.userGeneratedUID,
        runtimeAuthenticationAuthorityPosture,
        runtimeDirectoryServiceAPI,
    ]
    return sha256(Data(fields.joined(separator: "\u{0}").utf8))
}

func installedRuntimeAccountIdentity() throws -> (uid: uid_t, gid: gid_t) {
    let plan = try installedRuntimeAccountPlan()
    return try validateRuntimeAccountPOSIXProjection(plan)
}

func installedRuntimeAccountPlan() throws -> RuntimeAccountCreationPlan {
    guard !FileManager.default.fileExists(atPath: runtimePrincipalJournalPath) else {
        throw accountFailure("An interrupted Runtime principal transaction requires privileged recovery.")
    }
    let store = try OpenDirectoryRuntimeAccountStore()
    let user = try store.observe(.user)
    let group = try store.observe(.group)
    guard let user, let group else {
        throw principalDirectoryStateFailure(
            phase: "installed-runtime-principal",
            probe: "raw-od-user-and-group",
            state: user == nil && group == nil ? "principal-absent" : "partial-principal",
            expectedIdentifier: nil,
            observed: user ?? group
        )
    }
    let plan = try runtimeAccountPlan(user: user, group: group)
    try store.proveNoExplicitGroupMembership(plan)
    _ = try validateRuntimeAccountPOSIXProjection(plan)
    return plan
}

func removeRuntimeAccount() throws {
    try removeRuntimeAccount(expectedPlan: nil)
}

func removeRuntimeAccount(expectedPlan: RuntimeAccountCreationPlan?) throws {
    try recoverInterruptedRuntimePrincipalTransactionIfNeeded(expectedPlan: expectedPlan)
    let store = try OpenDirectoryRuntimeAccountStore()
    let user = try store.observe(.user)
    let group = try store.observe(.group)
    if user == nil, group == nil {
        if let expectedPlan {
            try store.proveRawAbsent(expectedPlan, phase: "principal-remove-zero-residue")
            try resetRuntimeDirectoryIdentityCaches(phase: "principal-remove-zero-residue")
            _ = try settleRuntimePOSIXProjectionAbsent(
                expectedPlan,
                phase: "principal-remove-zero-residue"
            )
        } else {
            try resetRuntimeDirectoryIdentityCaches(phase: "principal-remove-zero-residue")
            _ = try settleRuntimePOSIXNameProjectionAbsent(
                phase: "principal-remove-zero-residue"
            )
        }
        return
    }
    guard let user, let group else {
        throw principalDirectoryStateFailure(
            phase: "principal-remove-baseline",
            probe: "raw-od-user-and-group",
            state: "partial-principal-without-witness",
            expectedIdentifier: expectedPlan?.identifier,
            observed: user ?? group
        )
    }
    let plan = try runtimeAccountPlan(user: user, group: group)
    if let expectedPlan, plan != expectedPlan {
        throw principalDirectoryStateFailure(
            phase: "principal-remove-baseline",
            probe: "raw-od-user-and-group",
            state: "parent-witness-conflict",
            expectedIdentifier: expectedPlan.identifier,
            observed: user
        )
    }
    try store.proveNoExplicitGroupMembership(plan)
    _ = try validateRuntimeAccountPOSIXProjection(plan)
    let journal = RuntimePrincipalJournal(
        schemaVersion: "nimi.macos-local-development-principal-transaction/v1",
        transactionID: UUID().uuidString.lowercased(),
        operation: "remove",
        phase: "remove-prepared",
        accountName: runtimeAccountName,
        identifier: plan.identifier,
        groupGeneratedUID: plan.groupGeneratedUID,
        userGeneratedUID: plan.userGeneratedUID,
        directoryServiceAPI: runtimeDirectoryServiceAPI
    )
    try writeRuntimePrincipalJournal(journal)
    do {
        try store.deleteExact(.user, plan: plan)
        try updateRuntimePrincipalJournal(journal, phase: "user-removed")
        try store.deleteExact(.group, plan: plan)
        try updateRuntimePrincipalJournal(journal, phase: "group-removed")
        try resetRuntimeDirectoryIdentityCaches(phase: "normal-principal-group-removed")
        let verification = try runFixedCommand(
            try currentRuntimePrincipalRemovalVerifierPath(),
            ["verify-runtime-principal-removal-transaction"]
        )
        try validateFreshRuntimePrincipalRemovalReceipt(verification, journal: journal)
        try updateRuntimePrincipalJournal(journal, phase: "fresh-process-verified")
        try removeRuntimePrincipalJournal()
    } catch let failure as DevSecurityFailure {
        throw failure
    } catch {
        throw fail(
            "runtime-service-repair-required",
            "retry the exact confirmed uninstall transaction after inspecting the principal journal",
            "Runtime principal removal did not complete; the exact recovery journal was preserved: \(diagnosticMessage(error))"
        )
    }
}

func runtimeAccountRecordsPresent() throws -> Bool {
    let store = try OpenDirectoryRuntimeAccountStore()
    return try store.observe(.user) != nil || store.observe(.group) != nil
}

func validateRuntimeAccountRemovalState(
    expectedPlan: RuntimeAccountCreationPlan,
    requireCompleteIdentity: Bool
) throws {
    let journalPresent = try fixedPrincipalJournalPresent()
    if journalPresent {
        let journal = try readRuntimePrincipalJournal()
        guard journal.operation == "remove", journal.plan == expectedPlan else {
            throw accountFailure("The Runtime principal recovery journal is not bound to the parent removal witness.")
        }
    }
    let store = try OpenDirectoryRuntimeAccountStore()
    let user = try store.observe(.user)
    let group = try store.observe(.group)
    if let user, !runtimeDirectoryRecord(user, matches: expectedPlan) {
        throw principalDirectoryStateFailure(
            phase: "principal-removal-state-validation",
            probe: "raw-od-user",
            state: "parent-witness-conflict",
            expectedIdentifier: expectedPlan.identifier,
            observed: user
        )
    }
    if let group, !runtimeDirectoryRecord(group, matches: expectedPlan) {
        throw principalDirectoryStateFailure(
            phase: "principal-removal-state-validation",
            probe: "raw-od-group",
            state: "parent-witness-conflict",
            expectedIdentifier: expectedPlan.identifier,
            observed: group
        )
    }
    if requireCompleteIdentity {
        guard !journalPresent, user != nil, group != nil else {
            throw accountFailure("The repair baseline requires one complete Runtime principal and no inner transaction.")
        }
        try store.proveNoExplicitGroupMembership(expectedPlan)
        _ = try validateRuntimeAccountPOSIXProjection(expectedPlan)
        return
    }
    if (user == nil) != (group == nil), !journalPresent {
        throw principalDirectoryStateFailure(
            phase: "principal-removal-state-validation",
            probe: "raw-od-user-and-group",
            state: "partial-principal-without-journal",
            expectedIdentifier: expectedPlan.identifier,
            observed: user ?? group
        )
    }
    try store.proveNoExplicitGroupMembership(expectedPlan)
    if user != nil, group != nil {
        _ = try validateRuntimeAccountPOSIXProjection(expectedPlan)
    } else if user == nil, group == nil {
        if journalPresent {
            let journal = try readRuntimePrincipalJournal()
            if ["group-removed", "rollback-group-removed", "fresh-process-verified"].contains(journal.phase) {
                try resetRuntimeDirectoryIdentityCaches(phase: "principal-removal-state-validation")
            }
        }
        try proveRuntimeAccountPOSIXAbsent(expectedPlan)
    }
}

func proveRuntimeAccountFullyAbsent(_ plan: RuntimeAccountCreationPlan) throws {
    guard try !fixedPrincipalJournalPresent() else {
        throw accountFailure("A Runtime principal transaction remains after deletion.")
    }
    let store = try OpenDirectoryRuntimeAccountStore()
    try store.proveRawAbsent(plan, phase: "principal-fully-absent")
    try store.proveNoExplicitGroupMembership(plan)
    try proveRuntimeAccountPOSIXAbsent(plan)
}

private func fixedPrincipalJournalPresent() throws -> Bool {
    var metadata = stat()
    if lstat(runtimePrincipalJournalPath, &metadata) == 0 { return true }
    if errno == ENOENT { return false }
    throw posixFailure("inspect Runtime principal journal", runtimePrincipalJournalPath)
}

func recoverInterruptedRuntimePrincipalTransactionIfNeeded(
    expectedPlan: RuntimeAccountCreationPlan? = nil
) throws {
    guard FileManager.default.fileExists(atPath: runtimePrincipalJournalPath) else { return }
    let journal = try readRuntimePrincipalJournal()
    if let expectedPlan, journal.plan != expectedPlan {
        throw accountFailure("The interrupted Runtime principal transaction does not match its parent transaction witness.")
    }
    let store = try OpenDirectoryRuntimeAccountStore()
    let plan = journal.plan
    if let user = try store.observe(.user), !runtimeDirectoryRecord(user, matches: plan) {
        throw principalDirectoryStateFailure(
            phase: journal.phase,
            probe: "raw-od-user",
            state: "journal-witness-conflict",
            expectedIdentifier: plan.identifier,
            observed: user
        )
    }
    if let group = try store.observe(.group), !runtimeDirectoryRecord(group, matches: plan) {
        throw principalDirectoryStateFailure(
            phase: journal.phase,
            probe: "raw-od-group",
            state: "journal-witness-conflict",
            expectedIdentifier: plan.identifier,
            observed: group
        )
    }
    try store.proveNoExplicitGroupMembership(plan)
    try store.deleteExact(.user, plan: plan)
    if journal.operation == "create" {
        try updateRuntimePrincipalJournal(journal, phase: "rollback-user-removed")
    } else {
        try updateRuntimePrincipalJournal(journal, phase: "user-removed")
    }
    try store.deleteExact(.group, plan: plan)
    let removalPhase = journal.operation == "create" ? "rollback-group-removed" : "group-removed"
    try updateRuntimePrincipalJournal(journal, phase: removalPhase)
    try resetRuntimeDirectoryIdentityCaches(phase: removalPhase)
    let verification = try runFixedCommand(
        try currentRuntimePrincipalRemovalVerifierPath(),
        ["verify-runtime-principal-removal-transaction"]
    )
    try validateFreshRuntimePrincipalRemovalReceipt(verification, journal: journal)
    try updateRuntimePrincipalJournal(journal, phase: "fresh-process-verified")
    try removeRuntimePrincipalJournal()
}

func proveRuntimeAccountPOSIXAbsent(_ plan: RuntimeAccountCreationPlan) throws {
    _ = try settleRuntimePOSIXProjectionAbsent(plan, phase: "principal-absence")
}

private func writeRuntimePrincipalJournal(_ journal: RuntimePrincipalJournal) throws {
    try ensureRuntimePrincipalJournalParent()
    try validateRuntimePrincipalJournal(journal)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .prettyPrinted, .withoutEscapingSlashes]
    var data = try encoder.encode(journal)
    data.append(0x0a)
    try writeAtomicRootFile(data, to: runtimePrincipalJournalPath, mode: 0o600)
}

private func updateRuntimePrincipalJournal(
    _ journal: RuntimePrincipalJournal,
    phase: String
) throws {
    try writeRuntimePrincipalJournal(RuntimePrincipalJournal(
        schemaVersion: journal.schemaVersion,
        transactionID: journal.transactionID,
        operation: journal.operation,
        phase: phase,
        accountName: journal.accountName,
        identifier: journal.identifier,
        groupGeneratedUID: journal.groupGeneratedUID,
        userGeneratedUID: journal.userGeneratedUID,
        directoryServiceAPI: journal.directoryServiceAPI
    ))
}

private func readRuntimePrincipalJournal() throws -> RuntimePrincipalJournal {
    _ = try secureMetadata(runtimePrincipalJournalPath, type: S_IFREG, uid: 0, gid: 0, mode: 0o600, links: 1)
    let data = try Data(contentsOf: URL(fileURLWithPath: runtimePrincipalJournalPath))
    guard !data.isEmpty, data.count <= 64 * 1024 else {
        throw accountFailure("The Runtime principal journal has an invalid size.")
    }
    let journal = try JSONDecoder().decode(RuntimePrincipalJournal.self, from: data)
    try validateRuntimePrincipalJournal(journal)
    return journal
}

private func validateRuntimePrincipalJournal(_ journal: RuntimePrincipalJournal) throws {
    let validPhases: [String: Set<String>] = [
        "create": [
            "create-prepared", "group-created", "user-created",
            "rollback-user-removed", "rollback-group-removed", "fresh-process-verified",
        ],
        "remove": ["remove-prepared", "user-removed", "group-removed", "fresh-process-verified"],
    ]
    guard journal.schemaVersion == "nimi.macos-local-development-principal-transaction/v1",
          journal.transactionID.range(of: #"^[a-f0-9-]{36}$"#, options: .regularExpression) != nil,
          journal.accountName == runtimeAccountName,
          validPhases[journal.operation]?.contains(journal.phase) == true,
          journal.directoryServiceAPI == runtimeDirectoryServiceAPI else {
        throw accountFailure("The Runtime principal journal contains an unrecognized authority or phase.")
    }
    _ = try makeRuntimeAccountCreationPlan(
        identifier: journal.identifier,
        groupGeneratedUID: journal.groupGeneratedUID,
        userGeneratedUID: journal.userGeneratedUID
    )
}

private func currentRuntimePrincipalRemovalVerifierPath() throws -> String {
    let current = try canonicalCurrentExecutablePath()
    guard current == helperInstallPath || current == bootstrapHelperInstallPath else {
        throw accountFailure("Principal deletion must run from one exact installed helper path.")
    }
    return current
}

private func validateFreshRuntimePrincipalRemovalReceipt(
    _ result: CommandResult,
    journal: RuntimePrincipalJournal
) throws {
    let value = try parseFreshRuntimePrincipalReceipt(
        result,
        phase: journal.phase,
        probe: "fresh-principal-removal-receipt",
        expectedKeys: [
            "status", "accountName", "operation", "transactionID", "planDigest",
            "posixLookupAPI", "posixProjectionSHA256", "posixProbeStates", "verifierPID",
        ]
    )
    guard value["status"] as? String == "absence-verified",
          value["accountName"] as? String == runtimeAccountName,
          value["operation"] as? String == journal.operation,
          value["transactionID"] as? String == journal.transactionID,
          value["planDigest"] as? String == runtimePrincipalPlanDigest(journal),
          value["posixLookupAPI"] as? String == runtimePOSIXIdentityLookupAPI,
          (value["posixProjectionSHA256"] as? String)?.range(
              of: #"^[a-f0-9]{64}$"#,
              options: .regularExpression
          ) != nil,
          value["posixProbeStates"] as? [String] == [
              "not-found", "not-found", "not-found", "not-found",
          ],
          (value["verifierPID"] as? NSNumber)?.int32Value == result.pid else {
        throw freshRuntimePrincipalProofFailure(
            phase: journal.phase,
            probe: "fresh-principal-removal-receipt",
            state: "authority-binding-mismatch",
            verifierPID: result.pid,
            expectedIdentifier: journal.identifier,
            projectionSHA256: value["posixProjectionSHA256"] as? String
        )
    }
}

private func parseFreshRuntimePrincipalReceipt(
    _ result: CommandResult,
    phase: String,
    probe: String,
    expectedKeys: Set<String>
) throws -> [String: Any] {
    guard result.pid > 1, result.pid != getpid() else {
        throw freshRuntimePrincipalProofFailure(
            phase: phase,
            probe: probe,
            state: "invalid-verifier-process",
            verifierPID: result.pid
        )
    }
    guard !result.stdout.isEmpty, result.stdout.count <= 64 * 1024 else {
        throw freshRuntimePrincipalProofFailure(
            phase: phase,
            probe: probe,
            state: result.stdout.isEmpty ? "empty-receipt" : "oversized-receipt",
            verifierPID: result.pid
        )
    }
    guard let value = try? JSONSerialization.jsonObject(with: result.stdout) as? [String: Any] else {
        throw freshRuntimePrincipalProofFailure(
            phase: phase,
            probe: probe,
            state: "invalid-json-receipt",
            verifierPID: result.pid
        )
    }
    guard Set(value.keys) == expectedKeys else {
        throw freshRuntimePrincipalProofFailure(
            phase: phase,
            probe: probe,
            state: "field-set-mismatch",
            verifierPID: result.pid
        )
    }
    return value
}

private func freshRuntimePrincipalProofFailure(
    phase: String,
    probe: String,
    state: String,
    verifierPID: pid_t,
    expectedIdentifier: UInt32? = nil,
    projectionSHA256: String? = nil
) -> DevSecurityFailure {
    var details: [String: Any] = [
        "phase": phase,
        "probe": probe,
        "state": state,
        "verifier_pid": verifierPID,
    ]
    if let expectedIdentifier { details["expected_identifier"] = expectedIdentifier }
    if let projectionSHA256,
       projectionSHA256.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil {
        details["projection_sha256"] = projectionSHA256
    }
    return principalDiagnosticFailure(
        "runtime-principal-fresh-proof-invalid",
        "inspect the exact fresh Runtime principal receipt",
        "The fresh helper process returned an invalid or authority-unbound Runtime principal receipt.",
        details: details
    )
}

private func ensureRuntimePrincipalJournalParent() throws {
    let nimiRoot = "/Library/Application Support/Nimi"
    if !FileManager.default.fileExists(atPath: nimiRoot) {
        try ensureDirectory(nimiRoot, owner: 0, group: 0, mode: 0o755)
    } else {
        _ = try secureMetadata(nimiRoot, type: S_IFDIR, uid: 0, gid: 0, mode: 0o755)
    }
    if !FileManager.default.fileExists(atPath: runtimeDevRoot) {
        try ensureDirectory(runtimeDevRoot, owner: 0, group: 0, mode: 0o755)
    } else {
        _ = try secureMetadata(runtimeDevRoot, type: S_IFDIR, uid: 0, gid: 0, mode: 0o755)
    }
}

private func removeRuntimePrincipalJournal() throws {
    var metadata = stat()
    if lstat(runtimePrincipalJournalPath, &metadata) != 0 {
        if errno == ENOENT { return }
        throw posixFailure("inspect Runtime principal journal", runtimePrincipalJournalPath)
    }
    _ = try secureMetadata(runtimePrincipalJournalPath, type: S_IFREG, uid: 0, gid: 0, mode: 0o600, links: 1)
    guard unlink(runtimePrincipalJournalPath) == 0 else {
        throw posixFailure("remove Runtime principal journal", runtimePrincipalJournalPath)
    }
    try syncDirectory(runtimeDevRoot)
}
