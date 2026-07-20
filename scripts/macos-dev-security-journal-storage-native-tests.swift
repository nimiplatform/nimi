import Darwin
import Foundation

func runMacOSDevSecurityJournalStorageNativeTests() throws -> Int {
    try testJournalStorageWriteBoundaryOrder()
    try testJournalStoragePreRenameCrashRecovery()
    try testJournalStoragePostRenameCrashRecovery()
    try testJournalStorageFinalUnlinkCrashRecovery()
    try testCanonicalJournalRoundTrip()
    try testJournalRejectsUnknownField()
    try testJournalRejectsNonCanonicalUUIDAndBytes()
    try testJournalRejectsCallerWitnessReplacement()
    try testJournalPhaseEdgesUseReducerAuthority()
    return 9
}

private func testCanonicalJournalRoundTrip() throws {
    let journal = journalStorageFixture()
    let data = try canonicalPartialInstallRepairJournalData(journal)
    try journalStorageRequire(
        try decodeCanonicalPartialInstallRepairJournalStructure(data) == journal,
        "the production journal codec must round-trip one exact canonical witness"
    )
}

private func testJournalRejectsUnknownField() throws {
    let data = try canonicalPartialInstallRepairJournalData(journalStorageFixture())
    var object = try JSONSerialization.jsonObject(with: data) as! [String: Any]
    object["unexpectedAuthority"] = "forbidden"
    let mutated = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    try expectJournalCodecFailure(.nonExactFieldSet) {
        _ = try decodeCanonicalPartialInstallRepairJournalStructure(mutated)
    }
}

private func testJournalRejectsNonCanonicalUUIDAndBytes() throws {
    let nonCanonicalUUID = journalStorageFixture(
        transactionID: "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE"
    )
    try expectJournalCodecFailure(.nonCanonicalTransactionID) {
        _ = try decodeCanonicalPartialInstallRepairJournalStructure(
            try canonicalPartialInstallRepairJournalData(nonCanonicalUUID)
        )
    }

    let canonical = try canonicalPartialInstallRepairJournalData(journalStorageFixture())
    let object = try JSONSerialization.jsonObject(with: canonical)
    let compact = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    try expectJournalCodecFailure(.nonCanonicalBytes) {
        _ = try decodeCanonicalPartialInstallRepairJournalStructure(compact)
    }
}

private func testJournalRejectsCallerWitnessReplacement() throws {
    let expected = journalStorageFixture(phase: "artifacts-removed")
    let replacement = journalStorageFixture(phase: "user-removed")
    try journalStorageRequire(
        !partialInstallRepairOpenedWitnessMatches(opened: replacement, expected: expected),
        "an opened journal with a different phase must not replace the caller's complete witness"
    )
}

private func testJournalPhaseEdgesUseReducerAuthority() throws {
    try journalStorageRequire(
        PartialInstallRepairPhase.prepared.permitsJournalTransition(to: .artifactsRemoved),
        "prepared must permit exactly artifacts-removed"
    )
    try journalStorageRequire(
        !PartialInstallRepairPhase.prepared.permitsJournalTransition(to: .userRemoved),
        "journal persistence must reject a skipped reducer phase"
    )
    try journalStorageRequire(
        !PartialInstallRepairPhase.groupRemoved.permitsJournalTransition(to: .userRemoved),
        "journal persistence must reject phase rollback"
    )
    try journalStorageRequire(
        PartialInstallRepairPhase.principalRemoved.nextJournalPhase == nil,
        "principal-removed must be terminal for durable phase writes"
    )
}

private func journalStorageFixture(
    phase: String = "prepared",
    transactionID: String = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
) -> PartialInstallRepairJournal {
    PartialInstallRepairJournal(
        schemaVersion: "nimi.macos-local-development-partial-install-repair/v2",
        transactionID: transactionID,
        phase: phase,
        accountName: "_nimiruntimedev",
        identifier: 499,
        groupGeneratedUID: "11111111-1111-4111-8111-111111111111",
        userGeneratedUID: "22222222-2222-4222-8222-222222222222",
        sourceHelperSHA256: String(repeating: "a", count: 64),
        sourceHelperCDHash: String(repeating: "b", count: 40),
        sourcePrincipalCarrierContractVersion: 2,
        residueClass: "legacy_v2_disabled_user_delete_only",
        authenticationEvidenceSHA256: String(repeating: "c", count: 64),
        planDigest: String(repeating: "d", count: 64),
        rootKeyId: "nimi-macos-dev-record-fixture",
        policyDigest: String(repeating: "e", count: 64)
    )
}

