package localservice

import (
	"context"
	"errors"
	"net/http"
	"os"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/filedownload"
)

func (s *Service) updateTransferProgress(
	sessionID string,
	phase string,
	bytesReceived int64,
	bytesTotal int64,
	message string,
) {
	// Speed is a recent-rate estimate derived from observed byte deltas over a
	// bounded sliding window (see filedownload/rate.go). It deliberately is
	// NOT bytesReceived / lifetime: a lifetime average lags the current rate,
	// is meaningless across a filedownload resume (bytesReceived carries prior
	// attempts while the lifetime started fresh), and is skewed by any gap
	// before bytes start flowing. observeTransferRate records the sample and
	// returns the windowed rate; speedKnown is false until an honest rate is
	// established, in which case speed/eta are left absent rather than guessed.
	speed, speedKnown, rateUpdated := s.observeTransferRate(sessionID, maxInt64(bytesReceived, 0), time.Now())
	_, _ = s.mutateLocalTransfer(sessionID, false, func(summary *runtimev1.LocalTransferSessionSummary) {
		// A terminal session must never be resurrected by a late in-flight
		// progress sample (e.g. a copy/hash callback racing a cancel).
		if isTerminalTransferState(summary.GetState()) {
			return
		}
		summary.Phase = phase
		if normalizeTransferState(summary.GetState()) != localTransferStatePaused {
			summary.State = localTransferStateRunning
		}
		summary.BytesReceived = maxInt64(bytesReceived, 0)
		if bytesTotal > 0 {
			summary.BytesTotal = maxInt64(bytesTotal, 0)
		}
		if strings.TrimSpace(message) != "" {
			summary.Message = message
		}
		if speedKnown {
			summary.SpeedBytesPerSec = maxInt64(speed, 0)
			remaining := summary.GetBytesTotal() - summary.GetBytesReceived() - summary.GetBytesReused()
			if summary.GetBytesTotal() <= 0 || remaining <= 0 {
				summary.EtaSeconds = 0
			} else if rateUpdated && speed > 0 {
				summary.EtaSeconds = filedownload.RemainingSeconds(summary.GetBytesReceived()+summary.GetBytesReused(), summary.GetBytesTotal(), speed)
			}
		} else {
			summary.SpeedBytesPerSec = 0
			summary.EtaSeconds = 0
		}
	})
}

// updateTransferReuse records a position-based projection: bytes this
// transfer fetched or copied, and bytes it references from verified managed
// content. Reused bytes never drive speed or ETA.
func (s *Service) updateTransferReuse(sessionID string, phase string, bytesReceived int64, bytesReused int64, message string) {
	_, _ = s.mutateLocalTransfer(sessionID, false, func(summary *runtimev1.LocalTransferSessionSummary) {
		if isTerminalTransferState(summary.GetState()) {
			return
		}
		summary.Phase = phase
		if normalizeTransferState(summary.GetState()) != localTransferStatePaused {
			summary.State = localTransferStateRunning
		}
		summary.BytesReceived = maxInt64(bytesReceived, 0)
		summary.BytesReused = maxInt64(bytesReused, 0)
		if strings.TrimSpace(message) != "" {
			summary.Message = message
		}
		summary.SpeedBytesPerSec = 0
		summary.EtaSeconds = 0
	})
}

// updateTransferVerification reports identification or verification reads.
// They are neither payload nor managed content and never fake a download.
func (s *Service) updateTransferVerification(sessionID string, phase string, bytesVerified int64, message string) {
	_, _ = s.mutateLocalTransfer(sessionID, false, func(summary *runtimev1.LocalTransferSessionSummary) {
		if isTerminalTransferState(summary.GetState()) {
			return
		}
		summary.Phase = phase
		if normalizeTransferState(summary.GetState()) != localTransferStatePaused {
			summary.State = localTransferStateRunning
		}
		summary.BytesVerified = maxInt64(bytesVerified, 0)
		if strings.TrimSpace(message) != "" {
			summary.Message = message
		}
		summary.SpeedBytesPerSec = 0
		summary.EtaSeconds = 0
	})
}

