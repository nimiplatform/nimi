// Package agentsession implements the Runtime Brain Multi-Session, Brain-Body
// symbiosis, and deterministic alarm / directed trigger delegation owner.
// @nimi-authority: rule.nimi.platform.core-protocol.agent-session-operations
// @nimi-authority: rule.nimi.runtime.agent-participation.multi-session-router
// @nimi-authority: rule.nimi.runtime.agent-participation.body-step-symbiosis
package agentsession

import (
	"context"
	"errors"
	"fmt"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
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
	DomainAgentSessionManage   = "agent.session.manage"
	DomainAgentCompanion       = "agent.companion"
	DomainAgentBodyPC          = "agent.body.pc"
	DomainAgentBodyApp         = "agent.body.app"
	DomainAgentTriggerDelegate = "agent.trigger.delegate"

	CorePCNamespacePrefix = "os.pc."
	DefaultPCNamespace    = "os.pc.workspace"
	DefaultHeartbeatMs    = 10_000
	LeaseTTL              = 35 * time.Second
)

type AgentHandleResolver func(ctx context.Context, decision accountservice.LocalAppCallerDecision, agentHandle string) (string, error)

type MemoryQualifier func(context.Context, string, cognitionmemory.MemoryReadSet) (map[string]bool, error)

type Options struct {
	QualifyMemory             MemoryQualifier
	BodyNamespaceOwner        func(context.Context, string) (string, error)
	Logger                    *slog.Logger
	Now                       func() time.Time
	Store                     *Store
	DBPath                    string
	RequirePersistentDB       bool
	LedgerSecret              []byte
	Scheduler                 *scheduler.Scheduler
	EndpointResolver          func(agentBinding string) string
	AgentHandleResolver       AgentHandleResolver
	BodyStepExecutor          BodyStepExecutor
	ReadSetQualifier          ReadSetQualifier
	MilestoneHook             MilestoneHook
	MemoryCleanupHook         MemoryCleanupHook
	BrainTurnExecutor         BrainTurnExecutor
	AlarmDeliverySender       AlarmDeliverySender
	SupportedDeliveryChannel  func(channel string) bool
	AlarmLLMRunner            AlarmLLMRunner
	DailyAlarmLLMBudgetTokens int64
	AgentTerminatedChecker    func(accountID, agentBinding string) bool
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
	leaseEpoch int64
	wakeup     chan struct{}
	closed     chan struct{}
	closeOnce  sync.Once
}

func (sub *outboxSubscriber) close() {
	sub.closeOnce.Do(func() {
		close(sub.closed)
	})
}

type overviewSubscriber struct {
	includeArchived bool
	overflow        chan struct{}
	accountID       string
	decision        accountservice.LocalAppCallerDecision
	agentRef        string
	seq             uint64
	ch              chan *runtimev1.SessionOverviewDelta
}

type brainEventSubscriber struct {
	catchUp chan struct{}
	events  chan brainEventNotice
}

type brainEventNotice struct {
	event *runtimev1.BrainSessionEventEnvelope
	// A live fragment belongs to the durable user event that started its turn.
	turnSeq int64
}

type Service struct {
	qualifyMemory      MemoryQualifier
	stepCancels        map[uint64]context.CancelFunc
	stepSeq            uint64
	stepWG             sync.WaitGroup
	bodyNamespaceOwner func(context.Context, string) (string, error)
	runtimev1.UnimplementedAgentSessionServiceServer

	logger              *slog.Logger
	now                 func() time.Time
	store               *Store
	ownsStore           bool
	tempDir             string
	ledgerSecret        []byte
	scheduler           *scheduler.Scheduler
	endpointResolver    func(agentBinding string) string
	agentHandleResolver AgentHandleResolver

	bodyStepExecutor          BodyStepExecutor
	readSetQualifier          ReadSetQualifier
	milestoneMu               sync.Mutex
	milestoneHook             MilestoneHook
	memoryCleanupHook         MemoryCleanupHook
	brainTurnExecutor         BrainTurnExecutor
	alarmDeliverySender       AlarmDeliverySender
	supportedDeliveryChannel  func(channel string) bool
	alarmLLMRunner            AlarmLLMRunner
	dailyAlarmLLMBudgetTokens int64
	agentTerminatedChecker    func(accountID, agentBinding string) bool

	mu                    sync.Mutex
	closed                bool
	outboxSubscribers     map[string]map[*outboxSubscriber]struct{}
	overviewSubscribers   map[*overviewSubscriber]struct{}
	brainEventSubscribers map[string]map[*brainEventSubscriber]struct{}
	brainTurnCancels      map[string]brainTurnCancelEntry
	brainTurnSeq          uint64
	brainTurnsWg          sync.WaitGroup
	sessionStepLocks      map[string]*sessionLock
	alarmTickerParent     context.Context
	alarmTickerInterval   time.Duration
	alarmTickerCancel     context.CancelFunc
	alarmTickerDone       chan struct{}
	overviewMu            sync.Mutex
}

