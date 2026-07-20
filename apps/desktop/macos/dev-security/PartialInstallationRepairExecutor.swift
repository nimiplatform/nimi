import Foundation

struct PartialInstallRepairInvocationBinding: Equatable, Sendable {
    let invocationID: String
    let immutableJournalBindingSHA256: String
}

struct PartialInstallRepairInvocationEvidence: Equatable, Sendable {
    let invocationID: String
    fileprivate(set) var cacheReset: PartialInstallRepairInvocationBinding?
    fileprivate(set) var freshAbsenceProof: PartialInstallRepairInvocationBinding?

    init(invocationID: String) {
        self.invocationID = invocationID
    }

    func binding(for immutableJournalBindingSHA256: String) -> PartialInstallRepairInvocationBinding {
        PartialInstallRepairInvocationBinding(
            invocationID: invocationID,
            immutableJournalBindingSHA256: immutableJournalBindingSHA256
        )
    }

    func cacheResetState(for immutableJournalBindingSHA256: String) -> PartialInstallRepairCacheResetState {
        cacheReset == binding(for: immutableJournalBindingSHA256) ? .completed : .notPerformed
    }

    func freshProofState(for immutableJournalBindingSHA256: String) -> PartialInstallRepairFreshProofState {
        freshAbsenceProof == binding(for: immutableJournalBindingSHA256) ? .journalBoundAbsence : .absent
    }
}

struct PartialInstallRepairObservation<Context> {
    let context: Context
    let immutableJournalBindingSHA256: String
    let snapshot: PartialInstallRepairTransitionSnapshot
}

struct PartialInstallRepairPreparedCompletion<Context, Receipt> {
    let context: Context
    let binding: PartialInstallRepairInvocationBinding
    let receipt: Receipt
}

enum PartialInstallRepairExecutionEvent: Equatable, Sendable {
    case observed(PartialInstallRepairInvocationBinding, PartialInstallRepairPhase)
    case exactArtifactsRemoved(PartialInstallRepairInvocationBinding)
    case exactUserDeleted(PartialInstallRepairInvocationBinding)
    case exactGroupDeleted(PartialInstallRepairInvocationBinding)
    case identityCacheReset(PartialInstallRepairInvocationBinding)
    case freshAbsenceProved(PartialInstallRepairInvocationBinding)
    case journalPhaseCommitted(PartialInstallRepairInvocationBinding, PartialInstallRepairPhase)
    case finalTargetsProved(PartialInstallRepairInvocationBinding)
    case staticAuthorityRevalidated(PartialInstallRepairInvocationBinding)
    case successReceiptPrepared(PartialInstallRepairInvocationBinding)
}

struct PartialInstallRepairOperations<Context, Receipt> {
    let observe: (PartialInstallRepairInvocationEvidence) throws -> PartialInstallRepairObservation<Context>
    let removeExactArtifacts: (Context) throws -> Void
    let writeJournalPhase: (Context, PartialInstallRepairPhase) throws -> Void
    let deleteExactUser: (Context) throws -> Void
    let deleteExactGroup: (Context) throws -> Void
    let resetIdentityCache: (Context) throws -> Void
    let requestFreshProof: (Context) throws -> Void
    let proveFinalTargetsAbsent: (Context) throws -> Void
    let revalidateStaticAuthority: (Context) throws -> Void
    let removeJournal: (Context) throws -> Void
    let makeSuccessReceipt: (Context) throws -> Receipt
    let transitionFailure: (
        Context,
        PartialInstallRepairTransitionSnapshot,
        PartialInstallRepairTransitionFailure
    ) -> Error
    let transitionBudgetFailure: () -> Error
}

enum PartialInstallRepairEntryObservation: Equatable, Sendable {
    case activeJournal
    case cleanNoJournal
    case unjournaledResidue
}

