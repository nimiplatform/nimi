import CryptoKit
import Darwin
import Foundation
import Security

struct InstallerFailure: Error {
    let reasonCode: String
    let actionHint: String
    let message: String
    let details: [String: Any]
}

func fail(_ code: String, _ hint: String, _ message: String, details: [String: Any] = [:]) -> InstallerFailure {
    InstallerFailure(reasonCode: code, actionHint: hint, message: message, details: details)
}

func requireThat(_ condition: @autoclosure () -> Bool, _ code: String, _ hint: String, _ message: String, details: [String: Any] = [:]) throws {
    guard condition() else { throw fail(code, hint, message, details: details) }
}

func emit(_ value: [String: Any], to handle: FileHandle = .standardOutput) throws {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes])
    try handle.write(contentsOf: data + Data([0x0a]))
}

func requireRoot() throws {
    try requireThat(
        getuid() == 0 && geteuid() == 0,
        "macos-dev-administrator-authorization-required",
        "run_the_confirmed_operation_with_sudo",
        "This operation requires uid 0."
    )
}

func requireCanonicalPath(_ path: String) throws {
    let url = URL(fileURLWithPath: path)
    let standardized = url.standardizedFileURL.path
    let resolved = url.resolvingSymlinksInPath().path
    try requireThat(
        standardized == resolved,
        "runtime-service-untrusted", "inspect_the_exact_fixed_path",
        "A fixed path resolves through an unexpected filesystem alias.",
        details: ["path": path, "standardized": standardized, "resolved": resolved]
    )
}

func requireFile(_ path: String, owner: uid_t, group: gid_t, mode: mode_t, executable: Bool = false) throws {
    var value = stat()
    let valid = lstat(path, &value) == 0 && value.st_mode & S_IFMT == S_IFREG
        && value.st_uid == owner && value.st_gid == group && value.st_mode & 0o777 == mode
        && (!executable || value.st_mode & 0o111 != 0)
    try requireThat(valid, "runtime-service-untrusted", "repair_the_exact_fixed_file", "A fixed file has unsafe metadata.", details: ["path": path])
    try requireNoExtendedACL(path, symbolicLink: false)
}

private func treeURLs(_ root: String) throws -> [URL] {
    var metadata = stat()
    try requireThat(
        lstat(root, &metadata) == 0,
        "runtime-service-untrusted", "inspect_the_exact_fixed_path",
        "A protected tree root cannot be inspected.", details: ["path": root]
    )
    let kind = metadata.st_mode & S_IFMT
    if kind == S_IFREG {
        return [URL(fileURLWithPath: root, isDirectory: false)]
    }
    try requireThat(
        kind == S_IFDIR,
        "runtime-service-untrusted", "replace_the_unsupported_tree_root",
        "A protected tree root must be a regular file or directory.", details: ["path": root]
    )
    let rootURL = URL(fileURLWithPath: root, isDirectory: true)
    var traversalError: Error?
    let values = FileManager.default.enumerator(
        at: rootURL, includingPropertiesForKeys: nil,
        errorHandler: { _, error in traversalError = error; return false }
    )?.allObjects as? [URL] ?? []
    if let traversalError { throw traversalError }
    return [rootURL] + values
}

func requireRootOwnedTree(_ root: String) throws {
    try requireCanonicalPath(root)
    for url in try treeURLs(root) {
        var value = stat()
        try requireThat(
            lstat(url.path, &value) == 0 && value.st_uid == 0 && value.st_gid == 0,
            "runtime-service-untrusted", "repair_the_root_owned_installation",
            "An installed path is not root:wheel.", details: ["path": url.path]
        )
        let symbolicLink = value.st_mode & S_IFMT == S_IFLNK
        try requireNoExtendedACL(url.path, symbolicLink: symbolicLink)
        if symbolicLink {
            let resolved = url.resolvingSymlinksInPath().path
            try requireThat(
                resolved == root || resolved.hasPrefix("\(root)/"),
                "runtime-service-untrusted", "repair_the_root_owned_installation",
                "An installed symlink escapes its root.", details: ["path": url.path]
            )
        } else {
            try requireThat(
                value.st_mode & 0o022 == 0,
                "runtime-service-untrusted", "repair_the_root_owned_installation",
                "An installed path is writable outside root.", details: ["path": url.path]
            )
        }
    }
}

