package localappop

func evaluate(req Request, snapshot Snapshot) Decision {
	deny := func(reason Reason) Decision {
		return Decision{Outcome: OutcomeDenied, Reason: reason}
	}
	unavailable := func(reason Reason) Decision {
		return Decision{Outcome: OutcomeUnavailable, Reason: reason}
	}

	if !validOpaque(snapshot.LocalOSUserAnchor) || !validOpaque(snapshot.Principal.ID) {
		return deny(ReasonLocalAppPrincipalRequired)
	}
	if snapshot.Principal.State != PrincipalStateActive {
		return deny(ReasonLocalAppRecordTombstoned)
	}
	if snapshot.Principal.LocalOSUserAnchor != snapshot.LocalOSUserAnchor || !validLineage(snapshot.Principal) {
		return deny(ReasonLocalAppProvenanceUnavailable)
	}

	if !validOpaque(snapshot.Record.ID) {
		return deny(ReasonLocalAppRecordNotFound)
	}
	switch snapshot.Record.State {
	case RecordStateDormant:
		return deny(ReasonLocalAppRememberedProjectDormant)
	case RecordStateActive:
		// Continue.
	default:
		return deny(ReasonLocalAppRecordTombstoned)
	}
	if snapshot.Record.LocalOSUserAnchor != snapshot.LocalOSUserAnchor ||
		snapshot.Record.PrincipalID != snapshot.Principal.ID {
		return deny(ReasonLocalAppProvenanceUnavailable)
	}
	if !validRecordProvenance(snapshot.Principal, snapshot.Record) {
		return deny(ReasonLocalAppProvenanceUnavailable)
	}

	if snapshot.Session.State != SessionStateActive || !validOpaque(snapshot.Session.ID) {
		return deny(ReasonLocalAppSessionRevoked)
	}
	if snapshot.Session.LocalOSUserAnchor != snapshot.LocalOSUserAnchor ||
		snapshot.Session.PrincipalID != snapshot.Principal.ID ||
		snapshot.Session.RecordID != snapshot.Record.ID {
		return deny(ReasonLocalAppSessionRevoked)
	}
	if snapshot.Session.ProvenanceRevision != snapshot.Record.ProvenanceRevision ||
		snapshot.Session.InstallOrProjectGeneration != snapshot.Record.InstallOrProjectGeneration ||
		snapshot.Session.HostExecutableDigest != snapshot.Record.HostExecutableDigest ||
		snapshot.Session.PayloadRootDigest != snapshot.Record.PayloadRootDigest {
		return deny(ReasonLocalAppProvenanceUnavailable)
	}
	if !validOpaque(snapshot.BootEpoch) || snapshot.Session.BootEpoch != snapshot.BootEpoch {
		return deny(ReasonLocalAppSessionRevoked)
	}
	if !validProcess(snapshot.CurrentProcess) ||
		!equalProcess(snapshot.CurrentProcess, snapshot.Session.Process) ||
		snapshot.CurrentProcess.NativeConnectionRef != req.NativeConnectionRef ||
		snapshot.CurrentProcess.HostExecutableDigest != snapshot.Record.HostExecutableDigest {
		return deny(ReasonLocalAppProcessMismatch)
	}

	if snapshot.Account.State != AccountStateAuthenticated || !validOpaque(snapshot.Account.ID) || snapshot.Account.Generation == 0 {
		return deny(ReasonLocalAppAccountChanged)
	}
	if snapshot.Session.AccountID != snapshot.Account.ID ||
		snapshot.Session.AccountGeneration != snapshot.Account.Generation {
		return deny(ReasonLocalAppAccountChanged)
	}

	policy := snapshot.OwnerPolicy
	if policy.Status == OwnerPolicyUnavailable {
		return unavailable(ReasonLocalAppOperationUnavailable)
	}
	if policy.Operation != req.Operation || !equalSelector(policy.Selector, req.Selector) ||
		!validOpaque(policy.OwnerSelectorDigest) || policy.PolicyRevision == 0 {
		return unavailable(ReasonLocalAppOperationUnavailable)
	}

	authorityClass, ok := AuthorityClassForOperation(req.Operation)
	if !ok {
		return unavailable(ReasonLocalAppOperationUnavailable)
	}
	if authorityClass == AuthorityClassUserPermission {
		return unavailable(ReasonLocalAppOperationUnavailable)
	}

	if policy.Status != OwnerPolicyAllowed {
		reason := policy.Reason
		if reason == "" || reason == ReasonActionExecuted {
			reason = ReasonLocalAppOperationUnavailable
		}
		return deny(reason)
	}
	return Decision{
		Outcome: OutcomeAllowed,
		Reason:  ReasonActionExecuted,
		Authorization: &AuthorizationContext{
			AuthorityClass:             authorityClass,
			LocalOSUserAnchor:          snapshot.LocalOSUserAnchor,
			PrincipalID:                snapshot.Principal.ID,
			PrincipalKind:              snapshot.Principal.Kind,
			Lineage:                    snapshot.Principal.Lineage,
			RecordID:                   snapshot.Record.ID,
			ProvenanceRevision:         snapshot.Record.ProvenanceRevision,
			InstallOrProjectGeneration: snapshot.Record.InstallOrProjectGeneration,
			SessionID:                  snapshot.Session.ID,
			AccountID:                  snapshot.Account.ID,
			AccountGeneration:          snapshot.Account.Generation,
			Process:                    snapshot.CurrentProcess,
			BootEpoch:                  snapshot.BootEpoch,
			PolicyRevision:             policy.PolicyRevision,
			OwnerSelectorDigest:        policy.OwnerSelectorDigest,
			Operation:                  req.Operation,
			Selector:                   req.Selector,
		},
	}
}

func validLineage(principal Principal) bool {
	immutable := validOpaque(principal.Lineage.ImmutableLineageID)
	developmentAuthorization := validOpaque(principal.Lineage.DevelopmentAuthorizationID)
	project := validOpaque(principal.Lineage.CanonicalProjectFileID)

	switch principal.Kind {
	case PrincipalKindImmutable:
		return immutable && !developmentAuthorization && !project
	case PrincipalKindDevelopment:
		return !immutable && developmentAuthorization && project
	default:
		return false
	}
}

func validRecordProvenance(principal Principal, record Record) bool {
	if record.ProvenanceRevision == 0 || record.InstallOrProjectGeneration == 0 ||
		!validOpaque(record.ExecutionProfileRef) || !validOpaque(record.HostExecutableDigest) ||
		!validOpaque(record.PayloadRootDigest) {
		return false
	}
	switch record.TrustClass {
	case TrustClassVerified, TrustClassUserImported:
		return principal.Kind == PrincipalKindImmutable
	case TrustClassLocalDevelopment:
		return principal.Kind == PrincipalKindDevelopment
	default:
		return false
	}
}

func validProcess(process ProcessBinding) bool {
	return validOpaque(process.NativeConnectionRef) && process.ProcessID != 0 &&
		validOpaque(process.ProcessStartRef) && validOpaque(process.ExecutableObjectRef) &&
		validOpaque(process.HostExecutableDigest)
}

func equalProcess(left, right ProcessBinding) bool {
	return left == right
}
