package localservice

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/rpcctx"
	"github.com/nimiplatform/nimi/runtime/internal/streamutil"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	localTransferStateQueued    = "queued"
	localTransferStateRunning   = "running"
	localTransferStatePaused    = "paused"
	localTransferStateFailed    = "failed"
	localTransferStateCompleted = "completed"
	localTransferStateCancelled = "cancelled"
	localTransferStreamBudget   = 32

	localTransferKindDownload       = "download"
	localTransferKindImport         = "import"
	localTransferInterruptionReason = "LOCAL_TRANSFER_INTERRUPTED"
)

var errLocalTransferCancelled = errors.New("local transfer cancelled")

type localTransferControl struct {
	mu        sync.Mutex
	paused    bool
	cancelled bool
	signal    chan struct{}
}

func newLocalTransferControl() *localTransferControl {
	return &localTransferControl{signal: make(chan struct{})}
}

func (c *localTransferControl) pause() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cancelled || c.paused {
		return false
	}
	c.paused = true
	close(c.signal)
	c.signal = make(chan struct{})
	return true
}

func (c *localTransferControl) resume() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cancelled || !c.paused {
		return false
	}
	c.paused = false
	close(c.signal)
	c.signal = make(chan struct{})
	return true
}

func (c *localTransferControl) isPaused() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.paused && !c.cancelled
}

func (c *localTransferControl) cancel() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cancelled {
		return false
	}
	c.cancelled = true
	c.paused = false
	close(c.signal)
	c.signal = make(chan struct{})
	return true
}

func (c *localTransferControl) wait(ctx context.Context) error {
	for {
		c.mu.Lock()
		cancelled := c.cancelled
		paused := c.paused
		signal := c.signal
		c.mu.Unlock()
		if cancelled {
			return errLocalTransferCancelled
		}
		if !paused {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-signal:
		}
	}
}

func normalizeTransferState(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case localTransferStateQueued:
		return localTransferStateQueued
	case localTransferStatePaused:
		return localTransferStatePaused
	case localTransferStateFailed:
		return localTransferStateFailed
	case localTransferStateCompleted:
		return localTransferStateCompleted
	case localTransferStateCancelled:
		return localTransferStateCancelled
	default:
		return localTransferStateRunning
	}
}

func normalizeTransferKind(value string) string {
	if strings.EqualFold(strings.TrimSpace(value), localTransferKindImport) {
		return localTransferKindImport
	}
	return localTransferKindDownload
}

func isTerminalTransferState(state string) bool {
	switch normalizeTransferState(state) {
	case localTransferStateFailed, localTransferStateCompleted, localTransferStateCancelled:
		return true
	default:
		return false
	}
}

func isRetryableFailedManagedDownload(summary *runtimev1.LocalTransferSessionSummary) bool {
	return summary != nil &&
		normalizeTransferKind(summary.GetSessionKind()) == localTransferKindDownload &&
		normalizeTransferState(summary.GetState()) == localTransferStateFailed &&
		summary.GetRetryable()
}

func transferStateDoneSuccess(state string) (bool, bool) {
	switch normalizeTransferState(state) {
	case localTransferStateCompleted:
		return true, true
	case localTransferStateFailed, localTransferStateCancelled:
		return true, false
	default:
		return false, false
	}
}

func cloneLocalTransferSummary(summary *runtimev1.LocalTransferSessionSummary) *runtimev1.LocalTransferSessionSummary {
	if summary == nil {
		return nil
	}
	return &runtimev1.LocalTransferSessionSummary{
		InstallSessionId: summary.GetInstallSessionId(),
		AssetId:          summary.GetAssetId(),
		SessionKind:      normalizeTransferKind(summary.GetSessionKind()),
		Phase:            strings.TrimSpace(summary.GetPhase()),
		State:            normalizeTransferState(summary.GetState()),
		BytesReceived:    summary.GetBytesReceived(),
		BytesTotal:       summary.GetBytesTotal(),
		SpeedBytesPerSec: summary.GetSpeedBytesPerSec(),
		EtaSeconds:       summary.GetEtaSeconds(),
		Message:          strings.TrimSpace(summary.GetMessage()),
		ReasonCode:       strings.TrimSpace(summary.GetReasonCode()),
		Retryable:        summary.GetRetryable(),
		CreatedAt:        summary.GetCreatedAt(),
		UpdatedAt:        summary.GetUpdatedAt(),
	}
}

