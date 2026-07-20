import Foundation

func runMacOSDevSecurityExecutorNativeTests() throws -> Int {
    try testRepairEntrySourceStatusIsolation()
    try testProductionExecutorHappyPathAndInvocationBinding()
    try testProductionExecutorEffectAheadRecovery()
    try testProductionExecutorVolatileEvidenceRecovery()
    try testProductionExecutorEventSinkCrashMatrix()
    try testProductionExecutorTerminalRecovery()
    return 6
}

private enum ExecutorNativeFailure: Error, Equatable {
    case injected(String)
    case transition(String)
    case budget
    case noJournal
    case assertion(String)
    case cleanNoJournal
}

private final class FakeRepairMachine {
    var journalPresent = true
    var phase: PartialInstallRepairPhase
    var artifactsRemaining: Int
    var user: PartialInstallRepairRecordState
    var group: PartialInstallRepairRecordState
    var counters: [String: Int] = [:]
    var evidenceObservations: [PartialInstallRepairInvocationEvidence] = []
    var failBeforeOperation: String?
    var failAfterOperation: String?
    var receiptCount = 0

    let immutableBinding = String(repeating: "a", count: 64)

    init(
        phase: PartialInstallRepairPhase = .prepared,
        artifactsRemaining: Int = 5,
        user: PartialInstallRepairRecordState = .exactPresent,
        group: PartialInstallRepairRecordState = .exactPresent
    ) {
        self.phase = phase
        self.artifactsRemaining = artifactsRemaining
        self.user = user
        self.group = group
    }

    func operations() -> PartialInstallRepairOperations<FakeRepairMachine, String> {
        PartialInstallRepairOperations(
            observe: { evidence in
                guard self.journalPresent else { throw ExecutorNativeFailure.noJournal }
                self.evidenceObservations.append(evidence)
                return PartialInstallRepairObservation(
                    context: self,
                    immutableJournalBindingSHA256: self.immutableBinding,
                    snapshot: PartialInstallRepairTransitionSnapshot(
                        journalPhase: self.phase,
                        artifacts: self.artifactsRemaining == 0 ? .absent : .exactResiduePresent,
                        userRecord: self.user,
                        groupRecord: self.group,
                        cacheReset: evidence.cacheResetState(for: self.immutableBinding),
                        freshProof: evidence.freshProofState(for: self.immutableBinding)
                    )
                )
            },
            removeExactArtifacts: { _ in
                try self.perform("remove-artifacts") {
                    if self.failAfterOperation == "remove-artifacts" {
                        self.artifactsRemaining = max(0, self.artifactsRemaining - 1)
                    } else {
                        self.artifactsRemaining = 0
                    }
                }
            },
            writeJournalPhase: { _, phase in
                try self.perform("write-\(phase.rawValue)") { self.phase = phase }
            },
            deleteExactUser: { _ in
                try self.perform("delete-user") { self.user = .absent }
            },
            deleteExactGroup: { _ in
                try self.perform("delete-group") { self.group = .absent }
            },
            resetIdentityCache: { _ in
                try self.perform("reset-cache") {}
            },
            requestFreshProof: { _ in
                try self.perform("fresh-proof") {}
            },
            proveFinalTargetsAbsent: { _ in
                try self.perform("final-proof") {}
            },
            revalidateStaticAuthority: { _ in
                try self.perform("static-authority") {}
            },
            removeJournal: { _ in
                try self.perform("remove-journal") { self.journalPresent = false }
            },
            makeSuccessReceipt: { _ in
                try self.perform("make-receipt") { self.receiptCount += 1 }
                return "repaired"
            },
            transitionFailure: { _, _, reason in
                ExecutorNativeFailure.transition(reason.rawValue)
            },
            transitionBudgetFailure: { ExecutorNativeFailure.budget }
        )
    }

    func perform(_ name: String, mutation: () -> Void) throws {
        counters[name, default: 0] += 1
        if failBeforeOperation == name {
            failBeforeOperation = nil
            throw ExecutorNativeFailure.injected("before-\(name)")
        }
        mutation()
        if failAfterOperation == name {
            failAfterOperation = nil
            throw ExecutorNativeFailure.injected("after-\(name)")
        }
    }
}

