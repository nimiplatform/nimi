import CryptoKit
import Darwin
import Foundation

let helperInstallPath = "/usr/local/libexec/nimi-macos-dev-security"
let bootstrapHelperInstallPath = generatedBootstrapHelperPath
let systemKeychainPath = "/Library/Keychains/System.keychain"
let runtimeDevRoot = generatedRuntimeDevRoot
let signingProfilePath = "\(runtimeDevRoot)/dev-signing-profile.json"
let signingCleanupRecordPath = generatedSigningCleanupRecordPath
let unprovisionResidualIdentityClosure = generatedUnprovisionResidualIdentityClosure
let signingCustodyRoot = "\(runtimeDevRoot)/custody"
let signingKeychainPath = generatedSigningKeychainPath
let signingHelperIdentityTransitionPolicy = generatedSigningHelperIdentityTransitionPolicy
let signingACLIdentityDigestPolicy = generatedSigningACLIdentityDigestPolicy
let signingKeychainPasswordCommitPolicy = generatedSigningKeychainPasswordCommitPolicy
let signingKeychainPasswordService = generatedSigningKeychainPasswordService
let signingKeychainPasswordAccount = "macos_local_development_v1"
let runtimeActiveRoot = "\(runtimeDevRoot)/active"
let runtimeStateRoot = generatedRuntimeStateRoot
let runtimeRollbackRoot = "\(runtimeDevRoot)/rollback"
let runtimeTransactionRoot = "\(runtimeDevRoot)/transactions"
let installationJournalPath = generatedRuntimeInstallationJournalPath
let runtimePrincipalJournalPath = generatedRuntimePrincipalJournalPath
let runtimeServiceMutationSerializationPolicy = generatedRuntimeServiceMutationSerializationPolicy
let runtimeExecutablePath = generatedRuntimeExecutablePath
let trustRecordRoot = generatedTrustRecordRoot
let desktopApplicationPath = generatedDesktopApplicationPath
let launchDaemonPath = generatedLaunchDaemonPath
let launchDaemonLabel = generatedLaunchDaemonLabel
let runtimeAccountName = generatedRuntimeAccountName
let runtimePrincipalCarrierContractVersion = generatedRuntimePrincipalCarrierContractVersion
let runtimeAccountUIDMinimum = generatedRuntimeAccountUIDMinimum
let runtimeAccountUIDMaximum = generatedRuntimeAccountUIDMaximum
let runtimeHomeDirectory = generatedRuntimeHomeDirectory
let runtimeLoginShell = generatedRuntimeLoginShell
let runtimePasswordRecordValue = generatedRuntimePasswordRecordValue
let runtimeDirectoryServiceHiddenRecordValue = generatedRuntimeDirectoryServiceHiddenRecordValue
let runtimeAuthenticationAuthorityPosture = generatedRuntimeAuthenticationAuthorityPosture
let runtimeForbiddenAuthenticationMaterialAttributes = generatedRuntimeForbiddenAuthenticationMaterialAttributes
let runtimeForbiddenDelegatedWriterAttributePrefix = generatedRuntimeForbiddenDelegatedWriterAttributePrefix
let runtimeForbiddenExplicitGroupMembershipAttributes = generatedRuntimeForbiddenExplicitGroupMembershipAttributes
let runtimeForbiddenExplicitGroupMembershipPolicy = generatedRuntimeForbiddenExplicitGroupMembershipPolicy
let runtimeNegativeAttributeValuePolicy = generatedRuntimeNegativeAttributeValuePolicy
let runtimeGeneratedUIDPolicy = generatedRuntimeGeneratedUIDPolicy
let runtimeDirectoryServiceAPI = generatedRuntimeDirectoryServiceAPI
let runtimeDirectoryServiceCommitPolicy = generatedRuntimeDirectoryServiceCommitPolicy
let runtimeDirectoryServiceRecoveryPolicy = generatedRuntimeDirectoryServiceRecoveryPolicy
let runtimeDirectoryServiceExistingIdentityPolicy = generatedRuntimeDirectoryServiceExistingIdentityPolicy
let runtimeKeychainAccounts = generatedRuntimeKeychainAccounts
let runtimeInstallationTransactionScope = generatedRuntimeInstallationTransactionScope
let runtimeInstallationRollbackOrder = generatedRuntimeInstallationRollbackOrder
let runtimeInstallationCommitBoundary = generatedRuntimeInstallationCommitBoundary
let runtimeUpdateAdmission = generatedRuntimeUpdateAdmission
let runtimePartialInstallRepairJournalPath = generatedRuntimePartialInstallRepairJournalPath
let runtimePartialInstallRepairJournalStagingPath = generatedRuntimePartialInstallRepairJournalStagingPath
let runtimePartialInstallRepairPolicy = generatedRuntimePartialInstallRepairPolicy
let runtimeNormalRepairResidueClass = generatedRuntimeNormalRepairResidueClass
let runtimeNormalRepairSourcePrincipalCarrierContractVersion = generatedRuntimeNormalRepairSourcePrincipalCarrierContractVersion
let runtimeNormalRepairAuthenticationAuthorityPosture = generatedRuntimeNormalRepairAuthenticationAuthorityPosture
let runtimeLegacyRepairResidueClass = generatedRuntimeLegacyRepairResidueClass
let runtimeLegacyRepairSourcePrincipalCarrierContractVersion = generatedRuntimeLegacyRepairSourcePrincipalCarrierContractVersion
let runtimeLegacyRepairAuthenticationAuthorityAttribute = generatedRuntimeLegacyRepairAuthenticationAuthorityAttribute
let runtimeLegacyRepairAuthenticationAuthorityValueType = generatedRuntimeLegacyRepairAuthenticationAuthorityValueType
let runtimeLegacyRepairAuthenticationAuthorityExactValueCount = generatedRuntimeLegacyRepairAuthenticationAuthorityExactValueCount
let runtimeLegacyRepairAuthenticationAuthorityExactValue = generatedRuntimeLegacyRepairAuthenticationAuthorityExactValue
let runtimeLegacyRepairOtherAuthenticationMaterialAttributes = generatedRuntimeLegacyRepairOtherAuthenticationMaterialAttributes
let runtimeLegacyRepairOtherAuthenticationMaterialPosture = generatedRuntimeLegacyRepairOtherAuthenticationMaterialPosture
let runtimeLegacyRepairNormalCurrentProfileDisposition = generatedRuntimeLegacyRepairNormalCurrentProfileDisposition
let runtimeLegacyRepairJournalAuthorityBindingRequiredFields = generatedRuntimeLegacyRepairJournalAuthorityBindingRequiredFields
let runtimeLegacyRepairSourceHelperIdentityStability = generatedRuntimeLegacyRepairSourceHelperIdentityStability
let runtimeLegacyRepairJournalSchemaVersion = generatedRuntimeLegacyRepairJournalSchemaVersion
let runtimeLegacyRepairJournalPhases = generatedRuntimeLegacyRepairJournalPhases
let runtimeLegacyRepairJournalOwnership = generatedRuntimeLegacyRepairJournalOwnership
let runtimeLegacyRepairJournalStagingRecovery = generatedRuntimeLegacyRepairJournalStagingRecovery
let runtimeLegacyRepairFreshBootstrapAbsenceReceipt = generatedRuntimeLegacyRepairFreshBootstrapAbsenceReceipt

