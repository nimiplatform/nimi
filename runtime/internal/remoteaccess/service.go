package remoteaccess

import (
	"context"
	"log/slog"
	"sort"
	"sync"
	"time"

	realmv1 "github.com/nimiplatform/nimi/runtime/gen/realm/v1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type pendingOffer struct {
	offer    realmv1.RuntimeConnectionOfferDto
	deadline time.Time
	stunURLs []string
}
type peerWork struct {
	cancel              context.CancelFunc
	contextID, clientID string
}
type hostRun struct {
	ctx     context.Context
	cancel  context.CancelFunc
	scope   localappkernel.RemoteAccessScope
	control *accountservice.PrimaryRuntimeControl
	state   runtimev1.RemoteAccessConnectionState
	reason  string
	blocked bool
	pending map[string]pendingOffer
	working map[string]peerWork
	peers   map[string]*Peer
}

type Service struct {
	runtimev1.UnimplementedRuntimeRemoteAccessServiceServer
	account  *accountservice.Service
	kernel   *localappkernel.Kernel
	dispatch Dispatcher
	logger   *slog.Logger
	audit    *auditlog.Store
	instance protectedlocal.Identifier
	ctx      context.Context
	cancel   context.CancelFunc
	wake     chan struct{}
	mu       sync.Mutex
	run      *hostRun
	wg       sync.WaitGroup
	start    sync.Once
	close    sync.Once
}

func New(account *accountservice.Service, kernel *localappkernel.Kernel, instance protectedlocal.Identifier, dispatch Dispatcher, logger *slog.Logger, audit *auditlog.Store) *Service {
	ctx, cancel := context.WithCancel(context.Background())
	return &Service{account: account, kernel: kernel, instance: instance, dispatch: dispatch, logger: logger, audit: audit, ctx: ctx, cancel: cancel, wake: make(chan struct{}, 1)}
}
func (s *Service) available() bool {
	return s != nil && s.ctx.Err() == nil && s.account != nil && s.kernel != nil && s.dispatch != nil && s.instance != (protectedlocal.Identifier{})
}
func (s *Service) Start() {
	if !s.available() || s.ctx.Err() != nil {
		return
	}
	s.start.Do(func() {
		s.wg.Add(1)
		go func() {
			defer s.wg.Done()
			ticker := time.NewTicker(2 * time.Second)
			defer ticker.Stop()
			for {
				s.step()
				select {
				case <-s.ctx.Done():
					return
				case <-ticker.C:
				case <-s.wake:
				}
			}
		}()
	})
}
func (s *Service) Close() {
	if s == nil {
		return
	}
	s.close.Do(func() { s.cancel(); s.stopRun(); s.wg.Wait() })
}
func (s *Service) changed() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

