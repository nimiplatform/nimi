package account

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	localAppGrantChallengeTTL           = 5 * time.Minute
	localAppGrantPolicyRevision  uint64 = 1
	localAppGrantIdentifierBytes        = 32
)

// LocalAppGrantChallengeBinding contains only Runtime-derived facts. The
// injected protected-control owner binds the local-app request to the exact
// Desktop control session that is allowed to display and decide it.
type LocalAppGrantChallengeBinding struct {
	RequestID            []byte
	PresenceChallengeID  []byte
	LocalOSUserAnchor    string
	AccountID            string
	AccountGeneration    uint64
	LocalAppPrincipalID  string
	LocalAppRecordID     string
	ProvenanceRevision   uint64
	ProjectGeneration    uint64
	SessionID            protectedlocal.Identifier
	OperationID          string
	ResourceImpactDigest string
	PolicyRevision       uint64
	IssuedAt             time.Time
	ExpiresAt            time.Time
}

// LocalAppGrantControlAuthority is a narrow integration boundary for the
// protected Desktop supervisor. It must derive its opaque control-session ref
// from verified native connection state, never request fields or metadata.
type LocalAppGrantControlAuthority interface {
	BindLocalAppGrantChallenge(context.Context, LocalAppGrantChallengeBinding) (controlSessionRef string, err error)
	AuthorizeLocalAppGrantControl(context.Context) (controlSessionRef string, err error)
}

type LocalAppGrantChallengeInbox interface {
	PendingLocalAppGrantChallenge(context.Context) (LocalAppGrantChallengeBinding, bool, error)
	CompleteLocalAppGrantChallenge(requestID []byte)
}

type localAppGrantPendingRequest struct {
	requestID           []byte
	presenceChallengeID []byte
	controlSessionRef   string
	accountID           string
	appID               string
	accountGeneration   uint64
	principalID         string
	recordID            string
	provenanceRevision  uint64
	projectGeneration   uint64
	sessionID           protectedlocal.Identifier
	operationID         string
	resourceRef         string
	capability          string
	fingerprint         string
	grantID             string
	grantGeneration     uint64
	grantRevision       uint64
	presencePurpose     string
	expiresAt           time.Time
}

type localAppGrantOperationBinding struct {
	operationID string
	resourceRef string
	capability  string
	fingerprint string
}

func (s *Service) GetLocalAppGrantStatus(ctx context.Context, req *runtimev1.GetLocalAppGrantStatusRequest) (*runtimev1.GetLocalAppGrantStatusResponse, error) {
	if s.hasProtectedLocalAppGrantControl(ctx) && strings.TrimSpace(req.GetOperationId()) == "" && strings.TrimSpace(req.GetResourceRef()) == "" {
		return s.getPendingDesktopLocalAppGrant(ctx)
	}
	decision, binding, err := s.localAppGrantCallerBinding(ctx, req.GetOperationId(), req.GetResourceRef())
	if err != nil {
		return &runtimev1.GetLocalAppGrantStatusResponse{Projection: localAppGrantDeniedProjection(req.GetOperationId(), req.GetResourceRef(), localAppGrantErrorReason(err))}, nil
	}
	s.localAppGrantMu.Lock()
	defer s.localAppGrantMu.Unlock()
	grant, err := s.getCurrentLocalAppGrantLocked(ctx, decision, binding)
	if errors.Is(err, localappkernel.ErrNotFound) {
		return &runtimev1.GetLocalAppGrantStatusResponse{Projection: localAppZeroGrantProjection(binding)}, nil
	}
	if err != nil {
		return &runtimev1.GetLocalAppGrantStatusResponse{Projection: localAppGrantDeniedProjection(binding.operationID, binding.resourceRef, localAppGrantErrorReason(err))}, nil
	}
	return &runtimev1.GetLocalAppGrantStatusResponse{Projection: s.localAppGrantProjectionLocked(grant, binding)}, nil
}

