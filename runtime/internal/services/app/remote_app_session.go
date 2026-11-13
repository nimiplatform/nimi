package app

import (
	"context"
	"encoding/binary"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
	"github.com/nimiplatform/nimi/runtime/internal/remoteaccess"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
)

type remoteAppRuntimeSession struct {
	binding  localappop.SnapshotBinding
	snapshot *localappop.EffectiveAppAccessSnapshot
}

type remoteAppPeerContextKey struct{}

// @nimi-authority: rule.nimi.runtime.integration.standing-permission
// Integration management can offer a live remote subject without inventing
// native Host binding. The original peer, account and source fences still own it.
func (s *Service) RemoteAppSubjectLive(ctx context.Context, subject string) bool {
	if s == nil {
		return false
	}
	live := false
	s.remoteAppSessions.Range(func(key, value any) bool {
		session := value.(*remoteAppRuntimeSession)
		if session.binding.RegisteredAppSubject != subject {
			return true
		}
		info, _, _, err := s.currentRemotePeer(ctx, key.(remoteAppPeer))
		if err == nil && info.Source.Role == "app" && info.Registration.RegisteredAppSubject == subject {
			live = true
		}
		return !live
	})
	return live
}

type remoteAppPeer interface {
	Snapshot() (remoteaccess.PeerInfo, bool)
	Done() <-chan struct{}
	Commit(context.Context, protectedlocal.Identifier, func() error) error
}

func remoteAppPeerFromContext(ctx context.Context) remoteAppPeer {
	peer, _ := ctx.Value(remoteAppPeerContextKey{}).(remoteAppPeer)
	return peer
}

func (s *Service) currentRemotePeer(ctx context.Context, peer remoteAppPeer) (remoteaccess.PeerInfo, *runtimev1.AccountProjection, <-chan struct{}, error) {
	if s == nil || s.localAppKernel == nil || peer == nil {
		return remoteaccess.PeerInfo{}, nil, nil, remoteAdmissionDenied()
	}
	info, live := peer.Snapshot()
	account, generation, invalidated, current := s.bindAuthenticatedRuntimeAccount(ctx)
	if !live || !current || generation != info.AccountGeneration || account.AccountId != info.Scope.AccountID || account.RealmEnvironmentId != info.Scope.RealmEnvironmentID {
		return info, nil, nil, remoteAdmissionDenied()
	}
	settings, err := s.localAppKernel.RemoteAccess().Settings(ctx, info.Scope.RealmEnvironmentID, info.Scope.AccountID)
	if err != nil || !settings.Enabled || settings.BindingID != info.Scope.BindingID {
		return info, nil, nil, remoteAdmissionDenied()
	}
	access, err := s.localAppKernel.RemoteAccess().Source(ctx, info.Scope, info.Source.ClientID)
	if err != nil || access.Paused || access.ApprovedRevision != info.Source.SourceRevision || access.RegistrationHandle != info.Registration.RegistrationHandle {
		return info, nil, nil, remoteAdmissionDenied()
	}
	registration, err := s.localAppKernel.Registrations().GetActiveByHandle(ctx, access.RegistrationHandle)
	if err != nil || registration.SourceClass != localappkernel.SourceClassRemote || registration.AppID != info.Registration.AppID ||
		registration.RegisteredAppSubject != info.Registration.RegisteredAppSubject || registration.SourceGeneration != info.Registration.SourceGeneration ||
		registration.DeclarationGeneration != info.Registration.DeclarationGeneration {
		return info, nil, nil, remoteAdmissionDenied()
	}
	return info, account, invalidated, nil
}

// @nimi-authority: rule.nimi.runtime.remote-access.source-admission
func (s *Service) AuthorizeRemoteAppIngress(ctx context.Context, peer *remoteaccess.Peer, ingress localappop.Ingress) (context.Context, error) {
	if peer == nil {
		return nil, remoteAdmissionDenied()
	}
	return s.authorizeRemoteAppIngress(ctx, peer, ingress)
}

