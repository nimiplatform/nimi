package localservice

import (
	"context"
	"errors"
	"sort"
	"strings"
	"sync"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
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

	localTransferKindDownload = "download"
	localTransferKindImport   = "import"
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
		LocalAssetId:     summary.GetLocalAssetId(),
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
		LocalAssetId:     summary.GetLocalAssetId(),
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
	now := nowISO()
	summary := &runtimev1.LocalTransferSessionSummary{
		InstallSessionId: "transfer_" + strings.ToLower(ulid.Make().String()),
		AssetId:          defaultString(strings.TrimSpace(input.ModelID), strings.TrimSpace(input.ArtifactID)),
		LocalAssetId:     defaultString(strings.TrimSpace(input.LocalModelID), strings.TrimSpace(input.LocalArtifactID)),
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
	if !isTerminalTransferState(summary.GetState()) && summary.GetSessionKind() == localTransferKindDownload {
		s.transferControls[summary.GetInstallSessionId()] = newLocalTransferControl()
	}
	s.persistStateLocked()
	s.publishTransferEventLocked(localTransferEventFromSummary(summary))
	return cloneLocalTransferSummary(summary)
}

type localTransferMutation struct {
	ModelID          string
	LocalModelID     string
	ArtifactID       string
	LocalArtifactID  string
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

func (s *Service) mutateLocalTransfer(sessionID string, persist bool, mutate func(summary *runtimev1.LocalTransferSessionSummary)) *runtimev1.LocalTransferSessionSummary {
	s.mu.Lock()
	defer s.mu.Unlock()
	current := cloneLocalTransferSummary(s.transfers[strings.TrimSpace(sessionID)])
	if current == nil {
		return nil
	}
	mutate(current)
	current.SessionKind = normalizeTransferKind(current.GetSessionKind())
	current.State = normalizeTransferState(current.GetState())
	current.UpdatedAt = nowISO()
	s.transfers[current.GetInstallSessionId()] = cloneLocalTransferSummary(current)
	if isTerminalTransferState(current.GetState()) {
		delete(s.transferControls, current.GetInstallSessionId())
	}
	if persist {
		s.persistStateLocked()
	}
	s.publishTransferEventLocked(localTransferEventFromSummary(current))
	return cloneLocalTransferSummary(current)
}

func (s *Service) transferControl(sessionID string) *localTransferControl {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.transferControls[strings.TrimSpace(sessionID)]
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
			LocalAssetId:     event.GetLocalAssetId(),
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
	ch := make(chan *runtimev1.LocalTransferProgressEvent, 32)
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
	summary := s.mutateLocalTransfer(sessionID, true, func(summary *runtimev1.LocalTransferSessionSummary) {
		if isTerminalTransferState(summary.GetState()) {
			return
		}
		summary.State = localTransferStatePaused
		summary.Message = "transfer paused"
	})
	if summary == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			Message: "transfer not found",
		})
	}
	if control == nil || summary.GetSessionKind() != localTransferKindDownload || isTerminalTransferState(summary.GetState()) {
		return &runtimev1.PauseLocalTransferResponse{Transfer: summary}, nil
	}
	_ = control.pause()
	return &runtimev1.PauseLocalTransferResponse{Transfer: summary}, nil
}

func (s *Service) ResumeLocalTransfer(_ context.Context, req *runtimev1.ResumeLocalTransferRequest) (*runtimev1.ResumeLocalTransferResponse, error) {
	sessionID := strings.TrimSpace(req.GetInstallSessionId())
	if sessionID == "" {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			Message: "installSessionId required",
		})
	}
	control := s.transferControl(sessionID)
	summary := s.mutateLocalTransfer(sessionID, true, func(summary *runtimev1.LocalTransferSessionSummary) {
		if isTerminalTransferState(summary.GetState()) {
			return
		}
		summary.State = localTransferStateRunning
		summary.Message = "transfer resumed"
	})
	if summary == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			Message: "transfer not found",
		})
	}
	if control == nil || summary.GetSessionKind() != localTransferKindDownload || isTerminalTransferState(summary.GetState()) {
		return &runtimev1.ResumeLocalTransferResponse{Transfer: summary}, nil
	}
	_ = control.resume()
	return &runtimev1.ResumeLocalTransferResponse{Transfer: summary}, nil
}

func (s *Service) CancelLocalTransfer(_ context.Context, req *runtimev1.CancelLocalTransferRequest) (*runtimev1.CancelLocalTransferResponse, error) {
	sessionID := strings.TrimSpace(req.GetInstallSessionId())
	if sessionID == "" {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			Message: "installSessionId required",
		})
	}
	control := s.transferControl(sessionID)
	summary := s.mutateLocalTransfer(sessionID, true, func(summary *runtimev1.LocalTransferSessionSummary) {
		if isTerminalTransferState(summary.GetState()) {
			return
		}
		summary.State = localTransferStateCancelled
		summary.Message = "transfer cancelled"
		summary.ReasonCode = "LOCAL_TRANSFER_CANCELLED"
	})
	if summary == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			Message: "transfer not found",
		})
	}
	if control != nil {
		_ = control.cancel()
	}
	return &runtimev1.CancelLocalTransferResponse{Transfer: summary}, nil
}

func (s *Service) WatchLocalTransfers(_ *runtimev1.WatchLocalTransfersRequest, stream grpc.ServerStreamingServer[runtimev1.LocalTransferProgressEvent]) error {
	relay := streamutil.NewRelay(streamutil.RelayOptions[*runtimev1.LocalTransferProgressEvent]{
		Budget:              32,
		MaxConsecutiveDrops: 3,
		CloseErr:            status.Error(codes.ResourceExhausted, "slow consumer"),
		IsTerminal: func(event *runtimev1.LocalTransferProgressEvent) bool {
			if event == nil {
				return false
			}
			return event.GetDone()
		},
	})
	defer relay.Close()

	done := make(chan error, 1)
	go func() {
		done <- relay.Run(stream.Context(), func(event *runtimev1.LocalTransferProgressEvent) error {
			return stream.Send(event)
		})
	}()

	s.mu.Lock()
	subscriberID, updates := s.addTransferSubscriberLocked()
	existing := s.listLocalTransferSummariesLocked()
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
			if errors.Is(stream.Context().Err(), context.Canceled) {
				return nil
			}
			return stream.Context().Err()
		case err := <-done:
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