struct DevSecurityFailure: LocalizedError, CustomStringConvertible {
    let reasonCode: String
    let actionHint: String
    let message: String

    var errorDescription: String? { message }
    var description: String { message }
}

func fail(_ reasonCode: String, _ actionHint: String, _ message: String) -> DevSecurityFailure {
    DevSecurityFailure(reasonCode: reasonCode, actionHint: actionHint, message: message)
}

func withRuntimeServiceMutationLock<T>(_ operation: () throws -> T) throws -> T {
    guard runtimeServiceMutationSerializationPolicy == "nonblocking_exclusive_flock_on_the_exact_open_root_owned_final_helper_vnode_spans_install_restart_reset_uninstall_release-record-signing_and_unprovision;_lock_contention_fails_before_mutation" else {
        throw fail(
            "runtime-service-repair-required",
            "repair the generated macOS Runtime mutation profile",
            "The Runtime service mutation serialization policy is not admitted."
        )
    }
    let descriptor = open(helperInstallPath, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
    guard descriptor >= 0 else { throw posixFailure("open the fixed mutation-lock helper vnode", helperInstallPath) }
    defer { close(descriptor) }
    var metadata = stat()
    guard fstat(descriptor, &metadata) == 0,
          metadata.st_mode & S_IFMT == S_IFREG,
          metadata.st_uid == 0,
          metadata.st_gid == 0,
          metadata.st_nlink == 1,
          metadata.st_mode & 0o022 == 0 else {
        throw fail(
            "runtime-service-repair-required",
            "reinstall the exact root-owned development security helper",
            "The Runtime mutation-lock vnode has unsafe metadata."
        )
    }
    guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
        if errno == EWOULDBLOCK {
            throw fail(
                "runtime-service-repair-required",
                "wait for the existing macOS development security transaction to finish",
                "Another exact development security helper transaction already owns the mutation lock."
            )
        }
        throw posixFailure("lock the fixed development security helper vnode", helperInstallPath)
    }
    defer { flock(descriptor, LOCK_UN) }
    return try operation()
}

