package localappop

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"
)

func TestCoordinatorAllowsOnlySelectedOperationFamily(t *testing.T) {
	t.Parallel()

	operations := []Operation{
		OperationArtifactRead,
		OperationConversationOpen,
		OperationConversationTurnSend,
		OperationConversationSubscribe,
		OperationConversationSnapshot,
	}
	for _, operation := range operations {
		operation := operation
		t.Run(string(operation), func(t *testing.T) {
			t.Parallel()
			req, snapshot := allowedFixture(operation)
			decision := evaluateThroughCoordinator(t, req, snapshot)
			assertDecision(t, decision, OutcomeAllowed, ReasonActionExecuted)
			if decision.Authorization == nil {
				t.Fatal("allowed decision has no authorization context")
			}
			if decision.Authorization.Operation != operation || decision.Authorization.Selector != req.Selector {
				t.Fatalf("authorization operation/selector = %q %+v", decision.Authorization.Operation, decision.Authorization.Selector)
			}
			if decision.Authorization.PrincipalID == "" || decision.Authorization.GrantRevision == 0 {
				t.Fatalf("authorization lacks principal/grant revision: %+v", decision.Authorization)
			}
		})
	}
}

func TestCoordinatorIsProvenanceAgnosticAfterStructuralValidation(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		trustClass TrustClass
		kind       PrincipalKind
		lineage    LineageBinding
	}{
		{
			name:       "verified",
			trustClass: TrustClassVerified,
			kind:       PrincipalKindImmutable,
			lineage:    LineageBinding{ImmutableLineageID: "lineage:verified:opaque"},
		},
		{
			name:       "user_imported",
			trustClass: TrustClassUserImported,
			kind:       PrincipalKindImmutable,
			lineage:    LineageBinding{ImmutableLineageID: "lineage:imported:opaque"},
		},
		{
			name:       "local_development",
			trustClass: TrustClassLocalDevelopment,
			kind:       PrincipalKindDevelopment,
			lineage: LineageBinding{
				DevelopmentAuthorizationID: "dev-auth:opaque",
				CanonicalProjectFileID:     "project-file:opaque",
			},
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			req, snapshot := allowedFixture(OperationConversationTurnSend)
			snapshot.Principal.Kind = tc.kind
			snapshot.Principal.Lineage = tc.lineage
			snapshot.Record.TrustClass = tc.trustClass
			decision := evaluateThroughCoordinator(t, req, snapshot)
			assertDecision(t, decision, OutcomeAllowed, ReasonActionExecuted)
		})
	}
}

func TestCoordinatorRejectsZeroGrantAndRevocationWithoutRotatingSession(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		mutate func(*Snapshot)
		reason Reason
	}{
		{name: "zero grant", mutate: func(snapshot *Snapshot) { snapshot.Grant = nil }, reason: ReasonLocalAppGrantRequired},
		{name: "pending grant", mutate: func(snapshot *Snapshot) { snapshot.Grant.State = GrantStatePending }, reason: ReasonLocalAppGrantRequired},
		{name: "revoked grant", mutate: func(snapshot *Snapshot) { snapshot.Grant.State = GrantStateRevoked }, reason: ReasonLocalAppGrantRevoked},
		{name: "superseded grant", mutate: func(snapshot *Snapshot) { snapshot.Grant.State = GrantStateSuperseded }, reason: ReasonLocalAppGrantSuperseded},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			req, snapshot := allowedFixture(OperationArtifactRead)
			sessionID := snapshot.Session.ID
			tc.mutate(&snapshot)
			decision := evaluateThroughCoordinator(t, req, snapshot)
			assertDecision(t, decision, OutcomeDenied, tc.reason)
			if snapshot.Session.ID != sessionID || snapshot.Session.State != SessionStateActive {
				t.Fatal("grant mutation fixture unexpectedly rotated the identity session")
			}
		})
	}
}