// @nimi-authority: rule.nimi.runtime.remote-access.primary-control
func (s *Service) step() {
	accountID, realmID, selected := s.account.RemoteAccessSettingsOwner()
	if !selected || s.ctx.Err() != nil {
		s.stopRun()
		return
	}
	settings, err := s.kernel.RemoteAccess().Settings(s.ctx, realmID, accountID)
	if err != nil || !settings.Enabled {
		s.stopRun()
		return
	}
	scope := localappkernel.RemoteAccessScope{RealmEnvironmentID: realmID, AccountID: accountID, BindingID: settings.BindingID}
	s.mu.Lock()
	current := s.run
	s.mu.Unlock()
	if current != nil && current.scope != scope {
		s.stopRun()
		current = nil
	}
	if current == nil {
		ctx, cancel := context.WithCancel(s.ctx)
		current = &hostRun{ctx: ctx, cancel: cancel, scope: scope, state: runtimev1.RemoteAccessConnectionState_REMOTE_ACCESS_CONNECTION_STATE_CONNECTING,
			pending: make(map[string]pendingOffer), working: make(map[string]peerWork), peers: make(map[string]*Peer)}
		s.mu.Lock()
		if s.ctx.Err() != nil {
			s.mu.Unlock()
			cancel()
			return
		}
		s.run = current
		s.mu.Unlock()
	}
	s.mu.Lock()
	blocked, control := current.blocked, current.control
	s.mu.Unlock()
	if blocked {
		return
	}
	if control == nil {
		control, err = s.account.BindPrimaryRuntimeControl(current.ctx)
		if err != nil {
			// An absent/non-matching host identity needs an explicit owner action.
			// Re-reading it every tick cannot repair custody and exhausts discovery's quota.
			if status.Code(err) == codes.FailedPrecondition {
				s.mu.Lock()
				if s.run == current {
					current.blocked = true
				}
				s.mu.Unlock()
			}
			s.controlFailure(current, "PRIMARY_RUNTIME_UNAVAILABLE", err)
			return
		}
		bound := control.State()
		if bound.AccountID != scope.AccountID || bound.RealmEnvironmentID != scope.RealmEnvironmentID || bound.BindingID != scope.BindingID {
			s.mu.Lock()
			if s.run == current {
				current.blocked = true
			}
			s.mu.Unlock()
			s.controlFailure(current, "PRIMARY_RUNTIME_CHANGED", denied())
			return
		}
		s.mu.Lock()
		if s.run != current {
			s.mu.Unlock()
			return
		}
		current.control = control
		s.mu.Unlock()
	}
	bound := control.State()
	select {
	case <-bound.Invalidated:
		s.stopRun()
		return
	default:
	}
	if time.Until(bound.Deadline) < 40*time.Second || !accountservice.PrimaryRuntimeDeadlineLive(bound.Deadline) {
		if err = s.account.RenewPrimaryRuntimeControl(current.ctx, control); err != nil {
			s.controlFailure(current, "PRIMARY_RUNTIME_UNAVAILABLE", err)
			// A lost renewal response may have rotated the CAS version. Re-read
			// current control on the next tick; no business request is repeated.
			s.mu.Lock()
			if s.run == current {
				current.control = nil
			}
			s.mu.Unlock()
			return
		}
	}
	s.mu.Lock()
	ids := make(map[string]bool)
	for id, peer := range current.peers {
		if info, live := peer.Snapshot(); live {
			ids[info.ContextID] = true
		} else {
			delete(current.peers, id)
			go peer.Close()
		}
	}
	for _, work := range current.working {
		ids[work.contextID] = true
	}
	s.mu.Unlock()
	contextIDs := make([]string, 0, len(ids))
	for id := range ids {
		contextIDs = append(contextIDs, id)
	}
	sort.Strings(contextIDs)
	poll, err := s.account.PollPrimaryRuntimeConnections(current.ctx, control, contextIDs)
	if err != nil {
		s.controlFailure(current, "REALM_UNAVAILABLE", err)
		return
	}
	s.applyPoll(current, poll)
}

func (s *Service) controlFailure(run *hostRun, reason string, cause error) {
	s.mu.Lock()
	var peers []*Peer
	if s.run == run {
		run.state = runtimev1.RemoteAccessConnectionState_REMOTE_ACCESS_CONNECTION_STATE_UNAVAILABLE
		run.reason = reason
		switch status.Code(cause) {
		case codes.PermissionDenied, codes.Unauthenticated, codes.Aborted:
			for _, peer := range run.peers {
				peers = append(peers, peer)
			}
			run.peers = make(map[string]*Peer)
			for _, work := range run.working {
				work.cancel()
			}
			run.control = nil
		}
	}
	s.mu.Unlock()
	for _, peer := range peers {
		peer.Close()
	}
}

