import Darwin
import Dispatch
import Foundation

@main
struct MacOSDevSecurityNativeTests {
    static func main() throws {
        let journalStorageTests = try runMacOSDevSecurityJournalStorageNativeTests()
        let executorTests = try runMacOSDevSecurityExecutorNativeTests()
        let stableVnodeTests = try runMacOSDevSecurityStableVnodeNativeTests()
        try testPOSIXLookupClassification()
        try testRealReentrantNotFoundProjection()
        try testRealReentrantPresentProjection()
        try testBoundedProcessWait()
        try testFixedCommandRunner()
        try testAtomicBootstrapProcessGroupRunner()
        try testSubprocessFailureDiagnosticPropagation()
        try testPartialInstallationRepairDeadline()
        try testPartialInstallationRepairReceiptValidators()
        try testOpenDirectoryDeleteEffectAheadDecision()
        try testPartialRepairTransitionTable()
        try testPartialRepairEffectAheadRecoveryMatrix()
        try testJournalCrashRecoveryTable()
        print("{\"status\":\"passed\",\"suite\":\"macos-dev-security-native\",\"tests\":\(journalStorageTests + executorTests + stableVnodeTests + 13)}")
    }

    private static func testPOSIXLookupClassification() throws {
        let expected = POSIXIdentityProjectionExpectation(
            userNameSHA256: String(repeating: "a", count: 64),
            groupNameSHA256: String(repeating: "b", count: 64),
            identifier: 499
        )
        let absent = classifyPOSIXIdentityLookup(
            probe: .userByName,
            expected: expected,
            lookup: POSIXIdentityLookupResult(returnCode: 0, observed: nil)
        )
        try require(absent.state == .notFound && absent.returnCode == 0, "rc=0 plus nil must be the only not-found state")

        let queryFailure = classifyPOSIXIdentityLookup(
            probe: .userByID,
            expected: expected,
            lookup: POSIXIdentityLookupResult(returnCode: EIO, observed: nil)
        )
        try require(queryFailure.state == .lookupError && queryFailure.returnCode == EIO, "lookup errors must not become absence")

        let exact = classifyPOSIXIdentityLookup(
            probe: .userByID,
            expected: expected,
            lookup: POSIXIdentityLookupResult(
                returnCode: 0,
                observed: .user(POSIXUserLookupProjection(
                    nameSHA256: expected.userNameSHA256,
                    uid: expected.identifier,
                    primaryGID: expected.identifier,
                    homeDirectoryMatches: true,
                    loginShellMatches: true
                ))
            )
        )
        try require(exact.state == .presentExact, "the complete expected user projection must classify exact")

        let conflict = classifyPOSIXIdentityLookup(
            probe: .groupByID,
            expected: expected,
            lookup: POSIXIdentityLookupResult(
                returnCode: 0,
                observed: .group(POSIXGroupLookupProjection(
                    nameSHA256: String(repeating: "c", count: 64),
                    gid: expected.identifier
                ))
            )
        )
        try require(conflict.state == .presentConflict, "wrong-name identifier reuse must classify conflict")

        let nameOnlyPositive = classifyPOSIXIdentityNameLookup(
            probe: .userByName,
            expectedNameSHA256: expected.userNameSHA256,
            lookup: POSIXIdentityLookupResult(
                returnCode: 0,
                observed: .user(POSIXUserLookupProjection(
                    nameSHA256: expected.userNameSHA256,
                    uid: 487,
                    primaryGID: 487,
                    homeDirectoryMatches: false,
                    loginShellMatches: false
                ))
            )
        )
        try require(
            nameOnlyPositive.state == .presentExact && nameOnlyPositive.observedUID == 487,
            "name-only absence proof must classify an exact queried name as a stale positive without inventing an identifier expectation"
        )
        let wrongKindNameProjection = classifyPOSIXIdentityNameLookup(
            probe: .userByName,
            expectedNameSHA256: expected.userNameSHA256,
            lookup: POSIXIdentityLookupResult(
                returnCode: 0,
                observed: .group(POSIXGroupLookupProjection(
                    nameSHA256: expected.userNameSHA256,
                    gid: 487
                ))
            )
        )
        try require(
            wrongKindNameProjection.state == .presentConflict,
            "a wrong-kind name-service projection must classify as conflict"
        )
        try require(
            runtimePOSIXProjectionReasonCode(state: .lookupError, expected: "not-found")
                == "runtime-principal-posix-query-failed",
            "raw POSIX lookup errors require their structured query-failed reason"
        )
        try require(
            runtimePOSIXProjectionReasonCode(state: .presentExact, expected: "not-found")
                == "runtime-principal-posix-cache-stale",
            "an exact positive after raw deletion requires the cache-stale reason"
        )
        try require(
            runtimePOSIXProjectionReasonCode(state: .presentConflict, expected: "not-found")
                == "runtime-principal-posix-conflict",
            "identifier reuse or replacement requires the POSIX conflict reason"
        )

        let summaryA = POSIXIdentityProjectionSummary(
            userByName: absent,
            userByID: classifyPOSIXIdentityLookup(
                probe: .userByID,
                expected: expected,
                lookup: POSIXIdentityLookupResult(returnCode: 0, observed: nil)
            ),
            groupByName: classifyPOSIXIdentityLookup(
                probe: .groupByName,
                expected: expected,
                lookup: POSIXIdentityLookupResult(returnCode: 0, observed: nil)
            ),
            groupByID: classifyPOSIXIdentityLookup(
                probe: .groupByID,
                expected: expected,
                lookup: POSIXIdentityLookupResult(returnCode: 0, observed: nil)
            )
        )
        let summaryB = POSIXIdentityProjectionSummary(
            userByName: summaryA.probes[0],
            userByID: summaryA.probes[1],
            groupByName: summaryA.probes[2],
            groupByID: summaryA.probes[3]
        )
        try require(summaryA.allNotFound, "all four not-found probes must produce an absence summary")
        try require(summaryA.projectionDigestSHA256 == summaryB.projectionDigestSHA256, "projection digests must be stable")
    }