func secureCopiedTree(_ root: String) throws {
    for url in try treeURLs(root) {
        var value = stat()
        try requireThat(lstat(url.path, &value) == 0, "dev-install-copy-failed", "retry_the_install", "A staged path cannot be inspected.")
        let symbolicLink = value.st_mode & S_IFMT == S_IFLNK
        try removeExtendedACL(url.path, symbolicLink: symbolicLink)
        if symbolicLink {
            try requireThat(lchown(url.path, 0, 0) == 0, "dev-install-copy-failed", "retry_the_install", "A staged symlink cannot be secured.")
            continue
        }
        let mode: mode_t = value.st_mode & S_IFMT == S_IFDIR ? 0o755 : (value.st_mode & 0o111 != 0 ? 0o755 : 0o644)
        try requireThat(
            chown(url.path, 0, 0) == 0 && chmod(url.path, mode) == 0,
            "dev-install-copy-failed", "retry_the_install", "A staged path cannot be secured."
        )
    }
}

private func hasExtendedACL(_ path: String, symbolicLink: Bool) throws -> Bool {
    errno = 0
    let value = path.withCString {
        symbolicLink
            ? acl_get_link_np($0, ACL_TYPE_EXTENDED)
            : acl_get_file($0, ACL_TYPE_EXTENDED)
    }
    if let value {
        acl_free(UnsafeMutableRawPointer(value))
        return true
    }
    if errno == ENOENT || errno == ENOATTR { return false }
    throw fail(
        "runtime-service-untrusted",
        "remove_the_extended_acl_from_the_exact_path",
        "A protected path ACL cannot be inspected.",
        details: ["path": path, "errno": errno]
    )
}

func requireNoExtendedACL(_ path: String, symbolicLink: Bool) throws {
    let present = try hasExtendedACL(path, symbolicLink: symbolicLink)
    try requireThat(
        !present,
        "runtime-service-untrusted",
        "remove_the_extended_acl_from_the_exact_path",
        "A protected path must not carry an extended ACL.",
        details: ["path": path]
    )
}

func removeExtendedACL(_ path: String, symbolicLink: Bool) throws {
    guard try hasExtendedACL(path, symbolicLink: symbolicLink) else { return }
    guard let empty = acl_init(0) else {
        throw fail(
            "dev-install-path-failed",
            "inspect_the_exact_install_path",
            "An empty ACL could not be allocated.",
            details: ["path": path]
        )
    }
    defer { acl_free(UnsafeMutableRawPointer(empty)) }
    let status = path.withCString {
        symbolicLink
            ? acl_set_link_np($0, ACL_TYPE_EXTENDED, empty)
            : acl_set_file($0, ACL_TYPE_EXTENDED, empty)
    }
    try requireThat(
        status == 0,
        "dev-install-path-failed",
        "inspect_the_exact_install_path",
        "An inherited ACL could not be removed.",
        details: ["path": path, "errno": errno]
    )
    try requireNoExtendedACL(path, symbolicLink: symbolicLink)
}

func inspectStaticCode(codePath: String, executablePath: String, identifier: String) throws {
    var executable = stat()
    try requireThat(
        lstat(executablePath, &executable) == 0 && executable.st_mode & S_IFMT == S_IFREG
            && executable.st_mode & 0o111 != 0 && executable.st_mode & 0o022 == 0,
        "runtime-service-untrusted", "rebuild_and_sign_the_candidate",
        "A signed executable has unsafe metadata."
    )
    try requireNoExtendedACL(executablePath, symbolicLink: false)
    var code: SecStaticCode?
    let created = SecStaticCodeCreateWithPath(URL(fileURLWithPath: codePath) as CFURL, [], &code) == errSecSuccess
    let valid = code.map {
        SecStaticCodeCheckValidity($0, SecCSFlags(rawValue: kSecCSStrictValidate | kSecCSCheckAllArchitectures), nil) == errSecSuccess
    } ?? false
    try requireThat(created && valid, "runtime-service-untrusted", "rebuild_and_sign_the_candidate", "Strict code-signing validation failed.", details: ["path": codePath])
    try requireAdHocCodeIdentity(code!, identifier: identifier)
}

func inspectRunningCode(pid: pid_t, identifier: String) throws {
    var dynamicCode: SecCode?
    let attributes = [kSecGuestAttributePid: NSNumber(value: pid)] as CFDictionary
    let found = SecCodeCopyGuestWithAttributes(nil, attributes, [], &dynamicCode) == errSecSuccess
    let valid = dynamicCode.map {
        SecCodeCheckValidity(
            $0,
            SecCSFlags(rawValue: kSecCSStrictValidate | kSecCSCheckAllArchitectures),
            nil
        ) == errSecSuccess
    } ?? false
    try requireThat(found && valid, "runtime-service-untrusted", "inspect_the_live_runtime", "The live Runtime signature is invalid.")
    var staticCode: SecStaticCode?
    try requireThat(
        SecCodeCopyStaticCode(dynamicCode!, [], &staticCode) == errSecSuccess && staticCode != nil,
        "runtime-service-untrusted", "inspect_the_live_runtime",
        "The live Runtime cannot be bound to static code."
    )
    try requireAdHocCodeIdentity(staticCode!, identifier: identifier)
}

