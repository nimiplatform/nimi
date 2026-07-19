import CryptoKit
import Darwin
import Foundation

private let electronEntitlements = """
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/></dict></plist>
"""

struct InstallationReceipt {
    let generation: UInt64
    let releaseId: String
    let runtimeSHA256: String
    let desktopCDHash: String
}

func installDevelopmentCandidate(_ candidatePath: String) throws -> InstallationReceipt {
    try requireRootMutationContext()
    try requireNoPartialInstallRepairInProgress()
    let certificateAuthority = try DevelopmentCertificateAuthority()
    let profile = try certificateAuthority.validateInstalledProfile(requirePrivateCustody: true)
    let candidate = try validateCandidateRoot(candidatePath, profile: profile)
    try requireDesktopStopped()
    try recoverInterruptedInstallationIfNeeded()
    let principalPlan = try planFreshRuntimeAccountCreation()
    let generation = try nextInstallerGeneration()
    let transactionID = UUID().uuidString.lowercased()
    let transaction = "\(runtimeTransactionRoot)/\(transactionID)"
    let stagedActive = "\(transaction)/active"
    let stagedLedger = "\(transaction)/installer-ledger.json"
    let stagedApplication = "/Applications/.Nimi Dev.\(UUID().uuidString).staging.app"
    let entitlements = "\(transaction)/electron-entitlements.plist"
    try beginFreshInstallationTransaction(
        transactionID: transactionID,
        principalPlan: principalPlan,
        stagedActive: stagedActive,
        stagedApplication: stagedApplication,
        stagedLedger: stagedLedger
    )
    do {
        try stopLaunchDaemonIfLoaded()
        let principal = try ensureRuntimeAccount(plannedPlan: principalPlan)
        try markInstallationPhase("principal-ready")
        try prepareRuntimeDirectories(principal: principal)
        try ensureDirectory(transaction, owner: 0, group: 0, mode: 0o700)
        try ensureDirectory(stagedActive, owner: 0, group: 0, mode: 0o755)
        try ensureDirectory("\(stagedActive)/bin", owner: 0, group: 0, mode: 0o755)
        try ensureDirectory("\(stagedActive)/trust", owner: 0, group: 0, mode: 0o755)
        try ensureDirectory("\(stagedActive)/trust/protected-local", owner: 0, group: 0, mode: 0o755)
        try ensureDirectory("\(stagedActive)/trust/protected-local/v1", owner: 0, group: 0, mode: 0o755)
        try writeAtomicRootFile(Data(electronEntitlements.utf8), to: entitlements, mode: 0o600)
        try copyCandidateRuntime(candidate.runtimePath, to: "\(stagedActive)/bin/nimi-runtime")
        guard try sha256File("\(stagedActive)/bin/nimi-runtime") == candidate.runtimeSHA256 else {
            throw fail("runtime-service-untrusted", "rebuild the matching macOS development candidate", "Candidate Runtime changed during the privileged snapshot transaction.")
        }
        _ = try runFixedCommand("/usr/bin/ditto", [candidate.applicationPath, stagedApplication])
        try secureApplicationTreeRootOwnership(stagedApplication)
        guard try applicationTreeSHA256(stagedApplication) == candidate.applicationTreeSHA256 else {
            throw fail("runtime-service-untrusted", "rebuild the matching macOS development candidate", "Candidate Desktop tree changed during the privileged snapshot transaction.")
        }

        guard let runtimeIdentity = profile.identities["runtime"],
              let desktopIdentity = profile.identities["desktop"],
              let hostIdentity = profile.identities["local_app_host"] else {
            throw fail("runtime-service-repair-required", "reprovision the local-development identities", "Required role identities are absent from the signing profile.")
        }
        let stagedHost = "\(stagedApplication)/Contents/Frameworks/Nimi Local App Host Dev.app"
        try certificateAuthority.withCodeSigningCustody { keychainPath, homeDirectory in
            try signMachOFile(
                "\(stagedActive)/bin/nimi-runtime",
                identitySHA1: runtimeIdentity.certificateSHA1,
                identifier: runtimeIdentity.signingIdentifier,
                entitlements: nil,
                signingKeychain: keychainPath,
                homeDirectory: homeDirectory
            )
            try signElectronApplication(
                stagedHost,
                identitySHA1: hostIdentity.certificateSHA1,
                entitlements: entitlements,
                signingKeychain: keychainPath,
                homeDirectory: homeDirectory
            )
            try signElectronApplication(
                stagedApplication,
                identitySHA1: desktopIdentity.certificateSHA1,
                entitlements: entitlements,
                excluding: stagedHost,
                signingKeychain: keychainPath,
                homeDirectory: homeDirectory
            )
        }
        try verifySignedCandidate(
            runtimePath: "\(stagedActive)/bin/nimi-runtime",
            applicationPath: stagedApplication,
            profile: profile
        )

        let runtimeDigest = try sha256File("\(stagedActive)/bin/nimi-runtime")
        let buildId = "macos-dev-\(candidate.version)-\(runtimeDigest.prefix(20))"
        let releaseId = "macos-dev-generation-\(generation)-\(runtimeDigest.prefix(20))"
        let rolePaths = [
            "nimi_runtime_service": "\(stagedActive)/bin/nimi-runtime",
            "nimi_desktop": "\(stagedApplication)/Contents/MacOS/Nimi Dev",
            "nimi_local_app_host": "\(stagedHost)/Contents/MacOS/Nimi Local App Host Dev",
        ]
        let records = try createDevelopmentReleaseRecords(
            profile: profile,
            generation: generation,
            buildId: buildId,
            releaseId: releaseId,
            rolePaths: rolePaths
        )
        for (filename, encoded) in records {
            try writeAtomicRootFile(encoded, to: "\(stagedActive)/trust/protected-local/v1/\(filename)", mode: 0o644)
        }
        try stageInstallerGeneration(
            generation,
            releaseId: releaseId,
            runtimeSHA256: runtimeDigest,
            to: stagedLedger
        )
        try markInstallationPhase("candidate-staged")
        try commitCandidate(
            transactionID: transactionID,
            stagedActive: stagedActive,
            stagedApplication: stagedApplication,
            stagedLedger: stagedLedger
        )
        try writeAtomicRootFile(candidate.launchDaemonData, to: launchDaemonPath, mode: 0o644)
        _ = try runFixedCommand("/usr/bin/plutil", ["-lint", launchDaemonPath])
        try markInstallationPhase("plist-installed")
        let provision = try runFixedCommand(runtimeExecutablePath, ["macos-protected-state-provision"])
        try validateFreshProvisionReceipt(provision)
        try markInstallationPhase("custody-ready")
        try startLaunchDaemon()
        try markInstallationPhase("launchd-activated")
        _ = try waitForHealthyDevelopmentService(allowCommittedTransaction: true)
        try markInstallationPhase("service-healthy")
        let desktop = try inspectSignedCode(desktopApplicationPath, checkNested: true)
        try markInstallationPhase("commit-decided")
        try finalizeInstallationJournal()
        _ = try waitForHealthyDevelopmentService()
        return InstallationReceipt(
            generation: generation,
            releaseId: releaseId,
            runtimeSHA256: runtimeDigest,
            desktopCDHash: desktop.cdhash
        )
    } catch {
        let original = error
        do {
            try recoverInterruptedInstallationIfNeeded()
        } catch let recoveryError {
            throw fail(
                "runtime-service-repair-required",
                "inspect the root-owned installation journal and rollback before retrying",
                "Candidate installation failed and rollback could not complete: \(diagnosticMessage(original)); rollback: \(diagnosticMessage(recoveryError))"
            )
        }
        throw original
    }
}