type brainTurnCancelEntry struct {
	id      uint64
	turnRef string
	cancel  context.CancelFunc
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
			if opts.RequirePersistentDB {
				return nil, fmt.Errorf("sessions.db persistent DBPath is required")
			}
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
		loaded, err := store.LoadOrCreateLedgerSecret(context.Background())
		if err != nil {
			if ownsStore {
				_ = store.Close()
			}
			if tempDir != "" {
				_ = os.RemoveAll(tempDir)
			}
			return nil, fmt.Errorf("load or persist continuity ledger secret: %w", err)
		}
		secret = loaded
	}

	return &Service{
		logger:                    opts.Logger,
		now:                       now,
		store:                     store,
		ownsStore:                 ownsStore,
		tempDir:                   tempDir,
		ledgerSecret:              secret,
		scheduler:                 opts.Scheduler,
		endpointResolver:          opts.EndpointResolver,
		agentHandleResolver:       opts.AgentHandleResolver,
		bodyStepExecutor:          opts.BodyStepExecutor,
		readSetQualifier:          opts.ReadSetQualifier,
		qualifyMemory:             opts.QualifyMemory,
		milestoneHook:             opts.MilestoneHook,
		memoryCleanupHook:         opts.MemoryCleanupHook,
		brainTurnExecutor:         opts.BrainTurnExecutor,
		alarmDeliverySender:       opts.AlarmDeliverySender,
		supportedDeliveryChannel:  opts.SupportedDeliveryChannel,
		bodyNamespaceOwner:        opts.BodyNamespaceOwner,
		alarmLLMRunner:            opts.AlarmLLMRunner,
		dailyAlarmLLMBudgetTokens: opts.DailyAlarmLLMBudgetTokens,
		agentTerminatedChecker:    opts.AgentTerminatedChecker,
		outboxSubscribers:         make(map[string]map[*outboxSubscriber]struct{}),
		overviewSubscribers:       make(map[*overviewSubscriber]struct{}),
		brainEventSubscribers:     make(map[string]map[*brainEventSubscriber]struct{}),
		brainTurnCancels:          make(map[string]brainTurnCancelEntry),
		sessionStepLocks:          make(map[string]*sessionLock),
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

// Quiesce marks the service closed to new background brain turns, stops the
// alarm/recovery ticker, and waits for in-flight brain turns to finish.
func (s *Service) Quiesce() {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.closed = true
	alarmCancel := s.alarmTickerCancel
	alarmDone := s.alarmTickerDone
	s.alarmTickerCancel = nil
	for _, cancel := range s.stepCancels {
		cancel()
	}
	cancels := make([]context.CancelFunc, 0, len(s.brainTurnCancels))
	for ref, entry := range s.brainTurnCancels {
		cancels = append(cancels, entry.cancel)
		delete(s.brainTurnCancels, ref)
	}
	s.mu.Unlock()
	if alarmCancel != nil {
		alarmCancel()
	}
	for _, cancel := range cancels {
		cancel()
	}
	if alarmDone != nil {
		<-alarmDone
	}
	s.brainTurnsWg.Wait()
	s.stepWG.Wait()
}

// Close cancels active brain turns and closes any owned sessions.db store.
func (s *Service) Close() error {
	if s == nil {
		return nil
	}
	s.Quiesce()
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

func (s *Service) SetAgentHandleResolver(fn AgentHandleResolver) {
	s.mu.Lock()
	s.agentHandleResolver = fn
	s.mu.Unlock()
}

// StartAlarmTicker launches a cancelable background loop calling TickAlarms
// on startup and on every interval tick until ctx or Service.Close cancels it.
func (s *Service) StartAlarmTicker(parent context.Context, interval time.Duration) {
	if s == nil {
		return
	}
	if parent == nil {
		parent = context.Background()
	}
	if interval <= 0 {
		interval = 15 * time.Second
	}
	ctx, cancel := context.WithCancel(parent)
	done := make(chan struct{})
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		cancel()
		return
	}
	prevCancel := s.alarmTickerCancel
	prevDone := s.alarmTickerDone
	s.alarmTickerParent = parent
	s.alarmTickerInterval = interval
	s.alarmTickerCancel = cancel
	s.alarmTickerDone = done
	s.mu.Unlock()
	if prevCancel != nil {
		prevCancel()
	}
	if prevDone != nil {
		<-prevDone
	}

	go func() {
		defer close(done)
		// Run immediate startup recovery for interrupted deletes/purges and wake-merge alarm sweep.
		_ = s.RecoverPendingDeletions(ctx)
		_ = s.RecoverPendingAgentPurges(ctx)
		_ = s.deliverMilestones(ctx, "")
		_, _ = s.TickAlarms(ctx, s.now().UTC())
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				_ = s.RecoverPendingDeletions(ctx)
				_ = s.RecoverPendingAgentPurges(ctx)
				_ = s.deliverMilestones(ctx, "")
				_, _ = s.TickAlarms(ctx, s.now().UTC())
			}
		}
	}()
}