func diagnosticMessage(_ error: Error) -> String {
    if let failure = error as? DevSecurityFailure { return failure.message }
    return error.localizedDescription
}

@discardableResult
func requireRootMutationContext() throws -> String {
    try requireRootUID()
    let current = try requireExactRunningHelperPath(helperInstallPath)
    let running = try inspectRunningSignedCode(getpid())
    let installed = try inspectSignedCode(helperInstallPath)
    guard sameSignedIdentity(running, installed) else {
        throw fail("runtime-service-untrusted", "reinstall the exact signed helper", "The running signed helper no longer matches its fixed on-disk vnode.")
    }
    return current
}

@discardableResult
func requireProvisioningBootstrapMutationContext(unsignedFinalCandidateRequired: Bool) throws -> String {
    try requireRootUID()
    let current = try requireExactRunningHelperPath(bootstrapHelperInstallPath)
    let running = try inspectRunningBootstrapCode(getpid())
    let installed = try inspectBootstrapCode(bootstrapHelperInstallPath)
    guard sameBootstrapIdentity(running, installed) else {
        throw fail(
            "runtime-service-untrusted",
            "reinstall the immutable bootstrap helper",
            "The running bootstrap identity no longer matches its fixed on-disk vnode."
        )
    }
    if unsignedFinalCandidateRequired {
        try requireSecureHelper(at: helperInstallPath)
        let candidate = try inspectBootstrapCode(helperInstallPath)
        guard sameBootstrapIdentity(installed, candidate),
              try sha256File(bootstrapHelperInstallPath) == sha256File(helperInstallPath) else {
            throw fail(
                "runtime-service-untrusted",
                "reinstall both exact bootstrap helper copies",
                "The nonexecuted final helper candidate does not equal the immutable bootstrap input."
            )
        }
    }
    return current
}

func requireProvisioningFinalizerMutationContext() throws {
    _ = try requireRootMutationContext()
    try requireSecureHelper(at: bootstrapHelperInstallPath)
    let parent = getppid()
    guard parent > 1,
          try processExecutablePath(parent) == bootstrapHelperInstallPath else {
        throw fail(
            "macos-dev-privileged-context-required",
            "run final custody closure only as a child of the immutable bootstrap",
            "The signed final helper does not have the exact live bootstrap parent."
        )
    }
    let runningParent = try inspectRunningBootstrapCode(parent)
    let installedBootstrap = try inspectBootstrapCode(bootstrapHelperInstallPath)
    guard sameBootstrapIdentity(runningParent, installedBootstrap),
          kill(parent, 0) == 0 else {
        throw fail(
            "process-replaced",
            "restart the exact development trust provisioning transaction",
            "The immutable bootstrap parent exited or changed identity during custody closure."
        )
    }
}

@discardableResult
func requireCleanupMutationContext() throws -> String {
    try requireRootUID()
    let current = try canonicalCurrentExecutablePath()
    guard [bootstrapHelperInstallPath, helperInstallPath].contains(current) else {
        throw fail(
            "macos-dev-privileged-context-required",
            "run the exact confirmed cleanup helper with sudo",
            "Development trust cleanup must execute from one fixed helper path."
        )
    }
    try requireSecureHelper(at: current)
    if current == bootstrapHelperInstallPath {
        let running = try inspectRunningBootstrapCode(getpid())
        let installed = try inspectBootstrapCode(current)
        guard sameBootstrapIdentity(running, installed) else {
            throw fail("runtime-service-untrusted", "reinstall the cleanup helper", "The running cleanup helper was replaced.")
        }
    } else {
        let running = try inspectRunningSignedCode(getpid())
        let installed = try inspectSignedCode(current)
        guard sameSignedIdentity(running, installed) else {
            throw fail("runtime-service-untrusted", "reinstall the exact signed cleanup helper", "The running signed cleanup helper was replaced.")
        }
    }
    return current
}

