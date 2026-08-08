package localservice

import (
	"context"
	"net/http"
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
	// bounded sliding window (see service_transfer_rate.go). It deliberately is
	// NOT bytesReceived / lifetime: a lifetime average lags the current rate,
	// is meaningless across a filedownload resume (bytesReceived carries prior
	// attempts while the lifetime started fresh), and is skewed by any gap
	// before bytes start flowing. observeTransferRate records the sample and
	// returns the windowed rate; speedKnown is false until an honest rate is
	// established, in which case speed/eta are left absent rather than guessed.
	speed, speedKnown := s.observeTransferRate(sessionID, maxInt64(bytesReceived, 0), time.Now())
	_ = s.mutateLocalTransfer(sessionID, false, func(summary *runtimev1.LocalTransferSessionSummary) {
		// A terminal session must never be resurrected by a late in-flight
		// progress sample (e.g. a copy/hash callback racing a cancel).
		if isTerminalTransferState(summary.GetState()) {
			return
		}
		summary.Phase = phase
		summary.State = localTransferStateRunning
		summary.BytesReceived = maxInt64(bytesReceived, 0)
		if bytesTotal > 0 {
			summary.BytesTotal = maxInt64(bytesTotal, 0)
		}
		if strings.TrimSpace(message) != "" {
			summary.Message = message
		}
		if speedKnown {
			summary.SpeedBytesPerSec = maxInt64(speed, 0)
			if summary.GetBytesTotal() > 0 && speed > 0 && summary.GetBytesReceived() < summary.GetBytesTotal() {
				summary.EtaSeconds = maxInt64((summary.GetBytesTotal()-summary.GetBytesReceived())/speed, 0)
			} else {
				summary.EtaSeconds = 0
			}
		} else {
			summary.SpeedBytesPerSec = 0
			summary.EtaSeconds = 0
		}
	})
}

// observeTransferRate feeds one cumulative-bytes sample into the per-transfer
// sliding-window rate tracker and returns the recent download rate. The
// tracker is created lazily on first observation and dropped when the transfer
// reaches a terminal state (see mutateLocalTransfer). Access to the tracker
// map is serialized by s.mu; this runs in its own short critical section
// before mutateLocalTransfer's own s.mu section — both are non-reentrant.
func (s *Service) observeTransferRate(sessionID string, bytesReceived int64, now time.Time) (int64, bool) {
	key := strings.TrimSpace(sessionID)
	if key == "" {
		return 0, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, known := s.transfers[key]; !known {
		return 0, false
	}
	tracker := s.transferRates[key]
	if tracker == nil {
		tracker = &transferRateTracker{}
		s.transferRates[key] = tracker
	}
	return tracker.observe(bytesReceived, now)
}

func (s *Service) completeTransfer(
	sessionID string,
	phase string,
	message string,
	apply func(summary *runtimev1.LocalTransferSessionSummary),
) {
	_ = s.mutateLocalTransfer(sessionID, true, func(summary *runtimev1.LocalTransferSessionSummary) {
		// A session that already settled (e.g. cancelled while the worker was
		// mid-flight) must not be flipped back to a different terminal state.
		if isTerminalTransferState(summary.GetState()) {
			return
		}
		summary.Phase = phase
		summary.State = localTransferStateCompleted
		summary.Message = message
		summary.ReasonCode = ""
		summary.Retryable = false
		if summary.GetBytesTotal() > 0 && summary.GetBytesReceived() < summary.GetBytesTotal() {
			summary.BytesReceived = summary.GetBytesTotal()
		}
		// A completed transfer is no longer downloading: a leftover speed/ETA
		// from the last in-flight sample would read as an active rate. Clear
		// them so the terminal summary projects an honest absent rate.
		summary.SpeedBytesPerSec = 0
		summary.EtaSeconds = 0
		if apply != nil {
			apply(summary)
		}
	})
}

func (s *Service) failTransfer(sessionID string, message string, retryable bool) {
	_ = s.mutateLocalTransfer(sessionID, true, func(summary *runtimev1.LocalTransferSessionSummary) {
		if isTerminalTransferState(summary.GetState()) {
			return
		}
		summary.State = localTransferStateFailed
		summary.Message = message
		summary.ReasonCode = "LOCAL_TRANSFER_FAILED"
		summary.Retryable = retryable
	})
}

func (s *Service) cancelTransfer(sessionID string, message string) {
	_ = s.mutateLocalTransfer(sessionID, true, func(summary *runtimev1.LocalTransferSessionSummary) {
		summary.State = localTransferStateCancelled
		summary.Message = message
		summary.ReasonCode = "LOCAL_TRANSFER_CANCELLED"
		summary.Retryable = false
	})
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
	maxBodyBytes int64,
	header http.Header,
	timeout time.Duration,
) (filedownload.Result, error) {
	control := s.transferControl(sessionID)
	// When this download runs inside a local-environment materializer job, the
	// job context carries a per-job byte-progress sink (K-RPC-025 progress
	// projection). updateTransferProgress already derives a bounded speed / ETA
	// onto the transfer summary; reading it back after the update reuses that
	// one rate computation rather than duplicating it. A context with no sink
	// (the InstallVerifiedAsset RPC path) leaves behaviour unchanged.
	jobProgressSink := localEnvironmentJobDownloadProgressSinkFromContext(ctx)
	progress := func(bytesReceived, bytesTotal int64) {
		s.updateTransferProgress(sessionID, phase, bytesReceived, bytesTotal, "")
		if jobProgressSink == nil {
			return
		}
		summary := s.localTransferSummary(sessionID)
		jobProgressSink(localEnvironmentDependencyJobProgress{
			BytesReceived:    bytesReceived,
			BytesTotal:       bytesTotal,
			SpeedBytesPerSec: summary.GetSpeedBytesPerSec(),
			EtaSeconds:       summary.GetEtaSeconds(),
		})
	}
	var wait filedownload.WaitFunc
	if control != nil {
		wait = control.wait
	}
	return filedownload.Download(ctx, filedownload.Options{
		URL:            sourceURL,
		DestPath:       targetPath,
		Client:         &http.Client{Timeout: timeout},
		Header:         header,
		ExpectedSHA256: expectedSHA256,
		MaxBodyBytes:   maxBodyBytes,
		MaxAttempts:    localModelDownloadMaxAttempts,
		RetryBackoff:   localModelDownloadRetryBackoff,
		IsTransient:    isTransientModelDownloadError,
		Progress:       progress,
		Wait:           wait,
	})
}
