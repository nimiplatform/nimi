package account

import (
	"context"
	"encoding/base64"
	"errors"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/apppermission"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

type authorizedLocalAppDecisionContextKey struct{}

type localAppOperationReasonError struct {
	reason runtimev1.ReasonCode
}

func (err localAppOperationReasonError) Error() string {
	return "local-app protected operation denied"
}

func (err localAppOperationReasonError) Unwrap() error {
	return ErrLocalAppOperationNotAdmitted
}

func (err localAppOperationReasonError) LocalAppOperationReasonCode() runtimev1.ReasonCode {
	return err.reason
}

type localAppOperationReasonSource interface {
	LocalAppOperationReasonCode() runtimev1.ReasonCode
}

func localAppOperationDenied(reason runtimev1.ReasonCode) error {
	return localAppOperationReasonError{reason: reason}
}

// LocalAppOperationAuthorizationReason projects only the closed Runtime reason
// carried by an owner-side operation decision. Arbitrary error text and
// transport details never become a public local-app reason.
func LocalAppOperationAuthorizationReason(err error) runtimev1.ReasonCode {
	var source localAppOperationReasonSource
	if errors.As(err, &source) {
		return source.LocalAppOperationReasonCode()
	}
	return runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE
}

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
// principal, record, account and operation-owner selector in the
// provenance-agnostic coordinator. Base entitlements resolve their owner
// constraints directly. Product permissions remain unavailable until a
// complete owner-backed positive slice is admitted. Every call re-resolves its
// facts and no positive decision is cached.
func (s *Service) AuthorizeLocalAppProtectedOperation(ctx context.Context, operation LocalAppOperation, selector localappop.Selector) (LocalAppCallerDecision, error) {
	if s == nil || s.localAppKernel == nil {
		return LocalAppCallerDecision{}, localAppOperationDenied(runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	resourceRef, err := localAppOperationResourceRef(operation, selector)
	if err != nil {
		if errors.Is(err, appstorage.ErrLocalAppJSONPathInvalid) {
			return LocalAppCallerDecision{}, localAppOperationDenied(runtimev1.ReasonCode_APP_STORAGE_PATH_INVALID)
		}
		return LocalAppCallerDecision{}, localAppOperationDenied(runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	authorityClass, admitted := localappop.AuthorityClassForOperation(localappop.Operation(operation))
	if !admitted {
		return LocalAppCallerDecision{}, localAppOperationDenied(runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	var caller LocalAppCallerDecision
	var binding localAppOperationBinding
	switch authorityClass {
	case localappop.AuthorityClassBaseEntitlement:
		caller, binding, err = s.localAppBaseEntitlementCallerBinding(ctx, string(operation), resourceRef)
	case localappop.AuthorityClassUserPermission:
		permission, mapped := apppermission.ForOperation(string(operation))
		if !mapped {
			return LocalAppCallerDecision{}, localAppOperationDenied(runtimev1.ReasonCode_LOCAL_APP_PERMISSION_UNKNOWN)
		}
		if s.permissionAdmitted == nil || !s.permissionAdmitted(permission.ID) || !permission.ManifestAllowed {
			reason := runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE
			if permission.Admission == apppermission.AdmissionReserved {
				reason = runtimev1.ReasonCode_LOCAL_APP_PERMISSION_RESERVED_NOT_ADMITTED
			}
			return LocalAppCallerDecision{}, localAppOperationDenied(reason)
		}
		caller, err = s.AuthorizeLocalAppOperation(ctx, operation)
		if err != nil {
			return LocalAppCallerDecision{}, localAppOperationDenied(localAppAuthorityErrorReason(err))
		}
		resolvedAgent, resolveErr := s.ResolveLocalAppAgentHandle(ctx, selector.AgentID, permission.ID)
		if resolveErr != nil {
			switch {
			case errors.Is(resolveErr, ErrLocalAppAgentScopeRequired):
				return LocalAppCallerDecision{}, localAppOperationDenied(runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REQUIRED)
			case errors.Is(resolveErr, ErrLocalAppAgentScopeRevoked):
				return LocalAppCallerDecision{}, localAppOperationDenied(runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REVOKED)
			default:
				return LocalAppCallerDecision{}, localAppOperationDenied(runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED)
			}
		}
		selector.AgentID = resolvedAgent.LocalAgentID
		resourceRef, err = localAppOperationResourceRef(operation, selector)
		if err != nil {
			return LocalAppCallerDecision{}, localAppOperationDenied(runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
		}
		grantKey := localappkernel.PermissionGrantKey{
			LocalOSUserAnchor: caller.LocalOSUserAnchor, AccountID: caller.AccountID, LocalAppPrincipalID: caller.LocalAppPrincipalID,
			PermissionID: permission.ID, OwnerSelectorDigest: resolvedAgent.OwnerSelectorDigest,
		}
		grant, grantErr := s.localAppKernel.PermissionGrants().Get(ctx, grantKey)
		if grantErr != nil {
			return LocalAppCallerDecision{}, localAppOperationDenied(runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REQUIRED)
		}
		posture := apppermission.EvaluatePosture(s.now().UTC(), true, true, grantKey, &grant)
		if !posture.Usable {
			return LocalAppCallerDecision{}, localAppOperationDenied(localAppPermissionPostureReason(posture))
		}
		if permission.ID == "agents.configure" {
			interactKey := grantKey
			interactKey.PermissionID = localAppAgentPermissionID
			interactGrant, interactErr := s.localAppKernel.PermissionGrants().Get(ctx, interactKey)
			if interactErr != nil {
				return LocalAppCallerDecision{}, localAppOperationDenied(runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REQUIRED)
			}
			interactPosture := apppermission.EvaluatePosture(s.now().UTC(), true, true, interactKey, &interactGrant)
			if !interactPosture.Usable {
				return LocalAppCallerDecision{}, localAppOperationDenied(localAppPermissionPostureReason(interactPosture))
			}
		}
		binding = localAppOperationBinding{operationID: string(operation), resourceRef: resourceRef, capability: permission.ID, fingerprint: resolvedAgent.OwnerSelectorDigest}
		caller.LocalAgentID = resolvedAgent.LocalAgentID
	default:
		return LocalAppCallerDecision{}, localAppOperationDenied(runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	if err != nil {
		return LocalAppCallerDecision{}, localAppOperationDenied(localAppAuthorityErrorReason(err))
	}
	principal, err := s.localAppKernel.Principals().Get(ctx, caller.LocalAppPrincipalID)
	if err != nil {
		return LocalAppCallerDecision{}, localAppOperationDenied(runtimev1.ReasonCode_LOCAL_APP_PRINCIPAL_REQUIRED)
	}
	record, err := s.localAppKernel.Records().GetByPrincipalID(ctx, caller.LocalAppPrincipalID)
	if err != nil {
		return LocalAppCallerDecision{}, localAppOperationDenied(runtimev1.ReasonCode_LOCAL_APP_RECORD_NOT_FOUND)
	}
	if principal.State != localappkernel.PrincipalStateActive || principal.AppID != caller.AppID ||
		record.LocalAppRecordID != caller.LocalAppRecordID ||
		record.ProvenanceRevision != caller.ProvenanceRevision ||
		record.InstallOrProjectGeneration != caller.ProjectGeneration ||
		record.PayloadRootDigest != caller.PayloadDigest ||
		record.TrustClass != localappkernel.TrustClassLocalDevelopment ||
		record.LifecycleState != localappkernel.LifecycleStateActive {
		return LocalAppCallerDecision{}, localAppOperationDenied(runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
	}
	connection, ok := protectedlocal.LocalAppConnectionFromContext(ctx)
	if !ok || connection == nil || !connection.Live() {
		return LocalAppCallerDecision{}, localAppOperationDenied(runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH)
	}
	if directPeer, direct := connection.DirectPeer(); direct {
		if caller.DirectPeer != directPeer || caller.SessionID != connection.LaunchID() ||
			caller.RuntimeBootEpoch != (protectedlocal.Identifier{}) || caller.Process != (protectedlocal.ProcessTuple{}) {
			return LocalAppCallerDecision{}, localAppOperationDenied(runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH)
		}
	} else {
		if caller.DirectPeer != (protectedlocal.DirectLocalAppPeer{}) || connection.Process() != caller.Process {
			return LocalAppCallerDecision{}, localAppOperationDenied(runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH)
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
			OwnerPolicy: localappop.OwnerPolicyDecision{
				Status: localappop.OwnerPolicyAllowed, Operation: localappop.Operation(operation), Selector: selector,
				OwnerSelectorDigest: binding.fingerprint, PolicyRevision: localAppOwnerPolicyRevision,
				ResourceImpactDigest: binding.fingerprint,
			},
		}
		coordinatorOptions := make([]localappop.CoordinatorOption, 0, 1)
		if authorityClass == localappop.AuthorityClassUserPermission {
			coordinatorOptions = append(coordinatorOptions, localappop.WithUserPermissionAdmission(func(candidate localappop.Operation) bool {
				return candidate == localappop.Operation(operation)
			}))
		}
		coordinator := localappop.NewCoordinator(localappop.SnapshotResolverFunc(func(context.Context, localappop.Request) (localappop.Snapshot, error) {
			return snapshot, nil
		}), coordinatorOptions...)
		result := coordinator.Evaluate(ctx, localappop.Request{NativeConnectionRef: connectionRef, Operation: localappop.Operation(operation), Selector: selector})
		if result.Outcome != localappop.OutcomeAllowed || result.Authorization == nil || result.Authorization.AuthorityClass != authorityClass {
			return LocalAppCallerDecision{}, localAppOperationDenied(localAppOperationRuntimeReason(result.Reason))
		}
	}
	caller.Operation = operation
	caller.AuthorityClass = authorityClass
	caller.OperationCapability = binding.capability
	if authorityClass == localappop.AuthorityClassUserPermission {
		permission, _ := apppermission.ForOperation(string(operation))
		grantKey := localappkernel.PermissionGrantKey{
			LocalOSUserAnchor: caller.LocalOSUserAnchor, AccountID: caller.AccountID, LocalAppPrincipalID: caller.LocalAppPrincipalID,
			PermissionID: permission.ID, OwnerSelectorDigest: binding.fingerprint,
		}
		grant, grantErr := s.localAppKernel.PermissionGrants().Get(ctx, grantKey)
		if grantErr != nil {
			return LocalAppCallerDecision{}, localAppOperationDenied(runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED)
		}
		if permission.ID == "agents.configure" {
			interactKey := grantKey
			interactKey.PermissionID = localAppAgentPermissionID
			interactGrant, interactErr := s.localAppKernel.PermissionGrants().Get(ctx, interactKey)
			if interactErr != nil {
				return LocalAppCallerDecision{}, localAppOperationDenied(runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REQUIRED)
			}
			interactPosture := apppermission.EvaluatePosture(s.now().UTC(), true, true, interactKey, &interactGrant)
			if !interactPosture.Usable {
				return LocalAppCallerDecision{}, localAppOperationDenied(localAppPermissionPostureReason(interactPosture))
			}
		}
		auditBinding := apppermission.AuditBinding{
			OwnerSubjectID: caller.AccountID, LocalAppPrincipalID: caller.LocalAppPrincipalID, DisplayAppID: caller.AppID,
			PermissionID: permission.ID, SelectorDigest: binding.fingerprint, OldPosture: apppermission.PostureGranted,
			NewPosture: apppermission.PostureGranted, Trigger: "operation_use", Timestamp: s.now().UTC(), OwnerRevision: grant.Revision,
		}
		if auditErr := apppermission.NewAuditEmitter(s.auditStore).EmitOperationUse(ctx, apppermission.OperationUseAudit{
			Binding: auditBinding, ProtectedOperation: string(operation), ProtectedResourceID: resourceRef,
		}); auditErr != nil {
			return LocalAppCallerDecision{}, localAppOperationDenied(runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
		}
	}
	return caller, nil
}

func localAppPermissionPostureReason(posture apppermission.PostureEvaluation) runtimev1.ReasonCode {
	if posture.Reason == apppermission.PostureReasonGrantRevoked {
		return runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REVOKED
	}
	if posture.Posture == apppermission.PosturePending || posture.Posture == apppermission.PosturePrompt {
		return runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REQUIRED
	}
	return runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED
}

func localAppOperationRuntimeReason(reason localappop.Reason) runtimev1.ReasonCode {
	switch reason {
	case localappop.ReasonActionExecuted:
		return runtimev1.ReasonCode_ACTION_EXECUTED
	case localappop.ReasonLocalAppPrincipalRequired:
		return runtimev1.ReasonCode_LOCAL_APP_PRINCIPAL_REQUIRED
	case localappop.ReasonLocalAppRecordNotFound:
		return runtimev1.ReasonCode_LOCAL_APP_RECORD_NOT_FOUND
	case localappop.ReasonLocalAppRecordTombstoned:
		return runtimev1.ReasonCode_LOCAL_APP_RECORD_TOMBSTONED
	case localappop.ReasonLocalAppProvenanceUnavailable:
		return runtimev1.ReasonCode_LOCAL_APP_PROVENANCE_UNAVAILABLE
	case localappop.ReasonLocalAppProcessMismatch:
		return runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH
	case localappop.ReasonLocalAppSessionRevoked:
		return runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED
	case localappop.ReasonLocalAppPermissionRequired:
		return runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REQUIRED
	case localappop.ReasonLocalAppPermissionDenied:
		return runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED
	case localappop.ReasonLocalAppPermissionRevoked:
		return runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REVOKED
	case localappop.ReasonLocalAppAccountChanged:
		return runtimev1.ReasonCode_LOCAL_APP_ACCOUNT_CHANGED
	case localappop.ReasonLocalAppPresenceRequired:
		return runtimev1.ReasonCode_LOCAL_APP_PRESENCE_REQUIRED
	case localappop.ReasonLocalAppPresenceExpired:
		return runtimev1.ReasonCode_LOCAL_APP_PRESENCE_EXPIRED
	case localappop.ReasonLocalAppOperationUnavailable:
		return runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE
	default:
		return runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE
	}
}

func localAppOperationResourceRef(operation LocalAppOperation, selector localappop.Selector) (string, error) {
	require := func(value string) bool { return value != "" && value == strings.TrimSpace(value) }
	switch operation {
	case LocalAppOperationReadArtifactBytes:
		if !require(selector.ArtifactID) || selector.AgentID != "" || selector.ConversationAnchorID != "" || selector.TurnID != "" || selector.VoiceStreamID != "" || selector.StorageRelativePath != "" {
			return "", ErrLocalAppOperationNotAdmitted
		}
		return "artifact:" + selector.ArtifactID, nil
	case LocalAppOperationOpenConversation,
		LocalAppOperationConfigurationSnapshot, LocalAppOperationUpdateConfiguration,
		LocalAppOperationReadinessSnapshot, LocalAppOperationAutonomySnapshot,
		LocalAppOperationUpdateAutonomy, LocalAppOperationPresentationSnapshot,
		LocalAppOperationCommitPresentation:
		if !require(selector.AgentID) || selector.ArtifactID != "" || selector.ConversationAnchorID != "" || selector.TurnID != "" || selector.VoiceStreamID != "" || selector.StorageRelativePath != "" {
			return "", ErrLocalAppOperationNotAdmitted
		}
		return "agent:" + selector.AgentID, nil
	case LocalAppOperationSendConversationTurn:
		if !require(selector.AgentID) || !require(selector.ConversationAnchorID) || !require(selector.TurnID) || selector.ArtifactID != "" || selector.VoiceStreamID != "" || selector.StorageRelativePath != "" {
			return "", ErrLocalAppOperationNotAdmitted
		}
		return "agent:" + selector.AgentID + "/conversation:" + selector.ConversationAnchorID, nil
	case LocalAppOperationInterruptConversation, LocalAppOperationSubscribeConversation,
		LocalAppOperationConversationSnapshot:
		if !require(selector.AgentID) || !require(selector.ConversationAnchorID) || selector.ArtifactID != "" || selector.TurnID != "" || selector.VoiceStreamID != "" || selector.StorageRelativePath != "" {
			return "", ErrLocalAppOperationNotAdmitted
		}
		return "agent:" + selector.AgentID + "/conversation:" + selector.ConversationAnchorID, nil
	case LocalAppOperationStorageJSONRead, LocalAppOperationStorageJSONWrite, LocalAppOperationStorageJSONRemove:
		if selector.ArtifactID != "" || selector.AgentID != "" || selector.ConversationAnchorID != "" || selector.TurnID != "" || selector.VoiceStreamID != "" {
			return "", ErrLocalAppOperationNotAdmitted
		}
		return appstorage.LocalAppJSONResourceRef(selector.StorageRelativePath)
	case LocalAppOperationVoiceTranscribe:
		if !require(selector.AgentID) || selector.ArtifactID != "" || selector.ConversationAnchorID != "" || selector.TurnID != "" || selector.VoiceStreamID != "" || selector.StorageRelativePath != "" {
			return "", ErrLocalAppOperationNotAdmitted
		}
		return "agent:" + selector.AgentID + "/voice-transcription", nil
	case LocalAppOperationVoiceStreamSubscribe:
		if !require(selector.AgentID) || !require(selector.ConversationAnchorID) || !require(selector.TurnID) || !require(selector.VoiceStreamID) || selector.ArtifactID != "" || selector.StorageRelativePath != "" {
			return "", ErrLocalAppOperationNotAdmitted
		}
		return "agent:" + selector.AgentID + "/conversation:" + selector.ConversationAnchorID + "/turn:" + selector.TurnID + "/voice-stream:" + selector.VoiceStreamID, nil
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
