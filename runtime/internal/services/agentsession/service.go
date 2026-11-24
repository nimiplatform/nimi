// Package agentsession implements the Runtime Brain Multi-Session, Brain-Body
// symbiosis, and deterministic alarm / directed trigger delegation owner.
// @nimi-authority: rule.nimi.platform.core-protocol.agent-session-operations
// @nimi-authority: rule.nimi.runtime.agent-participation.multi-session-router
// @nimi-authority: rule.nimi.runtime.agent-participation.body-step-symbiosis
package agentsession

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/scheduler"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
)

const (
	DomainAgentLocal           = "agent.local"
	DomainAgentBodyPC          = "agent.body.pc"
	DomainAgentBodyApp         = "agent.body.app"
	DomainAgentTriggerDelegate = "agent.trigger.delegate"

	CorePCBodyAppID       = "nimi.harness"
	CorePCNamespacePrefix = "os.pc."
	DefaultPCNamespace    = "os.pc.workspace"
	DefaultHeartbeatMs    = 10_000
	LeaseTTL              = 35 * time.Second
)

type Options struct {
	Logger            *slog.Logger
	Now               func() time.Time
	Store             *Store
	DBPath            string
	LedgerSecret      []byte
	Scheduler         *scheduler.Scheduler
	EndpointResolver  func(agentBinding string) string
	BodyStepExecutor          BodyStepExecutor
	ReadSetQualifier          ReadSetQualifier
	MilestoneHook             MilestoneHook
	MemoryCleanupHook         MemoryCleanupHook
	BrainTurnExecutor         BrainTurnExecutor
	AlarmDeliverySender       AlarmDeliverySender
	AlarmLLMRunner            AlarmLLMRunner
	DailyAlarmLLMBudgetTokens int64
}

type carrierLease struct {
	AccountID           string
	DeviceID            string
	CapabilityNamespace string
	LeaseEpoch          int64
	CarrierAppID        string
	CarrierSubject      string
	InstanceID          string
	CapabilitiesJSON    string
	LastHeartbeatAt     time.Time
	Active              bool
}

type outboxSubscriber struct {
	ch chan *runtimev1.BodyOutboxEnvelope
}

type overviewSubscriber struct {
	accountID string
	decision  accountservice.LocalAppCallerDecision
	agentRef  string
	ch        chan *runtimev1.SessionOverviewDelta
}

type brainEventSubscriber struct {
	ch chan *runtimev1.BrainSessionEventEnvelope
}

type Service struct {
	runtimev1.UnimplementedAgentSessionServiceServer

	logger           *slog.Logger
	now              func() time.Time
	store            *Store
	ownsStore        bool
	tempDir          string
	ledgerSecret     []byte
	scheduler        *scheduler.Scheduler
	endpointResolver func(agentBinding string) string

	bodyStepExecutor          BodyStepExecutor
	readSetQualifier          ReadSetQualifier
	milestoneHook             MilestoneHook
	memoryCleanupHook         MemoryCleanupHook
	brainTurnExecutor         BrainTurnExecutor
	alarmDeliverySender       AlarmDeliverySender
	alarmLLMRunner            AlarmLLMRunner
	dailyAlarmLLMBudgetTokens int64

	mu                    sync.Mutex
	outboxSubscribers     map[string]map[*outboxSubscriber]struct{}
	overviewSubscribers   map[*overviewSubscriber]struct{}
	brainEventSubscribers map[string]map[*brainEventSubscriber]struct{}
	brainTurnCancels      map[string]context.CancelFunc
	overviewSeq           uint64
}