private func validateFreshProvisionReceipt(_ result: CommandResult) throws {
    guard result.stdout.count > 0, result.stdout.count <= 64 * 1024,
          let value = try JSONSerialization.jsonObject(with: result.stdout) as? [String: Any],
          Set(value.keys) == Set(["schemaVersion", "disposition", "stateRoot", "runtimePath"]),
          (value["schemaVersion"] as? NSNumber)?.intValue == 1,
          value["disposition"] as? String == "created",
          value["stateRoot"] as? String == runtimeStateRoot,
          value["runtimePath"] as? String == runtimeExecutablePath else {
        throw fail("runtime-service-repair-required", "inspect the Runtime custody provision receipt", "Fresh Runtime custody did not return one exact created receipt.")
    }
}

private struct CandidateRoot {
    let applicationPath: String
    let applicationTreeSHA256: String
    let launchDaemonData: Data
    let runtimePath: String
    let runtimeSHA256: String
    let version: String
}

private func validateCandidateRoot(_ input: String, profile: DevelopmentSigningProfile) throws -> CandidateRoot {
    guard input.hasPrefix("/"), !input.contains("\0"), input == (input as NSString).standardizingPath else {
        throw fail("runtime-service-untrusted", "rebuild the candidate under .nimi/local", "Candidate root must be a canonical absolute path.")
    }
    var metadata = stat()
    guard lstat(input, &metadata) == 0,
          metadata.st_mode & S_IFMT == S_IFDIR,
          metadata.st_uid >= 500,
          metadata.st_mode & 0o077 == 0 else {
        throw fail("runtime-service-untrusted", "rebuild the unprivileged candidate before the root transaction", "Candidate root metadata is invalid.")
    }
    let candidateOwner = metadata.st_uid
    let manifestPath = "\(input)/layout-manifest.json"
    let manifestData = try readCandidateRegularFile(manifestPath, owner: candidateOwner, maximumSize: 64 * 1024)
    guard let manifest = try JSONSerialization.jsonObject(with: manifestData) as? [String: Any],
          manifest["schemaVersion"] as? String == "nimi.macos-local-development-candidate/v1",
          manifest["compileTimeProfile"] as? String == "macos_local_development_v1",
          manifest["posture"] as? String == "unsigned_local_development_candidate_requires_privileged_sign_install_transaction",
          manifest["releaseRootKeyId"] as? String == profile.rootKeyId,
          let version = manifest["version"] as? String,
          version.range(of: #"^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$"#, options: .regularExpression) != nil,
          let expectedRuntimeHash = manifest["runtimeSha256"] as? String,
          expectedRuntimeHash.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil,
          let expectedLaunchDaemonHash = manifest["launchDaemonSha256"] as? String,
          expectedLaunchDaemonHash == generatedLaunchDaemonSHA256,
          let expectedApplicationTreeHash = manifest["desktopApplicationTreeSha256"] as? String,
          expectedApplicationTreeHash.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil else {
        throw fail("runtime-service-untrusted", "rebuild the matching macOS development candidate", "Candidate manifest does not match the admitted local-development profile.")
    }
    let runtimePath = "\(input)/RuntimeDev/bin/nimi-runtime"
    guard try hashCandidateRegularFile(runtimePath, owner: candidateOwner, maximumSize: 512 * 1024 * 1024) == expectedRuntimeHash else {
        throw fail("runtime-service-untrusted", "rebuild the matching macOS development candidate", "Candidate Runtime digest does not match its candidate manifest.")
    }
    let candidateLaunchDaemonPath = "\(input)/ai.nimi.runtime.dev.plist"
    let launchDaemonData = try readCandidateRegularFile(candidateLaunchDaemonPath, owner: candidateOwner, maximumSize: 64 * 1024)
    guard sha256(launchDaemonData) == expectedLaunchDaemonHash else {
        throw fail("runtime-service-untrusted", "regenerate the macOS development profile and candidate", "Candidate LaunchDaemon digest does not match the generated authority projection.")
    }
    let applicationPath = "\(input)/Nimi Dev.app"
    guard lstat(applicationPath, &metadata) == 0,
          metadata.st_mode & S_IFMT == S_IFDIR,
          metadata.st_uid == candidateOwner else {
        throw fail("runtime-service-untrusted", "rebuild the matching macOS development candidate", "Candidate Desktop application is absent or not a directory.")
    }
    return CandidateRoot(
        applicationPath: applicationPath,
        applicationTreeSHA256: expectedApplicationTreeHash,
        launchDaemonData: launchDaemonData,
        runtimePath: runtimePath,
        runtimeSHA256: expectedRuntimeHash,
        version: version
    )
}

private func readCandidateRegularFile(_ path: String, owner: uid_t, maximumSize: off_t) throws -> Data {
    let descriptor = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
    guard descriptor >= 0 else { throw posixFailure("open candidate file", path) }
    defer { close(descriptor) }
    var metadata = stat()
    guard fstat(descriptor, &metadata) == 0,
          metadata.st_mode & S_IFMT == S_IFREG,
          metadata.st_uid == owner,
          metadata.st_nlink == 1,
          metadata.st_size > 0,
          metadata.st_size <= maximumSize else {
        throw fail("runtime-service-untrusted", "rebuild the matching macOS development candidate", "Candidate file metadata is invalid: \(path)")
    }
    var result = Data()
    result.reserveCapacity(Int(metadata.st_size))
    var buffer = [UInt8](repeating: 0, count: 1024 * 1024)
    while true {
        let count = Darwin.read(descriptor, &buffer, buffer.count)
        if count == 0 { break }
        guard count > 0 else { throw posixFailure("read candidate file", path) }
        result.append(buffer, count: count)
        guard result.count <= Int(maximumSize) else {
            throw fail("runtime-service-untrusted", "rebuild the matching macOS development candidate", "Candidate file exceeded its declared bound: \(path)")
        }
    }
    var after = stat()
    guard fstat(descriptor, &after) == 0,
          after.st_dev == metadata.st_dev,
          after.st_ino == metadata.st_ino,
          after.st_size == metadata.st_size,
          result.count == Int(metadata.st_size) else {
        throw fail("runtime-service-untrusted", "rebuild the matching macOS development candidate", "Candidate file changed while being read: \(path)")
    }
    return result
}

private func hashCandidateRegularFile(_ path: String, owner: uid_t, maximumSize: off_t) throws -> String {
    let descriptor = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
    guard descriptor >= 0 else { throw posixFailure("open candidate file", path) }
    defer { close(descriptor) }
    var metadata = stat()
    guard fstat(descriptor, &metadata) == 0,
          metadata.st_mode & S_IFMT == S_IFREG,
          metadata.st_uid == owner,
          metadata.st_nlink == 1,
          metadata.st_size > 0,
          metadata.st_size <= maximumSize else {
        throw fail("runtime-service-untrusted", "rebuild the matching macOS development candidate", "Candidate file metadata is invalid: \(path)")
    }
    var digest = SHA256()
    var total: off_t = 0
    var buffer = [UInt8](repeating: 0, count: 1024 * 1024)
    while true {
        let count = Darwin.read(descriptor, &buffer, buffer.count)
        if count == 0 { break }
        guard count > 0 else { throw posixFailure("read candidate file", path) }
        digest.update(data: Data(buffer.prefix(count)))
        total += off_t(count)
        guard total <= maximumSize else {
            throw fail("runtime-service-untrusted", "rebuild the matching macOS development candidate", "Candidate file exceeded its declared bound: \(path)")
        }
    }
    var after = stat()
    guard fstat(descriptor, &after) == 0,
          after.st_dev == metadata.st_dev,
          after.st_ino == metadata.st_ino,
          after.st_size == metadata.st_size,
          total == metadata.st_size else {
        throw fail("runtime-service-untrusted", "rebuild the matching macOS development candidate", "Candidate file changed while being hashed: \(path)")
    }
    return digest.finalize().map { String(format: "%02x", $0) }.joined()
}

private func copyCandidateRuntime(_ source: String, to destination: String) throws {
    let sourceDescriptor = open(source, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
    guard sourceDescriptor >= 0 else { throw posixFailure("open candidate Runtime", source) }
    defer { close(sourceDescriptor) }
    let destinationDescriptor = open(destination, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0o755)
    guard destinationDescriptor >= 0 else { throw posixFailure("create staged Runtime", destination) }
    var failed: Error?
    var buffer = [UInt8](repeating: 0, count: 1024 * 1024)
    while failed == nil {
        let count = Darwin.read(sourceDescriptor, &buffer, buffer.count)
        if count == 0 { break }
        if count < 0 { failed = posixFailure("read candidate Runtime", source); break }
        var offset = 0
        while offset < count {
            let written = buffer.withUnsafeBytes { bytes in
                Darwin.write(destinationDescriptor, bytes.baseAddress!.advanced(by: offset), count - offset)
            }
            if written <= 0 { failed = posixFailure("write staged Runtime", destination); break }
            offset += written
        }
    }
    if failed == nil && fsync(destinationDescriptor) != 0 { failed = posixFailure("sync staged Runtime", destination) }
    if close(destinationDescriptor) != 0 && failed == nil { failed = posixFailure("close staged Runtime", destination) }
    if let failed { unlink(destination); throw failed }
    guard chown(destination, 0, 0) == 0, chmod(destination, 0o755) == 0 else {
        unlink(destination)
        throw posixFailure("secure staged Runtime", destination)
    }
}

private func signElectronApplication(
    _ application: String,
    identitySHA1: String,
    entitlements: String,
    excluding excludedRoot: String? = nil,
    signingKeychain: String,
    homeDirectory: String
) throws {
    var codeFiles = [String]()
    var bundles = [String]()
    guard let enumerator = FileManager.default.enumerator(
        at: URL(fileURLWithPath: application),
        includingPropertiesForKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey],
        options: [.skipsHiddenFiles]
    ) else {
        throw fail("runtime-service-untrusted", "rebuild the Electron candidate", "Cannot enumerate Electron code for signing.")
    }
    for case let url as URL in enumerator {
        let path = url.path
        if let excludedRoot, path == excludedRoot || path.hasPrefix("\(excludedRoot)/") {
            if path == excludedRoot { enumerator.skipDescendants() }
            continue
        }
        let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey])
        if values.isSymbolicLink == true { continue }
        if values.isDirectory == true, ["app", "framework", "xpc"].contains(url.pathExtension.lowercased()) {
            bundles.append(path)
        } else if values.isRegularFile == true, try isMachO(path) {
            codeFiles.append(path)
        }
    }
    for path in codeFiles.sorted(by: deeperPathFirst) {
        let useEntitlements = path.contains("/Contents/MacOS/")
        try signMachOFile(
            path,
            identitySHA1: identitySHA1,
            identifier: nil,
            entitlements: useEntitlements ? entitlements : nil,
            signingKeychain: signingKeychain,
            homeDirectory: homeDirectory
        )
    }
    for path in bundles.sorted(by: deeperPathFirst) where path != application {
        try signBundle(
            path,
            identitySHA1: identitySHA1,
            entitlements: path.hasSuffix(".app") ? entitlements : nil,
            signingKeychain: signingKeychain,
            homeDirectory: homeDirectory
        )
    }
    try signBundle(
        application,
        identitySHA1: identitySHA1,
        entitlements: entitlements,
        signingKeychain: signingKeychain,
        homeDirectory: homeDirectory
    )
}

