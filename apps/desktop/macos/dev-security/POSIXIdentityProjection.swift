import Darwin
import Foundation

enum POSIXIdentityProbe: String, CaseIterable, Codable {
    case userByName = "user-by-name"
    case userByID = "user-by-id"
    case groupByName = "group-by-name"
    case groupByID = "group-by-id"

    var api: String {
        switch self {
        case .userByName: return "getpwnam_r"
        case .userByID: return "getpwuid_r"
        case .groupByName: return "getgrnam_r"
        case .groupByID: return "getgrgid_r"
        }
    }
}

enum POSIXIdentityProbeState: String, Codable {
    case notFound = "not-found"
    case presentExact = "present-exact"
    case presentConflict = "present-conflict"
    case lookupError = "lookup-error"
}

struct POSIXIdentityProjectionTarget {
    let userName: String
    let groupName: String
    let identifier: UInt32
    let homeDirectory: String
    let loginShell: String

    var diagnosticExpectation: POSIXIdentityProjectionExpectation {
        POSIXIdentityProjectionExpectation(
            userNameSHA256: posixIdentitySHA256(Data(userName.utf8)),
            groupNameSHA256: posixIdentitySHA256(Data(groupName.utf8)),
            identifier: identifier
        )
    }
}

struct POSIXIdentityProjectionExpectation: Equatable {
    let userNameSHA256: String
    let groupNameSHA256: String
    let identifier: UInt32
}

struct POSIXUserLookupProjection: Equatable {
    let nameSHA256: String
    let uid: UInt32
    let primaryGID: UInt32
    let homeDirectoryMatches: Bool
    let loginShellMatches: Bool
}

struct POSIXGroupLookupProjection: Equatable {
    let nameSHA256: String
    let gid: UInt32
}

enum POSIXIdentityObservedProjection: Equatable {
    case user(POSIXUserLookupProjection)
    case group(POSIXGroupLookupProjection)
}

/// Injectable result boundary used by native tests. A zero return code with no
/// observed record is the only representation of an authoritative not-found.
struct POSIXIdentityLookupResult: Equatable {
    let returnCode: Int32
    let observed: POSIXIdentityObservedProjection?
}

struct POSIXIdentityProbeDiagnostic: Codable, Equatable {
    let probe: POSIXIdentityProbe
    let api: String
    let state: POSIXIdentityProbeState
    let returnCode: Int32
    let errorName: String?
    let expectedNameSHA256: String
    let observedNameSHA256: String?
    let expectedIdentifier: UInt32
    let observedUID: UInt32?
    let observedGID: UInt32?
    let supplementalAttributesMatch: Bool?
}

struct POSIXIdentityProjectionSummary: Codable, Equatable {
    let probes: [POSIXIdentityProbeDiagnostic]
    let projectionDigestSHA256: String

    var allNotFound: Bool { probes.allSatisfy { $0.state == .notFound } }
    var allPresentExact: Bool { probes.allSatisfy { $0.state == .presentExact } }
    var hasConflict: Bool { probes.contains { $0.state == .presentConflict } }
    var hasLookupError: Bool { probes.contains { $0.state == .lookupError } }

    init(
        userByName: POSIXIdentityProbeDiagnostic,
        userByID: POSIXIdentityProbeDiagnostic,
        groupByName: POSIXIdentityProbeDiagnostic,
        groupByID: POSIXIdentityProbeDiagnostic
    ) {
        precondition(userByName.probe == .userByName)
        precondition(userByID.probe == .userByID)
        precondition(groupByName.probe == .groupByName)
        precondition(groupByID.probe == .groupByID)
        probes = [userByName, userByID, groupByName, groupByID]
        projectionDigestSHA256 = stablePOSIXProjectionDigest(probes)
    }
}

struct POSIXIdentityNameProjectionSummary: Codable, Equatable {
    let probes: [POSIXIdentityProbeDiagnostic]
    let projectionDigestSHA256: String

    var allNotFound: Bool { probes.allSatisfy { $0.state == .notFound } }
    var hasConflict: Bool { probes.contains { $0.state == .presentConflict } }
    var hasLookupError: Bool { probes.contains { $0.state == .lookupError } }