// Open initializes an AgentSessionService backed by a physically isolated
// WAL+FULL sessions.db store.
func Open(opts Options) (*Service, error) {
	now := opts.Now
	if now == nil {
		now = time.Now
	}
	store := opts.Store
	ownsStore := false
	tempDir := ""
	if store == nil {
		dbPath := strings.TrimSpace(opts.DBPath)
		if dbPath == "" {
			dir, err := os.MkdirTemp("", "nimi-agentsession-*")
			if err != nil {
				return nil, fmt.Errorf("create temp dir for sessions.db: %w", err)
			}
			tempDir = dir
			dbPath = filepath.Join(dir, "sessions.db")
		}
		opened, err := OpenStore(dbPath)
		if err != nil {
			if tempDir != "" {
				_ = os.RemoveAll(tempDir)
			}
			return nil, err
		}
		store = opened
		ownsStore = true
	}

	secret := append([]byte(nil), opts.LedgerSecret...)
	if len(secret) == 0 {
		secret = make([]byte, 32)
		if _, err := rand.Read(secret); err != nil {
			if ownsStore {
				_ = store.Close()
			}
			if tempDir != "" {
				_ = os.RemoveAll(tempDir)
			}
			return nil, fmt.Errorf("generate continuity ledger secret: %w", err)
		}
	}

	return &Service{
		logger:                opts.Logger,
		now:                   now,
		store:                 store,
		ownsStore:             ownsStore,
		tempDir:               tempDir,
		ledgerSecret:          secret,
		scheduler:             opts.Scheduler,
		endpointResolver:      opts.EndpointResolver,
		bodyStepExecutor:          opts.BodyStepExecutor,
		readSetQualifier:          opts.ReadSetQualifier,
		milestoneHook:             opts.MilestoneHook,
		memoryCleanupHook:         opts.MemoryCleanupHook,
		brainTurnExecutor:         opts.BrainTurnExecutor,
		alarmDeliverySender:       opts.AlarmDeliverySender,
		alarmLLMRunner:            opts.AlarmLLMRunner,
		dailyAlarmLLMBudgetTokens: opts.DailyAlarmLLMBudgetTokens,
		outboxSubscribers:         make(map[string]map[*outboxSubscriber]struct{}),
		overviewSubscribers:   make(map[*overviewSubscriber]struct{}),
		brainEventSubscribers: make(map[string]map[*brainEventSubscriber]struct{}),
		brainTurnCancels:      make(map[string]context.CancelFunc),
	}, nil
}

// New opens a Service with the provided options and panics if the isolated
// SQLite store cannot be initialized. Production callers should prefer Open.
func New(opts Options) *Service {
	svc, err := Open(opts)
	if err != nil {
		panic(fmt.Sprintf("agentsession.New: %v", err))
	}
	return svc
}

// Close cancels active brain turns and closes any owned sessions.db store.
func (s *Service) Close() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	cancels := make([]context.CancelFunc, 0, len(s.brainTurnCancels))
	for ref, cancel := range s.brainTurnCancels {
		cancels = append(cancels, cancel)
		delete(s.brainTurnCancels, ref)
	}
	s.mu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
	var err error
	if s.ownsStore && s.store != nil {
		err = s.store.Close()
	}
	if s.tempDir != "" {
		_ = os.RemoveAll(s.tempDir)
	}
	return err
}

func (s *Service) Store() *Store {
	return s.store
}

func (s *Service) SetBodyStepExecutor(fn BodyStepExecutor) {
	s.mu.Lock()
	s.bodyStepExecutor = fn
	s.mu.Unlock()
}

func (s *Service) SetReadSetQualifier(fn ReadSetQualifier) {
	s.mu.Lock()
	s.readSetQualifier = fn
	s.mu.Unlock()
}

func (s *Service) SetMilestoneHook(fn MilestoneHook) {
	s.mu.Lock()
	s.milestoneHook = fn
	s.mu.Unlock()
}

func (s *Service) SetMemoryCleanupHook(fn MemoryCleanupHook) {
	s.mu.Lock()
	s.memoryCleanupHook = fn
	s.mu.Unlock()
}

func (s *Service) SetBrainTurnExecutor(fn BrainTurnExecutor) {
	s.mu.Lock()
	s.brainTurnExecutor = fn
	s.mu.Unlock()
}

func (s *Service) SetEndpointResolver(fn func(agentBinding string) string) {
	s.mu.Lock()
	s.endpointResolver = fn
	s.mu.Unlock()
}

func (s *Service) SetAlarmDeliverySender(fn AlarmDeliverySender) {
	s.mu.Lock()
	s.alarmDeliverySender = fn
	s.mu.Unlock()
}

func (s *Service) SetAlarmLLMRunner(fn AlarmLLMRunner) {
	s.mu.Lock()
	s.alarmLLMRunner = fn
	s.mu.Unlock()
}

func (s *Service) SetDailyAlarmLLMBudgetTokens(limit int64) {
	s.mu.Lock()
	s.dailyAlarmLLMBudgetTokens = limit
	s.mu.Unlock()
}