    private static func testRealReentrantNotFoundProjection() throws {
        let nonce = UUID().uuidString.lowercased()
        let summary = inspectPOSIXIdentityProjection(POSIXIdentityProjectionTarget(
            userName: "_nimi_absent_\(nonce)",
            groupName: "_nimi_absent_\(nonce)",
            identifier: 123_456_789,
            homeDirectory: "/var/empty",
            loginShell: "/usr/bin/false"
        ))
        try require(!summary.hasLookupError, "real reentrant libc probes must complete without lookup errors")
        try require(summary.allNotFound, "an impossible name and identifier must be absent in all four probes")
    }

    private static func testRealReentrantPresentProjection() throws {
        let summary = inspectPOSIXIdentityProjection(POSIXIdentityProjectionTarget(
            userName: "root",
            groupName: "wheel",
            identifier: 0,
            homeDirectory: "/var/root",
            loginShell: "/bin/sh"
        ))
        try require(!summary.hasLookupError, "real root/wheel reentrant libc probes must complete without lookup errors")
        try require(summary.allPresentExact, "real root/wheel records must be projected inside the _r pointer lifetime")
    }

    private static func testBoundedProcessWait() throws {
        let fast = Process()
        fast.executableURL = URL(fileURLWithPath: "/usr/bin/true")
        fast.standardOutput = FileHandle.nullDevice
        fast.standardError = FileHandle.nullDevice
        fast.standardInput = FileHandle.nullDevice
        let fastCompletion = DispatchSemaphore(value: 0)
        fast.terminationHandler = { _ in fastCompletion.signal() }
        try fast.run()
        let fastResult = waitForBoundedProcess(
            fast,
            completion: fastCompletion,
            timeoutSeconds: 2,
            terminateGraceSeconds: 1,
            killGraceSeconds: 1
        )
        try require(
            fastResult == BoundedProcessWaitResult(
                timedOut: false,
                sentSIGKILL: false,
                childReaped: true
            ),
            "a completed child must be reaped without timeout escalation"
        )

        let slow = Process()
        slow.executableURL = URL(fileURLWithPath: "/bin/sleep")
        slow.arguments = ["30"]
        slow.standardOutput = FileHandle.nullDevice
        slow.standardError = FileHandle.nullDevice
        slow.standardInput = FileHandle.nullDevice
        let slowCompletion = DispatchSemaphore(value: 0)
        slow.terminationHandler = { _ in slowCompletion.signal() }
        try slow.run()
        let childPID = slow.processIdentifier
        let slowResult = waitForBoundedProcess(
            slow,
            completion: slowCompletion,
            timeoutSeconds: 1,
            terminateGraceSeconds: 1,
            killGraceSeconds: 2
        )
        try require(slowResult.timedOut, "a slow child must take the bounded timeout branch")
        try require(slowResult.childReaped, "a timed-out child must be reaped before the repair transaction continues")
        errno = 0
        let liveness = kill(childPID, 0)
        try require(
            liveness == -1 && errno == ESRCH,
            "the bounded timeout branch must leave no live or unreaped child"
        )
    }