    init(userByName: POSIXIdentityProbeDiagnostic, groupByName: POSIXIdentityProbeDiagnostic) {
        precondition(userByName.probe == .userByName)
        precondition(groupByName.probe == .groupByName)
        probes = [userByName, groupByName]
        projectionDigestSHA256 = stablePOSIXProjectionDigest(probes)
    }
}

/// Name-only absence checks have no admitted UID/GID expectation. A record
/// returned for the exact queried name is therefore an exact positive name
/// projection, not an identifier conflict. Identifier values remain available
/// in the non-sensitive diagnostic for later authority-bound comparison.
func classifyPOSIXIdentityNameLookup(
    probe: POSIXIdentityProbe,
    expectedNameSHA256: String,
    lookup: POSIXIdentityLookupResult
) -> POSIXIdentityProbeDiagnostic {
    precondition(probe == .userByName || probe == .groupByName)
    guard lookup.returnCode == 0 else {
        return POSIXIdentityProbeDiagnostic(
            probe: probe,
            api: probe.api,
            state: .lookupError,
            returnCode: lookup.returnCode,
            errorName: posixIdentityErrorName(lookup.returnCode),
            expectedNameSHA256: expectedNameSHA256,
            observedNameSHA256: nil,
            expectedIdentifier: 0,
            observedUID: nil,
            observedGID: nil,
            supplementalAttributesMatch: nil
        )
    }
    guard let observed = lookup.observed else {
        return POSIXIdentityProbeDiagnostic(
            probe: probe,
            api: probe.api,
            state: .notFound,
            returnCode: 0,
            errorName: nil,
            expectedNameSHA256: expectedNameSHA256,
            observedNameSHA256: nil,
            expectedIdentifier: 0,
            observedUID: nil,
            observedGID: nil,
            supplementalAttributesMatch: nil
        )
    }
    switch observed {
    case let .user(user):
        let exact = probe == .userByName && user.nameSHA256 == expectedNameSHA256
        return POSIXIdentityProbeDiagnostic(
            probe: probe,
            api: probe.api,
            state: exact ? .presentExact : .presentConflict,
            returnCode: 0,
            errorName: nil,
            expectedNameSHA256: expectedNameSHA256,
            observedNameSHA256: user.nameSHA256,
            expectedIdentifier: 0,
            observedUID: user.uid,
            observedGID: user.primaryGID,
            supplementalAttributesMatch: user.homeDirectoryMatches && user.loginShellMatches
        )
    case let .group(group):
        let exact = probe == .groupByName && group.nameSHA256 == expectedNameSHA256
        return POSIXIdentityProbeDiagnostic(
            probe: probe,
            api: probe.api,
            state: exact ? .presentExact : .presentConflict,
            returnCode: 0,
            errorName: nil,
            expectedNameSHA256: expectedNameSHA256,
            observedNameSHA256: group.nameSHA256,
            expectedIdentifier: 0,
            observedUID: nil,
            observedGID: group.gid,
            supplementalAttributesMatch: nil
        )
    }
}

