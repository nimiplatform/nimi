package account

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

type authorizedLocalAppDecisionContextKey struct{}

// ContextWithAuthorizedLocalAppDecision is used only after the Runtime-owned
// coordinator has admitted one exact protected-local operation. It is an
// in-process owner handoff, not a portable credential or request assertion.
func ContextWithAuthorizedLocalAppDecision(ctx context.Context, decision LocalAppCallerDecision) context.Context {
	return context.WithValue(ctx, authorizedLocalAppDecisionContextKey{}, decision)
}

func AuthorizedLocalAppDecisionFromContext(ctx context.Context) (LocalAppCallerDecision, bool) {
	if ctx == nil {
		return LocalAppCallerDecision{}, false
	}
	decision, ok := ctx.Value(authorizedLocalAppDecisionContextKey{}).(LocalAppCallerDecision)
	return decision, ok && decision.LocalAppPrincipalID != "" && decision.LocalAppRecordID != ""
}

// AuthorizeLocalAppProtectedOperation joins the live transport/session,
// principal, record, account, exact grant and operation-owner selector in the
// provenance-agnostic coordinator. It resolves every fact for every call and
// retains no positive decision cache.
func (s *Service) AuthorizeLocalAppProtectedOperation(ctx context.Context, operation LocalAppOperation, selector localappop.Selector) (LocalAppCallerDecision, error) {
	if s == nil || s.localAppKernel == nil {
		return LocalAppCallerDecision{}, ErrLocalAppOperationNotAdmitted
	}
	resourceRef, err := localAppOperationResourceRef(operation, selector)
	if err != nil {
		return LocalAppCallerDecision{}, err
	}
	caller, binding, err := s.localAppGrantCallerBinding(ctx, string(operation), resourceRef)
	if err != nil {
		return LocalAppCallerDecision{}, err
	}
	s.localAppGrantMu.Lock()
	grant, err := s.getCurrentLocalAppGrantLocked(ctx, caller, binding)
	s.localAppGrantMu.Unlock()
	if err != nil || grant.State != localappkernel.GrantStateGranted {
		return LocalAppCallerDecision{}, ErrLocalAppOperationNotAdmitted
	}
	principal, err := s.localAppKernel.Principals().Get(ctx, caller.LocalAppPrincipalID)
	if err != nil {
		return LocalAppCallerDecision{}, err
	}
	record, err := s.localAppKernel.Records().GetByPrincipalID(ctx, caller.LocalAppPrincipalID)
	if err != nil {
		return LocalAppCallerDecision{}, err
	}
	connection, ok := protectedlocal.LocalAppConnectionFromContext(ctx)
	if !ok || connection == nil || !connection.Live() || connection.Process() != caller.Process {
		return LocalAppCallerDecision{}, ErrLocalAppCallerUnauthorized
	}
	connectionRef := localAppPrivateIdentifierRef("connection", caller.SessionID)
	bootRef := localAppPrivateIdentifierRef("boot", caller.RuntimeBootEpoch)
	sessionRef := localAppPrivateIdentifierRef("session", caller.SessionID)
	process := localappop.ProcessBinding{
		NativeConnectionRef:  connectionRef,
		ProcessID:            caller.Process.PID,
		ProcessStartRef:      caller.Process.CreationMarker,
		ExecutableObjectRef:  caller.Process.CanonicalExecutableIdentity,
		HostExecutableDigest: record.HostExecutableDigest,
	}
	snapshot := localappop.Snapshot{
		ResolvedAt: s.now().UTC(), LocalOSUserAnchor: s.localAppKernel.LocalOSUserAnchor(), BootEpoch: bootRef,
		CurrentProcess: process,
		Principal: localappop.Principal{
			LocalOSUserAnchor: principal.LocalOSUserAnchor, ID: principal.LocalAppPrincipalID,
			Kind: localAppOperationPrincipalKind(principal.Kind), AppID: principal.AppID,
			Lineage: localappop.LineageBinding{ImmutableLineageID: principal.ImmutableLineageID, DevelopmentAuthorizationID: principal.DevelopmentAuthorizationID, CanonicalProjectFileID: principal.CanonicalProjectFileID},
			State:   localAppOperationPrincipalState(principal.State),
		},
		Record: localappop.Record{
			LocalOSUserAnchor: record.LocalOSUserAnchor, ID: record.LocalAppRecordID, PrincipalID: record.LocalAppPrincipalID,
			TrustClass: localAppOperationTrustClass(record.TrustClass), ProvenanceRevision: record.ProvenanceRevision,
			InstallOrProjectGeneration: record.InstallOrProjectGeneration, ExecutionProfileRef: record.ExecutionProfileRef,
			HostExecutableDigest: record.HostExecutableDigest, PayloadRootDigest: record.PayloadRootDigest, State: localAppOperationRecordState(record.LifecycleState),
		},
		Session: localappop.Session{
			ID: sessionRef, State: localappop.SessionStateActive, LocalOSUserAnchor: record.LocalOSUserAnchor,
			PrincipalID: record.LocalAppPrincipalID, RecordID: record.LocalAppRecordID, ProvenanceRevision: caller.ProvenanceRevision,
			InstallOrProjectGeneration: caller.ProjectGeneration, HostExecutableDigest: record.HostExecutableDigest,
			PayloadRootDigest: caller.PayloadDigest, AccountID: caller.AccountID, AccountGeneration: caller.AccountGeneration,
			BootEpoch: bootRef, Process: process,
		},
		Account: localappop.Account{ID: caller.AccountID, Generation: caller.AccountGeneration, State: localappop.AccountStateAuthenticated},
		Grant: &localappop.Grant{
			ID: grant.GrantID, State: localAppOperationGrantState(grant.State), LocalOSUserAnchor: grant.LocalOSUserAnchor,
			AccountID: grant.AccountID, PrincipalID: grant.LocalAppPrincipalID, CapabilityResourceFingerprint: grant.CapabilityResourceFingerprint,
			Generation: grant.GrantGeneration, Revision: grant.GrantRevision,
		},
		OwnerPolicy: localappop.OwnerPolicyDecision{
			Status: localappop.OwnerPolicyAllowed, Operation: localappop.Operation(operation), Selector: selector,
			CapabilityResourceFingerprint: binding.fingerprint, PolicyRevision: localAppGrantPolicyRevision,
			ResourceImpactDigest: binding.fingerprint,
		},
	}
	coordinator := localappop.NewCoordinator(localappop.SnapshotResolverFunc(func(context.Context, localappop.Request) (localappop.Snapshot, error) {
		return snapshot, nil
	}))
	result := coordinator.Evaluate(ctx, localappop.Request{NativeConnectionRef: connectionRef, Operation: localappop.Operation(operation), Selector: selector})
	if result.Outcome != localappop.OutcomeAllowed || result.Authorization == nil {
		return LocalAppCallerDecision{}, fmt.Errorf("%w: %s", ErrLocalAppOperationNotAdmitted, result.Reason)
	}
	caller.Operation = operation
	caller.PermissionScope = binding.capability
	return caller, nil
}