func (s *Service) RequestLocalAppGrant(ctx context.Context, req *runtimev1.RequestLocalAppGrantRequest) (*runtimev1.RequestLocalAppGrantResponse, error) {
	purpose := req.GetPurpose()
	if purpose == "" || purpose != strings.TrimSpace(purpose) {
		return &runtimev1.RequestLocalAppGrantResponse{Projection: localAppGrantDeniedProjection(req.GetOperationId(), req.GetResourceRef(), runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)}, nil
	}
	decision, binding, err := s.localAppGrantCallerBinding(ctx, req.GetOperationId(), req.GetResourceRef())
	if err != nil {
		return &runtimev1.RequestLocalAppGrantResponse{Projection: localAppGrantDeniedProjection(req.GetOperationId(), req.GetResourceRef(), localAppGrantErrorReason(err))}, nil
	}
	if s.localAppGrantControl == nil {
		return &runtimev1.RequestLocalAppGrantResponse{Projection: localAppGrantDeniedProjection(binding.operationID, binding.resourceRef, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)}, nil
	}
	if err := s.requireLocalAppGrantAudit(); err != nil {
		return &runtimev1.RequestLocalAppGrantResponse{Projection: localAppGrantDeniedProjection(binding.operationID, binding.resourceRef, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)}, nil
	}

	s.localAppGrantMu.Lock()
	defer s.localAppGrantMu.Unlock()
	current, currentErr := s.getCurrentLocalAppGrantLocked(ctx, decision, binding)
	if currentErr == nil {
		switch current.State {
		case localappkernel.GrantStateGranted:
			return &runtimev1.RequestLocalAppGrantResponse{Projection: s.localAppGrantProjectionLocked(current, binding)}, nil
		case localappkernel.GrantStatePending:
			return &runtimev1.RequestLocalAppGrantResponse{Projection: s.localAppGrantProjectionLocked(current, binding)}, nil
		}
	} else if !errors.Is(currentErr, localappkernel.ErrNotFound) {
		return &runtimev1.RequestLocalAppGrantResponse{Projection: localAppGrantDeniedProjection(binding.operationID, binding.resourceRef, localAppGrantErrorReason(currentErr))}, nil
	}

	requestID, err := s.allocateLocalAppGrantRequestIDLocked()
	if err != nil {
		return &runtimev1.RequestLocalAppGrantResponse{Projection: localAppGrantDeniedProjection(binding.operationID, binding.resourceRef, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)}, nil
	}
	challengeID, err := s.readLocalAppGrantIdentifier()
	if err != nil {
		return &runtimev1.RequestLocalAppGrantResponse{Projection: localAppGrantDeniedProjection(binding.operationID, binding.resourceRef, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)}, nil
	}
	generation, revision := uint64(1), uint64(1)
	supersedes := ""
	if currentErr == nil {
		generation = current.GrantGeneration + 1
		revision = current.GrantRevision + 1
		supersedes = current.GrantID
	}
	pendingGrant, err := s.localAppKernel.Grants().CreatePending(ctx, localappkernel.CreatePendingGrantInput{
		AccountID: decision.AccountID, LocalAppPrincipalID: decision.LocalAppPrincipalID,
		CapabilityScope: []string{binding.capability}, ResourceScope: []string{binding.resourceRef},
		CapabilityResourceFingerprint: binding.fingerprint, GrantGeneration: generation, GrantRevision: revision,
		SupersedesGrantID:   supersedes,
		PresenceEvidenceRef: "presence-challenge:v1:" + base64.RawURLEncoding.EncodeToString(challengeID),
	})
	if err != nil {
		return &runtimev1.RequestLocalAppGrantResponse{Projection: localAppGrantDeniedProjection(binding.operationID, binding.resourceRef, localAppGrantErrorReason(err))}, nil
	}
	oldState := localAppGrantNoGrantState
	if currentErr == nil {
		oldState = string(current.State)
	}
	s.appendLocalAppGrantTransitionAudit(pendingGrant, decision.AppID, oldState, binding.operationID, "local_app_request")
	now := s.now().UTC()
	expiresAt := now.Add(localAppGrantChallengeTTL)
	controlSessionRef, bindErr := s.localAppGrantControl.BindLocalAppGrantChallenge(ctx, LocalAppGrantChallengeBinding{
		RequestID: append([]byte(nil), requestID...), PresenceChallengeID: append([]byte(nil), challengeID...),
		LocalOSUserAnchor: s.localAppKernel.LocalOSUserAnchor(), AccountID: decision.AccountID, AccountGeneration: decision.AccountGeneration,
		LocalAppPrincipalID: decision.LocalAppPrincipalID, LocalAppRecordID: decision.LocalAppRecordID,
		ProvenanceRevision: decision.ProvenanceRevision, ProjectGeneration: decision.ProjectGeneration,
		SessionID: decision.SessionID, OperationID: binding.operationID, ResourceImpactDigest: binding.fingerprint,
		PolicyRevision: localAppGrantPolicyRevision, IssuedAt: now, ExpiresAt: expiresAt,
	})
	if bindErr != nil || controlSessionRef == "" || controlSessionRef != strings.TrimSpace(controlSessionRef) {
		_, _ = s.transitionLocalAppGrant(ctx, pendingGrant, localappkernel.GrantStateDenied, "", decision.AppID, binding.operationID, "protected_control_unavailable")
		return &runtimev1.RequestLocalAppGrantResponse{Projection: localAppGrantDeniedProjection(binding.operationID, binding.resourceRef, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)}, nil
	}
	pending := localAppGrantPendingRequest{
		requestID: requestID, presenceChallengeID: challengeID, controlSessionRef: controlSessionRef,
		accountID: decision.AccountID, appID: decision.AppID, accountGeneration: decision.AccountGeneration, principalID: decision.LocalAppPrincipalID,
		recordID: decision.LocalAppRecordID, provenanceRevision: decision.ProvenanceRevision, projectGeneration: decision.ProjectGeneration,
		sessionID: decision.SessionID, operationID: binding.operationID, resourceRef: binding.resourceRef, capability: binding.capability,
		fingerprint: binding.fingerprint, grantID: pendingGrant.GrantID, grantGeneration: pendingGrant.GrantGeneration, grantRevision: pendingGrant.GrantRevision,
		presencePurpose: "local_app_grant/" + binding.operationID + "/" + binding.fingerprint,
		expiresAt:       expiresAt,
	}
	s.localAppGrantRequests[base64.RawURLEncoding.EncodeToString(requestID)] = pending
	return &runtimev1.RequestLocalAppGrantResponse{Projection: localAppGrantProjectionFromPending(pending, pendingGrant)}, nil
}