/// Pure classification boundary: tests inject the return code and projected
/// record without invoking OpenDirectory or libc name-service state.
func classifyPOSIXIdentityLookup(
    probe: POSIXIdentityProbe,
    expected: POSIXIdentityProjectionExpectation,
    lookup: POSIXIdentityLookupResult
) -> POSIXIdentityProbeDiagnostic {
    let expectedNameSHA256: String
    switch probe {
    case .userByName, .userByID: expectedNameSHA256 = expected.userNameSHA256
    case .groupByName, .groupByID: expectedNameSHA256 = expected.groupNameSHA256
    }

    guard lookup.returnCode == 0 else {
        return POSIXIdentityProbeDiagnostic(
            probe: probe,
            api: probe.api,
            state: .lookupError,
            returnCode: lookup.returnCode,
            errorName: posixIdentityErrorName(lookup.returnCode),
            expectedNameSHA256: expectedNameSHA256,
            observedNameSHA256: nil,
            expectedIdentifier: expected.identifier,
            observedUID: nil,
            observedGID: nil,
            supplementalAttributesMatch: nil
        )
    }

    guard let observed = lookup.observed else {
        return POSIXIdentityProbeDiagnostic(
            probe: probe,
            api: probe.api,
            state: .notFound,
            returnCode: 0,
            errorName: nil,
            expectedNameSHA256: expectedNameSHA256,
            observedNameSHA256: nil,
            expectedIdentifier: expected.identifier,
            observedUID: nil,
            observedGID: nil,
            supplementalAttributesMatch: nil
        )
    }

    switch observed {
    case let .user(user):
        let supplementalMatch = user.homeDirectoryMatches && user.loginShellMatches
        let exact = (probe == .userByName || probe == .userByID)
            && user.nameSHA256 == expected.userNameSHA256
            && user.uid == expected.identifier
            && user.primaryGID == expected.identifier
            && supplementalMatch
        return POSIXIdentityProbeDiagnostic(
            probe: probe,
            api: probe.api,
            state: exact ? .presentExact : .presentConflict,
            returnCode: 0,
            errorName: nil,
            expectedNameSHA256: expectedNameSHA256,
            observedNameSHA256: user.nameSHA256,
            expectedIdentifier: expected.identifier,
            observedUID: user.uid,
            observedGID: user.primaryGID,
            supplementalAttributesMatch: supplementalMatch
        )
    case let .group(group):
        let exact = (probe == .groupByName || probe == .groupByID)
            && group.nameSHA256 == expected.groupNameSHA256
            && group.gid == expected.identifier
        return POSIXIdentityProbeDiagnostic(
            probe: probe,
            api: probe.api,
            state: exact ? .presentExact : .presentConflict,
            returnCode: 0,
            errorName: nil,
            expectedNameSHA256: expectedNameSHA256,
            observedNameSHA256: group.nameSHA256,
            expectedIdentifier: expected.identifier,
            observedUID: nil,
            observedGID: group.gid,
            supplementalAttributesMatch: nil
        )
    }
}

func inspectPOSIXIdentityProjection(
    _ target: POSIXIdentityProjectionTarget
) -> POSIXIdentityProjectionSummary {
    let expected = target.diagnosticExpectation
    return POSIXIdentityProjectionSummary(
        userByName: classifyPOSIXIdentityLookup(
            probe: .userByName,
            expected: expected,
            lookup: lookupPOSIXUser(name: target.userName, target: target)
        ),
        userByID: classifyPOSIXIdentityLookup(
            probe: .userByID,
            expected: expected,
            lookup: lookupPOSIXUser(uid: uid_t(target.identifier), target: target)
        ),
        groupByName: classifyPOSIXIdentityLookup(
            probe: .groupByName,
            expected: expected,
            lookup: lookupPOSIXGroup(name: target.groupName)
        ),
        groupByID: classifyPOSIXIdentityLookup(
            probe: .groupByID,
            expected: expected,
            lookup: lookupPOSIXGroup(gid: gid_t(target.identifier))
        )
    )
}

func inspectPOSIXIdentityNameProjection(
    userName: String,
    groupName: String,
    homeDirectory: String,
    loginShell: String
) -> POSIXIdentityNameProjectionSummary {
    let target = POSIXIdentityProjectionTarget(
        userName: userName,
        groupName: groupName,
        identifier: 0,
        homeDirectory: homeDirectory,
        loginShell: loginShell
    )
    let expected = target.diagnosticExpectation
    return POSIXIdentityNameProjectionSummary(
        userByName: classifyPOSIXIdentityNameLookup(
            probe: .userByName,
            expectedNameSHA256: expected.userNameSHA256,
            lookup: lookupPOSIXUser(name: userName, target: target)
        ),
        groupByName: classifyPOSIXIdentityNameLookup(
            probe: .groupByName,
            expectedNameSHA256: expected.groupNameSHA256,
            lookup: lookupPOSIXGroup(name: groupName)
        )
    )
}

func runtimePOSIXIdentityTarget(_ plan: RuntimeAccountCreationPlan) -> POSIXIdentityProjectionTarget {
    POSIXIdentityProjectionTarget(
        userName: runtimeAccountName,
        groupName: runtimeAccountName,
        identifier: plan.identifier,
        homeDirectory: runtimeHomeDirectory,
        loginShell: runtimeLoginShell
    )
}

func requireRuntimePOSIXProjectionPresent(
    _ plan: RuntimeAccountCreationPlan,
    phase: String
) throws -> POSIXIdentityProjectionSummary {
    let summary = inspectPOSIXIdentityProjection(runtimePOSIXIdentityTarget(plan))
    guard summary.allPresentExact else {
        throw runtimePOSIXProjectionFailure(
            summary: summary,
            expected: "present-exact",
            phase: phase,
            attempt: 1,
            elapsedMilliseconds: 0
        )
    }
    return summary
}