    private static func testFixedCommandRunner() throws {
        let success = try runFixedCommand(
            "/usr/bin/printf",
            ["native-fixed-command"],
            timeoutSeconds: 2
        )
        try require(
            String(data: success.stdout, encoding: .utf8) == "native-fixed-command"
                && success.stderr.isEmpty
                && success.pid > 1
                && success.status == 0,
            "the native suite must execute the production fixed-command launch, capture, and reap path"
        )

        let admittedNonzero = try runFixedCommand(
            "/usr/bin/false",
            [],
            timeoutSeconds: 2,
            acceptedExitStatuses: [0, 1]
        )
        try require(
            admittedNonzero.status == 1
                && admittedNonzero.stdout.isEmpty
                && admittedNonzero.stderr.isEmpty,
            "the production runner must return one exact explicitly admitted nonzero exit status"
        )

        do {
            _ = try runFixedCommand("/usr/bin/false", [], timeoutSeconds: 2)
            throw NativeTestFailure(message: "a nonzero fixed subprocess must fail")
        } catch let failure as DevSecurityFailure {
            try require(
                failure.details?["return_code"] as? Int == 1
                    && failure.details?["child_reaped"] as? Bool == true
                    && failure.details?["sent_sigkill"] as? Bool == false,
                "a reaped nonzero child must expose precise quiescence evidence"
            )
        }

        do {
            _ = try runFixedCommand(
                "/usr/bin/true",
                [],
                timeoutSeconds: 2,
                acceptedExitStatuses: []
            )
            throw NativeTestFailure(message: "an empty accepted-exit set must fail before launch")
        } catch let failure as DevSecurityFailure {
            try require(
                failure.details?["child_reaped"] as? Bool == true,
                "invalid fixed-command admission must prove that no child was launched"
            )
        }

        do {
            _ = try runFixedCommand("/bin/sleep", ["30"], timeoutSeconds: 1)
            throw NativeTestFailure(message: "a slow fixed subprocess must time out")
        } catch let failure as DevSecurityFailure {
            guard let childPID = failure.details?["verifier_pid"] as? pid_t else {
                throw NativeTestFailure(message: "a timeout must identify its bounded child")
            }
            try require(
                failure.details?["return_code"] as? Int == Int(ETIMEDOUT)
                    && failure.details?["child_reaped"] as? Bool == true,
                "the production runner timeout must prove the child was reaped"
            )
            errno = 0
            try require(
                kill(childPID, 0) == -1 && errno == ESRCH,
                "the production fixed-command timeout must leave no live or unreaped child"
            )
        }
    }

    private static func testAtomicBootstrapProcessGroupRunner() throws {
        _ = unlink(bootstrapHelperInstallPath)
        defer {
            _ = unlink(bootstrapHelperInstallPath)
        }

        do {
            _ = try runFixedCommand(
                bootstrapHelperInstallPath,
                ["run-repair-source-helper-status"],
                timeoutSeconds: 2,
                processTreePolicy: .bootstrapOwnedProcessGroup
            )
            throw NativeTestFailure(message: "an absent atomic bootstrap unexpectedly spawned")
        } catch let failure as DevSecurityFailure {
            try require(
                failure.details?["state"] as? String == "spawn-failed"
                    && failure.details?["return_code"] as? Int == Int(ENOENT)
                    && failure.details?["child_reaped"] as? Bool == true,
                "posix_spawn failure must prove that no bootstrap child was created"
            )
        }

        let fixture = """
        #!/bin/sh
        case "$1" in
          run-repair-source-helper-status)
            pgid=$(/bin/ps -o pgid= -p "$$" | /usr/bin/tr -d ' ')
            /usr/bin/printf '%s %s' "$$" "$pgid"
            ;;
          run-repair-final-helper-private-custody)
            /bin/sh -c 'trap "" TERM; while :; do /bin/sleep 1; done' &
            descendant=$!
            /usr/bin/printf '%s' "$descendant"
            trap 'exit 0' TERM
            while :; do /bin/sleep 1; done
            ;;
          verify-partial-install-repair-principal-removal)
            trap '' TERM
            while :; do /usr/bin/printf '0123456789abcdef0123456789abcdef'; done
            ;;
          *)
            exit 64
            ;;
        esac
        """
        try Data(fixture.utf8).write(
            to: URL(fileURLWithPath: bootstrapHelperInstallPath),
            options: .atomic
        )
        guard chmod(bootstrapHelperInstallPath, 0o700) == 0 else {
            throw NativeTestFailure(message: "could not make the atomic bootstrap fixture executable")
        }

        let identity = try runFixedCommand(
            bootstrapHelperInstallPath,
            ["run-repair-source-helper-status"],
            captureLimit: 4 * 1024,
            timeoutSeconds: 3,
            processTreePolicy: .bootstrapOwnedProcessGroup
        )
        let fields = String(decoding: identity.stdout, as: UTF8.self)
            .split(whereSeparator: { $0 == " " || $0 == "\n" })
            .compactMap { pid_t($0) }
        try require(
            fields == [identity.pid, identity.pid],
            "POSIX_SPAWN_SETPGROUP must atomically make the direct child PID its PGID"
        )
        errno = 0
        try require(
            kill(-identity.pid, 0) == -1 && errno == ESRCH,
            "a completed atomic bootstrap command must leave its complete PGID absent"
        )

        let descendantExecution = try runAtomicBootstrapProcessGroup(
            executable: bootstrapHelperInstallPath,
            arguments: ["run-repair-final-helper-private-custody"],
            environment: [
                "HOME": "/var/empty",
                "LANG": "en_US.UTF-8",
                "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
                "TMPDIR": "/private/tmp",
            ],
            input: nil,
            captureLimit: 4 * 1024,
            timeoutSeconds: 1
        )
        guard let descendantPID = pid_t(String(decoding: descendantExecution.stdout, as: UTF8.self)) else {
            throw NativeTestFailure(message: "the ignoring descendant fixture did not publish its PID")
        }
        try require(
            descendantExecution.timedOut
                && descendantExecution.sentSIGKILL
                && descendantExecution.childReaped,
            "a SIGTERM-ignoring descendant must force SIGKILL and complete group-empty proof"
        )
        errno = 0
        try require(
            kill(-descendantExecution.pid, 0) == -1 && errno == ESRCH,
            "timeout success evidence requires kill(-pgid, 0) == ESRCH"
        )
        errno = 0
        try require(
            kill(descendantPID, 0) == -1 && errno == ESRCH,
            "the old-helper descendant must not escape the bootstrap-owned process group"
        )
        do {
            _ = try runFixedCommand(
                bootstrapHelperInstallPath,
                ["run-repair-final-helper-private-custody"],
                captureLimit: 4 * 1024,
                timeoutSeconds: 1,
                processTreePolicy: .bootstrapOwnedProcessGroup
            )
            throw NativeTestFailure(message: "a bootstrap process-group timeout unexpectedly succeeded")
        } catch let failure as DevSecurityFailure {
            guard let groupID = failure.details?["verifier_pid"] as? pid_t else {
                throw NativeTestFailure(message: "the process-group timeout omitted its exact PGID witness")
            }
            try require(
                failure.details?["return_code"] as? Int == Int(ETIMEDOUT)
                    && failure.details?["sent_sigkill"] as? Bool == true
                    && failure.details?["child_reaped"] as? Bool == true,
                "the public fixed-command API must preserve group timeout and reap evidence"
            )
            errno = 0
            try require(
                kill(-groupID, 0) == -1 && errno == ESRCH,
                "structured timeout evidence requires kill(-pgid, 0) == ESRCH"
            )
        }

        do {
            _ = try runFixedCommand(
                bootstrapHelperInstallPath,
                ["verify-partial-install-repair-principal-removal"],
                captureLimit: 1_024,
                timeoutSeconds: 10,
                processTreePolicy: .bootstrapOwnedProcessGroup
            )
            throw NativeTestFailure(message: "an overflowing bootstrap unexpectedly completed")
        } catch let failure as DevSecurityFailure {
            guard let groupID = failure.details?["verifier_pid"] as? pid_t else {
                throw NativeTestFailure(message: "the output overflow omitted its exact PGID witness")
            }
            try require(
                failure.details?["state"] as? String == "output-budget-exceeded"
                    && failure.details?["return_code"] as? Int == Int(EFBIG)
                    && failure.details?["sent_sigkill"] as? Bool == true
                    && failure.details?["child_reaped"] as? Bool == true,
                "bounded capture overflow must terminate, reap, and prove the whole process group absent"
            )
            errno = 0
            try require(
                kill(-groupID, 0) == -1 && errno == ESRCH,
                "output-overflow evidence requires an absent process group"
            )
        }
    }

