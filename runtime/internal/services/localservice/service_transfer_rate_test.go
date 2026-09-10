package localservice

import (
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/filedownload"
)

// TestUpdateTransferProgressUsesRecentRate exercises the full wiring: the
// transfer summary's SpeedBytesPerSec is driven by the windowed estimator, and
// completion clears the rate so a terminal summary projects no active rate.
func TestUpdateTransferProgressUsesRecentRate(t *testing.T) {
	svc := newTestService(t)
	transfer := svc.newLocalTransfer(localTransferKindDownload, localTransferMutation{
		ModelID: "local/rate-fixture",
		Phase:   "download",
		State:   localTransferStateRunning,
	})
	sessionID := transfer.GetInstallSessionId()

	const total = int64(64 * 1024 * 1024)
	// The first sample establishes no rate yet (one sample).
	svc.updateTransferProgress(sessionID, "download", 0, total, "")
	if first := svc.localTransferSummary(sessionID); first.GetSpeedBytesPerSec() != 0 || first.GetEtaSeconds() != 0 {
		t.Fatalf("a single progress sample must project an absent rate/ETA, got speed=%d eta=%d",
			first.GetSpeedBytesPerSec(), first.GetEtaSeconds())
	}
	// Move the injected estimator boundary one projection interval back so the
	// next progress callback establishes a concrete recent rate without making
	// the test sleep for a wall-clock second.
	svc.mu.Lock()
	tracker := svc.transferRates[sessionID]
	if tracker == nil {
		svc.mu.Unlock()
		t.Fatal("first progress sample did not establish the transfer tracker")
	}
	tracker = &filedownload.RateTracker{}
	tracker.Observe(0, time.Now().Add(-time.Second))
	svc.transferRates[sessionID] = tracker
	svc.mu.Unlock()
	svc.updateTransferProgress(sessionID, "download", 8*1024*1024, total, "")

	summary := svc.localTransferSummary(sessionID)
	if summary.GetSpeedBytesPerSec() <= 0 {
		t.Fatalf("expected a concrete recent rate, got %d B/s", summary.GetSpeedBytesPerSec())
	}
	// ETA is derived from the recent rate; a concrete rate yields a
	// non-negative ETA (it may round to 0 when the windowed rate is high).
	if summary.GetEtaSeconds() < 0 {
		t.Fatalf("ETA must never be negative, got %d s", summary.GetEtaSeconds())
	}

	if err := svc.completeTransfer(sessionID, "register", "model installed", nil); err != nil {
		t.Fatalf("complete transfer: %v", err)
	}
	final := svc.localTransferSummary(sessionID)
	if final.GetSpeedBytesPerSec() != 0 || final.GetEtaSeconds() != 0 {
		t.Fatalf("a completed transfer must not report an active rate/ETA, got speed=%d eta=%d",
			final.GetSpeedBytesPerSec(), final.GetEtaSeconds())
	}
	svc.mu.RLock()
	_, trackerLeft := svc.transferRates[sessionID]
	svc.mu.RUnlock()
	if trackerLeft {
		t.Fatal("rate tracker must be dropped when the transfer reaches a terminal state")
	}
}

func TestUpdateTransferProgressUnknownTotalOmitsETA(t *testing.T) {
	svc := newTestService(t)
	transfer := svc.newLocalTransfer(localTransferKindDownload, localTransferMutation{
		ModelID: "local/unknown-total-rate-fixture",
		Phase:   "download",
		State:   localTransferStateRunning,
	})
	sessionID := transfer.GetInstallSessionId()

	svc.mu.Lock()
	tracker := &filedownload.RateTracker{}
	tracker.Observe(0, time.Now().Add(-time.Second))
	svc.transferRates[sessionID] = tracker
	svc.mu.Unlock()
	svc.updateTransferProgress(sessionID, "download", 8*1024*1024, 0, "")

	summary := svc.localTransferSummary(sessionID)
	if summary.GetSpeedBytesPerSec() <= 0 {
		t.Fatalf("expected an observed rate with unknown total, got %d", summary.GetSpeedBytesPerSec())
	}
	if summary.GetEtaSeconds() != 0 {
		t.Fatalf("unknown total fabricated ETA %d", summary.GetEtaSeconds())
	}
}

func TestUpdateTransferProgressLimitsETACadenceAcrossChunks(t *testing.T) {
	svc := newTestService(t)
	transfer := svc.newLocalTransfer(localTransferKindDownload, localTransferMutation{
		ModelID: "local/eta-cadence-fixture",
		Phase:   "download",
		State:   localTransferStateRunning,
	})
	sessionID := transfer.GetInstallSessionId()

	svc.mu.Lock()
	tracker := &filedownload.RateTracker{}
	tracker.Observe(0, time.Now().Add(-time.Second))
	svc.transferRates[sessionID] = tracker
	svc.mu.Unlock()
	const total = int64(100 * 1024 * 1024)
	svc.updateTransferProgress(sessionID, "download", 10*1024*1024, total, "")
	baseline := svc.localTransferSummary(sessionID)
	if baseline.GetSpeedBytesPerSec() <= 0 || baseline.GetEtaSeconds() <= 0 {
		t.Fatalf("expected established speed/ETA, got speed=%d eta=%d", baseline.GetSpeedBytesPerSec(), baseline.GetEtaSeconds())
	}

	// A large byte burst inside the same projection interval still updates raw
	// bytes immediately, but must not repaint ETA at the chunk callback rate.
	svc.updateTransferProgress(sessionID, "download", 50*1024*1024, total, "")
	burst := svc.localTransferSummary(sessionID)
	if burst.GetBytesReceived() != 50*1024*1024 {
		t.Fatalf("chunk bytes were throttled: got %d", burst.GetBytesReceived())
	}
	if burst.GetEtaSeconds() != baseline.GetEtaSeconds() {
		t.Fatalf("ETA changed inside one projection interval: got %d, baseline %d", burst.GetEtaSeconds(), baseline.GetEtaSeconds())
	}
}