// RegisterPrimaryCompanionProjection registers or refreshes Zhiyu's V1
// read-only companion session projection (is_primary_companion = 1) without
// mutating Zhiyu's existing conversation_* tables.
func (s *Service) RegisterPrimaryCompanionProjection(ctx context.Context, accountID, agentBinding, workSessionRef, title string) error {
	if err := s.store.RegisterPrimaryCompanionProjection(ctx, accountID, agentBinding, workSessionRef, title, s.now().UTC()); err != nil {
		return err
	}
	if row, err := s.store.GetSession(ctx, accountID, workSessionRef); err == nil && row != nil {
		s.notifyOverviewChange(accountID, []*runtimev1.WorkSessionRecord{row.Record}, nil)
	}
	return nil
}

func (s *Service) resolveEndpointKey(agentBinding string) string {
	s.mu.Lock()
	resolver := s.endpointResolver
	s.mu.Unlock()
	if resolver != nil {
		if key := strings.TrimSpace(resolver(agentBinding)); key != "" {
			return key
		}
	}
	trimmed := strings.TrimSpace(agentBinding)
	if trimmed == "" {
		return "local:default"
	}
	return "agent:" + trimmed
}

func (s *Service) authorize(ctx context.Context, allowedOps ...localappop.Operation) (accountservice.LocalAppCallerDecision, error) {
	decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	if !ok || decision.AuthorityClass != localappop.AuthorityClassAppAccess ||
		strings.TrimSpace(decision.AccountID) == "" ||
		strings.TrimSpace(decision.RegisteredAppSubject) == "" ||
		decision.ExpiresAt.IsZero() || !s.now().UTC().Before(decision.ExpiresAt.UTC()) || isClosed(decision.SessionInvalidated) {
		return accountservice.LocalAppCallerDecision{}, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
	}
	for _, op := range allowedOps {
		if decision.Operation == op {
			return decision, nil
		}
	}
	return accountservice.LocalAppCallerDecision{}, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
}

func isClosed(ch <-chan struct{}) bool {
	if ch == nil {
		return false
	}
	select {
	case <-ch:
		return true
	default:
		return false
	}
}

func normalizeBodyNamespace(decision accountservice.LocalAppCallerDecision, requested string) (string, error) {
	ns := strings.TrimSpace(requested)
	switch decision.OperationCapability {
	case DomainAgentBodyPC:
		// os.pc.* is strictly reserved for Runtime-verified OS-signed core PC body principal.
		if decision.AppID != CorePCBodyAppID {
			return "", grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
		}
		if ns == "" {
			ns = DefaultPCNamespace
		}
		if !strings.HasPrefix(ns, CorePCNamespacePrefix) || len(ns) > 128 {
			return "", grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
		}
		return ns, nil
	case DomainAgentBodyApp:
		expectedPrefix := "app." + decision.AppID + "."
		if decision.AppID == "" || !strings.HasPrefix(ns, expectedPrefix) || len(ns) <= len(expectedPrefix) || len(ns) > 128 {
			return "", grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
		}
		return ns, nil
	default:
		return "", grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
	}
}

func leaseMapKey(accountID, deviceID, namespace string) string {
	return accountID + "\x00" + deviceID + "\x00" + namespace
}

// RegisterBodyCarrier binds a verified Body carrier lease and returns any
// pending tombstones (PURGE/INVALIDATE) that must be drained and ACKed before
// reconciliation, followed by pending NEW_INTENT items.
func (s *Service) RegisterBodyCarrier(ctx context.Context, req *runtimev1.RegisterBodyCarrierRequest) (*runtimev1.RegisterBodyCarrierResponse, error) {
	decision, err := s.authorize(ctx, localappop.OperationAgentBodyPCRegister, localappop.OperationAgentBodyAppRegister)
	if err != nil {
		return nil, err
	}
	if req == nil || strings.TrimSpace(req.GetDeviceId()) == "" || strings.TrimSpace(req.GetInstanceId()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	ns, err := normalizeBodyNamespace(decision, req.GetCapabilityNamespace())
	if err != nil {
		return nil, err
	}
	deviceID := strings.TrimSpace(req.GetDeviceId())
	instanceID := strings.TrimSpace(req.GetInstanceId())
	now := s.now().UTC()

	nextEpoch, tombstones, intents, err := s.store.RegisterLease(ctx, &carrierLease{
		AccountID:           decision.AccountID,
		DeviceID:            deviceID,
		CapabilityNamespace: ns,
		CarrierAppID:        decision.AppID,
		CarrierSubject:      decision.RegisteredAppSubject,
		InstanceID:          instanceID,
		CapabilitiesJSON:    req.GetCapabilitiesJson(),
		LastHeartbeatAt:     now,
		Active:              true,
	})
	if errors.Is(err, errLeaseConflict) {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AGENT_BODY_LEASE_CONFLICT)
	}
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}

	s.notifyOverviewChange(decision.AccountID, nil, nil)
	return &runtimev1.RegisterBodyCarrierResponse{
		LeaseEpoch:          nextEpoch,
		CapabilityNamespace: ns,
		PendingTombstones:   tombstones,
		PendingIntents:      intents,
		HeartbeatIntervalMs: DefaultHeartbeatMs,
	}, nil
}