private func testRepairEntrySourceStatusIsolation() throws {
    var resumeCount = 0
    var baselineCount = 0
    var statusCount = 0
    var journalCount = 0

    try preparePartialInstallRepairEntry(
        observation: .activeJournal,
        resumeActiveJournal: { resumeCount += 1 },
        requireCompleteUnjournaledBaseline: { baselineCount += 1; return "witness" },
        requestSourceStatus: { statusCount += 1; return "authority" },
        establishJournal: { _, _ in journalCount += 1 },
        cleanNoJournalFailure: { ExecutorNativeFailure.cleanNoJournal }
    )
    try executorRequire(
        resumeCount == 1 && baselineCount == 0 && statusCount == 0 && journalCount == 0,
        "an active journal must resume without invoking source status"
    )

    do {
        try preparePartialInstallRepairEntry(
            observation: .cleanNoJournal,
            resumeActiveJournal: { resumeCount += 1 },
            requireCompleteUnjournaledBaseline: { baselineCount += 1; return "witness" },
            requestSourceStatus: { statusCount += 1; return "authority" },
            establishJournal: { _, _ in journalCount += 1 },
            cleanNoJournalFailure: { ExecutorNativeFailure.cleanNoJournal }
        )
        throw ExecutorNativeFailure.assertion("clean/no-journal unexpectedly succeeded")
    } catch ExecutorNativeFailure.cleanNoJournal {}
    try executorRequire(
        statusCount == 0 && journalCount == 0,
        "clean/no-journal must produce no status request and no journal or success projection"
    )

    try preparePartialInstallRepairEntry(
        observation: .unjournaledResidue,
        resumeActiveJournal: { resumeCount += 1 },
        requireCompleteUnjournaledBaseline: { baselineCount += 1; return "witness" },
        requestSourceStatus: { statusCount += 1; return "authority" },
        establishJournal: { witness, authority in
            try executorRequire(
                witness == "witness" && authority == "authority",
                "the journal must bind the complete baseline and its one source status"
            )
            journalCount += 1
        },
        cleanNoJournalFailure: { ExecutorNativeFailure.cleanNoJournal }
    )
    try executorRequire(
        baselineCount == 1 && statusCount == 1 && journalCount == 1,
        "one complete unjournaled baseline must request source status exactly once"
    )

    do {
        try preparePartialInstallRepairEntry(
            observation: .unjournaledResidue,
            resumeActiveJournal: {},
            requireCompleteUnjournaledBaseline: { throw ExecutorNativeFailure.injected("baseline") },
            requestSourceStatus: { statusCount += 1; return "authority" },
            establishJournal: { (_: String, _: String) in journalCount += 1 },
            cleanNoJournalFailure: { ExecutorNativeFailure.cleanNoJournal }
        )
        throw ExecutorNativeFailure.assertion("invalid unjournaled residue unexpectedly reached status")
    } catch ExecutorNativeFailure.injected("baseline") {}
    try executorRequire(
        statusCount == 1 && journalCount == 1,
        "an incomplete or conflicting unjournaled baseline must fail before source status"
    )
}

private func testProductionExecutorHappyPathAndInvocationBinding() throws {
    let machine = FakeRepairMachine()
    let prepared = try executePartialInstallRepair(
        operations: machine.operations(),
        invocationID: "invocation-a"
    )
    try executorRequire(
        prepared.receipt == "repaired" && machine.journalPresent,
        "the executor must prepare the exact receipt while the principal-removed journal remains durable"
    )
    try executorRequire(machine.receiptCount == 1, "preparation must produce exactly one journal-bound receipt")
    let completedEvidence = machine.evidenceObservations.first {
        $0.freshAbsenceProof != nil
    }
    try executorRequire(
        completedEvidence?.cacheReset?.invocationID == "invocation-a"
            && completedEvidence?.freshAbsenceProof?.invocationID == "invocation-a"
            && completedEvidence?.freshAbsenceProof?.immutableJournalBindingSHA256
                == machine.immutableBinding,
        "volatile cache and fresh proof evidence must bind both invocation and immutable journal"
    )
    let receipt = try commitPreparedPartialInstallRepair(
        prepared,
        operations: machine.operations()
    )
    try executorRequire(
        receipt == "repaired" && !machine.journalPresent,
        "the terminal commit must unlink the journal as its last fallible effect"
    )
}

