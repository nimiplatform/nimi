import Darwin
import Foundation

func withEphemeralCodeSigningSearchList<T>(
    signingKeychain: String,
    operation: (String) throws -> T
) throws -> T {
    let homeDirectory = try createEphemeralCodeSigningHome()
    let result: Result<T, Error>
    do {
        try configureCodeSigningSearchList(homeDirectory: homeDirectory, signingKeychain: signingKeychain)
        result = .success(try operation(homeDirectory))
    } catch {
        result = .failure(error)
    }

    do {
        try removeEphemeralCodeSigningHome(homeDirectory)
    } catch {
        switch result {
        case .success:
            throw error
        case .failure(let operationError):
            throw fail(
                "runtime-service-repair-required",
                "remove the private temporary code-signing search list before retrying",
                "The code-signing transaction failed (\(diagnosticMessage(operationError))) and its private search-list cleanup also failed (\(diagnosticMessage(error)))."
            )
        }
    }
    return try result.get()
}

func requireTrustedCommandHome(_ homeDirectory: String) throws {
    if homeDirectory == "/var/empty" { return }
    try validateEphemeralCodeSigningHome(homeDirectory)
}

private func createEphemeralCodeSigningHome() throws -> String {
    var template = Array("/private/tmp/nimi-dev-codesign-home.XXXXXX".utf8CString)
    guard template.withUnsafeMutableBufferPointer({ mkdtemp($0.baseAddress!) }) != nil else {
        throw posixFailure("create private code-signing search-list home", "/private/tmp")
    }
    let homeDirectory = String(cString: template)
    do {
        guard chown(homeDirectory, 0, 0) == 0, chmod(homeDirectory, 0o700) == 0 else {
            throw posixFailure("secure private code-signing search-list home", homeDirectory)
        }
        _ = try secureMetadata(homeDirectory, type: S_IFDIR, uid: 0, gid: 0, mode: 0o700)
        let library = "\(homeDirectory)/Library"
        let preferences = "\(library)/Preferences"
        try ensureDirectory(library, owner: 0, group: 0, mode: 0o700)
        try ensureDirectory(preferences, owner: 0, group: 0, mode: 0o700)
        return homeDirectory
    } catch {
        try? FileManager.default.removeItem(atPath: homeDirectory)
        throw error
    }
}

private func configureCodeSigningSearchList(homeDirectory: String, signingKeychain: String) throws {
    try validateEphemeralCodeSigningHome(homeDirectory)
    _ = try secureMetadata(signingKeychain, type: S_IFREG, uid: 0, gid: 0, mode: 0o600, links: 1)
    _ = try runFixedCommand(
        "/usr/bin/security",
        ["list-keychains", "-d", "user", "-s", signingKeychain, systemKeychainPath],
        homeDirectory: homeDirectory
    )
    let listed = try runFixedCommand(
        "/usr/bin/security",
        ["list-keychains", "-d", "user"],
        homeDirectory: homeDirectory
    )
    let paths = String(data: listed.stdout, encoding: .utf8)?
        .split(separator: "\n")
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .map { value in
            value.hasPrefix("\"") && value.hasSuffix("\"")
                ? String(value.dropFirst().dropLast())
                : value
        }
    guard paths == [signingKeychain, systemKeychainPath] else {
        throw fail(
            "runtime-service-repair-required",
            "inspect the isolated code-signing Keychain search list",
            "The private code-signing process did not retain the exact admitted Keychain search list."
        )
    }
}

private func validateEphemeralCodeSigningHome(_ homeDirectory: String) throws {
    let prefix = "/private/tmp/nimi-dev-codesign-home."
    let suffix = homeDirectory.dropFirst(prefix.count)
    guard homeDirectory.hasPrefix(prefix), suffix.count == 6,
          suffix.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber) }) else {
        throw fail(
            "runtime-service-repair-required",
            "inspect the private code-signing search-list home",
            "A helper subprocess requested an untrusted HOME directory."
        )
    }
    _ = try secureMetadata(homeDirectory, type: S_IFDIR, uid: 0, gid: 0, mode: 0o700)
    guard let resolved = realpath(homeDirectory, nil) else {
        throw posixFailure("resolve private code-signing search-list home", homeDirectory)
    }
    defer { free(resolved) }
    guard String(cString: resolved) == homeDirectory else {
        throw fail(
            "runtime-service-repair-required",
            "inspect the private code-signing search-list home",
            "The private code-signing search-list home is not canonical."
        )
    }
}

private func removeEphemeralCodeSigningHome(_ homeDirectory: String) throws {
    try validateEphemeralCodeSigningHome(homeDirectory)
    try FileManager.default.removeItem(atPath: homeDirectory)
    guard !FileManager.default.fileExists(atPath: homeDirectory) else {
        throw fail(
            "runtime-service-repair-required",
            "remove the private code-signing search-list home",
            "The private code-signing search-list home remained after cleanup."
        )
    }
}