func (s *Service) applyPoll(run *hostRun, poll *accountservice.PrimaryRuntimePoll) {
	serverTime, _ := time.Parse(time.RFC3339Nano, poll.Projection.ServerTime)
	live := make(map[string]realmv1.RuntimeClientContextDto)
	for _, item := range poll.Projection.Contexts {
		live[item.ContextId] = item
	}
	s.mu.Lock()
	if s.run != run || run.ctx.Err() != nil {
		s.mu.Unlock()
		return
	}
	run.state = runtimev1.RemoteAccessConnectionState_REMOTE_ACCESS_CONNECTION_STATE_LISTENING
	run.reason = ""
	for id, peer := range run.peers {
		info, current := peer.Snapshot()
		item, exists := live[info.ContextID]
		if !current || !exists || !sameSource(info.Source, item.Source) {
			delete(run.peers, id)
			go peer.Close()
			continue
		}
		peer.renew(clientDeadline(poll, &item, serverTime))
	}
	for _, work := range run.working {
		if _, ok := live[work.contextID]; !ok {
			work.cancel()
		}
	}
	run.pending = make(map[string]pendingOffer)
	for _, offer := range poll.Projection.Offers {
		expires, _ := time.Parse(time.RFC3339Nano, offer.ExpiresAt)
		deadline := minTime(clientDeadline(poll, offer.Context, serverTime), poll.ObservedAt.Add(expires.Sub(serverTime)))
		run.pending[offer.ConnectionId] = pendingOffer{offer: offer, deadline: deadline, stunURLs: append([]string(nil), poll.Projection.StunUrls...)}
	}
	toTry := make([]pendingOffer, 0, len(run.pending))
	for id, pending := range run.pending {
		if _, busy := run.working[id]; !busy && run.peers[id] == nil {
			toTry = append(toTry, pending)
		}
	}
	s.mu.Unlock()
	for _, pending := range toTry {
		registration, source, err := s.confirmedSource(run.ctx, run.scope, pending.offer.Context)
		if err != nil {
			access, accessErr := s.kernel.RemoteAccess().Source(run.ctx, run.scope, pending.offer.Context.ClientId)
			if accessErr == nil && access.Paused {
				s.mu.Lock()
				control := run.control
				s.mu.Unlock()
				if control != nil && s.account.AnswerPrimaryRuntimeConnection(run.ctx, control, pending.offer.ConnectionId, "", "SOURCE_NOT_ALLOWED") == nil {
					s.mu.Lock()
					delete(run.pending, pending.offer.ConnectionId)
					s.mu.Unlock()
				}
			}
			continue
		}
		s.mu.Lock()
		if s.run != run || run.ctx.Err() != nil || run.peers[pending.offer.ConnectionId] != nil {
			s.mu.Unlock()
			continue
		}
		if _, busy := run.working[pending.offer.ConnectionId]; busy || len(run.peers)+len(run.working) >= 64 {
			s.mu.Unlock()
			continue
		}
		ctx, cancel := context.WithDeadline(run.ctx, pending.deadline)
		run.working[pending.offer.ConnectionId] = peerWork{cancel: cancel, contextID: pending.offer.Context.ContextId, clientID: source.ClientID}
		s.wg.Add(1)
		s.mu.Unlock()
		go s.connect(run, ctx, cancel, pending, registration, source)
	}
}

func (s *Service) connect(run *hostRun, ctx context.Context, cancel context.CancelFunc, pending pendingOffer, registration localappkernel.Registration, source localappkernel.RemoteSource) {
	defer s.wg.Done()
	defer cancel()
	defer func() { s.mu.Lock(); delete(run.working, pending.offer.ConnectionId); s.mu.Unlock() }()
	s.mu.Lock()
	control := run.control
	s.mu.Unlock()
	if control == nil {
		return
	}
	bound := control.State()
	info := PeerInfo{Scope: run.scope, ContextID: pending.offer.Context.ContextId, AccountGeneration: bound.AccountGeneration, AccountInvalidated: bound.Invalidated,
		Registration: registration, Source: source, RuntimeInstanceID: s.instance, Deadline: pending.deadline}
	peer, answer, err := newPeer(run.ctx, ctx, info, pending.offer.OfferSdp, pending.stunURLs, s.dispatch)
	if err != nil {
		if ctx.Err() == nil {
			_ = s.account.AnswerPrimaryRuntimeConnection(ctx, control, pending.offer.ConnectionId, "", "DIRECT_CONNECTION_UNAVAILABLE")
		}
		return
	}
	if _, _, err = s.confirmedSource(ctx, run.scope, pending.offer.Context); err != nil {
		peer.Close()
		return
	}
	if err = s.account.AnswerPrimaryRuntimeConnection(ctx, control, pending.offer.ConnectionId, answer, ""); err != nil {
		peer.Close()
		return
	}
	s.mu.Lock()
	if s.run != run || ctx.Err() != nil {
		s.mu.Unlock()
		peer.Close()
		return
	}
	run.peers[pending.offer.ConnectionId] = peer
	delete(run.pending, pending.offer.ConnectionId)
	s.mu.Unlock()
}