func (s *Service) authorizeRemoteAppIngress(ctx context.Context, peer remoteAppPeer, ingress localappop.Ingress) (context.Context, error) {
	info, _, _, err := s.currentRemotePeer(ctx, peer)
	if err != nil {
		return nil, err
	}
	if info.Source.Role != "app" {
		return nil, remoteAdmissionDenied()
	}
	value, exists := s.remoteAppSessions.Load(peer)
	if !exists {
		binding := remoteSnapshotBinding(info)
		snapshot, err := localappop.NewEffectiveAppAccessSnapshot(binding, info.Registration.ActivatedDomains)
		if err != nil {
			return nil, localAppIngressError(err)
		}
		candidate := &remoteAppRuntimeSession{binding: binding, snapshot: snapshot}
		var loaded bool
		value, loaded = s.remoteAppSessions.LoadOrStore(peer, candidate)
		if !loaded {
			go func() { <-peer.Done(); s.remoteAppSessions.Delete(peer) }()
		}
	}
	session := value.(*remoteAppRuntimeSession)
	admission, err := localappop.Admit(localappop.AdmissionInput{Ingress: ingress, Snapshot: session.snapshot, Current: localappop.CurrentBinding(remoteSnapshotBinding(info))})
	if err != nil {
		return nil, localAppIngressError(err)
	}
	capability, supported := appOperationCapability(admission)
	if !supported {
		return nil, grpcerr.WithReasonCode(codes.Unimplemented, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNSUPPORTED)
	}
	handle, valid := localDevelopmentRegistrationIdentifier(info.Registration.RegistrationHandle)
	if !valid {
		return nil, remoteAdmissionDenied()
	}
	decision := accountservice.LocalAppCallerDecision{LocalOSUserAnchor: s.localAppKernel.LocalOSUserAnchor(), SessionID: info.SessionID,
		AppID: info.Registration.AppID, AccountID: info.Scope.AccountID, RealmEnvironmentID: info.Scope.RealmEnvironmentID,
		AccountGeneration: info.AccountGeneration, RuntimeBootEpoch: info.RuntimeInstanceID, ExpiresAt: info.Deadline,
		Operation: admission.Operation, AuthorityClass: admission.Class, OperationCapability: capability, TrustClass: accountservice.LocalAppTrustClassRemote,
		RegistrationHandle: handle, SourceGeneration: info.Registration.SourceGeneration, DeclarationGeneration: info.Registration.DeclarationGeneration,
		RegisteredAppSubject: info.Registration.RegisteredAppSubject, SessionInvalidated: peer.Done()}
	// Conversation observations revalidate repeatedly on the same request.
	// Keep its existing cancellation binding instead of adding a listener per poll.
	if remoteAppPeerFromContext(ctx) != peer {
		ctx = context.WithValue(bindLocalAppSessionInvalidation(ctx, peer.Done()), remoteAppPeerContextKey{}, peer)
	}
	return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, decision), nil
}

// @nimi-authority: rule.nimi.runtime.remote-access.source-admission
// Remote owners reuse the Account and canonical-registration publication gates.
// The actual direct peer replaces only the native technical-session fence.
func (s *Service) commitRemoteAppIngress(ctx context.Context, peer remoteAppPeer, ingress localappop.Ingress, commit func(context.Context) error) error {
	authorized, err := s.authorizeRemoteAppIngress(ctx, peer, ingress)
	if err != nil {
		return err
	}
	decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(authorized)
	account, accountOK := s.accountSecurity.(runtimeAccountGenerationCommitter)
	classification, classifyErr := localappop.ClassifyIngress(ingress)
	if !ok || !accountOK || classifyErr != nil {
		return remoteAdmissionDenied()
	}
	accepted, err := account.CommitAuthenticatedRuntimeGeneration(ctx, decision.AccountID, decision.RealmEnvironmentID, decision.AccountGeneration, func() error {
		return s.localAppKernel.Registrations().WithRegistrationAuthority(ctx, decision.RegisteredAppSubject, decision.SourceGeneration, decision.DeclarationGeneration, string(classification.Domain), func() error {
			return peer.Commit(ctx, decision.SessionID, func() error { return commit(authorized) })
		})
	})
	if !accepted && err == nil {
		return remoteAdmissionDenied()
	}
	return err
}

func remoteSnapshotBinding(info remoteaccess.PeerInfo) localappop.SnapshotBinding {
	return localappop.SnapshotBinding{LaunchCorrelation: [32]byte(info.SessionID), RegistrationHandle: info.Registration.RegistrationHandle,
		RegisteredAppSubject: info.Registration.RegisteredAppSubject, SourceGeneration: info.Registration.SourceGeneration,
		DeclarationGeneration: info.Registration.DeclarationGeneration, AccountID: info.Scope.AccountID, AccountGeneration: info.AccountGeneration,
		RuntimeGeneration: binary.BigEndian.Uint64(info.RuntimeInstanceID[:8])}
}

// Official qualification, owner identity, source approval and the live peer
// are all required. This never creates a native Desktop process witness.
func (s *Service) AuthorizeRemoteManager(ctx context.Context, peer *remoteaccess.Peer) (context.Context, error) {
	if peer == nil {
		return nil, remoteAdmissionDenied()
	}
	info, account, invalidated, err := s.currentRemotePeer(ctx, peer)
	if err != nil {
		return nil, err
	}
	if info.Source.Role != "official_manager" {
		return nil, remoteAdmissionDenied()
	}
	principal := protectedprincipal.NewDirect(info.Registration.AppID, protectedprincipal.RemoteRuntimeOwnerProfileID, protectedprincipal.RemoteRuntimeOwnerProfileID,
		account, info.AccountGeneration, invalidated, peer.Done())
	return protectedprincipal.With(bindLocalAppSessionInvalidation(ctx, peer.Done()), principal), nil
}

func remoteAdmissionDenied() error {
	return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
}