func settleRuntimePOSIXProjectionAbsent(
    _ plan: RuntimeAccountCreationPlan,
    phase: String,
    maximumAttempts: Int = 50,
    delayMicroseconds: useconds_t = 100_000
) throws -> POSIXIdentityProjectionSummary {
    precondition(maximumAttempts > 0 && maximumAttempts <= 100)
    let started = ProcessInfo.processInfo.systemUptime
    var last = inspectPOSIXIdentityProjection(runtimePOSIXIdentityTarget(plan))
    for attempt in 1...maximumAttempts {
        if attempt > 1 { last = inspectPOSIXIdentityProjection(runtimePOSIXIdentityTarget(plan)) }
        let elapsed = Int((ProcessInfo.processInfo.systemUptime - started) * 1_000)
        if last.allNotFound { return last }
        if last.hasLookupError || last.hasConflict {
            throw runtimePOSIXProjectionFailure(
                summary: last,
                expected: "not-found",
                phase: phase,
                attempt: attempt,
                elapsedMilliseconds: elapsed
            )
        }
        if attempt < maximumAttempts { usleep(delayMicroseconds) }
    }
    throw runtimePOSIXProjectionFailure(
        summary: last,
        expected: "not-found",
        phase: phase,
        attempt: maximumAttempts,
        elapsedMilliseconds: Int((ProcessInfo.processInfo.systemUptime - started) * 1_000)
    )
}

func settleRuntimePOSIXNameProjectionAbsent(
    phase: String,
    maximumAttempts: Int = 50,
    delayMicroseconds: useconds_t = 100_000
) throws -> POSIXIdentityNameProjectionSummary {
    precondition(maximumAttempts > 0 && maximumAttempts <= 100)
    let started = ProcessInfo.processInfo.systemUptime
    var last = inspectPOSIXIdentityNameProjection(
        userName: runtimeAccountName,
        groupName: runtimeAccountName,
        homeDirectory: runtimeHomeDirectory,
        loginShell: runtimeLoginShell
    )
    for attempt in 1...maximumAttempts {
        if attempt > 1 {
            last = inspectPOSIXIdentityNameProjection(
                userName: runtimeAccountName,
                groupName: runtimeAccountName,
                homeDirectory: runtimeHomeDirectory,
                loginShell: runtimeLoginShell
            )
        }
        let elapsed = Int((ProcessInfo.processInfo.systemUptime - started) * 1_000)
        if last.allNotFound { return last }
        if last.hasLookupError || last.hasConflict {
            throw runtimePOSIXProjectionFailure(
                probes: last.probes,
                projectionDigestSHA256: last.projectionDigestSHA256,
                expected: "not-found",
                phase: phase,
                attempt: attempt,
                elapsedMilliseconds: elapsed
            )
        }
        if attempt < maximumAttempts { usleep(delayMicroseconds) }
    }
    throw runtimePOSIXProjectionFailure(
        probes: last.probes,
        projectionDigestSHA256: last.projectionDigestSHA256,
        expected: "not-found",
        phase: phase,
        attempt: maximumAttempts,
        elapsedMilliseconds: Int((ProcessInfo.processInfo.systemUptime - started) * 1_000)
    )
}

func runtimePOSIXAccountNamePresent(phase: String) throws -> Bool {
    let summary = inspectPOSIXIdentityNameProjection(
        userName: runtimeAccountName,
        groupName: runtimeAccountName,
        homeDirectory: runtimeHomeDirectory,
        loginShell: runtimeLoginShell
    )
    if summary.hasLookupError {
        throw runtimePOSIXProjectionFailure(
            probes: summary.probes,
            projectionDigestSHA256: summary.projectionDigestSHA256,
            expected: "not-found",
            phase: phase,
            attempt: 1,
            elapsedMilliseconds: 0
        )
    }
    return !summary.allNotFound
}