func (s *Service) DecideLocalAppGrant(ctx context.Context, req *runtimev1.DecideLocalAppGrantRequest) (*runtimev1.DecideLocalAppGrantResponse, error) {
	if !s.hasProtectedLocalAppGrantControl(ctx) || s.localAppGrantControl == nil {
		return &runtimev1.DecideLocalAppGrantResponse{Projection: localAppGrantDeniedProjection("", "", runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)}, nil
	}
	requestID := req.GetRequestId()
	challengeID := req.GetPresenceChallengeId()
	if len(requestID) != localAppGrantIdentifierBytes || len(challengeID) != localAppGrantIdentifierBytes {
		return &runtimev1.DecideLocalAppGrantResponse{Projection: localAppGrantDeniedProjection("", "", runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)}, nil
	}

	s.localAppGrantMu.Lock()
	defer s.localAppGrantMu.Unlock()
	key := base64.RawURLEncoding.EncodeToString(requestID)
	pending, ok := s.localAppGrantRequests[key]
	if !ok {
		return &runtimev1.DecideLocalAppGrantResponse{Projection: localAppGrantDeniedProjection("", "", runtimev1.ReasonCode_LOCAL_APP_PRESENCE_EXPIRED)}, nil
	}
	if !bytes.Equal(pending.requestID, requestID) || !bytes.Equal(pending.presenceChallengeID, challengeID) {
		return &runtimev1.DecideLocalAppGrantResponse{Projection: localAppGrantProjectionFromPending(pending, localappkernel.Grant{GrantID: pending.grantID, GrantRevision: pending.grantRevision, GrantGeneration: pending.grantGeneration, State: localappkernel.GrantStatePending})}, nil
	}
	if !s.now().UTC().Before(pending.expiresAt) {
		current := localappkernel.Grant{
			AccountID: pending.accountID, LocalAppPrincipalID: pending.principalID,
			CapabilityResourceFingerprint: pending.fingerprint, GrantID: pending.grantID,
			CapabilityScope: []string{pending.capability}, ResourceScope: []string{pending.resourceRef},
			GrantGeneration: pending.grantGeneration, GrantRevision: pending.grantRevision,
			State: localappkernel.GrantStatePending,
		}
		grant, err := s.transitionLocalAppGrant(ctx, current, localappkernel.GrantStateExpired, "", pending.appID, pending.operationID, "runtime_expiry")
		delete(s.localAppGrantRequests, key)
		s.completeLocalAppGrantChallenge(pending.requestID)
		if err != nil {
			return &runtimev1.DecideLocalAppGrantResponse{Projection: localAppGrantDeniedProjection(pending.operationID, pending.resourceRef, runtimev1.ReasonCode_LOCAL_APP_PRESENCE_EXPIRED)}, nil
		}
		return &runtimev1.DecideLocalAppGrantResponse{Projection: localAppGrantProjectionFor(grant, pending.operationID, pending.resourceRef, nil, pending.expiresAt)}, nil
	}
	projection, generation, authenticated := s.AuthenticatedRuntimeSecurityContext(ctx)
	if !authenticated || projection == nil || projection.GetAccountId() != pending.accountID || generation != pending.accountGeneration {
		return &runtimev1.DecideLocalAppGrantResponse{Projection: localAppGrantDeniedProjection(pending.operationID, pending.resourceRef, runtimev1.ReasonCode_LOCAL_APP_ACCOUNT_CHANGED)}, nil
	}
	controlRef, err := s.localAppGrantControl.AuthorizeLocalAppGrantControl(ctx)
	if err != nil || controlRef != pending.controlSessionRef {
		return &runtimev1.DecideLocalAppGrantResponse{Projection: localAppGrantDeniedProjection(pending.operationID, pending.resourceRef, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)}, nil
	}
	target := localappkernel.GrantStateDenied
	presenceEvidenceRef := ""
	if req.GetApproved() {
		target = localappkernel.GrantStateGranted
		presenceContext, presenceContextErr := WithPresenceBrowserLauncherMetadata(ctx)
		if presenceContextErr != nil {
			return &runtimev1.DecideLocalAppGrantResponse{Projection: localAppGrantDeniedProjection(pending.operationID, pending.resourceRef, runtimev1.ReasonCode_LOCAL_APP_PRESENCE_REQUIRED)}, nil
		}
		var verifiedUntil time.Time
		presenceEvidenceRef, verifiedUntil, err = s.VerifyRuntimePresence(presenceContext, pending.presencePurpose)
		if err != nil || !verifiedUntil.After(s.now().UTC()) {
			return &runtimev1.DecideLocalAppGrantResponse{Projection: localAppGrantDeniedProjection(pending.operationID, pending.resourceRef, runtimev1.ReasonCode_LOCAL_APP_PRESENCE_REQUIRED)}, nil
		}
	}
	current := localappkernel.Grant{
		AccountID: pending.accountID, LocalAppPrincipalID: pending.principalID,
		CapabilityResourceFingerprint: pending.fingerprint, GrantID: pending.grantID,
		CapabilityScope: []string{pending.capability}, ResourceScope: []string{pending.resourceRef},
		GrantGeneration: pending.grantGeneration, GrantRevision: pending.grantRevision,
		State: localappkernel.GrantStatePending,
	}
	grant, err := s.transitionLocalAppGrant(ctx, current, target, presenceEvidenceRef, pending.appID, pending.operationID, "desktop_grant_control")
	if err != nil {
		return &runtimev1.DecideLocalAppGrantResponse{Projection: localAppGrantDeniedProjection(pending.operationID, pending.resourceRef, localAppGrantErrorReason(err))}, nil
	}
	delete(s.localAppGrantRequests, key)
	s.completeLocalAppGrantChallenge(pending.requestID)
	return &runtimev1.DecideLocalAppGrantResponse{Projection: localAppGrantProjectionFor(grant, pending.operationID, pending.resourceRef, nil, time.Time{})}, nil
}