// HeartbeatBodyCarrier renews active carrier liveness purely in memory (zero SQLite disk writes).
func (s *Service) HeartbeatBodyCarrier(ctx context.Context, req *runtimev1.HeartbeatBodyCarrierRequest) (*runtimev1.HeartbeatBodyCarrierResponse, error) {
	decision, err := s.authorize(ctx, localappop.OperationAgentBodyPCHeartbeat, localappop.OperationAgentBodyAppHeartbeat)
	if err != nil {
		return nil, err
	}
	if req == nil || strings.TrimSpace(req.GetDeviceId()) == "" || req.GetLeaseEpoch() <= 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	ns, err := normalizeBodyNamespace(decision, req.GetCapabilityNamespace())
	if err != nil {
		return nil, err
	}
	alive, err := s.store.HeartbeatLease(ctx, decision.AccountID, strings.TrimSpace(req.GetDeviceId()), ns, decision.RegisteredAppSubject, req.GetLeaseEpoch(), s.now().UTC())
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	if !alive {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_BODY_LEASE_CONFLICT)
	}
	return &runtimev1.HeartbeatBodyCarrierResponse{
		Alive:           true,
		LeaseEpoch:      req.GetLeaseEpoch(),
		NextHeartbeatMs: DefaultHeartbeatMs,
	}, nil
}

func (s *Service) UnregisterBodyCarrier(ctx context.Context, req *runtimev1.UnregisterBodyCarrierRequest) (*runtimev1.UnregisterBodyCarrierResponse, error) {
	decision, err := s.authorize(ctx, localappop.OperationAgentBodyPCUnregister, localappop.OperationAgentBodyAppUnregister)
	if err != nil {
		return nil, err
	}
	if req == nil || strings.TrimSpace(req.GetDeviceId()) == "" || req.GetLeaseEpoch() <= 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	ns, err := normalizeBodyNamespace(decision, req.GetCapabilityNamespace())
	if err != nil {
		return nil, err
	}
	unregistered, err := s.store.UnregisterLease(ctx, decision.AccountID, strings.TrimSpace(req.GetDeviceId()), ns, decision.RegisteredAppSubject, req.GetLeaseEpoch())
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	if unregistered {
		s.notifyOverviewChange(decision.AccountID, nil, nil)
	}
	return &runtimev1.UnregisterBodyCarrierResponse{Unregistered: unregistered}, nil
}

