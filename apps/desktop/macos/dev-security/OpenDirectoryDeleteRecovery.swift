enum OpenDirectoryDeletePostconditionDecision: Equatable {
    /// Raw name and identifier projections are both absent in a fresh session.
    /// This is accepted even when delete() surfaced an error after committing.
    case acceptCommittedAbsence
    case failDeleteErrorRecordRemains
    case failRecordRemainedAfterDelete
}

func openDirectoryDeletePostconditionDecision(
    deletionReportedError: Bool,
    byNamePresent: Bool,
    byIdentifierPresent: Bool
) -> OpenDirectoryDeletePostconditionDecision {
    if !byNamePresent, !byIdentifierPresent { return .acceptCommittedAbsence }
    return deletionReportedError
        ? .failDeleteErrorRecordRemains
        : .failRecordRemainedAfterDelete
}