func (s *Service) getPendingDesktopLocalAppGrant(ctx context.Context) (*runtimev1.GetLocalAppGrantStatusResponse, error) {
	inbox, ok := s.localAppGrantControl.(LocalAppGrantChallengeInbox)
	if !ok || inbox == nil {
		return &runtimev1.GetLocalAppGrantStatusResponse{Projection: localAppGrantDeniedProjection("", "", runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)}, nil
	}
	challenge, found, err := inbox.PendingLocalAppGrantChallenge(ctx)
	if err != nil {
		return &runtimev1.GetLocalAppGrantStatusResponse{Projection: localAppGrantDeniedProjection("", "", runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)}, nil
	}
	if !found {
		return &runtimev1.GetLocalAppGrantStatusResponse{Projection: localAppZeroGrantProjection(localAppGrantOperationBinding{})}, nil
	}
	key := base64.RawURLEncoding.EncodeToString(challenge.RequestID)
	s.localAppGrantMu.Lock()
	defer s.localAppGrantMu.Unlock()
	pending, found := s.localAppGrantRequests[key]
	if !found || !bytes.Equal(pending.requestID, challenge.RequestID) || !bytes.Equal(pending.presenceChallengeID, challenge.PresenceChallengeID) || pending.accountID != challenge.AccountID || pending.accountGeneration != challenge.AccountGeneration || pending.principalID != challenge.LocalAppPrincipalID || pending.recordID != challenge.LocalAppRecordID || pending.provenanceRevision != challenge.ProvenanceRevision || pending.projectGeneration != challenge.ProjectGeneration || pending.sessionID != challenge.SessionID || pending.operationID != challenge.OperationID || pending.fingerprint != challenge.ResourceImpactDigest || !s.now().UTC().Before(pending.expiresAt) {
		return &runtimev1.GetLocalAppGrantStatusResponse{Projection: localAppGrantDeniedProjection("", "", runtimev1.ReasonCode_LOCAL_APP_PRESENCE_EXPIRED)}, nil
	}
	projection := localAppGrantProjectionFromPending(pending, localappkernel.Grant{GrantID: pending.grantID, GrantRevision: pending.grantRevision, GrantGeneration: pending.grantGeneration, State: localappkernel.GrantStatePending})
	projection.PresenceChallengeId = append([]byte(nil), pending.presenceChallengeID...)
	return &runtimev1.GetLocalAppGrantStatusResponse{Projection: projection}, nil
}

