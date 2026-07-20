import Foundation

/// Pure decision model for the delete-only partial-install repair transaction.
/// Callers must validate concrete filesystem, OpenDirectory, code identity, and
/// receipt evidence before projecting it into this snapshot.
enum PartialInstallRepairPhase: String, CaseIterable, Equatable, Sendable {
    case prepared
    case artifactsRemoved = "artifacts-removed"
    case userRemoved = "user-removed"
    case groupRemoved = "group-removed"
    case principalRemoved = "principal-removed"

    var nextJournalPhase: PartialInstallRepairPhase? {
        switch self {
        case .prepared: .artifactsRemoved
        case .artifactsRemoved: .userRemoved
        case .userRemoved: .groupRemoved
        case .groupRemoved: .principalRemoved
        case .principalRemoved: nil
        }
    }

    func permitsJournalTransition(to next: PartialInstallRepairPhase) -> Bool {
        nextJournalPhase == next
    }
}

enum PartialInstallRepairArtifactState: Equatable, Sendable {
    /// One or more repair-owned artifacts remain and every present artifact is exact.
    case exactResiduePresent
    case absent
    case conflicting
}

enum PartialInstallRepairRecordState: Equatable, Sendable {
    case exactPresent
    case absent
    case conflicting
}

enum PartialInstallRepairCacheResetState: Equatable, Sendable {
    case notPerformed
    case completed
    case failed
}

enum PartialInstallRepairFreshProofState: Equatable, Sendable {
    case absent
    case journalBoundAbsence
    case conflicting
}

enum PartialInstallRepairEvidenceState: Equatable, Sendable {
    case exact
    case conflicting
}

struct PartialInstallRepairTransitionSnapshot: Equatable, Sendable {
    /// Nil is always fail-closed. Repair transitions exist only under one
    /// immutable, authority-bound journal.
    let journalPhase: PartialInstallRepairPhase?
    let artifacts: PartialInstallRepairArtifactState
    let userRecord: PartialInstallRepairRecordState
    let groupRecord: PartialInstallRepairRecordState
    let cacheReset: PartialInstallRepairCacheResetState
    let freshProof: PartialInstallRepairFreshProofState
    let authority: PartialInstallRepairEvidenceState
    let globalEnvelope: PartialInstallRepairEvidenceState

    init(
        journalPhase: PartialInstallRepairPhase?,
        artifacts: PartialInstallRepairArtifactState,
        userRecord: PartialInstallRepairRecordState,
        groupRecord: PartialInstallRepairRecordState,
        cacheReset: PartialInstallRepairCacheResetState = .notPerformed,
        freshProof: PartialInstallRepairFreshProofState = .absent,
        authority: PartialInstallRepairEvidenceState = .exact,
        globalEnvelope: PartialInstallRepairEvidenceState = .exact
    ) {
        self.journalPhase = journalPhase
        self.artifacts = artifacts
        self.userRecord = userRecord
        self.groupRecord = groupRecord
        self.cacheReset = cacheReset
        self.freshProof = freshProof
        self.authority = authority
        self.globalEnvelope = globalEnvelope
    }
}

enum PartialInstallRepairFreshProofScope: Equatable, Sendable {
    case journalBoundAbsence
}

enum PartialInstallRepairNextAction: Equatable, Sendable {
    case removeExactArtifacts
    case writeJournalPhase(PartialInstallRepairPhase)
    case deleteExactUser
    case deleteExactGroup
    case resetIdentityCache
    case requestFreshProof(PartialInstallRepairFreshProofScope)
    case removeJournalAndComplete
}

enum PartialInstallRepairTransitionFailure: String, Equatable, Sendable {
    case authorityConflict = "authority-conflict"
    case globalEnvelopeConflict = "global-envelope-conflict"
    case artifactConflict = "artifact-conflict"
    case journalMissingForResidue = "journal-missing-for-residue"
    case principalConflict = "principal-conflict"
    case deletionOrderViolation = "deletion-order-violation"
    case phaseStateConflict = "phase-state-conflict"
    case staleEvidence = "stale-evidence"
    case cacheResetFailed = "cache-reset-failed"
    case freshProofConflict = "fresh-proof-conflict"
}