    private static func testSubprocessFailureDiagnosticPropagation() throws {
        let lower = fail(
            "runtime-service-repair-required",
            "preserve_the_exact_bootstrap",
            "child quiescence was not proven",
            details: [
                "return_code": Int(ETIMEDOUT),
                "verifier_pid": 4242,
                "timeout_seconds": 30,
                "sent_sigkill": true,
                "child_reaped": false,
            ]
        )
        let wrapped = principalSubprocessFailureDetails(
            [
                "phase": "group-removed",
                "probe": "fresh-bootstrap",
                "state": "subprocess-failed",
                "verifier_pid": 1,
            ],
            failure: lower
        )
        try require(
            wrapped["phase"] as? String == "group-removed"
                && wrapped["return_code"] as? Int == Int(ETIMEDOUT)
                && wrapped["verifier_pid"] as? Int == 4242
                && wrapped["timeout_seconds"] as? Int == 30
                && wrapped["sent_sigkill"] as? Bool == true
                && wrapped["child_reaped"] as? Bool == false,
            "domain-specific subprocess wrappers must preserve the complete non-sensitive quiescence witness"
        )
        let corrected = fixedCommandFailureWithReapEvidence(
            lower,
            verifierPID: 4343,
            timeoutSeconds: 4,
            waitResult: BoundedProcessWaitResult(
                timedOut: true,
                sentSIGKILL: true,
                childReaped: true
            )
        )
        try require(
            corrected.details?["verifier_pid"] as? pid_t == 4343
                && corrected.details?["timeout_seconds"] as? Int == 4
                && corrected.details?["sent_sigkill"] as? Bool == true
                && corrected.details?["child_reaped"] as? Bool == true,
            "post-bind recovery must replace stale pre-reap evidence with the proven bounded reap result"
        )
    }