func localAppOperationResourceRef(operation LocalAppOperation, selector localappop.Selector) (string, error) {
	require := func(value string) bool { return value != "" && value == strings.TrimSpace(value) }
	switch operation {
	case LocalAppOperationReadArtifactBytes:
		if !require(selector.ArtifactID) || selector.AgentID != "" || selector.ConversationAnchorID != "" || selector.TurnID != "" {
			return "", ErrLocalAppOperationNotAdmitted
		}
		return "artifact:" + selector.ArtifactID, nil
	case LocalAppOperationOpenConversation:
		if !require(selector.AgentID) || selector.ArtifactID != "" || selector.ConversationAnchorID != "" || selector.TurnID != "" {
			return "", ErrLocalAppOperationNotAdmitted
		}
		return "agent:" + selector.AgentID, nil
	case LocalAppOperationSendConversationTurn:
		if !require(selector.AgentID) || !require(selector.ConversationAnchorID) || !require(selector.TurnID) || selector.ArtifactID != "" {
			return "", ErrLocalAppOperationNotAdmitted
		}
		return "agent:" + selector.AgentID + "/conversation:" + selector.ConversationAnchorID, nil
	case LocalAppOperationSubscribeConversation, LocalAppOperationConversationSnapshot:
		if !require(selector.AgentID) || !require(selector.ConversationAnchorID) || selector.ArtifactID != "" || selector.TurnID != "" {
			return "", ErrLocalAppOperationNotAdmitted
		}
		return "agent:" + selector.AgentID + "/conversation:" + selector.ConversationAnchorID, nil
	default:
		return "", ErrLocalAppOperationNotAdmitted
	}
}

func localAppPrivateIdentifierRef(kind string, value protectedlocal.Identifier) string {
	return "la_" + kind + "_v1_" + base64.RawURLEncoding.EncodeToString(value[:])
}

func localAppOperationPrincipalKind(value localappkernel.PrincipalKind) localappop.PrincipalKind {
	return localappop.PrincipalKind(value)
}
func localAppOperationPrincipalState(value localappkernel.PrincipalState) localappop.PrincipalState {
	return localappop.PrincipalState(value)
}
func localAppOperationTrustClass(value localappkernel.TrustClass) localappop.TrustClass {
	return localappop.TrustClass(value)
}
func localAppOperationRecordState(value localappkernel.LifecycleState) localappop.RecordState {
	return localappop.RecordState(value)
}
func localAppOperationGrantState(value localappkernel.GrantState) localappop.GrantState {
	return localappop.GrantState(value)
}