private func expectJournalCodecFailure(
    _ expected: PartialInstallRepairJournalCodecFailure,
    operation: () throws -> Void
) throws {
    do {
        try operation()
        throw JournalStorageNativeFailure(message: "expected journal codec failure \(expected.rawValue)")
    } catch let failure as PartialInstallRepairJournalCodecFailure {
        try journalStorageRequire(failure == expected, "journal codec returned the wrong negative state")
    }
}

private func testJournalStorageWriteBoundaryOrder() throws {
    try withJournalStorageHarness { harness in
        var observed: [PartialInstallRepairJournalCrashPoint] = []
        try harness.persistence.writeAtomically(harness.initialData, validateExisting: harness.validate) {
            observed.append($0)
        }
        try journalStorageRequire(
            observed == [
                .stagingCreated,
                .stagingBytesWritten,
                .stagingFileSynced,
                .beforeRename,
                .afterRenameBeforeDirectorySync,
                .journalDirectorySynced,
            ],
            "a successful journal commit must expose every mutation boundary in syscall order"
        )
        var removal: [PartialInstallRepairJournalCrashPoint] = []
        try harness.persistence.remove(validate: harness.validate) { removal.append($0) }
        try journalStorageRequire(
            removal == [.afterFinalUnlinkBeforeDirectorySync, .finalUnlinkDirectorySynced],
            "a successful final unlink must expose unlink then directory-fsync boundaries"
        )
    }
}

private func testJournalStoragePreRenameCrashRecovery() throws {
    let boundaries: [PartialInstallRepairJournalCrashPoint] = [
        .stagingCreated,
        .stagingBytesWritten,
        .stagingFileSynced,
        .beforeRename,
    ]
    for boundary in boundaries {
        try withJournalStorageHarness { harness in
            try harness.persistence.writeAtomically(harness.initialData, validateExisting: harness.validate)
            try expectJournalStorageInterruption(boundary) {
                try harness.persistence.writeAtomically(harness.nextData, validateExisting: harness.validate) {
                    if $0 == boundary { throw PartialInstallRepairPersistenceInterruption(boundary: boundary) }
                }
            }
            try journalStorageRequire(
                try harness.persistence.read() == harness.initialData,
                "a pre-rename interruption must preserve the last named journal at \(boundary.rawValue)"
            )
            try journalStorageRequire(
                try harness.persistence.contains(harness.stagingName),
                "a pre-rename interruption must leave the exact staging vnode for recovery at \(boundary.rawValue)"
            )
            try harness.persistence.recoverInterruptedWrite()
            try journalStorageRequire(
                try !harness.persistence.contains(harness.stagingName),
                "staging recovery must unlink and directory-fsync the validated staging vnode at \(boundary.rawValue)"
            )
            try journalStorageRequire(
                try harness.persistence.read() == harness.initialData,
                "staging recovery must not alter the named journal at \(boundary.rawValue)"
            )
        }
    }
    try withJournalStorageHarness { harness in
        try harness.persistence.writeAtomically(harness.initialData, validateExisting: harness.validate)
        do {
            try harness.persistence.writeAtomically(harness.nextData, validateExisting: harness.validate) { boundary in
                guard boundary == .beforeRename else { return }
                let stagingPath = harness.root.appendingPathComponent(harness.stagingName)
                guard unlink(stagingPath.path) == 0 else {
                    throw JournalStorageNativeFailure(message: "replace staging unlink failed: \(errno)")
                }
                try Data("replacement".utf8).write(to: stagingPath)
                guard chmod(stagingPath.path, 0o600) == 0 else {
                    throw JournalStorageNativeFailure(message: "replace staging chmod failed: \(errno)")
                }
            }
            throw JournalStorageNativeFailure(message: "a replaced pre-rename staging vnode was accepted")
        } catch is PartialInstallRepairPersistenceInterruption {
            throw JournalStorageNativeFailure(message: "the replacement probe must fail as a vnode mismatch, not a crash")
        } catch {
            try journalStorageRequire(
                try harness.persistence.read() == harness.initialData,
                "a replaced staging vnode must not overwrite the validated named journal"
            )
            try journalStorageRequire(
                try !harness.persistence.contains(harness.stagingName),
                "normal failure recovery must remove the exact validated replacement staging vnode"
            )
        }
    }
}