// QuiesceDataRootContext stops the background alarm loop, cancels in-flight
// brain turns, and flushes sessions.db WAL before Product Control switches roots.
func (s *Service) QuiesceDataRootContext(ctx context.Context) error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	s.closed = true
	alarmCancel := s.alarmTickerCancel
	alarmDone := s.alarmTickerDone
	s.alarmTickerCancel = nil
	for _, cancel := range s.stepCancels {
		cancel()
	}
	cancels := make([]context.CancelFunc, 0, len(s.brainTurnCancels))
	for ref, entry := range s.brainTurnCancels {
		if entry.cancel != nil {
			cancels = append(cancels, entry.cancel)
		}
		delete(s.brainTurnCancels, ref)
	}
	s.mu.Unlock()
	if alarmCancel != nil {
		alarmCancel()
	}
	for _, cancel := range cancels {
		cancel()
	}
	if alarmDone != nil {
		select {
		case <-alarmDone:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	turnsDone := make(chan struct{})
	go func() {
		s.brainTurnsWg.Wait()
		s.stepWG.Wait()
		close(turnsDone)
	}()
	select {
	case <-turnsDone:
	case <-ctx.Done():
		return ctx.Err()
	}
	if s.store != nil {
		return s.store.FlushWAL(ctx)
	}
	return nil
}

// ResumeDataRootAfterAbort restarts the alarm ticker if Product Control aborts
// a data-root handoff.
func (s *Service) ResumeDataRootAfterAbort() {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.closed = false
	parent := s.alarmTickerParent
	interval := s.alarmTickerInterval
	active := s.alarmTickerCancel != nil
	s.mu.Unlock()
	if !active && parent != nil && parent.Err() == nil && interval > 0 {
		s.StartAlarmTicker(parent, interval)
	}
}

func buildDesktopAlarmAttention(alarm *runtimev1.SessionAlarmRecord, renderedTitle, renderedBody string, now time.Time) *runtimev1.PendingAttentionRecord {
	occ := strings.TrimSpace(alarm.GetNextFireAt())
	if occ == "" {
		occ = formatRFC3339(now.UTC().Truncate(time.Second))
	}
	// Deterministic idempotency key per (alarm_id, scheduled_occurrence) prevents
	// duplicate desktop notifications across crashes or claim-lease retries.
	attentionID := fmt.Sprintf("alarm_%s_%s", alarm.GetAlarmId(), occ)
	summaryJSON, _ := jsonMarshalNoEscape(map[string]any{
		"alarmId":   alarm.GetAlarmId(),
		"title":     renderedTitle,
		"body":      renderedBody,
		"alarmKind": int32(alarm.GetAlarmKind()),
	})
	trustScope := strings.TrimSpace(alarm.GetSourcePublisher())
	if trustScope == "" {
		trustScope = "account:session_manage"
	}
	return &runtimev1.PendingAttentionRecord{
		AttentionId:    attentionID,
		WorkSessionRef: alarm.GetTargetWorkSessionRef(),
		AgentBinding:   alarm.GetAgentBinding(),
		AttentionKind:  "alarm_reminder",
		TrustScope:     trustScope,
		SummaryJson:    summaryJSON,
		ExpiresAt:      formatRFC3339(now.Add(24 * time.Hour)),
		UpdatedAt:      formatRFC3339(now),
	}
}

// NotifyDesktopAlarm prepares the Home attention item. TickAlarms commits it with its
// receipt only while the occurrence's claim version is still current.
func (s *Service) NotifyDesktopAlarm(alarm *runtimev1.SessionAlarmRecord, title, body string) AlarmDeliveryOutcome {
	if s == nil || s.store == nil || alarm == nil {
		return AlarmDeliveryOutcome{ReceiptState: runtimev1.AlarmDeliveryReceiptState_ALARM_DELIVERY_RECEIPT_STATE_REJECTED, Detail: "desktop alarm notification unavailable"}
	}
	att := buildDesktopAlarmAttention(alarm, title, body, s.now().UTC())
	return AlarmDeliveryOutcome{
		ReceiptState:       runtimev1.AlarmDeliveryReceiptState_ALARM_DELIVERY_RECEIPT_STATE_PROVIDER_ACCEPTED,
		ProviderMessageRef: "desktop-attention:" + att.GetAttentionId(),
		desktopAttention:   att,
	}
}

// EnqueueAndPurgeAgent durably records a pending agent purge BEFORE cascading
// into sessions.db so a transient failure or crash always converges on restart.
func (s *Service) EnqueueAndPurgeAgent(ctx context.Context, accountID, agentBinding string) error {
	if s == nil || s.store == nil || strings.TrimSpace(accountID) == "" || strings.TrimSpace(agentBinding) == "" {
		return nil
	}
	acct := strings.TrimSpace(accountID)
	agent := strings.TrimSpace(agentBinding)
	if err := s.store.EnqueuePendingAgentPurge(ctx, acct, agent, s.now().UTC()); err != nil {
		return err
	}
	if err := s.PurgeAgent(ctx, acct, agent); err != nil {
		return err
	}
	return s.store.DeletePendingAgentPurge(ctx, acct, agent)
}

// RecoverPendingDeletions finishes any sessions left in durable 'deleting' state
// across crashes or transient Cognition errors so memory cutoffs, lineage forgets,
// and PURGE_SESSION tombstones always converge.
func (s *Service) RecoverPendingDeletions(ctx context.Context) error {
	if s == nil || s.store == nil {
		return nil
	}
	deleting, err := s.store.ListDeletingSessions(ctx)
	if err != nil {
		return err
	}
	var firstErr error
	for _, row := range deleting {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if _, _, _, compErr := s.completeSessionDeletion(ctx, row.AccountID, row); compErr != nil && firstErr == nil {
			firstErr = compErr
		}
	}
	return firstErr
}

// RecoverPendingAgentPurges replays durable pending agent purges AND reconciles
// any active sessions/alarms whose LocalAgent is already terminated (closing the
// startup hook-ordering window).
func (s *Service) RecoverPendingAgentPurges(ctx context.Context) error {
	if s == nil || s.store == nil {
		return nil
	}
	pending, err := s.store.ListPendingAgentPurges(ctx)
	if err != nil {
		return err
	}
	var firstErr error
	for _, item := range pending {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := s.PurgeAgent(ctx, item.AccountID, item.AgentBinding); err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		_ = s.store.DeletePendingAgentPurge(ctx, item.AccountID, item.AgentBinding)
	}
	s.mu.Lock()
	checker := s.agentTerminatedChecker
	s.mu.Unlock()
	if checker != nil {
		active, listErr := s.store.ListDistinctActiveAgentBindings(ctx)
		if listErr == nil {
			for _, item := range active {
				if ctx.Err() != nil {
					return ctx.Err()
				}
				if checker(item.AccountID, item.AgentBinding) {
					if err := s.EnqueueAndPurgeAgent(ctx, item.AccountID, item.AgentBinding); err != nil && firstErr == nil {
						firstErr = err
					}
				}
			}
		}
	}
	return firstErr
}

// PurgeAgent cascades LocalAgent termination into sessions.db: cancels active
// brain turns, marks all agent sessions deleted, cancels all agent alarms,
// neutralizes pending NEW_INTENTs, and enqueues PURGE_AGENT tombstones.
func (s *Service) PurgeAgent(ctx context.Context, accountID, agentBinding string) error {
	if s == nil || s.store == nil || strings.TrimSpace(accountID) == "" || strings.TrimSpace(agentBinding) == "" {
		return nil
	}
	deletedMetas, purgeEnvs, err := s.store.PurgeAgentSessionsAndAlarms(ctx, strings.TrimSpace(accountID), strings.TrimSpace(agentBinding), s.now().UTC())
	if err != nil {
		return err
	}
	for _, meta := range deletedMetas {
		s.cancelBrainTurn(meta.WorkSessionRef)
	}
	for _, env := range purgeEnvs {
		s.notifyOutboxSubscribers(accountID, env.GetDeviceId(), env.GetCapabilityNamespace(), env)
	}
	if len(deletedMetas) > 0 {
		removedRecords := make([]*runtimev1.WorkSessionRecord, 0, len(deletedMetas))
		for _, meta := range deletedMetas {
			removedRecords = append(removedRecords, &runtimev1.WorkSessionRecord{
				WorkSessionRef:    meta.WorkSessionRef,
				AgentBinding:      agentBinding,
				SessionKind:       meta.SessionKind,
				PublisherScopeKey: meta.PublisherScopeKey,
			})
		}
		s.notifyOverviewChange(accountID, nil, removedRecords)
	}
	return nil
}

type sessionLock struct {
	gate  chan struct{}
	users int
}

// Retain the same gate until both the holder and all queued callers have left.
func (s *Service) lockSessionStepContext(ctx context.Context, key string) (func(), error) {
	s.mu.Lock()
	if s.sessionStepLocks == nil {
		s.sessionStepLocks = make(map[string]*sessionLock)
	}
	lock := s.sessionStepLocks[key]
	if lock == nil {
		lock = &sessionLock{gate: make(chan struct{}, 1)}
		s.sessionStepLocks[key] = lock
	}
	lock.users++
	s.mu.Unlock()
	drop := func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		lock.users--
		if lock.users == 0 {
			delete(s.sessionStepLocks, key)
		}
	}
	select {
	case lock.gate <- struct{}{}:
		return func() { <-lock.gate; drop() }, nil
	case <-ctx.Done():
		drop()
		return nil, ctx.Err()
	}
}