func (s *Service) SubscribeBodyOutbox(req *runtimev1.SubscribeBodyOutboxRequest, stream grpc.ServerStreamingServer[runtimev1.BodyOutboxEnvelope]) error {
	ctx := stream.Context()
	decision, err := s.authorize(ctx, localappop.OperationAgentBodyPCOutboxSubscribe, localappop.OperationAgentBodyAppOutboxSubscribe)
	if err != nil {
		return err
	}
	if req == nil || strings.TrimSpace(req.GetDeviceId()) == "" || req.GetLeaseEpoch() <= 0 {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	ns, err := normalizeBodyNamespace(decision, req.GetCapabilityNamespace())
	if err != nil {
		return err
	}
	deviceID := strings.TrimSpace(req.GetDeviceId())
	active, err := s.store.VerifyActiveLease(ctx, decision.AccountID, deviceID, ns, decision.RegisteredAppSubject, req.GetLeaseEpoch(), s.now().UTC())
	if err != nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	if !active {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_BODY_LEASE_CONFLICT)
	}

	key := leaseMapKey(decision.AccountID, deviceID, ns)
	sub := &outboxSubscriber{ch: make(chan *runtimev1.BodyOutboxEnvelope, 64)}
	s.mu.Lock()
	if s.outboxSubscribers[key] == nil {
		s.outboxSubscribers[key] = make(map[*outboxSubscriber]struct{})
	}
	s.outboxSubscribers[key][sub] = struct{}{}
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		delete(s.outboxSubscribers[key], sub)
		if len(s.outboxSubscribers[key]) == 0 {
			delete(s.outboxSubscribers, key)
		}
		s.mu.Unlock()
	}()

	// Always drain pending tombstones BEFORE pending intents.
	tombstones, intents, err := s.store.ListPendingOutbox(ctx, decision.AccountID, deviceID, ns)
	if err != nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	seenIDs := make(map[string]struct{}, len(tombstones)+len(intents))
	for _, env := range tombstones {
		seenIDs[env.GetOutboxId()] = struct{}{}
		if err := stream.Send(env); err != nil {
			return err
		}
	}
	for _, env := range intents {
		seenIDs[env.GetOutboxId()] = struct{}{}
		if err := stream.Send(env); err != nil {
			return err
		}
	}

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-decision.SessionInvalidated:
			return grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
		case env, ok := <-sub.ch:
			if !ok {
				return nil
			}
			if _, dup := seenIDs[env.GetOutboxId()]; dup {
				continue
			}
			seenIDs[env.GetOutboxId()] = struct{}{}
			if err := stream.Send(env); err != nil {
				return err
			}
		}
	}
}

func (s *Service) AckBodyOutbox(ctx context.Context, req *runtimev1.AckBodyOutboxRequest) (*runtimev1.AckBodyOutboxResponse, error) {
	decision, err := s.authorize(ctx, localappop.OperationAgentBodyPCOutboxAck, localappop.OperationAgentBodyAppOutboxAck)
	if err != nil {
		return nil, err
	}
	if req == nil || strings.TrimSpace(req.GetOutboxId()) == "" || strings.TrimSpace(req.GetDeviceId()) == "" || req.GetLeaseEpoch() <= 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	ns, err := normalizeBodyNamespace(decision, req.GetCapabilityNamespace())
	if err != nil {
		return nil, err
	}
	active, err := s.store.VerifyActiveLease(ctx, decision.AccountID, strings.TrimSpace(req.GetDeviceId()), ns, decision.RegisteredAppSubject, req.GetLeaseEpoch(), s.now().UTC())
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	if !active {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_BODY_LEASE_CONFLICT)
	}
	outboxID := strings.TrimSpace(req.GetOutboxId())
	resultState := strings.TrimSpace(req.GetResultState())
	if resultState == "" {
		resultState = "acked"
	}
	acked, err := s.store.AckOutbox(ctx, decision.AccountID, outboxID, resultState, s.now().UTC())
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	return &runtimev1.AckBodyOutboxResponse{Acked: acked, OutboxId: outboxID}, nil
}

// EnqueueBodyOutbox persists an outbox command in runtime_body_outbox and notifies active subscribers.
func (s *Service) EnqueueBodyOutbox(accountID, deviceID, capabilityNamespace string, env *runtimev1.BodyOutboxEnvelope) {
	if env == nil {
		return
	}
	if strings.TrimSpace(env.OutboxId) == "" {
		env.OutboxId = newID("outbox")
	}
	if strings.TrimSpace(env.DeviceId) == "" {
		env.DeviceId = strings.TrimSpace(deviceID)
	}
	if strings.TrimSpace(env.CapabilityNamespace) == "" {
		env.CapabilityNamespace = strings.TrimSpace(capabilityNamespace)
	}
	if strings.TrimSpace(env.CreatedAt) == "" {
		env.CreatedAt = formatRFC3339(s.now().UTC())
	}
	_ = s.store.EnqueueOutbox(context.Background(), accountID, env, sha256HexString(env.GetPayloadJson()))
	s.notifyOutboxSubscribers(accountID, env.GetDeviceId(), env.GetCapabilityNamespace(), env)
}