func (s *Service) completeLocalAppGrantChallenge(requestID []byte) {
	if inbox, ok := s.localAppGrantControl.(LocalAppGrantChallengeInbox); ok && inbox != nil {
		inbox.CompleteLocalAppGrantChallenge(requestID)
	}
}

func (s *Service) RevokeLocalAppGrant(ctx context.Context, req *runtimev1.RevokeLocalAppGrantRequest) (*runtimev1.RevokeLocalAppGrantResponse, error) {
	if s == nil || s.localAppKernel == nil || !s.hasProtectedLocalAppGrantControl(ctx) || s.localAppGrantControl == nil {
		return &runtimev1.RevokeLocalAppGrantResponse{Projection: localAppGrantDeniedProjection("", "", runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)}, nil
	}
	if _, err := s.localAppGrantControl.AuthorizeLocalAppGrantControl(ctx); err != nil {
		return &runtimev1.RevokeLocalAppGrantResponse{Projection: localAppGrantDeniedProjection("", "", runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)}, nil
	}
	grantID, err := localAppGrantIDFromBytes(req.GetGrantId())
	if err != nil {
		return &runtimev1.RevokeLocalAppGrantResponse{Projection: localAppGrantDeniedProjection("", "", runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)}, nil
	}
	projection, _, authenticated := s.AuthenticatedRuntimeSecurityContext(ctx)
	if !authenticated || projection == nil {
		return &runtimev1.RevokeLocalAppGrantResponse{Projection: localAppGrantDeniedProjection("", "", runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)}, nil
	}
	s.localAppGrantMu.Lock()
	defer s.localAppGrantMu.Unlock()
	grant, err := s.localAppKernel.Grants().GetCurrentByID(ctx, projection.GetAccountId(), grantID)
	if err != nil {
		return &runtimev1.RevokeLocalAppGrantResponse{Projection: localAppGrantDeniedProjection("", "", localAppGrantErrorReason(err))}, nil
	}
	if grant.State == localappkernel.GrantStateRevoked {
		return &runtimev1.RevokeLocalAppGrantResponse{Projection: localAppGrantProjectionFor(grant, "", firstString(grant.ResourceScope), nil, time.Time{})}, nil
	}
	if grant.State != localappkernel.GrantStateGranted {
		return &runtimev1.RevokeLocalAppGrantResponse{Projection: localAppGrantDeniedProjection("", firstString(grant.ResourceScope), runtimev1.ReasonCode_LOCAL_APP_GRANT_REQUIRED)}, nil
	}
	principal, principalErr := s.localAppKernel.Principals().Get(ctx, grant.LocalAppPrincipalID)
	if principalErr != nil || principal.State != localappkernel.PrincipalStateActive {
		return &runtimev1.RevokeLocalAppGrantResponse{Projection: localAppGrantDeniedProjection("", firstString(grant.ResourceScope), runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)}, nil
	}
	grant, err = s.transitionLocalAppGrant(ctx, grant, localappkernel.GrantStateRevoked, "", principal.AppID, "grant.revoke", "desktop_revoke")
	if err != nil {
		return &runtimev1.RevokeLocalAppGrantResponse{Projection: localAppGrantDeniedProjection("", firstString(grant.ResourceScope), localAppGrantErrorReason(err))}, nil
	}
	return &runtimev1.RevokeLocalAppGrantResponse{Projection: localAppGrantProjectionFor(grant, "", firstString(grant.ResourceScope), nil, time.Time{})}, nil
}