enum PartialInstallRepairTransitionDecision: Equatable, Sendable {
    case act(PartialInstallRepairNextAction)
    case failClosed(PartialInstallRepairTransitionFailure)
}

enum PartialInstallRepairJournalCrashPoint: String, CaseIterable, Equatable, Sendable {
    case stagingCreated = "staging-created"
    case stagingBytesWritten = "staging-bytes-written"
    case stagingFileSynced = "staging-file-synced"
    case beforeRename = "before-rename"
    case afterRenameBeforeDirectorySync = "after-rename-before-directory-sync"
    case journalDirectorySynced = "journal-directory-synced"
    case afterFinalUnlinkBeforeDirectorySync = "after-final-unlink-before-directory-sync"
    case finalUnlinkDirectorySynced = "final-unlink-directory-synced"
}

enum PartialInstallRepairJournalRecovery: Equatable, Sendable {
    case removeValidatedStagingAndResumeNamedJournal
    case validateNamedJournalAndReconcileEffectAhead
    case validateReappearedPrincipalRemovedJournalOrAcceptAbsence
    case requireJournalAbsent
}

/// Crash recovery oracle for every persistent file-mutation boundary. The
/// concrete vnode store implements these decisions with openat/fstatat,
/// renameat/unlinkat and parent-directory fsync.
func partialInstallRepairJournalRecovery(
    after crashPoint: PartialInstallRepairJournalCrashPoint
) -> PartialInstallRepairJournalRecovery {
    switch crashPoint {
    case .stagingCreated, .stagingBytesWritten, .stagingFileSynced, .beforeRename:
        return .removeValidatedStagingAndResumeNamedJournal
    case .afterRenameBeforeDirectorySync, .journalDirectorySynced:
        return .validateNamedJournalAndReconcileEffectAhead
    case .afterFinalUnlinkBeforeDirectorySync:
        return .validateReappearedPrincipalRemovedJournalOrAcceptAbsence
    case .finalUnlinkDirectorySynced:
        return .requireJournalAbsent
    }
}

func partialInstallRepairNextTransition(
    _ snapshot: PartialInstallRepairTransitionSnapshot
) -> PartialInstallRepairTransitionDecision {
    guard snapshot.authority == .exact else { return .failClosed(.authorityConflict) }
    guard snapshot.globalEnvelope == .exact else { return .failClosed(.globalEnvelopeConflict) }
    guard snapshot.artifacts != .conflicting else { return .failClosed(.artifactConflict) }
    guard snapshot.cacheReset != .failed else { return .failClosed(.cacheResetFailed) }
    guard snapshot.freshProof != .conflicting else { return .failClosed(.freshProofConflict) }

    guard let phase = snapshot.journalPhase else {
        return .failClosed(.journalMissingForResidue)
    }
    return journalTransition(phase: phase, snapshot: snapshot)
}