func TestCoordinatorRejectsMismatchedCurrentTruth(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		mutate func(*Snapshot)
		reason Reason
	}{
		{name: "principal tombstoned", mutate: func(snapshot *Snapshot) { snapshot.Principal.State = PrincipalStateTombstoned }, reason: ReasonLocalAppRecordTombstoned},
		{name: "record removed", mutate: func(snapshot *Snapshot) { snapshot.Record.State = RecordStateRemoved }, reason: ReasonLocalAppRecordTombstoned},
		{name: "remembered project dormant", mutate: func(snapshot *Snapshot) { snapshot.Record.State = RecordStateDormant }, reason: ReasonLocalAppRememberedProjectDormant},
		{name: "record principal mismatch", mutate: func(snapshot *Snapshot) { snapshot.Record.PrincipalID = "principal:other" }, reason: ReasonLocalAppProvenanceUnavailable},
		{name: "principal lineage branch mismatch", mutate: func(snapshot *Snapshot) { snapshot.Principal.Lineage.ImmutableLineageID = "lineage:extra" }, reason: ReasonLocalAppProvenanceUnavailable},
		{name: "trust class principal mismatch", mutate: func(snapshot *Snapshot) { snapshot.Record.TrustClass = TrustClassVerified }, reason: ReasonLocalAppProvenanceUnavailable},
		{name: "provenance revision mismatch", mutate: func(snapshot *Snapshot) { snapshot.Session.ProvenanceRevision++ }, reason: ReasonLocalAppProvenanceUnavailable},
		{name: "project generation mismatch", mutate: func(snapshot *Snapshot) { snapshot.Session.InstallOrProjectGeneration++ }, reason: ReasonLocalAppProvenanceUnavailable},
		{name: "payload digest mismatch", mutate: func(snapshot *Snapshot) { snapshot.Session.PayloadRootDigest = "sha256:changed" }, reason: ReasonLocalAppProvenanceUnavailable},
		{name: "session revoked", mutate: func(snapshot *Snapshot) { snapshot.Session.State = SessionStateRevoked }, reason: ReasonLocalAppSessionRevoked},
		{name: "runtime boot changed", mutate: func(snapshot *Snapshot) { snapshot.BootEpoch = "boot:next" }, reason: ReasonLocalAppSessionRevoked},
		{name: "process id changed", mutate: func(snapshot *Snapshot) { snapshot.CurrentProcess.ProcessID++ }, reason: ReasonLocalAppProcessMismatch},
		{name: "process start changed", mutate: func(snapshot *Snapshot) { snapshot.CurrentProcess.ProcessStartRef = "process-start:next" }, reason: ReasonLocalAppProcessMismatch},
		{name: "connection changed", mutate: func(snapshot *Snapshot) { snapshot.CurrentProcess.NativeConnectionRef = "connection:other" }, reason: ReasonLocalAppProcessMismatch},
		{name: "host executable changed", mutate: func(snapshot *Snapshot) { snapshot.CurrentProcess.HostExecutableDigest = "sha256:other" }, reason: ReasonLocalAppProcessMismatch},
		{name: "account switched", mutate: func(snapshot *Snapshot) { snapshot.Account.ID = "account:other" }, reason: ReasonLocalAppAccountChanged},
		{name: "account generation changed", mutate: func(snapshot *Snapshot) { snapshot.Account.Generation++ }, reason: ReasonLocalAppAccountChanged},
		{name: "grant user partition mismatch", mutate: func(snapshot *Snapshot) { snapshot.Grant.LocalOSUserAnchor = "sid:other" }, reason: ReasonLocalAppGrantRequired},
		{name: "grant account mismatch", mutate: func(snapshot *Snapshot) { snapshot.Grant.AccountID = "account:other" }, reason: ReasonLocalAppGrantRequired},
		{name: "grant principal mismatch", mutate: func(snapshot *Snapshot) { snapshot.Grant.PrincipalID = "principal:other" }, reason: ReasonLocalAppGrantRequired},
		{name: "grant resource mismatch", mutate: func(snapshot *Snapshot) { snapshot.Grant.CapabilityResourceFingerprint = "fingerprint:other" }, reason: ReasonLocalAppGrantRequired},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			req, snapshot := allowedFixture(OperationConversationTurnSend)
			tc.mutate(&snapshot)
			decision := evaluateThroughCoordinator(t, req, snapshot)
			assertDecision(t, decision, OutcomeDenied, tc.reason)
		})
	}
}

func TestCoordinatorNeverFallsBackToDisplayAppID(t *testing.T) {
	t.Parallel()

	req, snapshot := allowedFixture(OperationArtifactRead)
	snapshot.Principal.AppID = "app.same-display-id"
	snapshot.Grant.PrincipalID = "principal:other-admission"
	decision := evaluateThroughCoordinator(t, req, snapshot)
	assertDecision(t, decision, OutcomeDenied, ReasonLocalAppGrantRequired)
}