private func signMachOFile(
    _ path: String,
    identitySHA1: String,
    identifier: String?,
    entitlements: String?,
    signingKeychain: String,
    homeDirectory: String
) throws {
    var arguments = [
        "--force", "--sign", identitySHA1,
        "--keychain", signingKeychain,
        "--options", "runtime", "--timestamp=none",
    ]
    if let identifier { arguments += ["--identifier", identifier] }
    if let entitlements { arguments += ["--entitlements", entitlements] }
    arguments.append(path)
    _ = try runFixedCommand("/usr/bin/codesign", arguments, homeDirectory: homeDirectory)
}

private func signBundle(
    _ path: String,
    identitySHA1: String,
    entitlements: String?,
    signingKeychain: String,
    homeDirectory: String
) throws {
    var arguments = [
        "--force", "--sign", identitySHA1,
        "--keychain", signingKeychain,
        "--options", "runtime", "--timestamp=none",
    ]
    if let entitlements { arguments += ["--entitlements", entitlements] }
    arguments.append(path)
    _ = try runFixedCommand("/usr/bin/codesign", arguments, homeDirectory: homeDirectory)
}

private func isMachO(_ path: String) throws -> Bool {
    let handle = try FileHandle(forReadingFrom: URL(fileURLWithPath: path))
    defer { try? handle.close() }
    let prefix = try handle.read(upToCount: 4) ?? Data()
    guard prefix.count == 4 else { return false }
    return [
        Data([0xfe, 0xed, 0xfa, 0xce]), Data([0xce, 0xfa, 0xed, 0xfe]),
        Data([0xfe, 0xed, 0xfa, 0xcf]), Data([0xcf, 0xfa, 0xed, 0xfe]),
        Data([0xca, 0xfe, 0xba, 0xbe]), Data([0xbe, 0xba, 0xfe, 0xca]),
    ].contains(prefix)
}