func localTransferEventFromSummary(summary *runtimev1.LocalTransferSessionSummary) *runtimev1.LocalTransferProgressEvent {
	if summary == nil {
		return nil
	}
	done, success := transferStateDoneSuccess(summary.GetState())
	return &runtimev1.LocalTransferProgressEvent{
		InstallSessionId: summary.GetInstallSessionId(),
		AssetId:          summary.GetAssetId(),
		SessionKind:      normalizeTransferKind(summary.GetSessionKind()),
		Phase:            strings.TrimSpace(summary.GetPhase()),
		BytesReceived:    summary.GetBytesReceived(),
		BytesTotal:       summary.GetBytesTotal(),
		SpeedBytesPerSec: summary.GetSpeedBytesPerSec(),
		EtaSeconds:       summary.GetEtaSeconds(),
		Message:          strings.TrimSpace(summary.GetMessage()),
		State:            normalizeTransferState(summary.GetState()),
		ReasonCode:       strings.TrimSpace(summary.GetReasonCode()),
		Retryable:        summary.GetRetryable(),
		Done:             done,
		Success:          success,
		CreatedAt:        summary.GetCreatedAt(),
		UpdatedAt:        summary.GetUpdatedAt(),
	}
}

func (s *Service) newLocalTransfer(kind string, input localTransferMutation) *runtimev1.LocalTransferSessionSummary {
	summary, _ := s.createLocalTransfer(kind, input, nil, false)
	return summary
}

func (s *Service) newManagedModelDownloadTransfer(input localTransferMutation, spec managedDownloadedModelSpec) (*runtimev1.LocalTransferSessionSummary, error) {
	return s.createLocalTransfer(localTransferKindDownload, input, &spec, true)
}