func (s *Service) addTransferVerifiedBytes(sessionID string, delta int64) {
	if delta <= 0 {
		return
	}
	_, _ = s.mutateLocalTransfer(sessionID, false, func(summary *runtimev1.LocalTransferSessionSummary) {
		if isTerminalTransferState(summary.GetState()) {
			return
		}
		summary.Phase = "verify"
		summary.BytesVerified += delta
		summary.SpeedBytesPerSec = 0
		summary.EtaSeconds = 0
	})
}

func (s *Service) setTransferBytesTotal(sessionID string, bytesTotal int64) {
	_, _ = s.mutateLocalTransfer(sessionID, false, func(summary *runtimev1.LocalTransferSessionSummary) {
		if isTerminalTransferState(summary.GetState()) || bytesTotal <= 0 {
			return
		}
		summary.BytesTotal = bytesTotal
	})
}

// observeTransferRate feeds one cumulative-bytes sample into the per-transfer
// sliding-window rate tracker and returns the recent download rate. The
// tracker is created lazily on first observation and dropped when the transfer
// reaches a terminal state (see mutateLocalTransfer). Access to the tracker
// map is serialized by s.mu; this runs in its own short critical section
// before mutateLocalTransfer's own s.mu section — both are non-reentrant.
func (s *Service) observeTransferRate(sessionID string, bytesReceived int64, now time.Time) (int64, bool, bool) {
	key := strings.TrimSpace(sessionID)
	if key == "" {
		return 0, false, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	summary, known := s.transfers[key]
	if !known {
		return 0, false, false
	}
	state := normalizeTransferState(summary.GetState())
	if state == localTransferStatePaused || isTerminalTransferState(state) {
		delete(s.transferRates, key)
		return 0, false, false
	}
	tracker := s.transferRates[key]
	if tracker == nil {
		tracker = &filedownload.RateTracker{}
		s.transferRates[key] = tracker
	}
	return tracker.ObserveProjection(bytesReceived, now)
}

// completeTransfer records a completed terminal state for in-process callers
// that carry no acquisition result of their own.
func (s *Service) completeTransfer(sessionID string, phase string, message string, apply func(summary *runtimev1.LocalTransferSessionSummary)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	staged := s.stageTransferCompletionLocked(sessionID, phase, message, apply)
	if staged == nil || !staged.changed {
		return nil
	}
	if err := s.persistStateLocked(); err != nil {
		staged.rollbackLocked(s)
		return err
	}
	s.publishTransferEventLocked(localTransferEventFromSummary(staged.current))
	return nil
}

type stagedTransferCompletion struct {
	key             string
	previous        *runtimev1.LocalTransferSessionSummary
	current         *runtimev1.LocalTransferSessionSummary
	previousControl *localTransferControl
	previousRate    *filedownload.RateTracker
	previousSpec    managedDownloadedModelSpec
	hadControl      bool
	hadRate         bool
	hadSpec         bool
	changed         bool
}

// stageTransferCompletionLocked mutates only in-memory transfer state. The
// caller owns s.mu and must either persist and publish the result or roll it
// back before releasing the lock. It never fabricates received bytes: a
// completion reports exactly what the transfer fetched and what it reused.
func (s *Service) stageTransferCompletionLocked(
	sessionID string,
	phase string,
	message string,
	apply func(summary *runtimev1.LocalTransferSessionSummary),
) *stagedTransferCompletion {
	key := strings.TrimSpace(sessionID)
	previous := cloneLocalTransferSummary(s.transfers[key])
	if previous == nil {
		return nil
	}
	staged := &stagedTransferCompletion{
		key:             key,
		previous:        previous,
		current:         cloneLocalTransferSummary(previous),
		previousControl: s.transferControls[key],
		previousRate:    s.transferRates[key],
		previousSpec:    cloneManagedDownloadedModelSpec(s.managedModelDownloadSpecs[key]),
	}
	_, staged.hadControl = s.transferControls[key]
	_, staged.hadRate = s.transferRates[key]
	_, staged.hadSpec = s.managedModelDownloadSpecs[key]
	if isTerminalTransferState(staged.current.GetState()) {
		return staged
	}
	staged.current.Phase = phase
	staged.current.State = localTransferStateCompleted
	staged.current.Message = message
	staged.current.ReasonCode = ""
	staged.current.Retryable = false
	staged.current.RelatedInstallSessionId = ""
	staged.current.CleanupPending = false
	staged.current.SpeedBytesPerSec = 0
	staged.current.EtaSeconds = 0
	if apply != nil {
		apply(staged.current)
	}
	staged.current.InstallSessionId = previous.GetInstallSessionId()
	staged.current.SessionKind = normalizeTransferKind(staged.current.GetSessionKind())
	staged.current.SourceLabel = previous.GetSourceLabel()
	staged.current.UpdatedAt = nowISO()
	s.transfers[key] = cloneLocalTransferSummary(staged.current)
	delete(s.transferControls, key)
	delete(s.transferRates, key)
	delete(s.managedModelDownloadSpecs, key)
	staged.current.AvailableActions = s.projectTransferActionsLocked(staged.current)
	staged.changed = true
	return staged
}

func (staged *stagedTransferCompletion) rollbackLocked(s *Service) {
	if staged == nil || !staged.changed {
		return
	}
	s.transfers[staged.key] = cloneLocalTransferSummary(staged.previous)
	if staged.hadControl {
		s.transferControls[staged.key] = staged.previousControl
	} else {
		delete(s.transferControls, staged.key)
	}
	if staged.hadRate {
		s.transferRates[staged.key] = staged.previousRate
	} else {
		delete(s.transferRates, staged.key)
	}
	if staged.hadSpec {
		s.managedModelDownloadSpecs[staged.key] = cloneManagedDownloadedModelSpec(staged.previousSpec)
	} else {
		delete(s.managedModelDownloadSpecs, staged.key)
	}
}

func (s *Service) failTransfer(sessionID string, message string, retryable bool) error {
	_, err := s.mutateLocalTransfer(sessionID, true, func(summary *runtimev1.LocalTransferSessionSummary) {
		if isTerminalTransferState(summary.GetState()) {
			return
		}
		summary.State = localTransferStateFailed
		summary.Message = message
		summary.ReasonCode = "LOCAL_TRANSFER_FAILED"
		summary.Retryable = retryable
	})
	return err
}

func (s *Service) interruptTransfer(sessionID string, message string) error {
	_, err := s.mutateLocalTransfer(sessionID, true, func(summary *runtimev1.LocalTransferSessionSummary) {
		if isTerminalTransferState(summary.GetState()) {
			return
		}
		summary.State = localTransferStatePaused
		summary.Message = message
		summary.ReasonCode = localTransferInterruptionReason
		summary.Retryable = true
		summary.SpeedBytesPerSec = 0
		summary.EtaSeconds = 0
	})
	return err
}

// cancelTransfer records the cancelled terminal state. Material discard is
// the executor's or CancelLocalTransfer's responsibility, so a busy file can
// keep cleanup pending without hiding the terminal state.
func (s *Service) cancelTransfer(sessionID string, message string) error {
	_, err := s.mutateLocalTransfer(sessionID, true, func(summary *runtimev1.LocalTransferSessionSummary) {
		if normalizeTransferState(summary.GetState()) == localTransferStateCompleted {
			return
		}
		summary.State = localTransferStateCancelled
		summary.Message = message
		summary.ReasonCode = "LOCAL_TRANSFER_CANCELLED"
		summary.Retryable = false
	})
	if err != nil {
		return err
	}
	s.mu.Lock()
	if private := s.transferPrivateLocked(sessionID); private.commitIntent != nil {
		private.commitIntent = nil
		_ = s.persistStateLocked()
	}
	s.mu.Unlock()
	s.discardCancelledIntentView(sessionID)
	return nil
}

// discardCancelledIntentView removes the uncommitted view directory of a
// cancelled create intent. It only touches a directory no committed asset
// owns; committed inventory is never rolled back by a cancel.
func (s *Service) discardCancelledIntentView(sessionID string) {
	s.mu.RLock()
	private := s.transferPrivate[strings.TrimSpace(sessionID)]
	var directory string
	if private != nil && private.commitIntent != nil {
		directory = private.commitIntent.ManagedDirectory
	}
	s.mu.RUnlock()
	if directory == "" {
		return
	}
	s.mu.RLock()
	_, owned := s.modelAssetForManagedDirectoryLocked(directory)
	s.mu.RUnlock()
	if owned || !s.validModelAssetManagedDirectory(directory) {
		return
	}
	if err := os.RemoveAll(directory); err != nil && !errors.Is(err, os.ErrNotExist) {
		s.logger.Warn("uncommitted ModelAsset view cleanup pending", "transfer_id", sessionID, "directory", directory, "error", err)
		s.setTransferCleanupPending(sessionID, true)
	}
}

// downloadToFileWithTransfer downloads sourceURL to targetPath through the
// shared filedownload core, feeding the runtime's transfer-progress projection.
//
// This is a thin model-side wrapper: the network download + bounded retry +
// HTTP Range resume + sha256 verification all live in the one shared core
// (internal/filedownload). The wrapper supplies only what is model-specific —
// a progress callback that drives updateTransferProgress, and the per-session
// pause/cancel control (transferControl) bridged into the core's Wait hook so
// the existing PauseLocalTransfer / ResumeLocalTransfer / CancelLocalTransfer
// behaviour is preserved without duplicating any retry/resume logic.
func (s *Service) downloadToFileWithTransfer(
	ctx context.Context,
	sessionID string,
	phase string,
	sourceURL string,
	targetPath string,
	expectedSHA256 string,
	completedBytes int64,
	bundleTotal int64,
	isLastFile bool,
	maxBodyBytes int64,
	header http.Header,
	timeout time.Duration,
) (filedownload.Result, error) {
	control := s.transferControl(sessionID)
	progress := func(bytesReceived, bytesTotal int64) {
		aggregateTotal := clampInt64Minimum(bundleTotal, 0)
		if aggregateTotal == 0 && isLastFile && bytesTotal > 0 {
			aggregateTotal = clampInt64Minimum(completedBytes, 0) + bytesTotal
		}
		s.updateTransferProgress(
			sessionID,
			phase,
			clampInt64Minimum(completedBytes, 0)+bytesReceived,
			aggregateTotal,
			"",
		)
	}
	var wait filedownload.WaitFunc
	if control != nil {
		wait = control.wait
	}
	maxAttempts := s.modelDownloadMaxAttempts
	if maxAttempts <= 0 {
		maxAttempts = localModelDownloadMaxAttempts
	}
	retryDelays := append([]time.Duration(nil), s.modelDownloadRetryDelays...)
	if len(retryDelays) == 0 {
		retryDelays = append([]time.Duration(nil), localModelDownloadRetryDelays...)
	}
	return filedownload.Download(ctx, filedownload.Options{
		URL:            sourceURL,
		DestPath:       targetPath,
		Client:         &http.Client{Timeout: timeout},
		Header:         header,
		ExpectedSHA256: expectedSHA256,
		MaxBodyBytes:   maxBodyBytes,
		MaxAttempts:    maxAttempts,
		RetryDelays:    retryDelays,
		IsTransient:    isTransientModelDownloadError,
		Progress:       progress,
		Wait:           wait,
		PreservePartialOnError: func(err error) bool {
			return !errors.Is(err, errLocalTransferCancelled) && !errors.Is(err, filedownload.ErrHashMismatch)
		},
	})
}
