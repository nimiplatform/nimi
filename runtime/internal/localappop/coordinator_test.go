package localappop

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"
)

func TestCoordinatorAllowsBaseEntitlementOperationFamily(t *testing.T) {
	t.Parallel()

	operations := []Operation{
		OperationStorageJSONRead,
		OperationStorageJSONWrite,
		OperationStorageJSONRemove,
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
			if decision.Authorization.PrincipalID == "" || decision.Authorization.AuthorityClass != AuthorityClassBaseEntitlement {
				t.Fatalf("authorization lacks principal/authority class: %+v", decision.Authorization)
			}
		})
	}
}

func TestCoordinatorKeepsReservedUserPermissionOperationsUnavailable(t *testing.T) {
	t.Parallel()

	operations := []Operation{
		OperationArtifactRead,
		OperationConversationOpen,
		OperationConversationTurnSend,
		OperationConversationSubscribe,
		OperationConversationSnapshot,
		OperationVoiceTranscribe,
		OperationVoiceStreamSubscribe,
	}
	for _, operation := range operations {
		operation := operation
		t.Run(string(operation), func(t *testing.T) {
			t.Parallel()
			req, snapshot := allowedFixture(operation)
			decision := evaluateThroughCoordinator(t, req, snapshot)
			assertDecision(t, decision, OutcomeUnavailable, ReasonLocalAppOperationUnavailable)
		})
	}
}

func TestCoordinatorAdmittedUserPermissionDefersToCurrentOwnerSnapshot(t *testing.T) {
	t.Parallel()
	req, snapshot := allowedFixture(OperationConversationOpen)
	coordinator := NewCoordinator(SnapshotResolverFunc(func(_ context.Context, got Request) (Snapshot, error) {
		if got != req {
			t.Fatalf("resolver request = %+v, want %+v", got, req)
		}
		return snapshot, nil
	}), WithUserPermissionAdmission(func(operation Operation) bool { return operation == OperationConversationOpen }))
	decision := coordinator.Evaluate(context.Background(), req)
	assertDecision(t, decision, OutcomeAllowed, ReasonActionExecuted)
	if decision.Authorization == nil || decision.Authorization.AuthorityClass != AuthorityClassUserPermission {
		t.Fatalf("user-permission authorization = %+v", decision.Authorization)
	}
}

func TestVoiceOperationsRemainOutsideAgentsInteractPermissionMapping(t *testing.T) {
	t.Parallel()
	for _, operation := range []Operation{OperationVoiceTranscribe, OperationVoiceStreamSubscribe} {
		if _, ok := AuthorityClassForOperation(operation); ok {
			t.Fatalf("voice operation %q entered the user-permission mapping", operation)
		}
		req, snapshot := allowedFixture(operation)
		decision := evaluateThroughCoordinator(t, req, snapshot)
		assertDecision(t, decision, OutcomeUnavailable, ReasonLocalAppOperationUnavailable)
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
			req, snapshot := allowedFixture(OperationStorageJSONWrite)
			snapshot.Principal.Kind = tc.kind
			snapshot.Principal.Lineage = tc.lineage
			snapshot.Record.TrustClass = tc.trustClass
			decision := evaluateThroughCoordinator(t, req, snapshot)
			assertDecision(t, decision, OutcomeAllowed, ReasonActionExecuted)
		})
	}
}

func TestCoordinatorBaseEntitlementNeedsNoUserPermissionState(t *testing.T) {
	t.Parallel()

	for _, operation := range []Operation{OperationStorageJSONRead, OperationStorageJSONWrite, OperationStorageJSONRemove} {
		operation := operation
		t.Run(string(operation), func(t *testing.T) {
			t.Parallel()
			req, snapshot := allowedFixture(operation)
			decision := evaluateThroughCoordinator(t, req, snapshot)
			assertDecision(t, decision, OutcomeAllowed, ReasonActionExecuted)
			if decision.Authorization == nil || decision.Authorization.AuthorityClass != AuthorityClassBaseEntitlement {
				t.Fatalf("base-entitlement authorization = %+v", decision.Authorization)
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
		{name: "local record dormant", mutate: func(snapshot *Snapshot) { snapshot.Record.State = RecordStateDormant }, reason: ReasonLocalAppProvenanceUnavailable},
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
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			req, snapshot := allowedFixture(OperationStorageJSONWrite)
			tc.mutate(&snapshot)
			decision := evaluateThroughCoordinator(t, req, snapshot)
			assertDecision(t, decision, OutcomeDenied, tc.reason)
		})
	}
}

func TestCoordinatorTreatsDisplayAppIDAsNonAuthorityMetadata(t *testing.T) {
	t.Parallel()

	req, snapshot := allowedFixture(OperationStorageJSONRead)
	snapshot.Principal.AppID = "app.same-display-id"
	decision := evaluateThroughCoordinator(t, req, snapshot)
	assertDecision(t, decision, OutcomeAllowed, ReasonActionExecuted)
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
			req, snapshot := allowedFixture(OperationStorageJSONWrite)
			tc.mutate(&snapshot)
			decision := evaluateThroughCoordinator(t, req, snapshot)
			assertDecision(t, decision, tc.outcome, tc.reason)
		})
	}
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

	missingTurnCorrelation := coordinator.Evaluate(context.Background(), Request{
		NativeConnectionRef: "connection:1",
		Operation:           OperationConversationTurnSend,
		Selector: Selector{
			AgentID:              "agent:1",
			ConversationAnchorID: "anchor:1",
		},
	})
	assertDecision(t, missingTurnCorrelation, OutcomeDenied, ReasonProtocolEnvelopeInvalid)
	if called {
		t.Fatal("send-turn selector without turn correlation reached the resolver")
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
	assertFields(t, reflect.TypeOf(Selector{}), []string{"ArtifactID", "AgentID", "ConversationAnchorID", "TurnID", "VoiceStreamID", "StorageRelativePath"})

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
		OwnerPolicy: OwnerPolicyDecision{
			Status:              OwnerPolicyAllowed,
			Operation:           operation,
			Selector:            selector,
			OwnerSelectorDigest: fingerprint,
			PolicyRevision:      7,
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
	case OperationConversationTurnSend:
		return Selector{AgentID: "agent:1", ConversationAnchorID: "anchor:1", TurnID: "turn:1"}
	case OperationConversationSnapshot:
		return Selector{AgentID: "agent:1", ConversationAnchorID: "anchor:1"}
	case OperationConversationSubscribe:
		return Selector{AgentID: "agent:1", ConversationAnchorID: "anchor:1"}
	case OperationStorageJSONRead, OperationStorageJSONWrite, OperationStorageJSONRemove:
		return Selector{StorageRelativePath: "state/value.json"}
	case OperationVoiceTranscribe:
		return Selector{AgentID: "agent:1"}
	case OperationVoiceStreamSubscribe:
		return Selector{AgentID: "agent:1", ConversationAnchorID: "anchor:1", TurnID: "turn:1", VoiceStreamID: "voice:1"}
	default:
		return Selector{}
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