func (s *Service) createLocalTransfer(
	kind string,
	input localTransferMutation,
	downloadSpec *managedDownloadedModelSpec,
	requireDurable bool,
) (*runtimev1.LocalTransferSessionSummary, error) {
	now := nowISO()
	summary := &runtimev1.LocalTransferSessionSummary{
		InstallSessionId: "transfer_" + strings.ToLower(ulid.Make().String()),
		AssetId:          defaultString(strings.TrimSpace(input.ModelID), strings.TrimSpace(input.ArtifactID)),
		SessionKind:      normalizeTransferKind(kind),
		Phase:            defaultString(strings.TrimSpace(input.Phase), "download"),
		State:            normalizeTransferState(defaultString(strings.TrimSpace(input.State), localTransferStateRunning)),
		BytesReceived:    clampInt64Minimum(input.BytesReceived, 0),
		BytesTotal:       clampInt64Minimum(input.BytesTotal, 0),
		SpeedBytesPerSec: clampInt64Minimum(input.SpeedBytesPerSec, 0),
		EtaSeconds:       clampInt64Minimum(input.EtaSeconds, 0),
		Message:          strings.TrimSpace(input.Message),
		ReasonCode:       strings.TrimSpace(input.ReasonCode),
		Retryable:        input.Retryable,
		CreatedAt:        now,
		UpdatedAt:        now,
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.transfers[summary.GetInstallSessionId()] = cloneLocalTransferSummary(summary)
	if downloadSpec != nil {
		s.managedModelDownloadSpecs[summary.GetInstallSessionId()] = cloneManagedDownloadedModelSpec(*downloadSpec)
	}
	if !isTerminalTransferState(summary.GetState()) {
		// Every non-terminal transfer gets a control. Import and download sessions
		// both honor pause, resume, and cancellation through the same bounded path.
		s.transferControls[summary.GetInstallSessionId()] = newLocalTransferControl()
	}
	if err := s.persistStateLocked(); err != nil && requireDurable {
		delete(s.transfers, summary.GetInstallSessionId())
		delete(s.managedModelDownloadSpecs, summary.GetInstallSessionId())
		delete(s.transferControls, summary.GetInstallSessionId())
		return nil, fmt.Errorf("persist managed download transfer: %w", err)
	}
	s.publishTransferEventLocked(localTransferEventFromSummary(summary))
	return cloneLocalTransferSummary(summary), nil
}

type localTransferMutation struct {
	ModelID          string
	ArtifactID       string
	Phase            string
	State            string
	BytesReceived    int64
	BytesTotal       int64
	SpeedBytesPerSec int64
	EtaSeconds       int64
	Message          string
	ReasonCode       string
	Retryable        bool
}

func (s *Service) mutateLocalTransfer(sessionID string, persist bool, mutate func(summary *runtimev1.LocalTransferSessionSummary)) (*runtimev1.LocalTransferSessionSummary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := strings.TrimSpace(sessionID)
	previous := cloneLocalTransferSummary(s.transfers[key])
	current := cloneLocalTransferSummary(previous)
	if current == nil {
		return nil, nil
	}
	previousControl, hadControl := s.transferControls[key]
	previousRate, hadRate := s.transferRates[key]
	previousSpec, hadSpec := s.managedModelDownloadSpecs[key]
	mutate(current)
	current.InstallSessionId = previous.GetInstallSessionId()
	current.SessionKind = normalizeTransferKind(current.GetSessionKind())
	current.State = normalizeTransferState(current.GetState())
	if isTerminalTransferState(current.GetState()) {
		current.SpeedBytesPerSec = 0
		current.EtaSeconds = 0
	}
	current.UpdatedAt = nowISO()
	s.transfers[key] = cloneLocalTransferSummary(current)
	if isTerminalTransferState(current.GetState()) {
		delete(s.transferControls, key)
		delete(s.transferRates, key)
		if !isRetryableFailedManagedDownload(current) {
			delete(s.managedModelDownloadSpecs, key)
		}
	}
	if persist {
		if err := s.persistStateLocked(); err != nil {
			s.transfers[key] = previous
			if hadControl {
				s.transferControls[key] = previousControl
			} else {
				delete(s.transferControls, key)
			}
			if hadRate {
				s.transferRates[key] = previousRate
			} else {
				delete(s.transferRates, key)
			}
			if hadSpec {
				s.managedModelDownloadSpecs[key] = cloneManagedDownloadedModelSpec(previousSpec)
			} else {
				delete(s.managedModelDownloadSpecs, key)
			}
			return cloneLocalTransferSummary(previous), err
		}
	}
	s.publishTransferEventLocked(localTransferEventFromSummary(current))
	return cloneLocalTransferSummary(current), nil
}

func localTransferPersistenceError(err error) error {
	return grpcerr.WrapWithReasonCode(
		codes.Unavailable,
		runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_PERSISTENCE_UNAVAILABLE,
		err,
		grpcerr.ReasonOptions{Message: "local transfer state could not be persisted"},
	)
}

// @nimi-authority: rule.nimi.runtime.local-compute.r029
// reconcileOrphanedLocalTransfersLocked pauses residual running/queued
// downloads after a daemon restart. Their stable per-asset staging remains the
// resume point for a later explicit install. Imports retain the existing
// fail-closed recovery because their source-side mutation cannot be resumed.
// Caller must hold s.mu.
func (s *Service) reconcileOrphanedLocalTransfersLocked(modelsRoot string) int {
	healed := 0
	for _, summary := range s.transfers {
		if summary == nil || isTerminalTransferState(summary.GetState()) {
			continue
		}
		state := normalizeTransferState(summary.GetState())
		changed := false
		if normalizeTransferKind(summary.GetSessionKind()) == localTransferKindDownload {
			// Progress events are intentionally not fsynced on every chunk. Rebuild
			// the durable byte projection from stable per-transfer staging so a hard
			// restart never presents an existing Range prefix as 0 B or shares it.
			var files []string
			if spec, exists := s.managedModelDownloadSpecs[summary.GetInstallSessionId()]; exists {
				files = append([]string(nil), spec.files...)
			}
			if bytesReceived, err := managedModelDownloadStagedBytes(modelsRoot, managedModelAcquisitionStorageID(summary.GetAssetId(), summary.GetInstallSessionId()), files); err == nil &&
				summary.GetBytesReceived() != bytesReceived {
				summary.BytesReceived = bytesReceived
				changed = true
			}
			if state == localTransferStateRunning || state == localTransferStateQueued {
				summary.State = localTransferStatePaused
				summary.Message = "transfer interrupted by runtime restart"
				summary.ReasonCode = localTransferInterruptionReason
				summary.Retryable = true
				changed = true
			}
		} else {
			summary.State = localTransferStateFailed
			summary.Message = "transfer interrupted by runtime restart"
			summary.ReasonCode = localTransferInterruptionReason
			summary.Retryable = false
			changed = true
		}
		if !changed {
			continue
		}
		summary.SpeedBytesPerSec = 0
		summary.EtaSeconds = 0
		summary.UpdatedAt = nowISO()
		healed++
	}
	return healed
}

func (s *Service) transferControl(sessionID string) *localTransferControl {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.transferControls[strings.TrimSpace(sessionID)]
}

// localTransferSummary returns a clone of the current transfer summary for a
// session, or an empty summary when the session is unknown. It is a read-only
// accessor used to reuse the bounded speed / ETA already derived onto the
// transfer summary when projecting per-job download progress.
func (s *Service) localTransferSummary(sessionID string) *runtimev1.LocalTransferSessionSummary {
	s.mu.RLock()
	defer s.mu.RUnlock()
	summary := s.transfers[strings.TrimSpace(sessionID)]
	if summary == nil {
		return &runtimev1.LocalTransferSessionSummary{}
	}
	return cloneLocalTransferSummary(summary)
}

func (s *Service) listLocalTransferSummariesLocked() []*runtimev1.LocalTransferSessionSummary {
	items := make([]*runtimev1.LocalTransferSessionSummary, 0, len(s.transfers))
	for _, summary := range s.transfers {
		items = append(items, cloneLocalTransferSummary(summary))
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].GetUpdatedAt() != items[j].GetUpdatedAt() {
			return items[i].GetUpdatedAt() > items[j].GetUpdatedAt()
		}
		return items[i].GetInstallSessionId() > items[j].GetInstallSessionId()
	})
	return items
}