func clientDeadline(poll *accountservice.PrimaryRuntimePoll, item *realmv1.RuntimeClientContextDto, serverTime time.Time) time.Time {
	expires, _ := time.Parse(time.RFC3339Nano, item.ExpiresAt)
	return minTime(poll.AuthorityDeadline, poll.ObservedAt.Add(expires.Sub(serverTime)))
}
func minTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}
func sameSource(source localappkernel.RemoteSource, actual *realmv1.RuntimeClientSourceDto) bool {
	return actual != nil && source.ClientID == actual.ClientId && source.SourceRevision == uint64(actual.SourceRevision) && source.Role == actual.Role && source.Origin == actual.Origin && source.RedirectURI == actual.RedirectUri
}

func (s *Service) confirmedSource(ctx context.Context, scope localappkernel.RemoteAccessScope, client *realmv1.RuntimeClientContextDto) (localappkernel.Registration, localappkernel.RemoteSource, error) {
	if client == nil || client.Source == nil || client.AccountId != scope.AccountID || client.RealmEnvironmentId != scope.RealmEnvironmentID {
		return localappkernel.Registration{}, localappkernel.RemoteSource{}, localappkernel.ErrStateConflict
	}
	access, err := s.kernel.RemoteAccess().Source(ctx, scope, client.ClientId)
	if err != nil || access.Paused || access.ApprovedRevision != uint64(client.Source.SourceRevision) {
		return localappkernel.Registration{}, localappkernel.RemoteSource{}, localappkernel.ErrStateConflict
	}
	registration, err := s.kernel.Registrations().GetActiveByHandle(ctx, access.RegistrationHandle)
	if err != nil {
		return registration, localappkernel.RemoteSource{}, err
	}
	source, err := s.kernel.Registrations().RemoteSource(ctx, access.RegistrationHandle)
	if err != nil || registration.AppID != client.AppId || !sameSource(source, client.Source) {
		return registration, source, localappkernel.ErrStateConflict
	}
	return registration, source, nil
}

func (s *Service) stopRun() {
	s.mu.Lock()
	run := s.run
	s.run = nil
	s.mu.Unlock()
	if run == nil {
		return
	}
	run.cancel()
	s.mu.Lock()
	peers := make([]*Peer, 0, len(run.peers))
	for _, peer := range run.peers {
		peers = append(peers, peer)
	}
	s.mu.Unlock()
	for _, peer := range peers {
		peer.Close()
	}
}
func (s *Service) invalidateSource(scope localappkernel.RemoteAccessScope, clientID string) {
	s.mu.Lock()
	run := s.run
	if run == nil || run.scope != scope {
		s.mu.Unlock()
		return
	}
	var peers []*Peer
	for id, peer := range run.peers {
		info, _ := peer.Snapshot()
		if info.Source.ClientID == clientID {
			delete(run.peers, id)
			peers = append(peers, peer)
		}
	}
	for _, work := range run.working {
		if work.clientID == clientID {
			work.cancel()
		}
	}
	s.mu.Unlock()
	for _, peer := range peers {
		peer.Close()
	}
}

func (s *Service) caller(ctx context.Context, homeOnly bool) (protectedprincipal.Principal, error) {
	if !s.available() {
		return protectedprincipal.Principal{}, unavailable()
	}
	p, ok := protectedprincipal.FromContext(ctx)
	if !ok || (homeOnly && !p.IsDesktopAccountProduct()) || (!homeOnly && !p.IsRuntimeOwnerManager()) {
		return p, denied()
	}
	current, generation, live := s.account.AuthenticatedRuntimeSecurityContext(ctx)
	if !live || current.AccountId != p.AccountID || current.RealmEnvironmentId != p.RealmEnvironment || generation != p.AccountGeneration {
		return p, denied()
	}
	return p, nil
}