private func testJournalStoragePostRenameCrashRecovery() throws {
    for boundary in [
        PartialInstallRepairJournalCrashPoint.afterRenameBeforeDirectorySync,
        .journalDirectorySynced,
    ] {
        try withJournalStorageHarness { harness in
            try harness.persistence.writeAtomically(harness.initialData, validateExisting: harness.validate)
            try expectJournalStorageInterruption(boundary) {
                try harness.persistence.writeAtomically(harness.nextData, validateExisting: harness.validate) {
                    if $0 == boundary { throw PartialInstallRepairPersistenceInterruption(boundary: boundary) }
                }
            }
            try journalStorageRequire(
                try !harness.persistence.contains(harness.stagingName),
                "a post-rename interruption must leave no staging entry at \(boundary.rawValue)"
            )
            try journalStorageRequire(
                try harness.persistence.read() == harness.nextData,
                "the atomically renamed journal must remain independently valid at \(boundary.rawValue)"
            )
            try harness.persistence.recoverInterruptedWrite()
            try journalStorageRequire(
                try harness.persistence.read() == harness.nextData,
                "post-rename recovery must preserve the valid named journal at \(boundary.rawValue)"
            )
        }
    }
}

private func testJournalStorageFinalUnlinkCrashRecovery() throws {
    for boundary in [
        PartialInstallRepairJournalCrashPoint.afterFinalUnlinkBeforeDirectorySync,
        .finalUnlinkDirectorySynced,
    ] {
        try withJournalStorageHarness { harness in
            try harness.persistence.writeAtomically(harness.initialData, validateExisting: harness.validate)
            try expectJournalStorageInterruption(boundary) {
                try harness.persistence.remove(validate: harness.validate) {
                    if $0 == boundary { throw PartialInstallRepairPersistenceInterruption(boundary: boundary) }
                }
            }
            try journalStorageRequire(
                try !harness.persistence.contains(harness.journalName),
                "the temp-filesystem outcome after final unlink must be absent at \(boundary.rawValue)"
            )
            try journalStorageRequire(
                try !harness.persistence.contains(harness.stagingName),
                "final unlink must never manufacture a staging entry at \(boundary.rawValue)"
            )
        }
    }
}

private struct JournalStorageHarness {
    let root: URL
    let persistence: PartialInstallRepairJournalPersistence
    let journalName = "partial-install-repair-transaction.json"
    let stagingName = "partial-install-repair-transaction.staging"
    let initialData = Data("{\"phase\":\"prepared\"}\n".utf8)
    let nextData = Data("{\"phase\":\"principal-removed\"}\n".utf8)

    func validate(_ data: Data) throws {
        try journalStorageRequire(
            data == initialData || data == nextData,
            "the persistence engine must not accept an unrecognized journal projection"
        )
    }
}

private struct JournalStorageNativeFailure: Error, CustomStringConvertible {
    let message: String
    var description: String { message }
}

private func withJournalStorageHarness(_ operation: (JournalStorageHarness) throws -> Void) throws {
    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("nimi-journal-storage-\(UUID().uuidString.lowercased())", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
    guard chmod(root.path, 0o700) == 0 else {
        throw JournalStorageNativeFailure(message: "chmod temp journal parent failed: \(errno)")
    }
    defer { try? FileManager.default.removeItem(at: root) }
    let journalName = "partial-install-repair-transaction.json"
    let stagingName = "partial-install-repair-transaction.staging"
    let persistence = PartialInstallRepairJournalPersistence(
        parentPath: root.path,
        journalName: journalName,
        stagingName: stagingName,
        owner: getuid(),
        group: getgid(),
        parentMode: 0o700,
        fileMode: 0o600,
        maximumSize: 64 * 1024,
        failure: { probe, state, message in
            JournalStorageNativeFailure(message: "\(probe):\(state): \(message)")
        },
        posixFailure: { operation, path, errorCode in
            JournalStorageNativeFailure(message: "\(operation) failed for \(path): \(errorCode)")
        }
    )
    try operation(JournalStorageHarness(root: root, persistence: persistence))
}

private func expectJournalStorageInterruption(
    _ expected: PartialInstallRepairJournalCrashPoint,
    operation: () throws -> Void
) throws {
    do {
        try operation()
        throw JournalStorageNativeFailure(message: "expected interruption at \(expected.rawValue)")
    } catch let interruption as PartialInstallRepairPersistenceInterruption {
        try journalStorageRequire(interruption.boundary == expected, "the injected interruption boundary changed")
    }
}

private func journalStorageRequire(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    guard try condition() else { throw JournalStorageNativeFailure(message: message) }
}