func (s *Service) localAppGrantCallerBinding(ctx context.Context, operationID, resourceRef string) (LocalAppCallerDecision, localAppGrantOperationBinding, error) {
	if s == nil || s.localAppKernel == nil {
		return LocalAppCallerDecision{}, localAppGrantOperationBinding{}, localappkernel.ErrNotFound
	}
	binding, err := localAppGrantOperation(operationID, resourceRef)
	if err != nil {
		return LocalAppCallerDecision{}, localAppGrantOperationBinding{}, err
	}
	decision, err := s.AuthorizeLocalAppCaller(ctx)
	if err != nil {
		return LocalAppCallerDecision{}, localAppGrantOperationBinding{}, err
	}
	principal, err := s.localAppKernel.Principals().Get(ctx, decision.LocalAppPrincipalID)
	if err != nil || principal.State != localappkernel.PrincipalStateActive || principal.AppID != decision.AppID {
		return LocalAppCallerDecision{}, localAppGrantOperationBinding{}, ErrLocalAppCallerUnauthorized
	}
	record, err := s.localAppKernel.Records().GetByPrincipalID(ctx, decision.LocalAppPrincipalID)
	if err != nil || record.LocalAppRecordID != decision.LocalAppRecordID || record.ProvenanceRevision != decision.ProvenanceRevision ||
		record.InstallOrProjectGeneration != decision.ProjectGeneration || record.PayloadRootDigest != decision.PayloadDigest ||
		record.TrustClass != localappkernel.TrustClassLocalDevelopment || record.LifecycleState != localappkernel.LifecycleStateActive {
		return LocalAppCallerDecision{}, localAppGrantOperationBinding{}, ErrLocalAppCallerUnauthorized
	}
	if err := requireLocalAppCapabilityFromDecision(s, ctx, decision, binding.capability); err != nil {
		return LocalAppCallerDecision{}, localAppGrantOperationBinding{}, err
	}
	return decision, binding, nil
}

func requireLocalAppCapabilityFromDecision(s *Service, ctx context.Context, decision LocalAppCallerDecision, capability string) error {
	binding, err := s.localAppSessions.ResolveLocalAppSession(ctx, decision.AccountGeneration)
	if err != nil {
		if errors.Is(err, ErrLocalAppAccountChanged) || errors.Is(err, ErrLocalAppProcessMismatch) {
			return err
		}
		return ErrLocalAppCallerUnauthorized
	}
	if binding.LocalAppPrincipalID != decision.LocalAppPrincipalID || binding.LocalAppRecordID != decision.LocalAppRecordID ||
		binding.ProvenanceRevision != decision.ProvenanceRevision || binding.ProjectGeneration != decision.ProjectGeneration ||
		binding.PayloadDigest != decision.PayloadDigest {
		return ErrLocalAppCallerUnauthorized
	}
	if !containsLocalAppCapability(binding.Capabilities, capability) {
		return ErrLocalAppOperationNotAdmitted
	}
	return nil
}

func localAppGrantOperation(operationID, resourceRef string) (localAppGrantOperationBinding, error) {
	if operationID == "" || operationID != strings.TrimSpace(operationID) || resourceRef == "" || resourceRef != strings.TrimSpace(resourceRef) {
		return localAppGrantOperationBinding{}, localappkernel.ErrInvalidArgument
	}
	capability := ""
	switch operationID {
	case "artifacts.read_runtime_bytes":
		capability = "data.scope.read#runtime.artifacts"
	case "runtime_agent.conversation.open", "runtime_agent.conversation.turn_send":
		capability = "runtime.agent.turn.write"
	case "runtime_agent.conversation.turn_subscribe", "runtime_agent.conversation.snapshot":
		capability = "runtime.agent.turn.read"
	case "runtime_agent.voice.transcribe":
		capability = "runtime.agent.voice.transcribe"
	case "runtime_agent.voice.stream_subscribe":
		capability = "runtime.agent.voice.read"
	case appstorage.LocalAppJSONReadOperationID:
		if _, err := appstorage.ParseLocalAppJSONResourceRef(resourceRef); err != nil {
			return localAppGrantOperationBinding{}, localappkernel.ErrInvalidArgument
		}
		capability = appstorage.LocalAppJSONReadCapability
	case appstorage.LocalAppJSONWriteOperationID, appstorage.LocalAppJSONRemoveOperationID:
		if _, err := appstorage.ParseLocalAppJSONResourceRef(resourceRef); err != nil {
			return localAppGrantOperationBinding{}, localappkernel.ErrInvalidArgument
		}
		capability = appstorage.LocalAppJSONWriteCapability
	default:
		return localAppGrantOperationBinding{}, ErrLocalAppOperationNotAdmitted
	}
	fingerprintInput := capability + "\x00" + resourceRef
	if operationID == appstorage.LocalAppJSONReadOperationID || operationID == appstorage.LocalAppJSONWriteOperationID || operationID == appstorage.LocalAppJSONRemoveOperationID ||
		operationID == "runtime_agent.voice.transcribe" || operationID == "runtime_agent.voice.stream_subscribe" {
		fingerprintInput = operationID + "\x00" + fingerprintInput
	}
	digest := sha256.Sum256([]byte("nimi.local-app-capability-resource.v1\x00" + fingerprintInput))
	return localAppGrantOperationBinding{
		operationID: operationID, resourceRef: resourceRef, capability: capability,
		fingerprint: "lacrf_v1_" + base64.RawURLEncoding.EncodeToString(digest[:]),
	}, nil
}