func retireProvisioningBootstrapHelper() throws {
    _ = try requireProvisioningBootstrapMutationContext(unsignedFinalCandidateRequired: false)
    _ = try inspectSignedCode(helperInstallPath)
    guard FileManager.default.fileExists(atPath: signingProfilePath) else {
        throw fail(
            "runtime-service-repair-required",
            "complete or roll back development trust provisioning",
            "The immutable bootstrap cannot retire before the signed profile is committed."
        )
    }
    guard unlink(bootstrapHelperInstallPath) == 0 else {
        throw posixFailure("retire immutable provisioning bootstrap helper", bootstrapHelperInstallPath)
    }
    try syncDirectory((bootstrapHelperInstallPath as NSString).deletingLastPathComponent)
    var metadata = stat()
    guard lstat(bootstrapHelperInstallPath, &metadata) != 0, errno == ENOENT else {
        throw fail("runtime-service-repair-required", "remove the bootstrap helper residue", "The bootstrap helper remains after retirement.")
    }
}

func requireSecureInstalledHelper() throws {
    try requireSecureHelper(at: helperInstallPath)
}

private func requireRootUID() throws {
    guard geteuid() == 0, getuid() == 0 else {
        throw fail(
            "macos-dev-privileged-context-required",
            "run the exact printed helper command with sudo after approving the reported machine changes",
            "The macOS development security helper requires real and effective uid 0."
        )
    }
}

private func requireExactRunningHelperPath(_ expected: String) throws -> String {
    let current = try canonicalCurrentExecutablePath()
    guard current == expected else {
        throw fail(
            "macos-dev-privileged-context-required",
            "run the exact fixed helper path with sudo",
            "The running helper path is \(current), expected \(expected)."
        )
    }
    try requireSecureHelper(at: expected)
    return current
}

func requireSecureHelper(at path: String) throws {
    var metadata = stat()
    guard lstat(path, &metadata) == 0,
          (metadata.st_mode & S_IFMT) == S_IFREG,
          metadata.st_uid == 0,
          metadata.st_gid == 0,
          metadata.st_nlink == 1,
          metadata.st_mode & 0o022 == 0,
          metadata.st_mode & 0o111 != 0 else {
        throw fail(
            "runtime-service-repair-required",
            "reinstall the root-owned macOS development security helper",
            "The installed development security helper has unsafe ownership, mode, type, or link metadata."
        )
    }
    guard let resolved = realpath(path, nil) else {
        throw posixFailure("resolve installed development security helper", path)
    }
    defer { free(resolved) }
    guard String(cString: resolved) == path else {
        throw fail(
            "runtime-service-repair-required",
            "reinstall the root-owned macOS development security helper",
            "The development security helper path is not canonical."
        )
    }
}

func canonicalCurrentExecutablePath() throws -> String {
    var size: UInt32 = 0
    guard _NSGetExecutablePath(nil, &size) == -1, size > 1, size <= UInt32(PATH_MAX) else {
        throw fail("runtime-service-untrusted", "inspect the running helper executable", "Cannot determine the running helper path size.")
    }
    var buffer = [CChar](repeating: 0, count: Int(size))
    guard _NSGetExecutablePath(&buffer, &size) == 0,
          let resolved = realpath(buffer, nil) else {
        throw posixFailure("resolve running development security helper", "current-executable")
    }
    defer { free(resolved) }
    return String(cString: resolved)
}

private func processExecutablePath(_ pid: pid_t) throws -> String {
    var buffer = [CChar](repeating: 0, count: 4096)
    let length = proc_pidpath(pid, &buffer, UInt32(buffer.count))
    guard length > 0, let path = String(validatingUTF8: buffer) else {
        throw fail(
            "process-replaced",
            "restart the exact development trust provisioning transaction",
            "Cannot resolve the provisioning parent executable."
        )
    }
    return path
}