private func testProductionExecutorEffectAheadRecovery() throws {
    let artifacts = FakeRepairMachine()
    for remainingAfterCrash in stride(from: 4, through: 0, by: -1) {
        artifacts.failAfterOperation = "remove-artifacts"
        try expectInjectedFailure(artifacts, invocationID: "artifact-\(remainingAfterCrash)")
        try executorRequire(
            artifacts.phase == .prepared && artifacts.artifactsRemaining == remainingAfterCrash,
            "each artifact effect-ahead crash must retain prepared ownership and exact remaining residue"
        )
    }
    let artifactPrepared = try executePartialInstallRepair(
        operations: artifacts.operations(),
        invocationID: "artifact-final"
    )
    let artifactReceipt = try commitPreparedPartialInstallRepair(
        artifactPrepared,
        operations: artifacts.operations()
    )
    try executorRequire(artifactReceipt == "repaired", "all artifact mutation boundaries must converge on retry")

    for (operation, expectedPhase, expectedUser, expectedGroup) in [
        ("write-artifacts-removed", PartialInstallRepairPhase.artifactsRemoved, PartialInstallRepairRecordState.exactPresent, PartialInstallRepairRecordState.exactPresent),
        ("delete-user", PartialInstallRepairPhase.artifactsRemoved, PartialInstallRepairRecordState.absent, PartialInstallRepairRecordState.exactPresent),
        ("write-user-removed", PartialInstallRepairPhase.userRemoved, PartialInstallRepairRecordState.absent, PartialInstallRepairRecordState.exactPresent),
        ("delete-group", PartialInstallRepairPhase.userRemoved, PartialInstallRepairRecordState.absent, PartialInstallRepairRecordState.absent),
        ("write-group-removed", PartialInstallRepairPhase.groupRemoved, PartialInstallRepairRecordState.absent, PartialInstallRepairRecordState.absent),
        ("write-principal-removed", PartialInstallRepairPhase.principalRemoved, PartialInstallRepairRecordState.absent, PartialInstallRepairRecordState.absent),
    ] {
        let machine = FakeRepairMachine()
        machine.failAfterOperation = operation
        try expectInjectedFailure(machine, invocationID: "effect-ahead-\(operation)")
        try executorRequire(
            machine.phase == expectedPhase && machine.user == expectedUser && machine.group == expectedGroup,
            "\(operation) must expose its durable effect without advancing any later boundary"
        )
        let prepared = try executePartialInstallRepair(
            operations: machine.operations(),
            invocationID: "resume-\(operation)"
        )
        _ = try commitPreparedPartialInstallRepair(
            prepared,
            operations: machine.operations()
        )
        try executorRequire(!machine.journalPresent, "\(operation) must converge from durable effect-ahead state")
    }
}

private func testProductionExecutorVolatileEvidenceRecovery() throws {
    for operation in ["reset-cache", "fresh-proof"] {
        let machine = FakeRepairMachine(
            phase: .groupRemoved,
            artifactsRemaining: 0,
            user: .absent,
            group: .absent
        )
        machine.failAfterOperation = operation
        try expectInjectedFailure(machine, invocationID: "volatile-crash-\(operation)")
        let attemptsBeforeResume = machine.counters[operation, default: 0]
        let prepared = try executePartialInstallRepair(
            operations: machine.operations(),
            invocationID: "volatile-resume-\(operation)"
        )
        try executorRequire(
            machine.counters[operation, default: 0] > attemptsBeforeResume,
            "\(operation) evidence must never survive a failed operation or new invocation"
        )
        _ = try commitPreparedPartialInstallRepair(
            prepared,
            operations: machine.operations()
        )
    }

    let replacement = FakeRepairMachine(
        phase: .groupRemoved,
        artifactsRemaining: 0,
        user: .absent,
        group: .absent
    )
    replacement.failBeforeOperation = "fresh-proof"
    try expectInjectedFailure(replacement, invocationID: "binding-before-replacement")
    replacement.evidenceObservations.removeAll()
    let replacementPrepared = try executePartialInstallRepair(
        operations: replacement.operations(),
        invocationID: "binding-after-replacement"
    )
    try executorRequire(
        replacement.evidenceObservations.first?.cacheReset == nil,
        "a new invocation must not accept the preceding invocation's volatile cache evidence"
    )
    _ = try commitPreparedPartialInstallRepair(
        replacementPrepared,
        operations: replacement.operations()
    )
}

private func testProductionExecutorEventSinkCrashMatrix() throws {
    for target in [
        "artifacts-removed",
        "phase-artifacts-removed",
        "user-deleted",
        "phase-user-removed",
        "group-deleted",
        "phase-group-removed",
        "cache-reset",
        "fresh-proof",
        "phase-principal-removed",
        "final-proof",
        "static-authority",
        "receipt-prepared",
    ] {
        let machine = FakeRepairMachine()
        var injected = false
        do {
            _ = try executePartialInstallRepair(
                operations: machine.operations(),
                invocationID: "event-\(target)",
                eventSink: { event in
                    if !injected, executorEventKey(event) == target {
                        injected = true
                        throw ExecutorNativeFailure.injected("event-\(target)")
                    }
                }
            )
            throw ExecutorNativeFailure.assertion("the \(target) event crash was not injected")
        } catch ExecutorNativeFailure.injected {}
        try executorRequire(
            injected && machine.journalPresent
                && machine.receiptCount == (target == "receipt-prepared" ? 1 : 0),
            "the \(target) event boundary must preserve a resumable journal without success"
        )
        let prepared = try executePartialInstallRepair(
            operations: machine.operations(),
            invocationID: "event-resume-\(target)"
        )
        _ = try commitPreparedPartialInstallRepair(
            prepared,
            operations: machine.operations()
        )
        try executorRequire(!machine.journalPresent, "the \(target) event boundary must converge on one fresh invocation")
    }
}