func (s *Service) getCurrentLocalAppGrantLocked(ctx context.Context, decision LocalAppCallerDecision, binding localAppGrantOperationBinding) (localappkernel.Grant, error) {
	grant, err := s.localAppKernel.Grants().GetCurrent(ctx, decision.AccountID, decision.LocalAppPrincipalID, binding.fingerprint)
	if err != nil {
		return localappkernel.Grant{}, err
	}
	if grant.State == localappkernel.GrantStatePending {
		pending, found := s.pendingLocalAppGrantRequestLocked(grant.GrantID)
		if !found || !s.now().UTC().Before(pending.expiresAt) {
			return s.transitionLocalAppGrant(ctx, grant, localappkernel.GrantStateExpired, "", decision.AppID, binding.operationID, "runtime_expiry")
		}
	}
	if grant.ExpiresAt != nil && !s.now().UTC().Before(grant.ExpiresAt.UTC()) && grant.State == localappkernel.GrantStateGranted {
		return s.transitionLocalAppGrant(ctx, grant, localappkernel.GrantStateExpired, "", decision.AppID, binding.operationID, "runtime_expiry")
	}
	return grant, nil
}

func (s *Service) localAppGrantProjectionLocked(grant localappkernel.Grant, binding localAppGrantOperationBinding) *runtimev1.LocalAppGrantProjection {
	if grant.State == localappkernel.GrantStatePending {
		if pending, found := s.pendingLocalAppGrantRequestLocked(grant.GrantID); found {
			projection := localAppGrantProjectionFromPending(pending, grant)
			// Operations that share one capability/resource fingerprint share one
			// grant. The local app must still receive the exact operation it asked
			// about; Desktop keeps the original pending decision correlation.
			projection.OperationId = binding.operationID
			projection.ResourceRef = binding.resourceRef
			return projection
		}
	}
	return localAppGrantProjectionFor(grant, binding.operationID, binding.resourceRef, nil, time.Time{})
}

func localAppZeroGrantProjection(binding localAppGrantOperationBinding) *runtimev1.LocalAppGrantProjection {
	return &runtimev1.LocalAppGrantProjection{State: runtimev1.LocalAppGrantState_LOCAL_APP_GRANT_STATE_NO_GRANT, OperationId: binding.operationID, ResourceRef: binding.resourceRef, ReasonCode: runtimev1.ReasonCode_LOCAL_APP_GRANT_REQUIRED}
}

func localAppGrantDeniedProjection(operationID, resourceRef string, reason runtimev1.ReasonCode) *runtimev1.LocalAppGrantProjection {
	return &runtimev1.LocalAppGrantProjection{State: runtimev1.LocalAppGrantState_LOCAL_APP_GRANT_STATE_DENIED, OperationId: operationID, ResourceRef: resourceRef, ReasonCode: reason}
}

func localAppGrantProjectionFromPending(pending localAppGrantPendingRequest, grant localappkernel.Grant) *runtimev1.LocalAppGrantProjection {
	return localAppGrantProjectionFor(grant, pending.operationID, pending.resourceRef, pending.requestID, pending.expiresAt)
}