private func sameBootstrapIdentity(_ left: BootstrapCodeIdentity, _ right: BootstrapCodeIdentity) -> Bool {
    left.identifier == right.identifier
        && left.teamId == right.teamId
        && left.cdhash == right.cdhash
        && left.designatedRequirement == right.designatedRequirement
}

private func sameSignedIdentity(_ left: SignedCodeIdentity, _ right: SignedCodeIdentity) -> Bool {
    left.identifier == right.identifier
        && left.teamId == right.teamId
        && left.cdhash == right.cdhash
        && left.designatedRequirement == right.designatedRequirement
        && left.leafSPKISHA256 == right.leafSPKISHA256
        && left.hardenedRuntime == right.hardenedRuntime
}

func secureMetadata(_ path: String, type: mode_t, uid: uid_t, gid: gid_t, mode: mode_t, links: nlink_t? = nil) throws -> stat {
    var metadata = stat()
    guard lstat(path, &metadata) == 0,
          metadata.st_mode & S_IFMT == type,
          metadata.st_uid == uid,
          metadata.st_gid == gid,
          metadata.st_mode & 0o777 == mode,
          links == nil || metadata.st_nlink == links else {
        throw fail(
            "runtime-service-repair-required",
            "repair or reinstall the macOS development Runtime profile",
            "Unsafe filesystem metadata at fixed path: \(path)"
        )
    }
    return metadata
}

func ensureDirectory(_ path: String, owner: uid_t, group: gid_t, mode: mode_t) throws {
    var metadata = stat()
    if lstat(path, &metadata) == 0 {
        guard metadata.st_mode & S_IFMT == S_IFDIR else {
            throw fail("runtime-service-repair-required", "remove the conflicting fixed-path object and retry", "Expected a directory at \(path).")
        }
    } else if errno == ENOENT {
        try FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: false)
    } else {
        throw posixFailure("inspect directory", path)
    }
    guard chown(path, owner, group) == 0, chmod(path, mode) == 0 else {
        throw posixFailure("secure directory", path)
    }
    _ = try secureMetadata(path, type: S_IFDIR, uid: owner, gid: group, mode: mode)
}

func writeAtomicRootFile(_ data: Data, to path: String, mode: mode_t) throws {
    let parent = (path as NSString).deletingLastPathComponent
    let temporary = "\(parent)/.\((path as NSString).lastPathComponent).\(UUID().uuidString).tmp"
    let descriptor = open(temporary, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, mode)
    guard descriptor >= 0 else { throw posixFailure("create transaction file", temporary) }
    var failure: Error?
    data.withUnsafeBytes { buffer in
        var offset = 0
        while offset < buffer.count {
            let count = Darwin.write(descriptor, buffer.baseAddress!.advanced(by: offset), buffer.count - offset)
            if count <= 0 {
                failure = posixFailure("write transaction file", temporary)
                break
            }
            offset += count
        }
    }
    if failure == nil && fsync(descriptor) != 0 { failure = posixFailure("sync transaction file", temporary) }
    if close(descriptor) != 0 && failure == nil { failure = posixFailure("close transaction file", temporary) }
    if let failure {
        unlink(temporary)
        throw failure
    }
    guard chown(temporary, 0, 0) == 0, chmod(temporary, mode) == 0 else {
        unlink(temporary)
        throw posixFailure("secure transaction file", temporary)
    }
    guard rename(temporary, path) == 0 else {
        unlink(temporary)
        throw posixFailure("commit transaction file", path)
    }
    try syncDirectory(parent)
}

func syncDirectory(_ path: String) throws {
    let directoryDescriptor = open(path, O_RDONLY | O_CLOEXEC | O_DIRECTORY | O_NOFOLLOW)
    guard directoryDescriptor >= 0 else { throw posixFailure("open transaction parent directory", path) }
    let directorySyncStatus = fsync(directoryDescriptor)
    let directorySyncError = errno
    let directoryCloseStatus = close(directoryDescriptor)
    let directoryCloseError = errno
    if directorySyncStatus != 0 {
        errno = directorySyncError
        throw posixFailure("sync transaction parent directory", path)
    }
    if directoryCloseStatus != 0 {
        errno = directoryCloseError
        throw posixFailure("close transaction parent directory", path)
    }
}