private func journalTransition(
    phase: PartialInstallRepairPhase,
    snapshot: PartialInstallRepairTransitionSnapshot
) -> PartialInstallRepairTransitionDecision {
    switch phase {
    case .prepared:
        guard snapshot.cacheReset == .notPerformed, snapshot.freshProof == .absent else {
            return .failClosed(.staleEvidence)
        }
        if let decision = requireCompletePrincipal(snapshot) { return decision }
        switch snapshot.artifacts {
        case .exactResiduePresent:
            return .act(.removeExactArtifacts)
        case .absent:
            return .act(.writeJournalPhase(.artifactsRemoved))
        case .conflicting:
            return .failClosed(.artifactConflict)
        }

    case .artifactsRemoved:
        guard snapshot.artifacts == .absent else { return .failClosed(.phaseStateConflict) }
        guard snapshot.cacheReset == .notPerformed, snapshot.freshProof == .absent else {
            return .failClosed(.staleEvidence)
        }
        switch (snapshot.userRecord, snapshot.groupRecord) {
        case (.exactPresent, .exactPresent):
            return .act(.deleteExactUser)
        case (.absent, .exactPresent):
            return .act(.writeJournalPhase(.userRemoved))
        case (.exactPresent, .absent):
            return .failClosed(.deletionOrderViolation)
        case (.absent, .absent):
            return .failClosed(.phaseStateConflict)
        default:
            return .failClosed(.principalConflict)
        }

    case .userRemoved:
        guard snapshot.artifacts == .absent else { return .failClosed(.phaseStateConflict) }
        guard snapshot.cacheReset == .notPerformed, snapshot.freshProof == .absent else {
            return .failClosed(.staleEvidence)
        }
        switch (snapshot.userRecord, snapshot.groupRecord) {
        case (.absent, .exactPresent):
            return .act(.deleteExactGroup)
        case (.absent, .absent):
            return .act(.writeJournalPhase(.groupRemoved))
        case (.exactPresent, .absent):
            return .failClosed(.deletionOrderViolation)
        default:
            return .failClosed(.phaseStateConflict)
        }

    case .groupRemoved:
        guard snapshot.artifacts == .absent else { return .failClosed(.phaseStateConflict) }
        if let decision = requireRawAbsentPrincipal(snapshot) { return decision }
        switch snapshot.cacheReset {
        case .notPerformed:
            guard snapshot.freshProof == .absent else { return .failClosed(.staleEvidence) }
            return .act(.resetIdentityCache)
        case .completed:
            switch snapshot.freshProof {
            case .absent:
                return .act(.requestFreshProof(.journalBoundAbsence))
            case .journalBoundAbsence:
                return .act(.writeJournalPhase(.principalRemoved))
            case .conflicting:
                return .failClosed(.freshProofConflict)
            }
        case .failed:
            return .failClosed(.cacheResetFailed)
        }

    case .principalRemoved:
        guard snapshot.artifacts == .absent else { return .failClosed(.phaseStateConflict) }
        if let decision = requireRawAbsentPrincipal(snapshot) { return decision }
        switch snapshot.cacheReset {
        case .notPerformed:
            guard snapshot.freshProof == .absent else { return .failClosed(.staleEvidence) }
            return .act(.resetIdentityCache)
        case .completed:
            switch snapshot.freshProof {
            case .absent:
                // Re-establish the fresh proof after a crash that followed the
                // durable principal-removed write but preceded journal removal.
                return .act(.requestFreshProof(.journalBoundAbsence))
            case .journalBoundAbsence:
                return .act(.removeJournalAndComplete)
            case .conflicting:
                return .failClosed(.freshProofConflict)
            }
        case .failed:
            return .failClosed(.cacheResetFailed)
        }
    }
}

private func requireCompletePrincipal(
    _ snapshot: PartialInstallRepairTransitionSnapshot
) -> PartialInstallRepairTransitionDecision? {
    guard snapshot.userRecord == .exactPresent,
          snapshot.groupRecord == .exactPresent else {
        if snapshot.userRecord == .exactPresent, snapshot.groupRecord == .absent {
            return .failClosed(.deletionOrderViolation)
        }
        return .failClosed(.principalConflict)
    }
    return nil
}

private func requireRawAbsentPrincipal(
    _ snapshot: PartialInstallRepairTransitionSnapshot
) -> PartialInstallRepairTransitionDecision? {
    guard snapshot.userRecord == .absent, snapshot.groupRecord == .absent else {
        if snapshot.userRecord == .exactPresent, snapshot.groupRecord == .absent {
            return .failClosed(.deletionOrderViolation)
        }
        return .failClosed(.phaseStateConflict)
    }
    return nil
}