func (s *Service) resolveAgentBinding(ctx context.Context, decision accountservice.LocalAppCallerDecision, rawHandle string) (string, error) {
	trimmed := strings.TrimSpace(rawHandle)
	if trimmed == "" {
		return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	s.mu.Lock()
	resolver := s.agentHandleResolver
	s.mu.Unlock()
	if resolver != nil {
		resolved, err := resolver(ctx, decision, trimmed)
		if err != nil {
			return "", err
		}
		if strings.TrimSpace(resolved) == "" {
			return "", grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
		}
		return strings.TrimSpace(resolved), nil
	}
	return trimmed, nil
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

func hasSessionManage(decision accountservice.LocalAppCallerDecision) bool {
	return decision.HasActivatedDomain(DomainAgentSessionManage)
}

func hasCompanionScope(decision accountservice.LocalAppCallerDecision) bool {
	return decision.HasActivatedDomain(DomainAgentCompanion)
}

func subjectScopeKey(decision accountservice.LocalAppCallerDecision) string {
	sub := strings.TrimSpace(decision.RegisteredAppSubject)
	if sub == "" {
		return ""
	}
	return "subject:" + sub
}

func (s *Service) normalizeBodyNamespace(ctx context.Context, decision accountservice.LocalAppCallerDecision, requested string) (string, error) {
	ns := strings.TrimSpace(requested)
	switch decision.OperationCapability {
	case DomainAgentBodyPC:
		// Zero-privilege capability admission: ANY local formal App that activated
		// agent.body.pc may bind os.pc.* under single-active-subject lease fencing.
		// Remote sessions never activate agent.body.pc.
		if !decision.HasActivatedDomain(DomainAgentBodyPC) {
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
		return s.appBodyNamespace(ctx, decision, ns)
	default:
		return "", grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
	}
}

func (s *Service) appBodyNamespace(ctx context.Context, decision accountservice.LocalAppCallerDecision, ns string) (string, error) {
	if !decision.HasActivatedDomain(DomainAgentBodyApp) {
		return "", grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
	}
	if s.bodyNamespaceOwner != nil {
		owner, err := s.bodyNamespaceOwner(ctx, ns)
		if err != nil || owner != decision.AppID {
			return "", grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
		}
	} else if i := strings.LastIndexByte(ns, '.'); i < 0 || ns[:i] != "app."+decision.AppID {
		return "", grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
	}
	expectedPrefix := "app." + decision.AppID + "."
	if decision.AppID == "" || !strings.HasPrefix(ns, expectedPrefix) || len(ns) <= len(expectedPrefix) || len(ns) > 128 {
		return "", grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
	}
	return ns, nil
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
	ns, err := s.normalizeBodyNamespace(ctx, decision, req.GetCapabilityNamespace())
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

	// Close any superseded outbox streams bound to an older lease_epoch on this carrier.
	s.evictSupersededOutboxSubscribers(decision.AccountID, deviceID, ns, nextEpoch)
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
	ns, err := s.normalizeBodyNamespace(ctx, decision, req.GetCapabilityNamespace())
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
	ns, err := s.normalizeBodyNamespace(ctx, decision, req.GetCapabilityNamespace())
	if err != nil {
		return nil, err
	}
	unregistered, err := s.store.UnregisterLease(ctx, decision.AccountID, strings.TrimSpace(req.GetDeviceId()), ns, decision.RegisteredAppSubject, req.GetLeaseEpoch())
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	if unregistered {
		s.evictSupersededOutboxSubscribers(decision.AccountID, strings.TrimSpace(req.GetDeviceId()), ns, req.GetLeaseEpoch()+1)
		s.notifyOverviewChange(decision.AccountID, nil, nil)
	}
	return &runtimev1.UnregisterBodyCarrierResponse{Unregistered: unregistered}, nil
}

func (s *Service) evictSupersededOutboxSubscribers(accountID, deviceID, ns string, newEpoch int64) {
	key := leaseMapKey(accountID, deviceID, ns)
	s.mu.Lock()
	var stale []*outboxSubscriber
	for sub := range s.outboxSubscribers[key] {
		if sub.leaseEpoch < newEpoch {
			stale = append(stale, sub)
			delete(s.outboxSubscribers[key], sub)
		}
	}
	if len(s.outboxSubscribers[key]) == 0 {
		delete(s.outboxSubscribers, key)
	}
	s.mu.Unlock()
	for _, sub := range stale {
		sub.close()
	}
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
	ns, err := s.normalizeBodyNamespace(ctx, decision, req.GetCapabilityNamespace())
	if err != nil {
		return err
	}
	deviceID := strings.TrimSpace(req.GetDeviceId())
	leaseEpoch := req.GetLeaseEpoch()
	active, err := s.store.VerifyActiveLease(ctx, decision.AccountID, deviceID, ns, decision.RegisteredAppSubject, leaseEpoch, s.now().UTC())
	if err != nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	if !active {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_BODY_LEASE_CONFLICT)
	}

	key := leaseMapKey(decision.AccountID, deviceID, ns)
	sub := &outboxSubscriber{
		leaseEpoch: leaseEpoch,
		wakeup:     make(chan struct{}, 1),
		closed:     make(chan struct{}),
	}
	s.mu.Lock()
	if s.outboxSubscribers[key] == nil {
		s.outboxSubscribers[key] = make(map[*outboxSubscriber]struct{})
	}
	s.outboxSubscribers[key][sub] = struct{}{}
	s.mu.Unlock()

	defer func() {
		sub.close()
		s.mu.Lock()
		delete(s.outboxSubscribers[key], sub)
		if len(s.outboxSubscribers[key]) == 0 {
			delete(s.outboxSubscribers, key)
		}
		s.mu.Unlock()
	}()

	if err := stream.SendHeader(nil); err != nil {
		return err
	}

	// Bounded sent-cursor tracking: only tracks currently-pending unacked IDs
	// and prunes any ID no longer pending in SQLite so memory stays strictly bounded
	// while never silently dropping outbox envelopes under load.
	sentPending := make(map[string]struct{})
	drainPending := func() error {
		alive, lErr := s.store.VerifyActiveLease(ctx, decision.AccountID, deviceID, ns, decision.RegisteredAppSubject, leaseEpoch, s.now().UTC())
		if lErr != nil {
			return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
		}
		if !alive {
			return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_BODY_LEASE_CONFLICT)
		}
		tombstones, intents, err := s.store.ListPendingOutbox(ctx, decision.AccountID, deviceID, ns)
		if err != nil {
			return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
		}
		stillPending := make(map[string]struct{}, len(tombstones)+len(intents))
		for _, env := range tombstones {
			id := env.GetOutboxId()
			stillPending[id] = struct{}{}
			if _, already := sentPending[id]; !already {
				if err := stream.Send(env); err != nil {
					return err
				}
				sentPending[id] = struct{}{}
			}
		}
		for _, env := range intents {
			id := env.GetOutboxId()
			stillPending[id] = struct{}{}
			if _, already := sentPending[id]; !already {
				if err := stream.Send(env); err != nil {
					return err
				}
				sentPending[id] = struct{}{}
			}
		}
		// Prune acked/cancelled IDs so sentPending never grows unboundedly.
		for id := range sentPending {
			if _, ok := stillPending[id]; !ok {
				delete(sentPending, id)
			}
		}
		return nil
	}

	if err := drainPending(); err != nil {
		return err
	}

	leaseCheckTicker := time.NewTicker(5 * time.Second)
	defer leaseCheckTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-decision.SessionInvalidated:
			return grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
		case <-sub.closed:
			return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_BODY_LEASE_CONFLICT)
		case <-sub.wakeup:
			if err := drainPending(); err != nil {
				return err
			}
		case <-leaseCheckTicker.C:
			if err := drainPending(); err != nil {
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
	ns, err := s.normalizeBodyNamespace(ctx, decision, req.GetCapabilityNamespace())
	if err != nil {
		return nil, err
	}
	deviceID := strings.TrimSpace(req.GetDeviceId())
	active, err := s.store.VerifyActiveLease(ctx, decision.AccountID, deviceID, ns, decision.RegisteredAppSubject, req.GetLeaseEpoch(), s.now().UTC())
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
	acked, err := s.store.AckOutbox(ctx, decision.AccountID, deviceID, ns, decision.RegisteredAppSubject, req.GetLeaseEpoch(), outboxID, resultState, s.now().UTC())
	if errors.Is(err, errLeaseConflict) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_BODY_LEASE_CONFLICT)
	}
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
		case sub.wakeup <- struct{}{}:
		default:
		}
	}
}

