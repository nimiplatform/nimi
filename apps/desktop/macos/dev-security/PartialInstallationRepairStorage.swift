import Darwin
import Foundation
import Security

func recoverInterruptedPartialInstallRepairJournalWrite() throws {
    guard runtimePartialInstallRepairJournalStagingPath
            == "\(runtimeDevRoot)/partial-install-repair-transaction.staging",
          (runtimePartialInstallRepairJournalStagingPath as NSString).deletingLastPathComponent
            == runtimeDevRoot else {
        throw repairFailure("The authority-derived partial-install repair staging path is invalid.")
    }
    var pathMetadata = stat()
    if lstat(runtimePartialInstallRepairJournalStagingPath, &pathMetadata) != 0 {
        if errno == ENOENT { return }
        throw posixFailure("inspect partial-install repair journal staging", runtimePartialInstallRepairJournalStagingPath)
    }
    let descriptor = open(runtimePartialInstallRepairJournalStagingPath, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
    guard descriptor >= 0 else {
        throw posixFailure("open partial-install repair journal staging", runtimePartialInstallRepairJournalStagingPath)
    }
    defer { close(descriptor) }
    var descriptorMetadata = stat()
    var stablePathMetadata = stat()
    guard fstat(descriptor, &descriptorMetadata) == 0,
          lstat(runtimePartialInstallRepairJournalStagingPath, &stablePathMetadata) == 0,
          descriptorMetadata.st_mode & S_IFMT == S_IFREG,
          descriptorMetadata.st_uid == 0,
          descriptorMetadata.st_gid == 0,
          descriptorMetadata.st_mode & 0o777 == 0o600,
          descriptorMetadata.st_nlink == 1,
          descriptorMetadata.st_size >= 0,
          descriptorMetadata.st_size <= 64 * 1024,
          descriptorMetadata.st_dev == stablePathMetadata.st_dev,
          descriptorMetadata.st_ino == stablePathMetadata.st_ino else {
        throw repairFailure("The interrupted partial-install repair journal staging node is not the exact transaction-owned vnode.")
    }
    let parentDescriptor = open(runtimeDevRoot, O_RDONLY | O_CLOEXEC | O_DIRECTORY | O_NOFOLLOW)
    guard parentDescriptor >= 0 else {
        throw posixFailure("open RuntimeDev root for journal staging recovery", runtimeDevRoot)
    }
    defer { close(parentDescriptor) }
    var parentMetadata = stat()
    guard fstat(parentDescriptor, &parentMetadata) == 0,
          parentMetadata.st_mode & S_IFMT == S_IFDIR,
          parentMetadata.st_uid == 0,
          parentMetadata.st_gid == 0,
          parentMetadata.st_mode & 0o777 == 0o755 else {
        throw repairFailure("The RuntimeDev root is not the fixed root-owned journal parent.")
    }
    let stagingName = (runtimePartialInstallRepairJournalStagingPath as NSString).lastPathComponent
    let unlinkStatus = stagingName.withCString { unlinkat(parentDescriptor, $0, 0) }
    guard unlinkStatus == 0 else {
        throw posixFailure("remove exact interrupted partial-install repair journal staging", runtimePartialInstallRepairJournalStagingPath)
    }
    try syncDirectory(runtimeDevRoot)
}

func repairPathPresent(_ path: String) throws -> Bool {
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

func repairSocketRoot() throws -> String {
    let desktopRoot = (generatedDesktopSocketPath as NSString).deletingLastPathComponent
    let hostRoot = (generatedLocalAppSocketPath as NSString).deletingLastPathComponent
    guard desktopRoot == hostRoot, desktopRoot == "/private/var/run/nimi-dev" else {
        throw repairFailure("The generated protected socket roots diverge from the fixed repair target.")
    }
    return desktopRoot
}

func requireEmptyRepairDirectory(_ path: String, owner: UInt32, group: UInt32, mode: mode_t) throws {
    _ = try secureMetadata(path, type: S_IFDIR, uid: uid_t(owner), gid: gid_t(group), mode: mode)
    guard try FileManager.default.contentsOfDirectory(atPath: path).isEmpty else {
        throw repairFailure("Repair target directory is not empty: \(path)")
    }
}

func removeEmptyRepairDirectoryIfPresent(_ path: String, owner: UInt32, group: UInt32, mode: mode_t) throws {
    var metadata = stat()
    if lstat(path, &metadata) != 0 {
        if errno == ENOENT { return }
        throw posixFailure("inspect partial-install repair directory", path)
    }
    try requireEmptyRepairDirectory(path, owner: owner, group: group, mode: mode)
    guard rmdir(path) == 0 else { throw posixFailure("remove empty partial-install repair directory", path) }
    try syncDirectory((path as NSString).deletingLastPathComponent)
}

func removeRepairLaunchDaemonIfPresent() throws {
    var metadata = stat()
    if lstat(launchDaemonPath, &metadata) != 0 {
        if errno == ENOENT { return }
        throw posixFailure("inspect partial LaunchDaemon definition", launchDaemonPath)
    }
    try verifyInstalledLaunchDaemonDefinition()
    guard unlink(launchDaemonPath) == 0 else { throw posixFailure("remove partial LaunchDaemon definition", launchDaemonPath) }
    try syncDirectory((launchDaemonPath as NSString).deletingLastPathComponent)
}

func proveRepairTargetsAbsent() throws {
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
    guard try !runtimeAccountRecordsPresent() else {
        throw repairFailure("The Runtime service principal remains after repair.")
    }
}

func writePartialInstallRepairJournal(_ journal: PartialInstallRepairJournal) throws {
    try validatePartialInstallRepairJournal(journal)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .prettyPrinted, .withoutEscapingSlashes]
    var data = try encoder.encode(journal)
    data.append(0x0a)
    try writePartialInstallRepairJournalAtomically(data)
}

func writePartialInstallRepairJournalAtomically(_ data: Data) throws {
    guard !data.isEmpty, data.count <= 64 * 1024 else {
        throw repairFailure("The partial-install repair journal exceeds its admitted write budget.")
    }
    var stagingMetadata = stat()
    guard lstat(runtimePartialInstallRepairJournalStagingPath, &stagingMetadata) != 0, errno == ENOENT else {
        throw repairFailure("The fixed partial-install repair journal staging path is not clean before a write.")
    }
    let descriptor = open(
        runtimePartialInstallRepairJournalStagingPath,
        O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW,
        0o600
    )
    guard descriptor >= 0 else {
        throw posixFailure("create partial-install repair journal staging", runtimePartialInstallRepairJournalStagingPath)
    }
    var descriptorOpen = true
    defer { if descriptorOpen { close(descriptor) } }
    do {
        try data.withUnsafeBytes { buffer in
            var offset = 0
            while offset < buffer.count {
                let count = Darwin.write(descriptor, buffer.baseAddress!.advanced(by: offset), buffer.count - offset)
                guard count > 0 else {
                    throw posixFailure("write partial-install repair journal staging", runtimePartialInstallRepairJournalStagingPath)
                }
                offset += count
            }
        }
        guard fchown(descriptor, 0, 0) == 0,
              fchmod(descriptor, 0o600) == 0,
              fsync(descriptor) == 0 else {
            throw posixFailure("secure and sync partial-install repair journal staging", runtimePartialInstallRepairJournalStagingPath)
        }
        var descriptorMetadata = stat()
        var pathMetadata = stat()
        guard fstat(descriptor, &descriptorMetadata) == 0,
              lstat(runtimePartialInstallRepairJournalStagingPath, &pathMetadata) == 0,
              descriptorMetadata.st_mode & S_IFMT == S_IFREG,
              descriptorMetadata.st_uid == 0,
              descriptorMetadata.st_gid == 0,
              descriptorMetadata.st_mode & 0o777 == 0o600,
              descriptorMetadata.st_nlink == 1,
              descriptorMetadata.st_size == data.count,
              descriptorMetadata.st_dev == pathMetadata.st_dev,
              descriptorMetadata.st_ino == pathMetadata.st_ino else {
            throw repairFailure("The partial-install repair journal staging vnode changed before commit.")
        }
        guard rename(runtimePartialInstallRepairJournalStagingPath, runtimePartialInstallRepairJournalPath) == 0 else {
            throw posixFailure("commit partial-install repair journal", runtimePartialInstallRepairJournalPath)
        }
        guard close(descriptor) == 0 else {
            descriptorOpen = false
            throw posixFailure("close committed partial-install repair journal", runtimePartialInstallRepairJournalPath)
        }
        descriptorOpen = false
        try syncDirectory(runtimeDevRoot)
    } catch {
        if descriptorOpen {
            close(descriptor)
            descriptorOpen = false
        }
        try? recoverInterruptedPartialInstallRepairJournalWrite()
        throw error
    }
}

func updatePartialInstallRepairJournal(_ journal: PartialInstallRepairJournal, phase: String) throws {
    try writePartialInstallRepairJournal(PartialInstallRepairJournal(
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
    ))
}

func readPartialInstallRepairJournal() throws -> PartialInstallRepairJournal {
    _ = try secureMetadata(runtimePartialInstallRepairJournalPath, type: S_IFREG, uid: 0, gid: 0, mode: 0o600, links: 1)
    let data = try Data(contentsOf: URL(fileURLWithPath: runtimePartialInstallRepairJournalPath))
    guard !data.isEmpty, data.count <= 64 * 1024 else {
        throw repairFailure("The partial-install repair journal has an invalid size.")
    }
    let journal = try JSONDecoder().decode(PartialInstallRepairJournal.self, from: data)
    try validatePartialInstallRepairJournal(journal)
    return journal
}

func validatePartialInstallRepairJournal(_ journal: PartialInstallRepairJournal) throws {
    guard journal.schemaVersion == runtimeLegacyRepairJournalSchemaVersion,
          journal.transactionID.range(of: #"^[a-f0-9-]{36}$"#, options: .regularExpression) != nil,
          [
              "prepared", "artifacts-removed", "user-removed", "group-removed", "principal-removed",
          ].contains(journal.phase),
          runtimeLegacyRepairJournalPhases.contains(journal.phase),
          journal.accountName == runtimeAccountName,
          journal.sourceHelperSHA256.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil,
          journal.sourceHelperCDHash.range(of: #"^[a-f0-9]{40}$"#, options: .regularExpression) != nil,
          repairResidueClass(for: journal.sourcePrincipalCarrierContractVersion)?.rawValue == journal.residueClass,
          journal.authenticationEvidenceSHA256.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil,
          journal.planDigest.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil,
          journal.rootKeyId.range(of: #"^[a-z0-9][a-z0-9._-]{7,127}$"#, options: .regularExpression) != nil,
          journal.policyDigest.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil else {
        throw repairFailure("The partial-install repair journal contains an unrecognized authority or phase.")
    }
    let plan = try makeRuntimeAccountCreationPlan(
        identifier: journal.identifier,
        groupGeneratedUID: journal.groupGeneratedUID,
        userGeneratedUID: journal.userGeneratedUID
    )
    guard journal.planDigest == partialInstallRepairPlanDigest(plan) else {
        throw repairFailure("The partial-install repair journal plan digest is invalid.")
    }
    _ = try partialInstallRepairWitness(journal)
}

func removePartialInstallRepairJournal() throws {
    _ = try secureMetadata(runtimePartialInstallRepairJournalPath, type: S_IFREG, uid: 0, gid: 0, mode: 0o600, links: 1)
    guard unlink(runtimePartialInstallRepairJournalPath) == 0 else {
        throw posixFailure("remove partial-install repair journal", runtimePartialInstallRepairJournalPath)
    }
    try syncDirectory(runtimeDevRoot)
}

func repairFailure(_ message: String) -> DevSecurityFailure {
    fail(
        "runtime-service-repair-required",
        "inspect the exact fixed partial-install residue before retrying repair",
        message
    )
}