private func requireAdHocCodeIdentity(_ code: SecStaticCode, identifier: String) throws {
    var information: CFDictionary?
    let copied = SecCodeCopySigningInformation(code, SecCSFlags(rawValue: kSecCSSigningInformation), &information) == errSecSuccess
    guard copied, let values = information as? [String: Any],
          values[kSecCodeInfoIdentifier as String] as? String == identifier,
          let flags = values[kSecCodeInfoFlags as String] as? NSNumber,
          flags.uint32Value & 0x0000_0002 != 0,
          flags.uint32Value & 0x0001_0000 != 0,
          values[kSecCodeInfoTeamIdentifier as String] == nil,
          values[kSecCodeInfoCertificates as String] == nil else {
        throw fail(
            "runtime-service-untrusted",
            "rebuild_the_fixed_ad_hoc_development_candidate",
            "The local code identity is not the required ad-hoc hardened Runtime identity.",
            details: ["identifier": identifier]
        )
    }
}

func sha256File(_ path: String) throws -> String {
    SHA256.hash(data: try Data(contentsOf: URL(fileURLWithPath: path))).hex
}

struct FixedCommandResult { let status: Int32; let stdout: Data; let stderr: Data }

func runFixedResult(_ executable: String, _ arguments: [String], timeoutSeconds: TimeInterval? = nil) throws -> FixedCommandResult {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    process.environment = ["HOME": "/var/empty", "LANG": "en_US.UTF-8", "PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "TMPDIR": "/private/tmp"]
    let output = Pipe(), errors = Pipe()
    process.standardInput = FileHandle.nullDevice
    process.standardOutput = output
    process.standardError = errors
    try process.run()
    if let timeoutSeconds {
        let deadline = Date().addingTimeInterval(timeoutSeconds)
        while process.isRunning {
            if Date() >= deadline {
                process.terminate()
                usleep(200_000)
                if process.isRunning { kill(process.processIdentifier, SIGKILL) }
                process.waitUntilExit()
                var stderr = errors.fileHandleForReading.readDataToEndOfFile()
                stderr.append(Data("operation timed out\n".utf8))
                return FixedCommandResult(
                    status: 124,
                    stdout: output.fileHandleForReading.readDataToEndOfFile(),
                    stderr: stderr
                )
            }
            usleep(50_000)
        }
    } else {
        process.waitUntilExit()
    }
    return FixedCommandResult(
        status: process.terminationStatus,
        stdout: output.fileHandleForReading.readDataToEndOfFile(),
        stderr: errors.fileHandleForReading.readDataToEndOfFile()
    )
}

@discardableResult
func runFixed(_ executable: String, _ arguments: [String]) throws -> Data {
    let result = try runFixedResult(executable, arguments)
    guard result.status == 0 else {
        throw fail(
            "dev-install-fixed-operation-failed", "inspect_the_reported_fixed_operation",
            String(data: result.stderr.prefix(2000), encoding: .utf8) ?? "A fixed operation failed.",
            details: ["executable": executable, "status": result.status]
        )
    }
    return result.stdout
}

func launchdJobPresent() throws -> Bool {
    let result = try runFixedResult("/bin/launchctl", ["print", "system/\(generatedLaunchDaemonLabel)"])
    if result.status == 0 { return true }
    if result.status == 113 { return false }
    throw fail("runtime-service-unavailable", "inspect_launchd_system_domain", "The launchd job state is unavailable.")
}

func launchdPID() throws -> pid_t {
    let text = String(
        data: try runFixed("/bin/launchctl", ["print", "system/\(generatedLaunchDaemonLabel)"]),
        encoding: .utf8
    ) ?? ""
    guard let match = text.range(of: #"pid = ([1-9][0-9]*)"#, options: .regularExpression),
          let pid = pid_t(String(text[match].split(separator: " ").last ?? "")),
          processIsLive(pid) else {
        throw fail("runtime-service-unavailable", "inspect_launchd_logs", "The Runtime PID is not live.")
    }
    return pid
}

func processIsLive(_ pid: pid_t) -> Bool {
    errno = 0
    if kill(pid, 0) == 0 { return true }
    return errno == EPERM
}

func syncDirectory(_ path: String) throws {
    let descriptor = open(path, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW)
    try requireThat(descriptor >= 0, "runtime-service-repair-required", "inspect_the_exact_install_directory", "An install directory cannot be opened.")
    let result = fsync(descriptor)
    Darwin.close(descriptor)
    try requireThat(result == 0, "runtime-service-repair-required", "inspect_the_exact_install_directory", "An install directory cannot be synchronized.")
}

private extension Digest {
    var hex: String { map { String(format: "%02x", $0) }.joined() }
}