func (s *Service) publishTransferEventLocked(event *runtimev1.LocalTransferProgressEvent) {
	if event == nil {
		return
	}
	for subscriberID, ch := range s.transferSubscribers {
		clone := localTransferEventFromSummary(&runtimev1.LocalTransferSessionSummary{
			InstallSessionId: event.GetInstallSessionId(),
			AssetId:          event.GetAssetId(),
			SessionKind:      event.GetSessionKind(),
			Phase:            event.GetPhase(),
			State:            event.GetState(),
			BytesReceived:    event.GetBytesReceived(),
			BytesTotal:       event.GetBytesTotal(),
			SpeedBytesPerSec: event.GetSpeedBytesPerSec(),
			EtaSeconds:       event.GetEtaSeconds(),
			Message:          event.GetMessage(),
			ReasonCode:       event.GetReasonCode(),
			Retryable:        event.GetRetryable(),
			CreatedAt:        event.GetCreatedAt(),
			UpdatedAt:        event.GetUpdatedAt(),
		})
		select {
		case ch <- clone:
		default:
			close(ch)
			delete(s.transferSubscribers, subscriberID)
		}
	}
}

func (s *Service) addTransferSubscriberLocked() (uint64, chan *runtimev1.LocalTransferProgressEvent) {
	s.transferSubscriberSeq++
	id := s.transferSubscriberSeq
	ch := make(chan *runtimev1.LocalTransferProgressEvent, localTransferStreamBudget)
	s.transferSubscribers[id] = ch
	return id, ch
}

func (s *Service) removeTransferSubscriber(id uint64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ch, ok := s.transferSubscribers[id]
	if !ok {
		return
	}
	delete(s.transferSubscribers, id)
	close(ch)
}

func (s *Service) ListLocalTransfers(_ context.Context, _ *runtimev1.ListLocalTransfersRequest) (*runtimev1.ListLocalTransfersResponse, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return &runtimev1.ListLocalTransfersResponse{
		Transfers: s.listLocalTransferSummariesLocked(),
	}, nil
}