private func deeperPathFirst(_ left: String, _ right: String) -> Bool {
    let leftDepth = left.split(separator: "/").count
    let rightDepth = right.split(separator: "/").count
    return leftDepth == rightDepth ? left < right : leftDepth > rightDepth
}

private func verifySignedCandidate(runtimePath: String, applicationPath: String, profile: DevelopmentSigningProfile) throws {
    _ = try runFixedCommand("/usr/bin/codesign", ["--verify", "--strict", "--verbose=4", runtimePath])
    _ = try runFixedCommand("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=4", applicationPath])
    let runtime = try inspectSignedCode(runtimePath)
    let desktop = try inspectSignedCode(applicationPath, checkNested: true)
    let hostPath = "\(applicationPath)/Contents/Frameworks/Nimi Local App Host Dev.app"
    let host = try inspectSignedCode(hostPath, checkNested: true)
    let expected: [(SignedCodeIdentity, DevelopmentIdentity?)] = [
        (runtime, profile.identities["runtime"]),
        (desktop, profile.identities["desktop"]),
        (host, profile.identities["local_app_host"]),
    ]
    guard expected.allSatisfy({ identity, policy in
        policy != nil && identity.identifier == policy!.signingIdentifier && identity.teamId.isEmpty
            && identity.leafSPKISHA256 == policy!.leafSPKISHA256 && identity.hardenedRuntime
    }) else {
        throw fail("runtime-service-untrusted", "rebuild and reinstall the local-development candidate", "A signed candidate role failed its exact local-CA identity policy.")
    }
    for executable in [runtimePath, "\(applicationPath)/Contents/MacOS/Nimi Dev", "\(hostPath)/Contents/MacOS/Nimi Local App Host Dev"] {
        let architectures = try runFixedCommand("/usr/bin/lipo", ["-archs", executable]).stdout
        guard String(data: architectures, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) == "arm64" else {
            throw fail("runtime-service-untrusted", "rebuild the native arm64 development candidate", "Candidate role is not exact arm64: \(executable)")
        }
    }
}