/// Establishes the durable repair owner before the transition executor starts.
/// The source helper is intentionally unreachable from active-journal and clean
/// paths. For unjournaled residue, the complete raw baseline must return before
/// the one source-status request can occur.
func preparePartialInstallRepairEntry<Witness, Authority>(
    observation: PartialInstallRepairEntryObservation,
    resumeActiveJournal: () throws -> Void,
    requireCompleteUnjournaledBaseline: () throws -> Witness,
    requestSourceStatus: () throws -> Authority,
    establishJournal: (Witness, Authority) throws -> Void,
    cleanNoJournalFailure: () -> Error
) throws {
    switch observation {
    case .activeJournal:
        try resumeActiveJournal()
    case .cleanNoJournal:
        throw cleanNoJournalFailure()
    case .unjournaledResidue:
        let witness = try requireCompleteUnjournaledBaseline()
        let authority = try requestSourceStatus()
        try establishJournal(witness, authority)
    }
}

func executePartialInstallRepair<Context, Receipt>(
    operations: PartialInstallRepairOperations<Context, Receipt>,
    invocationID: String = UUID().uuidString.lowercased(),
    transitionLimit: Int = 12,
    eventSink: (PartialInstallRepairExecutionEvent) throws -> Void = { _ in }
) throws -> PartialInstallRepairPreparedCompletion<Context, Receipt> {
    guard transitionLimit > 0 else { throw operations.transitionBudgetFailure() }
    var evidence = PartialInstallRepairInvocationEvidence(invocationID: invocationID)

    for _ in 0..<transitionLimit {
        let observation = try operations.observe(evidence)
        let snapshot = observation.snapshot
        guard let phase = snapshot.journalPhase else {
            throw operations.transitionFailure(
                observation.context,
                snapshot,
                .journalMissingForResidue
            )
        }
        let binding = evidence.binding(for: observation.immutableJournalBindingSHA256)
        try eventSink(.observed(binding, phase))

        switch partialInstallRepairNextTransition(snapshot) {
        case let .failClosed(reason):
            throw operations.transitionFailure(observation.context, snapshot, reason)

        case .act(.removeExactArtifacts):
            try operations.removeExactArtifacts(observation.context)
            try eventSink(.exactArtifactsRemoved(binding))

        case let .act(.writeJournalPhase(nextPhase)):
            try operations.writeJournalPhase(observation.context, nextPhase)
            try eventSink(.journalPhaseCommitted(binding, nextPhase))

        case .act(.deleteExactUser):
            try operations.deleteExactUser(observation.context)
            try eventSink(.exactUserDeleted(binding))

        case .act(.deleteExactGroup):
            try operations.deleteExactGroup(observation.context)
            try eventSink(.exactGroupDeleted(binding))

        case .act(.resetIdentityCache):
            try operations.resetIdentityCache(observation.context)
            try eventSink(.identityCacheReset(binding))
            evidence.cacheReset = binding
            evidence.freshAbsenceProof = nil

        case .act(.requestFreshProof(.journalBoundAbsence)):
            try operations.requestFreshProof(observation.context)
            try eventSink(.freshAbsenceProved(binding))
            evidence.freshAbsenceProof = binding

        case .act(.removeJournalAndComplete):
            try operations.proveFinalTargetsAbsent(observation.context)
            try eventSink(.finalTargetsProved(binding))
            try operations.revalidateStaticAuthority(observation.context)
            try eventSink(.staticAuthorityRevalidated(binding))
            let receipt = try operations.makeSuccessReceipt(observation.context)
            try eventSink(.successReceiptPrepared(binding))
            return PartialInstallRepairPreparedCompletion(
                context: observation.context,
                binding: binding,
                receipt: receipt
            )
        }
    }
    throw operations.transitionBudgetFailure()
}

func commitPreparedPartialInstallRepair<Context, Receipt>(
    _ prepared: PartialInstallRepairPreparedCompletion<Context, Receipt>,
    operations: PartialInstallRepairOperations<Context, Receipt>
) throws -> Receipt {
    try operations.removeJournal(prepared.context)
    return prepared.receipt
}