func TestCoordinatorRequiresExactOwnerRelation(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		mutate  func(*Snapshot)
		outcome Outcome
		reason  Reason
	}{
		{
			name: "owner unavailable",
			mutate: func(snapshot *Snapshot) {
				snapshot.OwnerPolicy.Status = OwnerPolicyUnavailable
			},
			outcome: OutcomeUnavailable,
			reason:  ReasonLocalAppOperationUnavailable,
		},
		{
			name: "owner evaluated another conversation",
			mutate: func(snapshot *Snapshot) {
				snapshot.OwnerPolicy.Selector.ConversationAnchorID = "anchor:other"
			},
			outcome: OutcomeUnavailable,
			reason:  ReasonLocalAppOperationUnavailable,
		},
		{
			name: "owner evaluated another operation",
			mutate: func(snapshot *Snapshot) {
				snapshot.OwnerPolicy.Operation = OperationConversationSnapshot
			},
			outcome: OutcomeUnavailable,
			reason:  ReasonLocalAppOperationUnavailable,
		},
		{
			name: "owner denied relation",
			mutate: func(snapshot *Snapshot) {
				snapshot.OwnerPolicy.Status = OwnerPolicyDenied
				snapshot.OwnerPolicy.Reason = Reason("RUNTIME_AGENT_CONVERSATION_RELATION_DENIED")
			},
			outcome: OutcomeDenied,
			reason:  Reason("RUNTIME_AGENT_CONVERSATION_RELATION_DENIED"),
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			req, snapshot := allowedFixture(OperationConversationTurnSend)
			tc.mutate(&snapshot)
			decision := evaluateThroughCoordinator(t, req, snapshot)
			assertDecision(t, decision, tc.outcome, tc.reason)
		})
	}
}

func TestCoordinatorOwnerRequiredPresenceIsExactAndFresh(t *testing.T) {
	t.Parallel()

	t.Run("missing", func(t *testing.T) {
		req, snapshot := allowedFixture(OperationConversationTurnSend)
		snapshot.OwnerPolicy.PresenceRequired = true
		decision := evaluateThroughCoordinator(t, req, snapshot)
		assertDecision(t, decision, OutcomeDenied, ReasonLocalAppPresenceRequired)
	})

	tests := []struct {
		name   string
		mutate func(*Presence, Snapshot)
	}{
		{name: "expired", mutate: func(presence *Presence, snapshot Snapshot) { presence.ExpiresAt = snapshot.ResolvedAt }},
		{name: "consumed", mutate: func(presence *Presence, _ Snapshot) { presence.State = PresenceStateConsumed }},
		{name: "account generation mismatch", mutate: func(presence *Presence, _ Snapshot) { presence.AccountGeneration++ }},
		{name: "principal mismatch", mutate: func(presence *Presence, _ Snapshot) { presence.PrincipalID = "principal:other" }},
		{name: "provenance mismatch", mutate: func(presence *Presence, _ Snapshot) { presence.ProvenanceRevision++ }},
		{name: "operation mismatch", mutate: func(presence *Presence, _ Snapshot) { presence.Operation = OperationArtifactRead }},
		{name: "resource mismatch", mutate: func(presence *Presence, _ Snapshot) { presence.ResourceImpactDigest = "impact:other" }},
		{name: "policy revision mismatch", mutate: func(presence *Presence, _ Snapshot) { presence.PolicyRevision++ }},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			req, snapshot := allowedFixture(OperationConversationTurnSend)
			snapshot.OwnerPolicy.PresenceRequired = true
			snapshot.OwnerPolicy.ResourceImpactDigest = "impact:turn"
			presence := matchingPresence(req, snapshot)
			tc.mutate(&presence, snapshot)
			snapshot.Presence = &presence
			decision := evaluateThroughCoordinator(t, req, snapshot)
			assertDecision(t, decision, OutcomeDenied, ReasonLocalAppPresenceExpired)
		})
	}

	t.Run("matching", func(t *testing.T) {
		t.Parallel()
		req, snapshot := allowedFixture(OperationConversationTurnSend)
		snapshot.OwnerPolicy.PresenceRequired = true
		snapshot.OwnerPolicy.ResourceImpactDigest = "impact:turn"
		presence := matchingPresence(req, snapshot)
		snapshot.Presence = &presence
		decision := evaluateThroughCoordinator(t, req, snapshot)
		assertDecision(t, decision, OutcomeAllowed, ReasonActionExecuted)
	})
}