func localAppGrantProjectionFor(grant localappkernel.Grant, operationID, resourceRef string, requestID []byte, pendingExpiry time.Time) *runtimev1.LocalAppGrantProjection {
	state := runtimev1.LocalAppGrantState_LOCAL_APP_GRANT_STATE_UNSPECIFIED
	reason := runtimev1.ReasonCode_LOCAL_APP_GRANT_REQUIRED
	switch grant.State {
	case localappkernel.GrantStatePending:
		state, reason = runtimev1.LocalAppGrantState_LOCAL_APP_GRANT_STATE_PENDING, runtimev1.ReasonCode_LOCAL_APP_PRESENCE_REQUIRED
	case localappkernel.GrantStateGranted:
		state, reason = runtimev1.LocalAppGrantState_LOCAL_APP_GRANT_STATE_GRANTED, runtimev1.ReasonCode_ACTION_EXECUTED
	case localappkernel.GrantStateDenied:
		state = runtimev1.LocalAppGrantState_LOCAL_APP_GRANT_STATE_DENIED
	case localappkernel.GrantStateExpired:
		state, reason = runtimev1.LocalAppGrantState_LOCAL_APP_GRANT_STATE_EXPIRED, runtimev1.ReasonCode_LOCAL_APP_PRESENCE_EXPIRED
	case localappkernel.GrantStateRevoked:
		state, reason = runtimev1.LocalAppGrantState_LOCAL_APP_GRANT_STATE_REVOKED, runtimev1.ReasonCode_LOCAL_APP_GRANT_REVOKED
	case localappkernel.GrantStateSuperseded:
		state, reason = runtimev1.LocalAppGrantState_LOCAL_APP_GRANT_STATE_SUPERSEDED, runtimev1.ReasonCode_LOCAL_APP_GRANT_SUPERSEDED
	}
	projection := &runtimev1.LocalAppGrantProjection{
		State: state, OperationId: operationID, ResourceRef: resourceRef, RequestId: append([]byte(nil), requestID...),
		GrantId: localAppGrantIDBytes(grant.GrantID), GrantGeneration: grant.GrantGeneration, GrantRevision: grant.GrantRevision, ReasonCode: reason,
	}
	expiresAt := pendingExpiry
	if expiresAt.IsZero() && grant.ExpiresAt != nil {
		expiresAt = grant.ExpiresAt.UTC()
	}
	if !expiresAt.IsZero() {
		projection.ExpiresAt = timestamppb.New(expiresAt)
	}
	return projection
}

func (s *Service) readLocalAppGrantIdentifier() ([]byte, error) {
	identifier := make([]byte, localAppGrantIdentifierBytes)
	if _, err := io.ReadFull(s.localAppGrantRandom, identifier); err != nil {
		return nil, err
	}
	if bytes.Equal(identifier, make([]byte, localAppGrantIdentifierBytes)) {
		return nil, errors.New("local-app grant identifier is all zero")
	}
	return identifier, nil
}

func (s *Service) allocateLocalAppGrantRequestIDLocked() ([]byte, error) {
	for attempt := 0; attempt < 8; attempt++ {
		identifier, err := s.readLocalAppGrantIdentifier()
		if err != nil {
			return nil, err
		}
		if _, exists := s.localAppGrantRequests[base64.RawURLEncoding.EncodeToString(identifier)]; !exists {
			return identifier, nil
		}
	}
	return nil, errors.New("local-app grant request identifier allocation exhausted")
}

func (s *Service) pendingLocalAppGrantRequestLocked(grantID string) (localAppGrantPendingRequest, bool) {
	for _, pending := range s.localAppGrantRequests {
		if pending.grantID == grantID {
			return pending, true
		}
	}
	return localAppGrantPendingRequest{}, false
}

func (s *Service) hasProtectedLocalAppGrantControl(ctx context.Context) bool {
	connection, ok := protectedlocal.DesktopConnectionFromContext(ctx)
	if !ok || connection == nil {
		return false
	}
	origin := connection.Origin()
	return origin.TransportClass == protectedlocal.TransportDesktopControl && origin.HasRole(protectedlocal.RoleVerifiedDesktopProcess) && origin.HasRole(protectedlocal.RoleLocalAppControl)
}

func localAppGrantIDBytes(grantID string) []byte {
	const prefix = "lag_v1_"
	if !strings.HasPrefix(grantID, prefix) {
		return nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(grantID, prefix))
	if err != nil || len(decoded) != localAppGrantIdentifierBytes {
		return nil
	}
	return decoded
}

func localAppGrantIDFromBytes(value []byte) (string, error) {
	if len(value) != localAppGrantIdentifierBytes || bytes.Equal(value, make([]byte, localAppGrantIdentifierBytes)) {
		return "", localappkernel.ErrInvalidArgument
	}
	return "lag_v1_" + base64.RawURLEncoding.EncodeToString(value), nil
}

func localAppGrantErrorReason(err error) runtimev1.ReasonCode {
	switch {
	case errors.Is(err, ErrLocalAppAccountChanged):
		return runtimev1.ReasonCode_LOCAL_APP_ACCOUNT_CHANGED
	case errors.Is(err, ErrLocalAppProcessMismatch):
		return runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH
	case errors.Is(err, ErrLocalAppCallerUnauthorized), errors.Is(err, localappkernel.ErrPrincipalTombstoned):
		return runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED
	case errors.Is(err, ErrLocalAppOperationNotAdmitted):
		return runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE
	case errors.Is(err, localappkernel.ErrInvalidArgument):
		return runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID
	case errors.Is(err, localappkernel.ErrGrantTransition), errors.Is(err, localappkernel.ErrStateConflict):
		return runtimev1.ReasonCode_LOCAL_APP_GRANT_SUPERSEDED
	default:
		return runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE
	}
}

func firstString(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[0]
}