func (s *Service) PauseLocalTransfer(_ context.Context, req *runtimev1.PauseLocalTransferRequest) (*runtimev1.PauseLocalTransferResponse, error) {
	sessionID := strings.TrimSpace(req.GetInstallSessionId())
	if sessionID == "" {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			Message: "installSessionId required",
		})
	}
	control := s.transferControl(sessionID)
	summary, persistErr := s.mutateLocalTransfer(sessionID, true, func(summary *runtimev1.LocalTransferSessionSummary) {
		if isTerminalTransferState(summary.GetState()) {
			return
		}
		summary.State = localTransferStatePaused
		summary.Message = "transfer paused"
		summary.SpeedBytesPerSec = 0
		summary.EtaSeconds = 0
		delete(s.transferRates, sessionID)
	})
	if persistErr != nil {
		return nil, localTransferPersistenceError(persistErr)
	}
	if summary == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			Message: "transfer not found",
		})
	}
	if control == nil || isTerminalTransferState(summary.GetState()) {
		return &runtimev1.PauseLocalTransferResponse{Transfer: summary}, nil
	}
	_ = control.pause()
	return &runtimev1.PauseLocalTransferResponse{Transfer: summary}, nil
}

// @nimi-authority: rule.nimi.runtime.local-compute.r090
func (s *Service) ResumeLocalTransfer(_ context.Context, req *runtimev1.ResumeLocalTransferRequest) (*runtimev1.ResumeLocalTransferResponse, error) {
	sessionID := strings.TrimSpace(req.GetInstallSessionId())
	if sessionID == "" {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			Message: "installSessionId required",
		})
	}

	summary := s.localTransferSummary(sessionID)
	if summary.GetInstallSessionId() == "" {
		return nil, grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			Message: "transfer not found",
		})
	}
	if isTerminalTransferState(summary.GetState()) && !isRetryableFailedManagedDownload(summary) {
		return &runtimev1.ResumeLocalTransferResponse{Transfer: summary}, nil
	}

	control := s.transferControl(sessionID)
	state := normalizeTransferState(summary.GetState())
	if state == localTransferStateRunning && control != nil {
		// Idempotent resume while the original in-process executor is alive.
		return &runtimev1.ResumeLocalTransferResponse{Transfer: summary}, nil
	}
	if state == localTransferStatePaused && control != nil && control.isPaused() {
		// A cooperative pause retains its executor and only needs the existing
		// control released. An interruption does not pause the control, so it
		// deliberately falls through to full reconstruction below.
		var persistErr error
		summary, persistErr = s.mutateLocalTransfer(sessionID, true, func(summary *runtimev1.LocalTransferSessionSummary) {
			if isTerminalTransferState(summary.GetState()) {
				return
			}
			summary.State = localTransferStateRunning
			summary.Message = "transfer resumed"
			summary.ReasonCode = ""
			summary.Retryable = true
			summary.SpeedBytesPerSec = 0
			summary.EtaSeconds = 0
		})
		if persistErr != nil {
			return nil, localTransferPersistenceError(persistErr)
		}
		_ = control.resume()
		return &runtimev1.ResumeLocalTransferResponse{Transfer: summary}, nil
	}

	if normalizeTransferKind(summary.GetSessionKind()) != localTransferKindDownload {
		reason := runtimev1.ReasonCode_AI_LOCAL_MODEL_INVALID_TRANSITION.String()
		err := grpcerr.WithReasonCodeOptions(
			codes.FailedPrecondition,
			runtimev1.ReasonCode_AI_LOCAL_MODEL_INVALID_TRANSITION,
			grpcerr.ReasonOptions{Message: "transfer executor did not survive the runtime restart"},
		)
		s.failTransferWithReason(sessionID, err.Error(), reason, false)
		return nil, err
	}

	plan, reason, err := s.rebuildManagedModelDownloadResumePlan(summary.GetAssetId(), summary.GetInstallSessionId())
	if err != nil {
		s.failTransferWithReason(sessionID, err.Error(), reason, false)
		return nil, err
	}
	resumed, err := s.startRestoredManagedModelDownload(sessionID, plan)
	if err != nil {
		s.failTransferWithReason(sessionID, err.Error(), runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE.String(), false)
		return nil, err
	}
	return &runtimev1.ResumeLocalTransferResponse{Transfer: resumed}, nil
}