    private static func testPartialInstallationRepairDeadline() throws {
        let expired = DispatchSemaphore(value: 0)
        let deadline = try PartialInstallationRepairDeadline.start(
            timeoutSeconds: 1,
            termination: { childReaped, childPID in
                if childReaped, childPID == nil { expired.signal() }
            }
        )
        do {
            _ = try PartialInstallationRepairDeadline.beginSubprocessLaunch(
                timeoutSeconds: 1,
                escalationSeconds: 0
            )
            throw NativeTestFailure(message: "an outer deadline must reject a child that cannot fit")
        } catch let failure as DevSecurityFailure {
            try require(
                failure.details?["state"] as? String == "deadline-budget-exhausted",
                "subprocess budget exhaustion must retain structured field-level evidence"
            )
        }
        try require(
            expired.wait(timeout: .now() + .seconds(3)) == .success,
            "the production repair deadline implementation must expire dynamically"
        )
        do {
            _ = try PartialInstallationRepairDeadline.beginSubprocessLaunch(
                timeoutSeconds: 1,
                escalationSeconds: 0
            )
            throw NativeTestFailure(message: "an expired repair deadline must not become an optional no-deadline launch")
        } catch let failure as DevSecurityFailure {
            try require(
                failure.details?["state"] as? String == "deadline-expired-before-launch"
                    && failure.details?["child_reaped"] as? Bool == true,
                "expiry before atomic budget-and-slot reservation must fail before Process.run"
            )
        }
        deadline.finish()

        let cancelled = DispatchSemaphore(value: 0)
        let cancellable = try PartialInstallationRepairDeadline.start(
            timeoutSeconds: 1,
            termination: { _, _ in cancelled.signal() }
        )
        cancellable.finish()
        try require(
            cancelled.wait(timeout: .now() + .seconds(2)) == .timedOut,
            "a completed repair must cancel its hard deadline"
        )

        let launchExpired = DispatchSemaphore(value: 0)
        var launchWindowQuiescence = true
        var launchWindowPID: pid_t?
        let launchDeadline = try PartialInstallationRepairDeadline.start(
            timeoutSeconds: 3,
            termination: { childReaped, childPID in
                launchWindowQuiescence = childReaped
                launchWindowPID = childPID
                launchExpired.signal()
            }
        )
        let launchReserved = try PartialInstallationRepairDeadline.beginSubprocessLaunch(
            timeoutSeconds: 1,
            escalationSeconds: 0
        )
        try require(
            launchReserved,
            "an active deadline must reserve the child slot before Process.run"
        )
        try require(
            launchExpired.wait(timeout: .now() + .seconds(5)) == .success,
            "the launch-window fault injection must reach the production deadline"
        )
        try require(
            !launchWindowQuiescence && launchWindowPID == nil,
            "deadline expiry during Process.run must report quiescence-unproven even before a PID is bound"
        )
        launchDeadline.finish()

        let childExpired = DispatchSemaphore(value: 0)
        let observationLock = NSLock()
        var observedChildReaped = true
        var observedChildPID: pid_t?
        let childDeadline = try PartialInstallationRepairDeadline.start(
            timeoutSeconds: 3,
            termination: { childReaped, childPID in
                observationLock.lock()
                observedChildReaped = childReaped
                observedChildPID = childPID
                observationLock.unlock()
                childExpired.signal()
            }
        )
        let child = Process()
        child.executableURL = URL(fileURLWithPath: "/bin/sleep")
        child.arguments = ["30"]
        child.standardInput = FileHandle.nullDevice
        child.standardOutput = FileHandle.nullDevice
        child.standardError = FileHandle.nullDevice
        let childLaunch = try PartialInstallationRepairDeadline.beginSubprocessLaunch(
            timeoutSeconds: 1,
            escalationSeconds: 0
        )
        try child.run()
        let childPID = child.processIdentifier
        try PartialInstallationRepairDeadline.bindLaunchedSubprocess(
            child,
            deadlineOwned: childLaunch
        )
        try require(
            childExpired.wait(timeout: .now() + .seconds(5)) == .success,
            "the hard deadline must terminate an active bounded child before reporting expiry"
        )
        observationLock.lock()
        let capturedChildReaped = observedChildReaped
        let capturedChildPID = observedChildPID
        observationLock.unlock()
        try require(
            !capturedChildReaped && capturedChildPID == childPID,
            "deadline evidence must prevent wrapper cleanup when a child was not yet proven reaped"
        )
        child.waitUntilExit()
        childDeadline.finish()
        errno = 0
        try require(
            kill(childPID, 0) == -1 && errno == ESRCH,
            "the deadline must leave no live test child after the parent reaps it"
        )
    }