func TestCoordinatorRejectsUnsupportedOrMalformedRequestBeforeResolution(t *testing.T) {
	t.Parallel()

	called := false
	coordinator := NewCoordinator(SnapshotResolverFunc(func(context.Context, Request) (Snapshot, error) {
		called = true
		return Snapshot{}, nil
	}))

	unsupported := coordinator.Evaluate(context.Background(), Request{
		NativeConnectionRef: "connection:1",
		Operation:           Operation("runtime.media.stream"),
	})
	assertDecision(t, unsupported, OutcomeUnavailable, ReasonLocalAppOperationUnavailable)
	if called {
		t.Fatal("unsupported operation reached the resolver")
	}

	malformed := coordinator.Evaluate(context.Background(), Request{
		NativeConnectionRef: "connection:1",
		Operation:           OperationArtifactRead,
		Selector: Selector{
			ArtifactID: "artifact:1",
			AgentID:    "agent:must-not-be-present",
		},
	})
	assertDecision(t, malformed, OutcomeDenied, ReasonProtocolEnvelopeInvalid)
	if called {
		t.Fatal("malformed selector reached the resolver")
	}

	whitespaceAlias := coordinator.Evaluate(context.Background(), Request{
		NativeConnectionRef: "connection:1",
		Operation:           OperationArtifactRead,
		Selector: Selector{
			ArtifactID: "artifact:1",
			AgentID:    " ",
		},
	})
	assertDecision(t, whitespaceAlias, OutcomeDenied, ReasonProtocolEnvelopeInvalid)
	if called {
		t.Fatal("whitespace selector alias reached the resolver")
	}
}

func TestCoordinatorFailsClosedWhenResolverIsUnavailable(t *testing.T) {
	t.Parallel()

	req, _ := allowedFixture(OperationArtifactRead)
	for name, coordinator := range map[string]*Coordinator{
		"nil coordinator": nil,
		"nil resolver":    NewCoordinator(nil),
		"resolver error": NewCoordinator(SnapshotResolverFunc(func(context.Context, Request) (Snapshot, error) {
			return Snapshot{}, errors.New("storage unavailable")
		})),
	} {
		name, coordinator := name, coordinator
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			decision := coordinator.Evaluate(context.Background(), req)
			assertDecision(t, decision, OutcomeUnavailable, ReasonLocalAppOperationUnavailable)
		})
	}
}

func TestRequestAndAuthorizationHaveNoPortableAuthorityFields(t *testing.T) {
	t.Parallel()

	assertFields(t, reflect.TypeOf(Request{}), []string{"NativeConnectionRef", "Operation", "Selector"})
	assertFields(t, reflect.TypeOf(Selector{}), []string{"ArtifactID", "AgentID", "ConversationAnchorID", "TurnID"})

	for _, typ := range []reflect.Type{reflect.TypeOf(Request{}), reflect.TypeOf(AuthorizationContext{})} {
		for index := 0; index < typ.NumField(); index++ {
			name := typ.Field(index).Name
			switch name {
			case "Token", "Bearer", "SessionProof", "ProviderID", "ModelID", "AppID":
				t.Fatalf("%s exposes forbidden authority field %s", typ.Name(), name)
			}
		}
	}
}