func (s *Service) startRestoredManagedModelDownload(
	sessionID string,
	plan managedModelDownloadResumePlan,
) (*runtimev1.LocalTransferSessionSummary, error) {
	s.mu.Lock()
	current := s.transfers[strings.TrimSpace(sessionID)]
	if current == nil {
		s.mu.Unlock()
		return nil, grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			Message: "transfer not found",
		})
	}
	if isTerminalTransferState(current.GetState()) && !isRetryableFailedManagedDownload(current) {
		summary := cloneLocalTransferSummary(current)
		s.mu.Unlock()
		return summary, nil
	}
	if normalizeTransferState(current.GetState()) == localTransferStateRunning && s.transferControls[sessionID] != nil {
		summary := cloneLocalTransferSummary(current)
		s.mu.Unlock()
		return summary, nil
	}
	parent := s.jobLifetimeCtx
	if parent == nil || s.jobLifetimeCancel == nil {
		s.mu.Unlock()
		return nil, grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message: "runtime is shutting down; transfer executor cannot be started",
		})
	}

	control := newLocalTransferControl()
	previousControl, hadControl := s.transferControls[sessionID]
	previous := cloneLocalTransferSummary(current)
	s.transferControls[sessionID] = control
	current.State = localTransferStateRunning
	current.Phase = "download"
	current.BytesReceived = clampInt64Minimum(plan.bytesReceived, 0)
	if plan.bytesTotal > 0 {
		current.BytesTotal = plan.bytesTotal
	}
	current.SpeedBytesPerSec = 0
	current.EtaSeconds = 0
	current.Message = "transfer resumed"
	current.ReasonCode = ""
	current.Retryable = true
	current.UpdatedAt = nowISO()
	s.transfers[sessionID] = cloneLocalTransferSummary(current)
	if err := s.persistStateLocked(); err != nil {
		s.transfers[sessionID] = previous
		if hadControl {
			s.transferControls[sessionID] = previousControl
		} else {
			delete(s.transferControls, sessionID)
		}
		s.mu.Unlock()
		return nil, localTransferPersistenceError(err)
	}
	s.publishTransferEventLocked(localTransferEventFromSummary(current))
	summary := cloneLocalTransferSummary(current)
	s.transferWorkerWG.Add(1)
	s.mu.Unlock()

	go func() {
		defer s.transferWorkerWG.Done()
		_, runErr := s.installManagedDownloadedModelWithTransfer(parent, plan.spec, sessionID)
		s.finishRestoredManagedModelDownload(sessionID, control, runErr)
		if runErr != nil {
			s.logger.Debug("restored managed model transfer ended with error",
				"install_session_id", sessionID,
				"asset_id", plan.spec.modelID,
				"error", runErr)
		}
	}()
	return summary, nil
}

// finishRestoredManagedModelDownload drops only the executor generation that
// just exited. If an unexpected early return left its session running, it also
// fails that session closed so no running-without-executor state can persist.
func (s *Service) finishRestoredManagedModelDownload(sessionID string, control *localTransferControl, runErr error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.transferControls[sessionID] != control {
		return
	}
	delete(s.transferControls, sessionID)
	previous := cloneLocalTransferSummary(s.transfers[sessionID])
	current := cloneLocalTransferSummary(previous)
	if current == nil || isTerminalTransferState(current.GetState()) || normalizeTransferState(current.GetState()) == localTransferStatePaused {
		return
	}
	previousRate, hadRate := s.transferRates[sessionID]
	previousSpec, hadSpec := s.managedModelDownloadSpecs[sessionID]
	current.State = localTransferStateFailed
	if runErr != nil {
		current.Message = runErr.Error()
	} else {
		current.Message = "transfer executor stopped before completion"
	}
	current.ReasonCode = "LOCAL_TRANSFER_FAILED"
	current.Retryable = false
	current.SpeedBytesPerSec = 0
	current.EtaSeconds = 0
	current.UpdatedAt = nowISO()
	s.transfers[sessionID] = cloneLocalTransferSummary(current)
	delete(s.transferRates, sessionID)
	delete(s.managedModelDownloadSpecs, sessionID)
	if err := s.persistStateLocked(); err != nil {
		s.transfers[sessionID] = previous
		if hadRate {
			s.transferRates[sessionID] = previousRate
		}
		if hadSpec {
			s.managedModelDownloadSpecs[sessionID] = cloneManagedDownloadedModelSpec(previousSpec)
		}
		return
	}
	s.publishTransferEventLocked(localTransferEventFromSummary(current))
}