private func secureApplicationTreeRootOwnership(_ root: String) throws {
    _ = try runFixedCommand("/usr/sbin/chown", ["-R", "-P", "root:wheel", root])
    var paths = [root]
    guard let enumerator = FileManager.default.enumerator(
        at: URL(fileURLWithPath: root),
        includingPropertiesForKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey],
        options: []
    ) else {
        throw fail("runtime-service-repair-required", "inspect staged application ownership", "Staged Desktop tree cannot be enumerated.")
    }
    for case let url as URL in enumerator { paths.append(url.path) }
    for path in paths.sorted() {
        guard path == root || path.hasPrefix("\(root)/") else {
            throw fail("runtime-service-untrusted", "rebuild the Electron candidate", "A staged application node escaped the fixed application root.")
        }
        var metadata = stat()
        guard lstat(path, &metadata) == 0, metadata.st_uid == 0, metadata.st_gid == 0 else {
            throw fail("runtime-service-repair-required", "inspect staged application ownership", "Staged application ownership is unsafe: \(path)")
        }
        switch metadata.st_mode & S_IFMT {
        case S_IFDIR:
            let secured = metadata.st_mode & 0o777 & ~mode_t(0o022)
            guard secured & 0o500 == 0o500, chmod(path, secured) == 0 else {
                throw posixFailure("secure staged application directory", path)
            }
        case S_IFREG:
            guard metadata.st_nlink == 1 else {
                throw fail("runtime-service-untrusted", "rebuild the Electron candidate", "A staged application file has multiple hard links: \(path)")
            }
            let secured = metadata.st_mode & 0o777 & ~mode_t(0o022)
            guard secured & 0o400 == 0o400, chmod(path, secured) == 0 else {
                throw posixFailure("secure staged application file", path)
            }
        case S_IFLNK:
            try validateInternalApplicationSymlink(path, root: root)
        default:
            throw fail("runtime-service-untrusted", "rebuild the Electron candidate", "A staged application contains a forbidden filesystem node: \(path)")
        }
    }
    var rootMetadata = stat()
    guard lstat(root, &rootMetadata) == 0,
          rootMetadata.st_mode & S_IFMT == S_IFDIR,
          rootMetadata.st_uid == 0,
          rootMetadata.st_gid == 0,
          rootMetadata.st_mode & 0o022 == 0 else {
        throw fail("runtime-service-repair-required", "inspect staged application ownership", "Staged Desktop ownership could not be secured.")
    }
}