func (s *Service) notifyOverviewChange(accountID string, upserted []*runtimev1.WorkSessionRecord, removed []*runtimev1.WorkSessionRecord) {
	s.overviewMu.Lock()
	defer s.overviewMu.Unlock()
	_, activePCCarrierAppID, carrierOnline, carrierErr := s.store.FindActiveCarrier(context.Background(), accountID, DefaultPCNamespace, s.now().UTC())
	allAtt, attentionErr := s.store.ListPendingAttention(context.Background(), accountID, s.now().UTC())

	s.mu.Lock()
	subs := make([]*overviewSubscriber, 0, len(s.overviewSubscribers))
	for sub := range s.overviewSubscribers {
		if sub.accountID == accountID {
			subs = append(subs, sub)
		}
	}
	s.mu.Unlock()

	// Notifications can arrive after a newer transaction. Read the current record
	// while serializing dispatch so an earlier callback cannot restore old state.
	current := make([]*runtimev1.WorkSessionRecord, 0, len(upserted))
	var recordErr error
	for _, record := range upserted {
		row, err := s.store.GetSessionIncludingDeleting(context.Background(), accountID, record.GetWorkSessionRef())
		if err != nil {
			recordErr = err
			break
		}
		if row.DeletedAt != "" || row.Record.Status == "deleting" {
			removed = append(removed, row.Record)
		} else {
			current = append(current, row.Record)
		}
	}
	upserted = current
	for _, sub := range subs {
		if carrierErr != nil || attentionErr != nil || recordErr != nil {
			select {
			case sub.overflow <- struct{}{}:
			default:
			}
			continue
		}
		var visibleRemoved []string
		var visibleSessions []*runtimev1.WorkSessionRecord
		for _, rec := range upserted {
			if sub.agentRef != "" && rec.GetAgentBinding() != sub.agentRef {
				continue
			}
			if readerCanAccessSession(sub.decision, rec) {
				if rec.GetArchivedAt() != "" && !sub.includeArchived {
					visibleRemoved = append(visibleRemoved, rec.GetWorkSessionRef())
				} else {
					visibleSessions = append(visibleSessions, rec)
				}
			}
		}
		for _, rec := range removed {
			if sub.agentRef != "" && rec.GetAgentBinding() != sub.agentRef {
				continue
			}
			if readerCanAccessSession(sub.decision, rec) {
				visibleRemoved = append(visibleRemoved, rec.GetWorkSessionRef())
			}
		}
		// Avoid leaking hidden-session activity when neither sessions nor removals are visible
		// unless this is a carrier liveness/attention broadcast (upserted==nil && removed==nil).
		if (len(upserted) > 0 || len(removed) > 0) && len(visibleSessions) == 0 && len(visibleRemoved) == 0 {
			continue
		}
		var visibleAtt []*runtimev1.PendingAttentionRecord
		for _, att := range allAtt {
			if (sub.agentRef == "" || sub.agentRef == att.GetAgentBinding()) && readerCanAccessAttention(sub.decision, att) {
				visibleAtt = append(visibleAtt, att)
			}
		}
		s.mu.Lock()
		sub.seq++
		seq := sub.seq
		s.mu.Unlock()
		delta := &runtimev1.SessionOverviewDelta{
			OverviewSeq:            seq,
			FullBaseline:           false,
			UpsertedSessions:       visibleSessions,
			RemovedWorkSessionRefs: visibleRemoved,
			AttentionItems:         visibleAtt,
			CarrierOnline:          carrierOnline,
			ActivePcCarrierAppId:   activePCCarrierAppID,
		}
		select {
		case sub.ch <- delta:
		default:
			select {
			case sub.overflow <- struct{}{}:
			default:
			}
		}
	}
}