// @nimi-authority: rule.nimi.runtime.remote-access.source-admission
func (s *Service) GetRemoteAccessState(ctx context.Context, _ *runtimev1.GetRemoteAccessStateRequest) (*runtimev1.GetRemoteAccessStateResponse, error) {
	p, err := s.caller(ctx, false)
	if err != nil {
		return nil, err
	}
	return s.state(ctx, p)
}
func (s *Service) state(ctx context.Context, p protectedprincipal.Principal) (*runtimev1.GetRemoteAccessStateResponse, error) {
	settings, err := s.kernel.RemoteAccess().Settings(ctx, p.RealmEnvironment, p.AccountID)
	if err != nil {
		return nil, unavailable()
	}
	result := &runtimev1.GetRemoteAccessStateResponse{Enabled: settings.Enabled, BindingId: settings.BindingID, ConnectionState: runtimev1.RemoteAccessConnectionState_REMOTE_ACCESS_CONNECTION_STATE_DISABLED}
	if settings.BindingID == "" {
		return result, nil
	}
	scope := localappkernel.RemoteAccessScope{RealmEnvironmentID: p.RealmEnvironment, AccountID: p.AccountID, BindingID: settings.BindingID}
	entries, err := s.kernel.RemoteAccess().Sources(ctx, scope)
	if err != nil {
		return nil, unavailable()
	}
	rows := make(map[string]*runtimev1.RemoteAccessSource)
	for _, entry := range entries {
		registration, regErr := s.kernel.Registrations().GetActiveByHandle(ctx, entry.RegistrationHandle)
		source, sourceErr := s.kernel.Registrations().RemoteSource(ctx, entry.RegistrationHandle)
		if regErr != nil || sourceErr != nil {
			return nil, unavailable()
		}
		state := runtimev1.RemoteSourceAccessState_REMOTE_SOURCE_ACCESS_STATE_ALLOWED
		if entry.Paused {
			state = runtimev1.RemoteSourceAccessState_REMOTE_SOURCE_ACCESS_STATE_PAUSED
		}
		if entry.ApprovedRevision != source.SourceRevision {
			state = runtimev1.RemoteSourceAccessState_REMOTE_SOURCE_ACCESS_STATE_CHANGED
		}
		rows[source.ClientID] = &runtimev1.RemoteAccessSource{ClientId: source.ClientID, AppId: registration.AppID, DisplayName: registration.DisplayName, Origin: source.Origin,
			OfficialManager: source.Role == "official_manager", SourceRevision: source.SourceRevision, AppAccess: registration.RawDeclaration, CapabilityContractRefs: source.CapabilityContractRefs, State: state}
	}
	s.mu.Lock()
	run := s.run
	if settings.Enabled {
		result.ConnectionState = runtimev1.RemoteAccessConnectionState_REMOTE_ACCESS_CONNECTION_STATE_CONNECTING
	}
	if run != nil && run.scope == scope {
		result.ConnectionState, result.ReasonCode = run.state, run.reason
		if result.ConnectionState == runtimev1.RemoteAccessConnectionState_REMOTE_ACCESS_CONNECTION_STATE_LISTENING && (run.control == nil || !accountservice.PrimaryRuntimeDeadlineLive(run.control.State().Deadline)) {
			result.ConnectionState = runtimev1.RemoteAccessConnectionState_REMOTE_ACCESS_CONNECTION_STATE_UNAVAILABLE
			result.ReasonCode = "PRIMARY_RUNTIME_UNAVAILABLE"
		}
		for _, peer := range run.peers {
			if peer.Ready() {
				result.ConnectedPeers++
			}
		}
		for id, pending := range run.pending {
			if !accountservice.PrimaryRuntimeDeadlineLive(pending.deadline) {
				continue
			}
			source := pending.offer.Context.Source
			if row := rows[source.ClientId]; row != nil && (row.State == runtimev1.RemoteSourceAccessState_REMOTE_SOURCE_ACCESS_STATE_PAUSED || (row.SourceRevision == uint64(source.SourceRevision) && row.State != runtimev1.RemoteSourceAccessState_REMOTE_SOURCE_ACCESS_STATE_CHANGED)) {
				continue
			}
			rows[source.ClientId] = &runtimev1.RemoteAccessSource{ClientId: source.ClientId, AppId: source.AppId, DisplayName: source.DisplayName, Origin: source.Origin,
				OfficialManager: source.Role == "official_manager", SourceRevision: uint64(source.SourceRevision), AppAccess: source.AppAccess, CapabilityContractRefs: source.CapabilityContractRefs,
				State: runtimev1.RemoteSourceAccessState_REMOTE_SOURCE_ACCESS_STATE_PENDING, PendingRequestId: id}
		}
	}
	s.mu.Unlock()
	for _, row := range rows {
		result.Sources = append(result.Sources, row)
	}
	sort.Slice(result.Sources, func(i, j int) bool { return result.Sources[i].ClientId < result.Sources[j].ClientId })
	if !p.Valid() {
		return nil, denied()
	}
	return result, nil
}