    private static func testPartialInstallationRepairReceiptValidators() throws {
        let journalExpected = PartialInstallRepairJournalAbsenceReceiptExpectation(
            accountName: "_nimiruntimedev",
            transactionID: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
            phase: "group-removed",
            sourceHelperSHA256: String(repeating: "a", count: 64),
            sourceHelperCDHash: String(repeating: "b", count: 40),
            sourcePrincipalCarrierContractVersion: 2,
            residueClass: "macos_local_development_v2_failed_first_install_disabled_user",
            authenticationEvidenceSHA256: String(repeating: "c", count: 64),
            planDigest: String(repeating: "d", count: 64),
            groupGeneratedUID: "11111111-1111-4111-8111-111111111111",
            userGeneratedUID: "22222222-2222-4222-8222-222222222222",
            rootKeyId: "nimi-macos-dev-record-fixture",
            policyDigest: String(repeating: "e", count: 64),
            posixLookupAPI: "getpwnam_r_getpwuid_r_getgrnam_r_getgrgid_r",
            parentPID: 41,
            parentProcessStartIdentity: "parent-start-identity-fixture"
        )
        var journalReceipt: [String: Any] = [
            "status": "absence-verified",
            "accountName": journalExpected.accountName,
            "transactionID": journalExpected.transactionID,
            "phase": journalExpected.phase,
            "sourceHelperSHA256": journalExpected.sourceHelperSHA256,
            "sourceHelperCDHash": journalExpected.sourceHelperCDHash,
            "sourcePrincipalCarrierContractVersion": journalExpected.sourcePrincipalCarrierContractVersion,
            "residueClass": journalExpected.residueClass,
            "authenticationEvidenceSHA256": journalExpected.authenticationEvidenceSHA256,
            "planDigest": journalExpected.planDigest,
            "groupGeneratedUID": journalExpected.groupGeneratedUID,
            "userGeneratedUID": journalExpected.userGeneratedUID,
            "rootKeyId": journalExpected.rootKeyId,
            "policyDigest": journalExpected.policyDigest,
            "posixLookupAPI": journalExpected.posixLookupAPI,
            "posixProjectionSHA256": String(repeating: "f", count: 64),
            "posixProbeStates": ["not-found", "not-found", "not-found", "not-found"],
            "parentPID": 41,
            "parentProcessStartIdentity": journalExpected.parentProcessStartIdentity,
            "verifierPID": 42,
        ]
        try require(
            partialInstallRepairJournalAbsenceReceiptMatches(
                journalReceipt,
                childPID: 42,
                parentPID: 41,
                expected: journalExpected
            ),
            "the production journal-bound fresh receipt validator must accept one exact receipt"
        )
        journalReceipt["unexpected"] = true
        try require(
            !partialInstallRepairJournalAbsenceReceiptMatches(
                journalReceipt,
                childPID: 42,
                parentPID: 41,
                expected: journalExpected
            ),
            "the journal-bound fresh receipt validator must reject unknown fields"
        )
        journalReceipt.removeValue(forKey: "unexpected")
        journalReceipt["sourcePrincipalCarrierContractVersion"] = 4
        try require(
            !partialInstallRepairJournalAbsenceReceiptMatches(
                journalReceipt,
                childPID: 42,
                parentPID: 41,
                expected: journalExpected
            ),
            "the journal-bound fresh receipt validator must reject carrier replacement"
        )
        journalReceipt["sourcePrincipalCarrierContractVersion"] = 2
        journalReceipt["parentPID"] = 99
        try require(
            !partialInstallRepairJournalAbsenceReceiptMatches(
                journalReceipt,
                childPID: 42,
                parentPID: 41,
                expected: journalExpected
            ),
            "the journal-bound fresh receipt validator must reject a substituted parent PID"
        )
        journalReceipt["parentPID"] = 41
        journalReceipt["parentProcessStartIdentity"] = "replacement-parent-start"
        try require(
            !partialInstallRepairJournalAbsenceReceiptMatches(
                journalReceipt,
                childPID: 42,
                parentPID: 41,
                expected: journalExpected
            ),
            "the journal-bound fresh receipt validator must reject a substituted parent start identity"
        )

        let success = try makePartialInstallRepairSuccessReceipt(
            disposition: "residue-removed",
            serviceName: launchDaemonLabel,
            removed: [
                "partial_launchd_definition", "empty_install_directories", "exact_runtime_principal",
            ],
            sourcePrincipalCarrierContractVersion: 2,
            requiredInstallPrincipalCarrierContractVersion: 4
        )
        try require(
            Set(success.keys) == Set(generatedRuntimeLegacyRepairSuccessReceiptRequiredFields),
            "the production repair success receipt must expose only the generated exact field set"
        )
        try require(
            success["sourcePrincipalCarrierContractVersion"] as? Int == 2
                && success["requiredInstallPrincipalCarrierContractVersion"] as? Int == 4
                && success["sourceHelperDisposition"] as? String == "preserved"
                && success["trustHelperRotationRequired"] as? Bool == true
                && success["nextPrivilegedAction"] as? String
                    == "separately_confirmed_trust_helper_rotation",
            "a v2 repair receipt must explicitly preserve v2 and require a separately confirmed v4 rotation"
        )
        do {
            _ = try makePartialInstallRepairSuccessReceipt(
                disposition: "residue-removed",
                serviceName: launchDaemonLabel,
                removed: [],
                sourcePrincipalCarrierContractVersion: 2,
                requiredInstallPrincipalCarrierContractVersion: 4
            )
            throw NativeTestFailure(message: "an inconsistent success receipt must fail closed")
        } catch is DevSecurityFailure {
            // Expected exact-schema refusal.
        }
    }