func (s *Service) notifyBrainEventSubscribers(env *runtimev1.BrainSessionEventEnvelope, turnSeq int64) {
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
		case sub.events <- brainEventNotice{event: env, turnSeq: turnSeq}:
		default:
			if env.GetSeq() > 0 {
				select {
				case sub.catchUp <- struct{}{}:
				default:
				}
			}
		}
	}
}

func (s *Service) maybeStartBrainTurn(decision accountservice.LocalAppCallerDecision, session *runtimev1.WorkSessionRecord, userText, requestID string) {
	if session == nil {
		return
	}
	accountID := decision.AccountID
	ref := session.GetWorkSessionRef()
	ctx, cancel := context.WithCancel(context.Background())

	s.mu.Lock()
	if s.closed || s.brainTurnExecutor == nil {
		s.mu.Unlock()
		cancel()
		return
	}
	executor := s.brainTurnExecutor
	if prev, ok := s.brainTurnCancels[ref]; ok && prev.cancel != nil {
		prev.cancel()
	}
	s.brainTurnSeq++
	turnID := s.brainTurnSeq
	s.brainTurnCancels[ref] = brainTurnCancelEntry{id: turnID, turnRef: strings.TrimSpace(requestID), cancel: cancel}
	// Add(1) strictly under s.mu while !s.closed so Close()/Quiesce() Wait() never races.
	s.brainTurnsWg.Add(1)
	s.mu.Unlock()

	go func() {
		defer s.brainTurnsWg.Done()
		defer func() {
			cancel()
			s.mu.Lock()
			if current, ok := s.brainTurnCancels[ref]; ok && current.id == turnID {
				delete(s.brainTurnCancels, ref)
			}
			s.mu.Unlock()
		}()
		history, _ := s.store.ListRecentBrainEvents(ctx, ref, 64)
		err := executor(ctx, BrainTurnExecutionInput{
			AccountID:      accountID,
			CallerDecision: decision,
			Session:        session,
			UserText:       userText,
			RequestID:      requestID,
			History:        history,
		}, func(eventType, payloadJSON string, persist bool) error {
			if !persist {
				s.notifyBrainEventSubscribers(&runtimev1.BrainSessionEventEnvelope{
					WorkSessionRef: ref,
					Seq:            0,
					EventId:        newID("ev"),
					EventType:      eventType,
					PayloadJson:    payloadJSON,
					CreatedAt:      formatRFC3339(s.now().UTC()),
				}, session.GetHeadSeq())
				return nil
			}
			env, err := s.store.AppendBrainEvent(ctx, accountID, ref, eventType, payloadJSON, s.now().UTC())
			if err != nil {
				return err
			}
			s.notifyBrainEventSubscribers(env, 0)
			return nil
		})
		if err != nil && ctx.Err() == nil {
			errPayload, _ := jsonMarshalNoEscape(map[string]string{
				"requestId": requestID,
				"error":     err.Error(),
			})
			if env, appendErr := s.store.AppendBrainEvent(ctx, accountID, ref, "turn_error", errPayload, s.now().UTC()); appendErr == nil {
				s.notifyBrainEventSubscribers(env, 0)
			}
		}
	}()
}

func (s *Service) cancelBrainTurn(workSessionRef string) bool {
	return s.cancelBrainTurnExpected(workSessionRef, "")
}

func (s *Service) cancelBrainTurnExpected(workSessionRef, expectedTurnRef string) bool {
	expected := strings.TrimSpace(expectedTurnRef)
	s.mu.Lock()
	entry, ok := s.brainTurnCancels[workSessionRef]
	if !ok {
		s.mu.Unlock()
		return false
	}
	if expected != "" && entry.turnRef != expected {
		s.mu.Unlock()
		return false
	}
	delete(s.brainTurnCancels, workSessionRef)
	s.mu.Unlock()
	if entry.cancel != nil {
		entry.cancel()
		return true
	}
	return false
}