func allowedFixture(operation Operation) (Request, Snapshot) {
	selector := selectorFor(operation)
	req := Request{
		NativeConnectionRef: "connection:1",
		Operation:           operation,
		Selector:            selector,
	}
	process := ProcessBinding{
		NativeConnectionRef:  req.NativeConnectionRef,
		ProcessID:            4242,
		ProcessStartRef:      "process-start:opaque",
		ExecutableObjectRef:  "executable-object:opaque",
		HostExecutableDigest: "sha256:host",
	}
	fingerprint := "capability-resource:fingerprint"
	snapshot := Snapshot{
		ResolvedAt:        time.Date(2026, 7, 13, 9, 0, 0, 0, time.UTC),
		LocalOSUserAnchor: "sid:interactive-user",
		BootEpoch:         "boot:1",
		CurrentProcess:    process,
		Principal: Principal{
			LocalOSUserAnchor: "sid:interactive-user",
			ID:                "principal:random-opaque",
			Kind:              PrincipalKindDevelopment,
			AppID:             "app.display-only",
			Lineage: LineageBinding{
				DevelopmentAuthorizationID: "dev-auth:opaque",
				CanonicalProjectFileID:     "project-file:opaque",
			},
			State: PrincipalStateActive,
		},
		Record: Record{
			LocalOSUserAnchor:          "sid:interactive-user",
			ID:                         "record:1",
			PrincipalID:                "principal:random-opaque",
			TrustClass:                 TrustClassLocalDevelopment,
			ProvenanceRevision:         4,
			InstallOrProjectGeneration: 9,
			ExecutionProfileRef:        "profile:opaque",
			HostExecutableDigest:       "sha256:host",
			PayloadRootDigest:          "sha256:payload",
			State:                      RecordStateActive,
		},
		Session: Session{
			ID:                         "session:1",
			State:                      SessionStateActive,
			LocalOSUserAnchor:          "sid:interactive-user",
			PrincipalID:                "principal:random-opaque",
			RecordID:                   "record:1",
			ProvenanceRevision:         4,
			InstallOrProjectGeneration: 9,
			HostExecutableDigest:       "sha256:host",
			PayloadRootDigest:          "sha256:payload",
			AccountID:                  "account:1",
			AccountGeneration:          6,
			BootEpoch:                  "boot:1",
			Process:                    process,
		},
		Account: Account{
			ID:         "account:1",
			Generation: 6,
			State:      AccountStateAuthenticated,
		},
		Grant: &Grant{
			ID:                            "grant:1",
			State:                         GrantStateGranted,
			LocalOSUserAnchor:             "sid:interactive-user",
			AccountID:                     "account:1",
			PrincipalID:                   "principal:random-opaque",
			CapabilityResourceFingerprint: fingerprint,
			Generation:                    2,
			Revision:                      3,
		},
		OwnerPolicy: OwnerPolicyDecision{
			Status:                        OwnerPolicyAllowed,
			Operation:                     operation,
			Selector:                      selector,
			CapabilityResourceFingerprint: fingerprint,
			PolicyRevision:                7,
		},
	}
	return req, snapshot
}

func selectorFor(operation Operation) Selector {
	switch operation {
	case OperationArtifactRead:
		return Selector{ArtifactID: "artifact:1"}
	case OperationConversationOpen:
		return Selector{AgentID: "agent:1"}
	case OperationConversationTurnSend, OperationConversationSnapshot:
		return Selector{AgentID: "agent:1", ConversationAnchorID: "anchor:1"}
	case OperationConversationSubscribe:
		return Selector{AgentID: "agent:1", ConversationAnchorID: "anchor:1"}
	default:
		return Selector{}
	}
}

func matchingPresence(req Request, snapshot Snapshot) Presence {
	return Presence{
		State:                         PresenceStateActive,
		LocalOSUserAnchor:             snapshot.LocalOSUserAnchor,
		AccountID:                     snapshot.Account.ID,
		AccountGeneration:             snapshot.Account.Generation,
		PrincipalID:                   snapshot.Principal.ID,
		RecordID:                      snapshot.Record.ID,
		ProvenanceRevision:            snapshot.Record.ProvenanceRevision,
		InstallOrProjectGeneration:    snapshot.Record.InstallOrProjectGeneration,
		Operation:                     req.Operation,
		CapabilityResourceFingerprint: snapshot.OwnerPolicy.CapabilityResourceFingerprint,
		ResourceImpactDigest:          snapshot.OwnerPolicy.ResourceImpactDigest,
		PolicyRevision:                snapshot.OwnerPolicy.PolicyRevision,
		ExpiresAt:                     snapshot.ResolvedAt.Add(time.Minute),
	}
}

func evaluateThroughCoordinator(t *testing.T, req Request, snapshot Snapshot) Decision {
	t.Helper()
	coordinator := NewCoordinator(SnapshotResolverFunc(func(_ context.Context, got Request) (Snapshot, error) {
		if got != req {
			t.Fatalf("resolver request = %+v, want %+v", got, req)
		}
		return snapshot, nil
	}))
	return coordinator.Evaluate(context.Background(), req)
}

func assertDecision(t *testing.T, decision Decision, outcome Outcome, reason Reason) {
	t.Helper()
	if decision.Outcome != outcome || decision.Reason != reason {
		t.Fatalf("decision = %+v, want outcome=%s reason=%s", decision, outcome, reason)
	}
	if outcome != OutcomeAllowed && decision.Authorization != nil {
		t.Fatalf("non-allowed decision leaked authorization: %+v", decision.Authorization)
	}
}

func assertFields(t *testing.T, typ reflect.Type, expected []string) {
	t.Helper()
	if typ.NumField() != len(expected) {
		t.Fatalf("%s has %d fields, want %d", typ.Name(), typ.NumField(), len(expected))
	}
	for index, field := range expected {
		if typ.Field(index).Name != field {
			t.Fatalf("%s field[%d] = %s, want %s", typ.Name(), index, typ.Field(index).Name, field)
		}
	}
}