    private static func testOpenDirectoryDeleteEffectAheadDecision() throws {
        try require(
            openDirectoryDeletePostconditionDecision(
                deletionReportedError: true,
                byNamePresent: false,
                byIdentifierPresent: false
            ) == .acceptCommittedAbsence,
            "delete error plus fresh raw absence must continue in the same invocation"
        )
        try require(
            openDirectoryDeletePostconditionDecision(
                deletionReportedError: false,
                byNamePresent: false,
                byIdentifierPresent: false
            ) == .acceptCommittedAbsence,
            "successful delete plus fresh raw absence must continue"
        )
        try require(
            openDirectoryDeletePostconditionDecision(
                deletionReportedError: true,
                byNamePresent: false,
                byIdentifierPresent: true
            ) == .failDeleteErrorRecordRemains,
            "delete error with identifier residue must retain the precise mutation failure"
        )
        try require(
            openDirectoryDeletePostconditionDecision(
                deletionReportedError: false,
                byNamePresent: true,
                byIdentifierPresent: false
            ) == .failRecordRemainedAfterDelete,
            "a successful delete report with name residue must fail as a postcondition mismatch"
        )
    }

    private static func testPartialRepairTransitionTable() throws {
        let base = PartialInstallRepairTransitionSnapshot(
            journalPhase: .artifactsRemoved,
            artifacts: .absent,
            userRecord: .exactPresent,
            groupRecord: .exactPresent
        )
        try requireDecision(
            snapshot(base, phase: .prepared),
            .act(.writeJournalPhase(.artifactsRemoved)),
            "artifact deletion effect-ahead must commit artifacts-removed"
        )
        try requireDecision(base, .act(.deleteExactUser), "artifacts-removed must delete user first")
        try requireDecision(snapshot(base, user: .absent), .act(.writeJournalPhase(.userRemoved)), "user effect-ahead must advance only its journal")
        try requireDecision(snapshot(base, phase: .userRemoved, user: .absent), .act(.deleteExactGroup), "user-removed must delete the exact group")
        try requireDecision(
            snapshot(base, phase: .userRemoved, user: .absent, group: .absent),
            .act(.writeJournalPhase(.groupRemoved)),
            "group effect-ahead must advance only its journal"
        )
        let groupRemoved = snapshot(
            base,
            phase: .groupRemoved,
            user: .absent,
            group: .absent
        )
        try requireDecision(groupRemoved, .act(.resetIdentityCache), "raw absence must precede one cache reset")
        try requireDecision(
            snapshot(groupRemoved, cache: .completed),
            .act(.requestFreshProof(.journalBoundAbsence)),
            "cache reset must be followed by a journal-bound fresh proof"
        )
        try requireDecision(
            snapshot(groupRemoved, cache: .completed, proof: .journalBoundAbsence),
            .act(.writeJournalPhase(.principalRemoved)),
            "fresh proof must commit principal-removed"
        )
        try requireDecision(
            snapshot(groupRemoved, phase: .principalRemoved, cache: .completed, proof: .journalBoundAbsence),
            .act(.removeJournalAndComplete),
            "principal-removed plus re-established proof must remove the journal last"
        )
        try requireDecision(
            snapshot(groupRemoved, phase: .principalRemoved),
            .act(.resetIdentityCache),
            "a new invocation after the principal-removed write must reset before re-proving"
        )
        try requireDecision(
            snapshot(groupRemoved, phase: .principalRemoved, cache: .completed),
            .act(.requestFreshProof(.journalBoundAbsence)),
            "a restarted principal-removed invocation must obtain a new fresh-process receipt"
        )
        try requireDecision(
            snapshot(base, user: .exactPresent, group: .absent),
            .failClosed(.deletionOrderViolation),
            "group-before-user deletion must fail closed"
        )
        try requireDecision(
            snapshot(groupRemoved, cache: .failed),
            .failClosed(.cacheResetFailed),
            "cache reset failure must preserve the journal"
        )

        let zero = PartialInstallRepairTransitionSnapshot(
            journalPhase: nil,
            artifacts: .absent,
            userRecord: .absent,
            groupRecord: .absent
        )
        try requireDecision(
            zero,
            .failClosed(.journalMissingForResidue),
            "clean state without an authority-bound journal must fail closed without mutation"
        )
    }