private func testProductionExecutorTerminalRecovery() throws {
    for operation in ["final-proof", "static-authority"] {
        let machine = FakeRepairMachine(
            phase: .principalRemoved,
            artifactsRemaining: 0,
            user: .absent,
            group: .absent
        )
        machine.failBeforeOperation = operation
        try expectInjectedFailure(machine, invocationID: "terminal-\(operation)")
        try executorRequire(
            machine.journalPresent && machine.phase == .principalRemoved && machine.receiptCount == 0,
            "\(operation) failure must preserve the principal-removed journal and withhold success"
        )
        let prepared = try executePartialInstallRepair(
            operations: machine.operations(),
            invocationID: "terminal-resume-\(operation)"
        )
        _ = try commitPreparedPartialInstallRepair(
            prepared,
            operations: machine.operations()
        )
    }

    let reappeared = FakeRepairMachine(
        phase: .principalRemoved,
        artifactsRemaining: 0,
        user: .absent,
        group: .absent
    )
    let reappearedPrepared = try executePartialInstallRepair(
        operations: reappeared.operations(),
        invocationID: "unlink-reappeared"
    )
    reappeared.failBeforeOperation = "remove-journal"
    do {
        _ = try commitPreparedPartialInstallRepair(
            reappearedPrepared,
            operations: reappeared.operations()
        )
        throw ExecutorNativeFailure.assertion("the pre-unlink failure was not injected")
    } catch ExecutorNativeFailure.injected("before-remove-journal") {}
    try executorRequire(reappeared.journalPresent, "an uncommitted unlink must leave a resumable principal-removed journal")
    _ = try commitPreparedPartialInstallRepair(
        reappearedPrepared,
        operations: reappeared.operations(),
    )

    let absent = FakeRepairMachine(
        phase: .principalRemoved,
        artifactsRemaining: 0,
        user: .absent,
        group: .absent
    )
    let absentPrepared = try executePartialInstallRepair(
        operations: absent.operations(),
        invocationID: "unlink-absent"
    )
    absent.failAfterOperation = "remove-journal"
    do {
        _ = try commitPreparedPartialInstallRepair(
            absentPrepared,
            operations: absent.operations(),
        )
        throw ExecutorNativeFailure.assertion("the effect-ahead unlink failure was not injected")
    } catch ExecutorNativeFailure.injected("after-remove-journal") {}
    try executorRequire(
        !absent.journalPresent && absent.receiptCount == 1,
        "an unlink effect-ahead failure must reach the independent clean/no-journal boundary without returning success"
    )

    var statusCount = 0
    var receiptCount = 0
    do {
        try preparePartialInstallRepairEntry(
            observation: .cleanNoJournal,
            resumeActiveJournal: {},
            requireCompleteUnjournaledBaseline: { "witness" },
            requestSourceStatus: { statusCount += 1; return "authority" },
            establishJournal: { _, _ in },
            cleanNoJournalFailure: { ExecutorNativeFailure.cleanNoJournal }
        )
        receiptCount += 1
    } catch ExecutorNativeFailure.cleanNoJournal {}
    try executorRequire(
        statusCount == 0 && receiptCount == 0,
        "journal absence after an effect-ahead final unlink must typed-fail-close without status or receipt"
    )
}

private func expectInjectedFailure(
    _ machine: FakeRepairMachine,
    invocationID: String
) throws {
    do {
        _ = try executePartialInstallRepair(
            operations: machine.operations(),
            invocationID: invocationID
        )
        throw ExecutorNativeFailure.assertion("the injected failure did not stop execution")
    } catch ExecutorNativeFailure.injected {}
}

private func executorEventKey(_ event: PartialInstallRepairExecutionEvent) -> String {
    switch event {
    case .observed: "observed"
    case .exactArtifactsRemoved: "artifacts-removed"
    case .exactUserDeleted: "user-deleted"
    case .exactGroupDeleted: "group-deleted"
    case .identityCacheReset: "cache-reset"
    case .freshAbsenceProved: "fresh-proof"
    case let .journalPhaseCommitted(_, phase): "phase-\(phase.rawValue)"
    case .finalTargetsProved: "final-proof"
    case .staticAuthorityRevalidated: "static-authority"
    case .successReceiptPrepared: "receipt-prepared"
    }
}

private func executorRequire(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    guard condition() else { throw ExecutorNativeFailure.assertion(message) }
}