func (s *Service) commit(ctx context.Context, p protectedprincipal.Principal, operation string, fields map[string]any, action func() error) (*runtimev1.ErrorInfo, error) {
	if s.audit == nil {
		return nil, unavailable()
	}
	fields["actor_role"] = "remote-manager"
	if p.IsDesktopAccountProduct() {
		fields["actor_role"] = "host-home"
	}
	payload, err := structpb.NewStruct(fields)
	if err != nil {
		return nil, unavailable()
	}
	event := &runtimev1.AuditEventRecord{AppId: p.AppID, SubjectUserId: p.AccountID, Domain: "runtime.remote-access", Operation: operation,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED, Timestamp: timestamppb.New(time.Now().UTC()), Payload: payload}
	committed, err := s.audit.CommitRecorded(event, func() error {
		accepted, effectErr := s.account.CommitAuthenticatedRuntimeGeneration(ctx, p.AccountID, p.RealmEnvironment, p.AccountGeneration, action)
		if effectErr != nil {
			return effectErr
		}
		if !accepted {
			return denied()
		}
		return nil
	})
	if !committed {
		return nil, unavailable()
	}
	return auditlog.CommittedDiagnostic(err), nil
}

func (s *Service) SetRemoteAccessEnabled(ctx context.Context, request *runtimev1.SetRemoteAccessEnabledRequest) (*runtimev1.SetRemoteAccessEnabledResponse, error) {
	p, err := s.caller(ctx, true)
	if err != nil {
		return nil, err
	}
	if request == nil || request.ExpectedBindingId == "" {
		return nil, denied()
	}
	scope := localappkernel.RemoteAccessScope{RealmEnvironmentID: p.RealmEnvironment, AccountID: p.AccountID, BindingID: request.ExpectedBindingId}
	if request.Enabled {
		control, err := s.account.BindPrimaryRuntimeControl(ctx)
		if err != nil {
			return nil, err
		}
		current := control.State()
		if current.AccountID != p.AccountID || current.AccountGeneration != p.AccountGeneration || current.BindingID != request.ExpectedBindingId {
			return nil, denied()
		}
	} else {
		settings, err := s.kernel.RemoteAccess().Settings(ctx, p.RealmEnvironment, p.AccountID)
		if err != nil || settings.BindingID != request.ExpectedBindingId {
			return nil, denied()
		}
	}
	diagnostic, err := s.commit(ctx, p, "remote_access.set", map[string]any{"binding_id": scope.BindingID, "enabled": request.Enabled}, func() error { return s.kernel.RemoteAccess().SetEnabled(ctx, scope, request.Enabled) })
	if err != nil {
		return nil, err
	}
	s.stopRun()
	s.changed()
	state, err := s.state(ctx, p)
	if err != nil {
		return nil, err
	}
	return &runtimev1.SetRemoteAccessEnabledResponse{State: state, AuditDiagnostic: diagnostic}, nil
}

func (s *Service) pending(p protectedprincipal.Principal, bindingID, id string) (*hostRun, pendingOffer, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	run := s.run
	if run == nil || run.scope.AccountID != p.AccountID || run.scope.RealmEnvironmentID != p.RealmEnvironment || run.scope.BindingID != bindingID {
		return nil, pendingOffer{}, denied()
	}
	item, exists := run.pending[id]
	if !exists || !accountservice.PrimaryRuntimeDeadlineLive(item.deadline) {
		return nil, pendingOffer{}, unavailable()
	}
	return run, item, nil
}