func (s *Service) notifyOutboxSubscribers(accountID, deviceID, capabilityNamespace string, env *runtimev1.BodyOutboxEnvelope) {
	if env == nil {
		return
	}
	dev := strings.TrimSpace(deviceID)
	ns := strings.TrimSpace(capabilityNamespace)
	exactKey := leaseMapKey(accountID, dev, ns)
	prefix := accountID + "\x00"
	suffix := "\x00" + ns

	s.mu.Lock()
	var subs []*outboxSubscriber
	if dev == "" || dev == "local-default" {
		for k, set := range s.outboxSubscribers {
			if strings.HasPrefix(k, prefix) && strings.HasSuffix(k, suffix) {
				for sub := range set {
					subs = append(subs, sub)
				}
			}
		}
	} else {
		for sub := range s.outboxSubscribers[exactKey] {
			subs = append(subs, sub)
		}
	}
	s.mu.Unlock()

	for _, sub := range subs {
		select {
		case sub.ch <- env:
		default:
		}
	}
}

func (s *Service) notifyOverviewChange(accountID string, upserted []*runtimev1.WorkSessionRecord, removedRefs []string) {
	_, carrierOnline, _ := s.store.FindActiveCarrierDevice(context.Background(), accountID, DefaultPCNamespace, s.now().UTC())
	allAtt, _ := s.store.ListPendingAttention(context.Background(), accountID)

	s.mu.Lock()
	s.overviewSeq++
	seq := s.overviewSeq
	subs := make([]*overviewSubscriber, 0, len(s.overviewSubscribers))
	for sub := range s.overviewSubscribers {
		if sub.accountID == accountID {
			subs = append(subs, sub)
		}
	}
	s.mu.Unlock()

	for _, sub := range subs {
		var visibleSessions []*runtimev1.WorkSessionRecord
		for _, rec := range upserted {
			if sub.agentRef != "" && rec.GetAgentBinding() != sub.agentRef {
				continue
			}
			if readerCanAccessSession(sub.decision, rec) {
				visibleSessions = append(visibleSessions, rec)
			}
		}
		var visibleAtt []*runtimev1.PendingAttentionRecord
		for _, att := range allAtt {
			if readerCanAccessAttention(sub.decision, att) {
				visibleAtt = append(visibleAtt, att)
			}
		}
		delta := &runtimev1.SessionOverviewDelta{
			OverviewSeq:             seq,
			FullBaseline:            false,
			UpsertedSessions:        visibleSessions,
			RemovedWorkSessionRefs:  removedRefs,
			AttentionItems:          visibleAtt,
			CarrierOnline:           carrierOnline,
		}
		select {
		case sub.ch <- delta:
		default:
		}
	}
}

func (s *Service) notifyBrainEventSubscribers(env *runtimev1.BrainSessionEventEnvelope) {
	if env == nil {
		return
	}
	ref := strings.TrimSpace(env.GetWorkSessionRef())
	s.mu.Lock()
	subs := make([]*brainEventSubscriber, 0, len(s.brainEventSubscribers[ref]))
	for sub := range s.brainEventSubscribers[ref] {
		subs = append(subs, sub)
	}
	s.mu.Unlock()
	for _, sub := range subs {
		select {
		case sub.ch <- env:
		default:
		}
	}
}

func (s *Service) maybeStartBrainTurn(accountID string, session *runtimev1.WorkSessionRecord, userText, requestID string) {
	s.mu.Lock()
	executor := s.brainTurnExecutor
	s.mu.Unlock()
	if executor == nil || session == nil {
		return
	}
	ref := session.GetWorkSessionRef()
	ctx, cancel := context.WithCancel(context.Background())

	s.mu.Lock()
	if prev, ok := s.brainTurnCancels[ref]; ok {
		prev()
	}
	s.brainTurnCancels[ref] = cancel
	s.mu.Unlock()

	go func() {
		defer func() {
			cancel()
			s.mu.Lock()
			if current, ok := s.brainTurnCancels[ref]; ok && fmt.Sprintf("%p", current) == fmt.Sprintf("%p", cancel) {
				delete(s.brainTurnCancels, ref)
			}
			s.mu.Unlock()
		}()
		_ = executor(ctx, accountID, session, userText, requestID, func(eventType, payloadJSON string) error {
			env, err := s.store.AppendBrainEvent(ctx, accountID, ref, eventType, payloadJSON, s.now().UTC())
			if err != nil {
				return err
			}
			s.notifyBrainEventSubscribers(env)
			return nil
		})
	}()
}

func (s *Service) cancelBrainTurn(workSessionRef string) bool {
	s.mu.Lock()
	cancel, ok := s.brainTurnCancels[workSessionRef]
	if ok {
		delete(s.brainTurnCancels, workSessionRef)
	}
	s.mu.Unlock()
	if ok && cancel != nil {
		cancel()
		return true
	}
	return false
}