func resetRuntimeDirectoryIdentityCaches(phase: String) throws {
    guard runtimeDirectoryCacheResetExecutable == "/usr/bin/odutil" else {
        throw principalDiagnosticFailure(
            "runtime-principal-cache-reset-failed",
            "repair the authority-derived Directory Services cache reset contract",
            "The Directory Services cache reset executable is not admitted.",
            details: [
                "phase": phase,
                "probe": "directory-cache-reset",
                "state": "authority-mismatch",
                "verifier_pid": getpid(),
            ]
        )
    }
    let started = ProcessInfo.processInfo.systemUptime
    do {
        _ = try runFixedCommand(
            runtimeDirectoryCacheResetExecutable,
            ["reset", "cache"],
            captureLimit: 256 * 1024,
            timeoutSeconds: 30
        )
    } catch let failure as DevSecurityFailure {
        let base: [String: Any] = [
            "phase": phase,
            "probe": "directory-cache-reset",
            "state": failure.details?["return_code"] as? Int == Int(ETIMEDOUT)
                ? "timeout"
                : "command-failed",
            "elapsed_ms": Int((ProcessInfo.processInfo.systemUptime - started) * 1_000),
            "verifier_pid": getpid(),
        ]
        let details = principalSubprocessFailureDetails(base, failure: failure)
        throw principalDiagnosticFailure(
            "runtime-principal-cache-reset-failed",
            "inspect the exact /usr/bin/odutil reset cache failure",
            "The local-development Directory Services cache reset failed; raw deletion remains journaled and recoverable.",
            details: details
        )
    }
}

private func runtimePOSIXProjectionFailure(
    summary: POSIXIdentityProjectionSummary,
    expected: String,
    phase: String,
    attempt: Int,
    elapsedMilliseconds: Int
) -> DevSecurityFailure {
    runtimePOSIXProjectionFailure(
        probes: summary.probes,
        projectionDigestSHA256: summary.projectionDigestSHA256,
        expected: expected,
        phase: phase,
        attempt: attempt,
        elapsedMilliseconds: elapsedMilliseconds
    )
}

private func runtimePOSIXProjectionFailure(
    probes: [POSIXIdentityProbeDiagnostic],
    projectionDigestSHA256: String,
    expected: String,
    phase: String,
    attempt: Int,
    elapsedMilliseconds: Int
) -> DevSecurityFailure {
    let observed = probes.first { diagnostic in
        expected == "not-found" ? diagnostic.state != .notFound : diagnostic.state != .presentExact
    } ?? probes[0]
    let reasonCode = runtimePOSIXProjectionReasonCode(state: observed.state, expected: expected)
    let message: String
    switch reasonCode {
    case "runtime-principal-posix-query-failed":
        message = "A reentrant POSIX identity lookup failed; absence was not inferred."
    case "runtime-principal-posix-cache-stale":
        message = "The raw OpenDirectory deletion is committed, but an exact stale POSIX cache projection remains."
    case "runtime-principal-posix-conflict":
        message = "A POSIX name or identifier resolves to a conflicting principal projection."
    default:
        message = "The POSIX principal projection does not match the required boundary."
    }
    var details: [String: Any] = [
        "phase": phase,
        "probe": observed.probe.rawValue,
        "state": observed.state.rawValue,
        "return_code": observed.returnCode,
        "expected_identifier": observed.expectedIdentifier,
        "projection_sha256": projectionDigestSHA256,
        "attempt": attempt,
        "elapsed_ms": elapsedMilliseconds,
        "verifier_pid": getpid(),
    ]
    if let value = observed.observedNameSHA256 { details["observed_name_sha256"] = value }
    if let value = observed.observedUID { details["observed_identifier"] = value }
    if let value = observed.observedGID {
        if observed.probe == .userByName || observed.probe == .userByID {
            details["observed_primary_group_identifier"] = value
        } else {
            details["observed_identifier"] = value
        }
    }
    return principalDiagnosticFailure(
        reasonCode,
        "inspect the exact POSIX projection diagnostic before retrying repair",
        message,
        details: details
    )
}

func runtimePOSIXProjectionReasonCode(
    state: POSIXIdentityProbeState,
    expected: String
) -> String {
    switch state {
    case .lookupError:
        return "runtime-principal-posix-query-failed"
    case .presentExact where expected == "not-found":
        return "runtime-principal-posix-cache-stale"
    case .presentConflict:
        return "runtime-principal-posix-conflict"
    default:
        return "runtime-principal-posix-conflict"
    }
}