func (s *Service) ConfirmRemoteSource(ctx context.Context, request *runtimev1.ConfirmRemoteSourceRequest) (*runtimev1.ConfirmRemoteSourceResponse, error) {
	p, err := s.caller(ctx, true)
	if err != nil {
		return nil, err
	}
	if request == nil {
		return nil, denied()
	}
	run, pending, err := s.pending(p, request.ExpectedBindingId, request.PendingRequestId)
	if err != nil {
		return nil, err
	}
	source := pending.offer.Context.Source
	diagnostic, err := s.commit(ctx, p, "remote_source.confirm", map[string]any{"binding_id": run.scope.BindingID, "client_id": source.ClientId, "source_revision": source.SourceRevision}, func() error {
		return s.kernel.RemoteAccess().ConfirmRegistration(ctx, run.scope, localappkernel.RegisterRemoteInput{
			AppID: source.AppId, DisplayName: source.DisplayName, RealmEnvironmentID: p.RealmEnvironment, ClientID: source.ClientId, Origin: source.Origin, RedirectURI: source.RedirectUri,
			Role: source.Role, SourceRevision: uint64(source.SourceRevision), RawDeclaration: source.AppAccess, CapabilityContractRefs: source.CapabilityContractRefs})
	})
	if err != nil {
		return nil, err
	}
	s.invalidateSource(run.scope, source.ClientId)
	s.changed()
	state, err := s.state(ctx, p)
	if err != nil {
		return nil, err
	}
	return &runtimev1.ConfirmRemoteSourceResponse{State: state, AuditDiagnostic: diagnostic}, nil
}

func (s *Service) RejectRemoteSource(ctx context.Context, request *runtimev1.RejectRemoteSourceRequest) (*runtimev1.RejectRemoteSourceResponse, error) {
	p, err := s.caller(ctx, true)
	if err != nil {
		return nil, err
	}
	if request == nil {
		return nil, denied()
	}
	run, pending, err := s.pending(p, request.ExpectedBindingId, request.PendingRequestId)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	control := run.control
	s.mu.Unlock()
	if control == nil {
		return nil, unavailable()
	}
	if err = s.account.AnswerPrimaryRuntimeConnection(ctx, control, pending.offer.ConnectionId, "", "SOURCE_NOT_ALLOWED"); err != nil {
		return nil, err
	}
	s.mu.Lock()
	delete(run.pending, pending.offer.ConnectionId)
	s.mu.Unlock()
	state, err := s.state(ctx, p)
	if err != nil {
		return nil, err
	}
	return &runtimev1.RejectRemoteSourceResponse{State: state}, nil
}

func (s *Service) SetRemoteSourcePaused(ctx context.Context, request *runtimev1.SetRemoteSourcePausedRequest) (*runtimev1.SetRemoteSourcePausedResponse, error) {
	p, err := s.caller(ctx, false)
	if err != nil {
		return nil, err
	}
	if request == nil {
		return nil, denied()
	}
	scope := localappkernel.RemoteAccessScope{RealmEnvironmentID: p.RealmEnvironment, AccountID: p.AccountID, BindingID: request.ExpectedBindingId}
	diagnostic, err := s.commit(ctx, p, "remote_source.pause", map[string]any{"binding_id": scope.BindingID, "client_id": request.ClientId, "paused": request.Paused}, func() error { return s.kernel.RemoteAccess().SetPaused(ctx, scope, request.ClientId, request.Paused) })
	if err != nil {
		return nil, err
	}
	if request.Paused {
		s.invalidateSource(scope, request.ClientId)
	}
	s.changed()
	state, err := s.state(ctx, p)
	if err != nil {
		return nil, err
	}
	return &runtimev1.SetRemoteSourcePausedResponse{State: state, AuditDiagnostic: diagnostic}, nil
}

func denied() error {
	return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
}
func unavailable() error {
	return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE)
}
