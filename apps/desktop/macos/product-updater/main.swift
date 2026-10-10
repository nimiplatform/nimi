import AppKit
import CryptoKit
import Security
import Darwin

// Fixed product installer bridge, not an arbitrary privileged command API.
// Generated build constants are sealed in the signed Mach-O by packaging.
let fm = FileManager.default
let appPath = "/Applications/Nimi.app"
let helperPath = appPath + "/Contents/Helpers/Nimi Product Updater"
enum UpdateFailure: String, Error {
    case trust = "UPDATE_INSTALLER_TRUST_FAILED", key = "UPDATE_TRUST_NOT_CONFIGURED"
    case metadata = "UPDATE_METADATA_INVALID", expired = "UPDATE_METADATA_EXPIRED"
    case bytes = "UPDATE_ASSET_DIGEST_MISMATCH", parent = "UPDATE_PARENT_EXIT_FAILED"
    case install = "UPDATE_INSTALL_FAILED", handoff = "UPDATE_RUNTIME_HANDOFF_FAILED"
    case request = "UPDATE_HANDOFF_INVALID", auth = "UPDATE_AUTHORIZATION_CANCELED"
}
func require(_ value: Bool, _ failure: UpdateFailure) throws { if !value { throw failure } }
func json(_ value: Any) throws -> Data { try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) }
func emit(_ value: Any) { if let data = try? json(value) { FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10])) } }
func record(_ value: [String: Any], at file: String) throws {
    try json(value).write(to: URL(fileURLWithPath: file), options: [.atomic])
    try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file)
}
func regularFile(_ file: String, uid: uid_t? = nil) throws -> UInt64 {
    var info = stat()
    try require(lstat(file, &info) == 0 && (info.st_mode & S_IFMT) == S_IFREG, .request)
    if let uid = uid { try require(info.st_uid == uid && info.st_mode & 0o077 == 0, .request) }
    return UInt64(info.st_size)
}
func hashFile(_ file: String) throws -> String {
    let handle = try FileHandle(forReadingFrom: URL(fileURLWithPath: file)); defer { try? handle.close() }
    var digest = SHA256()
    while let data = try handle.read(upToCount: 1024 * 1024), !data.isEmpty { digest.update(data: data) }
    return digest.finalize().map { String(format: "%02x", $0) }.joined()
}
func codeTrust(_ file: String, identifier: String) -> Bool {
    var code: SecStaticCode?, requirement: SecRequirement?
    let text = "anchor apple generic and identifier \"\(identifier)\" and certificate leaf[subject.OU] = \"\(updateTeamId)\" and certificate leaf[field.1.2.840.113635.100.6.1.13] exists"
    return SecStaticCodeCreateWithPath(URL(fileURLWithPath: file) as CFURL, [], &code) == errSecSuccess
        && SecRequirementCreateWithString(text as CFString, [], &requirement) == errSecSuccess
        && code != nil && SecStaticCodeCheckValidity(code!, SecCSFlags(rawValue: kSecCSStrictValidate | kSecCSCheckAllArchitectures), requirement) == errSecSuccess
}
func run(_ executable: String, _ arguments: [String]) throws -> (Int32, String) {
    let process = Process(); process.executableURL = URL(fileURLWithPath: executable); process.arguments = arguments
    process.environment = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "C"]
    let pipe = Pipe(); process.standardOutput = pipe; process.standardError = pipe
    try process.run()
    let data = pipe.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
    return (process.terminationStatus, String(data: data, encoding: .utf8) ?? "")
}
func packageTrust(_ file: String) throws {
    let signature = try run("/usr/sbin/pkgutil", ["--check-signature", file])
    try require(signature.0 == 0 && signature.1.contains("Status: signed by a developer certificate issued by Apple for distribution")
        && signature.1.range(of: "1\\. Developer ID Installer: [^\\n]+\\(\(updateTeamId)\\)", options: .regularExpression) != nil, .trust)
    let assessment = try run("/usr/sbin/spctl", ["--assess", "--type", "install", "--verbose=2", file])
    try require(assessment.0 == 0 && assessment.1.split(separator: "\n").contains("source=Notarized Developer ID"), .trust)
}
func version(_ text: String) throws -> [String] {
    let expression = try NSRegularExpression(pattern: "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-(beta|rc)\\.([1-9][0-9]*))?$")
    guard let match = expression.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { throw UpdateFailure.metadata }
    return (1...5).map { index in Range(match.range(at: index), in: text).map { String(text[$0]) } ?? "" }
}
func compare(_ a: String, _ b: String) throws -> Int {
    let left = try version(a), right = try version(b)
    for index in 0...2 { let order = left[index].compare(right[index], options: .numeric); if order != .orderedSame { return order == .orderedAscending ? -1 : 1 } }
    let rank: (String) -> Int = { $0 == "beta" ? 0 : $0 == "rc" ? 1 : 2 }
    if rank(left[3]) != rank(right[3]) { return rank(left[3]) < rank(right[3]) ? -1 : 1 }
    let order = (left[4].isEmpty ? "0" : left[4]).compare(right[4].isEmpty ? "0" : right[4], options: .numeric)
    return order == .orderedSame ? 0 : order == .orderedAscending ? -1 : 1
}
func date(_ value: Any?) -> Date? {
    guard let text = value as? String else { return nil }
    let parser = ISO8601DateFormatter(); parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return parser.date(from: text) ?? ISO8601DateFormatter().date(from: text)
}
func keys(_ object: [String: Any], _ expected: [String]) throws { try require(Set(object.keys) == Set(expected), .metadata) }
struct Job {
    let object: [String: Any], release: [String: Any], asset: [String: Any], uid: uid_t
    let package: String, parentPid: pid_t, result: String, releaseId: String, requestHash: String
}
func readJob(_ file: String) throws -> Job {
    try require(!updatePublicKey.isEmpty, .key)
    let fileSize = try regularFile(file); try require(fileSize <= 128 * 1024, .request)
    let input = try FileHandle(forReadingFrom: URL(fileURLWithPath: file)); defer { try? input.close() }
    let request = try input.read(upToCount: 128 * 1024 + 1) ?? Data()
    try require(request.count == fileSize && request.count <= 128 * 1024, .request)
    guard let object = try JSONSerialization.jsonObject(with: request) as? [String: Any],
          let uid = object["ownerUid"] as? UInt32, uid > 0,
          let parent = object["parentPid"] as? Int32, parent > 1,
          let package = object["packagePath"] as? String, let result = object["resultPath"] as? String,
          let envelope = object["envelope"] as? [String: String], let raw = Data(base64Encoded: envelope["payload"] ?? ""),
          let signature = Data(base64Encoded: envelope["signature"] ?? ""), let key = Data(base64Encoded: updatePublicKey),
          let release = try JSONSerialization.jsonObject(with: raw) as? [String: Any] else { throw UpdateFailure.request }
    _ = try regularFile(file, uid: uid)
    try require(object["schema"] as? String == "nimi-product-install/v1" && object["consentApproved"] as? Bool == true
        && object["criticalCleanupComplete"] as? Bool == true, .request)
    try require(geteuid() == 0 || getuid() == uid, .request)
    try require(raw.count <= 64 * 1024 && signature.count == 64 && key.count == 32, .metadata)
    try require(try Curve25519.Signing.PublicKey(rawRepresentation: key).isValidSignature(signature, for: raw), .trust)
    try keys(release, ["schema", "releaseId", "version", "channel", "target", "publishedAt", "expiresAt", "sourceRevision", "components", "compatibility", "asset"])
    guard let releaseVersion = release["version"] as? String, let releaseId = release["releaseId"] as? String,
          let source = release["sourceRevision"] as? String, let components = release["components"] as? [String: [String: String]],
          let compatibility = release["compatibility"] as? [String: String], let asset = release["asset"] as? [String: Any],
          let name = asset["name"] as? String, let size = asset["size"] as? UInt64, let digest = asset["sha256"] as? String else { throw UpdateFailure.metadata }
    _ = try version(releaseVersion)
    try require(release["schema"] as? String == "nimi-product-release/v1" && releaseId == "nimi/v\(releaseVersion)"
        && release["target"] as? String == "macos-arm64" && release["channel"] as? String == updateChannel
        && source.range(of: "^[a-f0-9]{40}$", options: .regularExpression) != nil, .metadata)
    guard let published = date(release["publishedAt"]), let expires = date(release["expiresAt"]) else { throw UpdateFailure.metadata }
    try require(expires > published && published <= Date().addingTimeInterval(300), .metadata)
    try require(expires > Date(), .expired)
    try keys(components, ["desktop", "runtime", "avatar"])
    for component in components.values {
        try keys(component, ["version", "sha256"]); _ = try version(component["version"] ?? "")
        try require(component["sha256"]?.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil, .metadata)
    }
    try keys(compatibility, ["minimumProductVersion", "minimumOsVersion", "dataPolicy"])
    try require(compatibility["dataPolicy"] == "owner-approved-forward", .metadata)
    let installed = Bundle(path: appPath)?.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
    try require(try compare(installed, compatibility["minimumProductVersion"] ?? "") >= 0 && compare(releaseVersion, installed) > 0, .metadata)
    let os = ProcessInfo.processInfo.operatingSystemVersion
    let minimum = compatibility["minimumOsVersion"] ?? ""
    try require(minimum.range(of: "^[0-9]+\\.[0-9]+(?:\\.[0-9]+)?$", options: .regularExpression) != nil
        && "\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)".compare(minimum, options: .numeric) != .orderedAscending, .metadata)
    try keys(asset, ["name", "url", "size", "sha256", "installer"])
    let escapedTag = releaseId.replacingOccurrences(of: "/", with: "%2F")
    try require(name == "Nimi-\(releaseVersion)-macos-arm64.pkg" && asset["installer"] as? String == "macos-pkg"
        && asset["url"] as? String == "https://github.com/nimiplatform/nimi/releases/download/\(escapedTag)/\(name)"
        && size > 0 && size <= 4 * 1024 * 1024 * 1024
        && digest.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil, .metadata)
    let root = URL(fileURLWithPath: file).deletingLastPathComponent().path
    guard let account = getpwuid(uid), let home = account.pointee.pw_dir else { throw UpdateFailure.request }
    try require(URL(fileURLWithPath: root).deletingLastPathComponent().path == String(cString: home) + "/Library/Caches/ai.nimi.product-update", .request)
    try require(result == root + "/result.json" && package.hasPrefix(root + "/")
        && URL(fileURLWithPath: package).lastPathComponent == name, .request)
    var directory = stat(); try require(lstat(root, &directory) == 0 && (directory.st_mode & S_IFMT) == S_IFDIR
        && directory.st_uid == uid && directory.st_mode & 0o077 == 0, .request)
    try require(try regularFile(package, uid: uid) == size && hashFile(package) == digest, .bytes)
    try require(codeTrust(appPath, identifier: "ai.nimi.apps.nimi.desktop") && codeTrust(helperPath, identifier: "ai.nimi.product-update"), .trust)
    let requestHash = SHA256.hash(data: request).map { String(format: "%02x", $0) }.joined()
    return Job(object: object, release: release, asset: asset, uid: uid, package: package, parentPid: parent, result: result, releaseId: releaseId, requestHash: requestHash)
}
func rootInstall(_ file: String, expectedRequestHash: String) throws {
    try require(getuid() == 0 && geteuid() == 0, .request)
    let job = try readJob(file)
    try require(job.requestHash == expectedRequestHash, .request)
    let template = strdup("/private/var/tmp/nimi-product-update-XXXXXX")!; defer { free(template) }
    guard let created = mkdtemp(template) else { throw UpdateFailure.install }
    let directory = String(cString: created); defer { try? fm.removeItem(atPath: directory) }
    let protectedPackage = directory + "/candidate.pkg"
    try fm.copyItem(atPath: job.package, toPath: protectedPackage)
    try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: protectedPackage)
    try require(try regularFile(protectedPackage) == job.asset["size"] as? UInt64 && hashFile(protectedPackage) == job.asset["sha256"] as? String, .bytes)
    try packageTrust(protectedPackage)
    try require(date(job.release["expiresAt"])! > Date(), .expired)
    // The formal PKG preinstall owns launchd stop. No helper service or raw
    // Runtime invocation substitutes for that owner.
    let outcome = try run("/usr/sbin/installer", ["-pkg", protectedPackage, "-target", "/"])
    if outcome.0 != 0 {
        throw outcome.1.contains("NIMI_UPDATE_RUNTIME_HANDOFF_FAILED") ? UpdateFailure.handoff : UpdateFailure.install
    }
    emit(["phase": "awaiting-activation", "releaseId": job.releaseId])
}
func shellQuote(_ text: String) -> String { "'" + text.replacingOccurrences(of: "'", with: "'\\''") + "'" }
func authorizationScript(_ file: String, _ requestHash: String) throws -> NSAppleScript {
    let command = shellQuote(helperPath) + " --root-install " + shellQuote(file) + " " + shellQuote(requestHash)
    let escaped = command.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
    guard let script = NSAppleScript(source: "do shell script \"\(escaped)\" with administrator privileges without altering line endings") else { throw UpdateFailure.install }
    var error: NSDictionary?
    try require(script.compileAndReturnError(&error), .install)
    return script
}
func apply(_ file: String) throws {
    try require(getuid() != 0, .request)
    let job = try readJob(file)
    try require(getppid() == job.parentPid, .request)
    var parentPath = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
    try require(proc_pidpath(job.parentPid, &parentPath, UInt32(parentPath.count)) > 0
        && String(cString: parentPath) == appPath + "/Contents/MacOS/Nimi", .request)
    try packageTrust(job.package)
    let guidance = "Nimi update: \(job.releaseId)\nIf Home cannot start, preserve your data and rerun the verified formal PKG:\n\(job.package)\nPublisher asset: \(job.asset["url"] ?? "")\nDo not replace Runtime or roll back data manually. Use the original data owner's forward repair instructions.\n"
    try guidance.write(toFile: URL(fileURLWithPath: file).deletingLastPathComponent().path + "/Recovery.txt", atomically: true, encoding: .utf8)
    emit(["phase": "handoff", "releaseId": job.releaseId, "requestHash": job.requestHash])
    // Keep ordinary-user identity across root installation and LaunchServices.
    var result: [String: Any] = ["phase": "failed", "releaseId": job.releaseId, "reason": UpdateFailure.install.rawValue]
    do {
        let deadline = Date().addingTimeInterval(120)
        while kill(job.parentPid, 0) == 0 {
            if Date() >= deadline { throw UpdateFailure.parent }
            Thread.sleep(forTimeInterval: 0.1)
        }
        let script = try authorizationScript(file, job.requestHash)
        var error: NSDictionary?
        let answer = script.executeAndReturnError(&error)
        if let error = error {
            if error[NSAppleScript.errorNumber] as? Int == -128 { throw UpdateFailure.auth }
            if let message = error[NSAppleScript.errorMessage] as? String, let bytes = message.data(using: .utf8),
               let outcome = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any], let reason = outcome["reason"] as? String,
               let failure = UpdateFailure(rawValue: reason) { throw failure }
            throw UpdateFailure.install
        }
        guard let data = answer.stringValue?.data(using: .utf8), let decoded = try JSONSerialization.jsonObject(with: data) as? [String: Any], decoded["phase"] as? String == "awaiting-activation" else { throw UpdateFailure.install }
        result = decoded
    } catch { result["reason"] = (error as? UpdateFailure)?.rawValue ?? UpdateFailure.install.rawValue }
    try record(result, at: job.result)
    let configuration = NSWorkspace.OpenConfiguration(); configuration.activates = true
    let semaphore = DispatchSemaphore(value: 0)
    NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: appPath), configuration: configuration) { _, error in
        if error != nil { try? record(["phase": "recovery-required", "releaseId": job.releaseId, "reason": "UPDATE_HOME_REOPEN_FAILED"], at: job.result) }
        semaphore.signal()
    }
    // Pump the ordinary-user main run loop for LaunchServices completion.
    while semaphore.wait(timeout: .now()) != .success { RunLoop.current.run(until: Date().addingTimeInterval(0.05)) }
}
do {
    let args = CommandLine.arguments
    if args.count == 2 && args[1] == "--probe" {
        emit(["protocolVersion": 1, "publicKeyConfigured": !updatePublicKey.isEmpty,
              "authorizationScriptCompiled": (try? authorizationScript("/Users/example/Library/Caches/ai.nimi.product-update/download-AbC123/job.json", String(repeating: "0", count: 64))) != nil,
              "publicKeyFingerprint": Data(base64Encoded: updatePublicKey).map { SHA256.hash(data: $0).map { String(format: "%02x", $0) }.joined() } ?? "",
              "productionTrusted": codeTrust(appPath, identifier: "ai.nimi.apps.nimi.desktop") && codeTrust(helperPath, identifier: "ai.nimi.product-update")])
    } else if args.count == 3 && args[1] == "--apply" { try apply(args[2]) }
    else if args.count == 4 && args[1] == "--root-install" { try rootInstall(args[2], expectedRequestHash: args[3]) }
    else { throw UpdateFailure.request }
} catch {
    emit(["phase": "failed", "reason": (error as? UpdateFailure)?.rawValue ?? UpdateFailure.install.rawValue])
    exit(1)
}