private struct ApplicationTreeRow {
    let kind: String
    let relative: String
    let value: String
}

private func applicationTreeSHA256(_ root: String) throws -> String {
    guard let enumerator = FileManager.default.enumerator(
        at: URL(fileURLWithPath: root),
        includingPropertiesForKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey],
        options: []
    ) else {
        throw fail("runtime-service-untrusted", "rebuild the Electron candidate", "Cannot enumerate the staged Desktop tree for integrity verification.")
    }
    var rows = [ApplicationTreeRow]()
    for case let url as URL in enumerator {
        let path = url.path
        guard path.hasPrefix("\(root)/") else {
            throw fail("runtime-service-untrusted", "rebuild the Electron candidate", "A staged Desktop integrity path escaped its root.")
        }
        let relative = String(path.dropFirst(root.count + 1))
        guard !relative.isEmpty, !relative.contains("\0") else {
            throw fail("runtime-service-untrusted", "rebuild the Electron candidate", "A staged Desktop integrity path is invalid.")
        }
        var metadata = stat()
        guard lstat(path, &metadata) == 0 else { throw posixFailure("inspect staged Desktop tree", path) }
        switch metadata.st_mode & S_IFMT {
        case S_IFDIR:
            rows.append(ApplicationTreeRow(kind: "directory", relative: relative, value: ""))
        case S_IFREG:
            rows.append(ApplicationTreeRow(kind: "file", relative: relative, value: try sha256File(path)))
        case S_IFLNK:
            rows.append(ApplicationTreeRow(kind: "symlink", relative: relative, value: try symbolicLinkTarget(path)))
        default:
            throw fail("runtime-service-untrusted", "rebuild the Electron candidate", "A staged Desktop integrity path has a forbidden type: \(path)")
        }
    }
    rows.sort { left, right in
        Data(left.relative.utf8).lexicographicallyPrecedes(Data(right.relative.utf8))
    }
    var digest = SHA256()
    for row in rows {
        for value in [row.kind, row.relative, row.value] {
            digest.update(data: Data(value.utf8))
            digest.update(data: Data([0]))
        }
    }
    return digest.finalize().map { String(format: "%02x", $0) }.joined()
}