func (s *Service) failTransferWithReason(sessionID string, message string, reason string, retryable bool) error {
	_, err := s.mutateLocalTransfer(sessionID, true, func(summary *runtimev1.LocalTransferSessionSummary) {
		if isTerminalTransferState(summary.GetState()) {
			return
		}
		summary.State = localTransferStateFailed
		summary.Message = strings.TrimSpace(message)
		summary.ReasonCode = strings.TrimSpace(reason)
		summary.Retryable = retryable
		summary.SpeedBytesPerSec = 0
		summary.EtaSeconds = 0
	})
	return err
}

func (s *Service) CancelLocalTransfer(_ context.Context, req *runtimev1.CancelLocalTransferRequest) (*runtimev1.CancelLocalTransferResponse, error) {
	sessionID := strings.TrimSpace(req.GetInstallSessionId())
	if sessionID == "" {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			Message: "installSessionId required",
		})
	}
	control := s.transferControl(sessionID)
	summary, persistErr := s.mutateLocalTransfer(sessionID, true, func(summary *runtimev1.LocalTransferSessionSummary) {
		state := normalizeTransferState(summary.GetState())
		if state == localTransferStateCompleted || state == localTransferStateCancelled {
			return
		}
		summary.State = localTransferStateCancelled
		summary.Message = "transfer cancelled"
		summary.ReasonCode = "LOCAL_TRANSFER_CANCELLED"
		summary.Retryable = false
	})
	if persistErr != nil {
		return nil, localTransferPersistenceError(persistErr)
	}
	if summary == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			Message: "transfer not found",
		})
	}
	if control != nil {
		_ = control.cancel()
	}
	if normalizeTransferKind(summary.GetSessionKind()) == localTransferKindDownload && normalizeTransferState(summary.GetState()) == localTransferStateCancelled {
		s.discardManagedModelDownloadStaging(managedModelAcquisitionStorageID(summary.GetAssetId(), summary.GetInstallSessionId()))
	}
	return &runtimev1.CancelLocalTransferResponse{Transfer: summary}, nil
}

func (s *Service) WatchLocalTransfers(_ *runtimev1.WatchLocalTransfersRequest, stream grpc.ServerStreamingServer[runtimev1.LocalTransferProgressEvent]) error {
	relay := streamutil.NewRelay(streamutil.RelayOptions[*runtimev1.LocalTransferProgressEvent]{
		Budget:              localTransferStreamBudget,
		MaxConsecutiveDrops: 3,
		CloseErr:            status.Error(codes.ResourceExhausted, "slow consumer"),
		IsTerminal: func(event *runtimev1.LocalTransferProgressEvent) bool {
			if event == nil {
				return false
			}
			return event.GetDone()
		},
	})
	defer func() { relay.Close() }()

	done := make(chan error, 1)
	go func() {
		done <- relay.Run(stream.Context(), func(event *runtimev1.LocalTransferProgressEvent) error {
			return stream.Send(event)
		})
	}()

	s.mu.Lock()
	subscriberID, updates := s.addTransferSubscriberLocked()
	existing := s.listLocalTransferSummariesLocked()
	if len(existing) > localTransferStreamBudget {
		existing = existing[:localTransferStreamBudget]
	}
	s.mu.Unlock()
	defer s.removeTransferSubscriber(subscriberID)

	for _, summary := range existing {
		if err := relay.Enqueue(localTransferEventFromSummary(summary)); err != nil {
			return err
		}
	}

	for {
		select {
		case <-stream.Context().Done():
			if err := rpcctx.ContextDoneError(stream.Context()); err == nil {
				return nil
			}
			return rpcctx.ContextDoneError(stream.Context())
		case err := <-done:
			if err == nil && rpcctx.WasServerShutdown(stream.Context()) {
				return rpcctx.ServerShutdownError()
			}
			return err
		case event, ok := <-updates:
			if !ok {
				return nil
			}
			if err := relay.Enqueue(event); err != nil {
				return err
			}
		}
	}
}

func clampInt64Minimum(value int64, minimum int64) int64 {
	if value < minimum {
		return minimum
	}
	return value
}