    private static func testPartialRepairEffectAheadRecoveryMatrix() throws {
        let complete = PartialInstallRepairTransitionSnapshot(
            journalPhase: .prepared,
            artifacts: .exactResiduePresent,
            userRecord: .exactPresent,
            groupRecord: .exactPresent
        )
        for artifactBoundary in [
            "launchd-unlink", "state-root-rmdir", "transactions-root-rmdir",
            "rollback-root-rmdir", "socket-root-rmdir",
        ] {
            try requireDecision(
                complete,
                .act(.removeExactArtifacts),
                "a crash after \(artifactBoundary) must retry exact artifact reconciliation while any admitted artifact remains"
            )
        }
        try requireDecision(
            snapshot(complete, phase: .prepared),
            .act(.removeExactArtifacts),
            "a crash before the artifacts phase commit must retain prepared ownership"
        )
        let artifactsAbsent = PartialInstallRepairTransitionSnapshot(
            journalPhase: .prepared,
            artifacts: .absent,
            userRecord: .exactPresent,
            groupRecord: .exactPresent
        )
        try requireDecision(
            artifactsAbsent,
            .act(.writeJournalPhase(.artifactsRemoved)),
            "all artifact effects ahead must commit only the next journal phase"
        )
        let userEffectAhead = PartialInstallRepairTransitionSnapshot(
            journalPhase: .artifactsRemoved,
            artifacts: .absent,
            userRecord: .absent,
            groupRecord: .exactPresent
        )
        try requireDecision(
            userEffectAhead,
            .act(.writeJournalPhase(.userRemoved)),
            "a user delete committed before its journal write must reconcile in one invocation"
        )
        let groupEffectAhead = PartialInstallRepairTransitionSnapshot(
            journalPhase: .userRemoved,
            artifacts: .absent,
            userRecord: .absent,
            groupRecord: .absent
        )
        try requireDecision(
            groupEffectAhead,
            .act(.writeJournalPhase(.groupRemoved)),
            "a group delete committed before its journal write must reconcile in one invocation"
        )
        let groupRemovedRestart = PartialInstallRepairTransitionSnapshot(
            journalPhase: .groupRemoved,
            artifacts: .absent,
            userRecord: .absent,
            groupRecord: .absent
        )
        for volatileBoundary in ["cache-reset", "fresh-receipt", "pre-principal-phase"] {
            try requireDecision(
                groupRemovedRestart,
                .act(.resetIdentityCache),
                "a crash after \(volatileBoundary) must discard volatile proof and reset before re-proving"
            )
        }
        let principalRemovedRestart = PartialInstallRepairTransitionSnapshot(
            journalPhase: .principalRemoved,
            artifacts: .absent,
            userRecord: .absent,
            groupRecord: .absent
        )
        for terminalBoundary in ["principal-phase-commit", "final-target-proof"] {
            try requireDecision(
                principalRemovedRestart,
                .act(.resetIdentityCache),
                "a crash after \(terminalBoundary) must re-establish cache and fresh-process proof before final unlink"
            )
        }
    }

    private static func testJournalCrashRecoveryTable() throws {
        let stagingPoints: [PartialInstallRepairJournalCrashPoint] = [
            .stagingCreated, .stagingBytesWritten, .stagingFileSynced, .beforeRename,
        ]
        for point in stagingPoints {
            try require(
                partialInstallRepairJournalRecovery(after: point)
                    == .removeValidatedStagingAndResumeNamedJournal,
                "pre-rename crash must discard only the validated staging vnode"
            )
        }
        for point in [
            PartialInstallRepairJournalCrashPoint.afterRenameBeforeDirectorySync,
            .journalDirectorySynced,
        ] {
            try require(
                partialInstallRepairJournalRecovery(after: point)
                    == .validateNamedJournalAndReconcileEffectAhead,
                "post-rename recovery must accept only a valid named journal and reconcile effects"
            )
        }
        try require(
            partialInstallRepairJournalRecovery(after: .afterFinalUnlinkBeforeDirectorySync)
                == .validateReappearedPrincipalRemovedJournalOrAcceptAbsence,
            "an un-durable final unlink may recover either a principal-removed journal or absence"
        )
        try require(
            partialInstallRepairJournalRecovery(after: .finalUnlinkDirectorySynced)
                == .requireJournalAbsent,
            "a directory-synced final unlink must recover as absent"
        )
    }

    private static func snapshot(
        _ value: PartialInstallRepairTransitionSnapshot,
        phase: PartialInstallRepairPhase? = nil,
        user: PartialInstallRepairRecordState? = nil,
        group: PartialInstallRepairRecordState? = nil,
        cache: PartialInstallRepairCacheResetState? = nil,
        proof: PartialInstallRepairFreshProofState? = nil
    ) -> PartialInstallRepairTransitionSnapshot {
        PartialInstallRepairTransitionSnapshot(
            journalPhase: phase ?? value.journalPhase,
            artifacts: value.artifacts,
            userRecord: user ?? value.userRecord,
            groupRecord: group ?? value.groupRecord,
            cacheReset: cache ?? value.cacheReset,
            freshProof: proof ?? value.freshProof,
            authority: value.authority,
            globalEnvelope: value.globalEnvelope
        )
    }

    private static func requireDecision(
        _ snapshot: PartialInstallRepairTransitionSnapshot,
        _ expected: PartialInstallRepairTransitionDecision,
        _ message: String
    ) throws {
        try require(partialInstallRepairNextTransition(snapshot) == expected, message)
    }

    private static func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
        guard condition() else { throw NativeTestFailure(message: message) }
    }
}

private struct NativeTestFailure: Error, CustomStringConvertible {
    let message: String
    var description: String { message }
}