private func validateInternalApplicationSymlink(_ path: String, root: String) throws {
    let target = try symbolicLinkTarget(path)
    guard !target.hasPrefix("/"), !target.contains("\0") else {
        throw fail("runtime-service-untrusted", "rebuild the Electron candidate", "A staged application symlink has an invalid target: \(path)")
    }
    let parent = (path as NSString).deletingLastPathComponent
    let lexicalTarget = ((parent as NSString).appendingPathComponent(target) as NSString).standardizingPath
    guard lexicalTarget == root || lexicalTarget.hasPrefix("\(root)/"),
          let resolved = realpath(path, nil) else {
        throw fail("runtime-service-untrusted", "rebuild the Electron candidate", "A staged application symlink escapes or does not resolve inside the application: \(path)")
    }
    defer { free(resolved) }
    let resolvedTarget = String(cString: resolved)
    guard resolvedTarget == root || resolvedTarget.hasPrefix("\(root)/") else {
        throw fail("runtime-service-untrusted", "rebuild the Electron candidate", "A staged application symlink resolves outside the application: \(path)")
    }
}

private func symbolicLinkTarget(_ path: String) throws -> String {
    var buffer = [CChar](repeating: 0, count: Int(PATH_MAX) + 1)
    let length = readlink(path, &buffer, Int(PATH_MAX))
    guard length > 0,
          length < Int(PATH_MAX),
          let target = String(
              bytes: buffer.prefix(length).map({ UInt8(bitPattern: $0) }),
              encoding: .utf8
          ) else {
        throw fail("runtime-service-untrusted", "rebuild the Electron candidate", "A staged application symlink has an invalid target: \(path)")
    }
    return target
}