func sha256(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

func sha256File(_ path: String) throws -> String {
    let handle = try FileHandle(forReadingFrom: URL(fileURLWithPath: path))
    defer { try? handle.close() }
    var digest = SHA256()
    while true {
        let data = try handle.read(upToCount: 1024 * 1024) ?? Data()
        if data.isEmpty { break }
        digest.update(data: data)
    }
    return digest.finalize().map { String(format: "%02x", $0) }.joined()
}

struct CommandResult {
    let stdout: Data
    let stderr: Data
    let pid: pid_t
}

@discardableResult
func runFixedCommand(
    _ executable: String,
    _ arguments: [String],
    input: Data? = nil,
    captureLimit: Int = 4 * 1024 * 1024,
    homeDirectory: String = "/var/empty"
) throws -> CommandResult {
    guard executable.hasPrefix("/"), arguments.allSatisfy({ !$0.contains("\0") }) else {
        throw fail("runtime-service-repair-required", "inspect the fixed helper command", "A non-canonical helper subprocess was requested.")
    }
    try requireTrustedCommandHome(homeDirectory)
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    process.environment = [
        "HOME": homeDirectory,
        "LANG": "en_US.UTF-8",
        "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
        "TMPDIR": "/private/tmp",
    ]
    let output = try unlinkedCaptureFile()
    let errors = try unlinkedCaptureFile()
    process.standardOutput = output
    process.standardError = errors
    if let input {
        let source = Pipe()
        process.standardInput = source
        try process.run()
        try source.fileHandleForWriting.write(contentsOf: input)
        try source.fileHandleForWriting.close()
    } else {
        process.standardInput = FileHandle.nullDevice
        try process.run()
    }
    process.waitUntilExit()
    let stdout = try boundedCaptureData(output, limit: captureLimit)
    let stderr = try boundedCaptureData(errors, limit: captureLimit)
    try output.close()
    try errors.close()
    guard stdout.count <= captureLimit, stderr.count <= captureLimit else {
        throw fail("runtime-service-repair-required", "inspect the bounded helper subprocess", "A helper subprocess exceeded its output budget.")
    }
    guard process.terminationReason == .exit, process.terminationStatus == 0 else {
        let diagnostic = String(data: stderr, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        throw fail(
            "runtime-service-repair-required",
            "inspect the macOS development helper subprocess failure",
            "\((executable as NSString).lastPathComponent) failed with status \(process.terminationStatus)\(diagnostic.isEmpty ? "" : ": \(diagnostic.prefix(500))")"
        )
    }
    return CommandResult(stdout: stdout, stderr: stderr, pid: process.processIdentifier)
}

private func unlinkedCaptureFile() throws -> FileHandle {
    var template = Array("/private/tmp/nimi-dev-security-capture.XXXXXX".utf8CString)
    let descriptor = template.withUnsafeMutableBufferPointer { pointer in
        mkstemp(pointer.baseAddress!)
    }
    guard descriptor >= 0 else {
        throw posixFailure("create bounded helper capture", "/private/tmp")
    }
    let path = String(cString: template)
    guard fchmod(descriptor, 0o600) == 0, unlink(path) == 0 else {
        let failure = posixFailure("secure bounded helper capture", path)
        close(descriptor)
        throw failure
    }
    return FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
}

private func boundedCaptureData(_ handle: FileHandle, limit: Int) throws -> Data {
    let size = try handle.seekToEnd()
    guard size <= UInt64(limit) else {
        throw fail(
            "runtime-service-repair-required",
            "inspect the bounded helper subprocess",
            "A helper subprocess exceeded its output budget."
        )
    }
    try handle.seek(toOffset: 0)
    return try handle.readToEnd() ?? Data()
}

func posixFailure(_ operation: String, _ path: String) -> DevSecurityFailure {
    let diagnostic = String(cString: strerror(errno))
    return fail("runtime-service-repair-required", "inspect the fixed macOS development installation", "\(operation) failed for \(path): \(diagnostic)")
}

func emitJSON(_ value: Any, to handle: FileHandle = .standardOutput) throws {
    guard JSONSerialization.isValidJSONObject(value) else {
        throw fail("runtime-service-repair-required", "inspect helper output construction", "The helper attempted to emit invalid JSON.")
    }
    let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) + Data([0x0a])
    try handle.write(contentsOf: data)
}
