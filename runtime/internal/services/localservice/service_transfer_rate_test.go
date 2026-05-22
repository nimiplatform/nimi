package localservice

import (
	"testing"
	"time"
)

// TestTransferRateTrackerTracksRecentBurst is the core regression for the
// download-speed fix: a transfer that starts slow then bursts must report a
// speed near the recent burst rate, not the diluted lifetime average. The old
// bytesReceived/lifetime estimator failed exactly this case.
func TestTransferRateTrackerTracksRecentBurst(t *testing.T) {
	tracker := &transferRateTracker{}
	base := time.Unix(1_700_000_000, 0)

	// Slow start: ~1 KiB/s for 4 seconds.
	tracker.observe(0, base)
	for i := 1; i <= 4; i++ {
		tracker.observe(int64(i*1024), base.Add(time.Duration(i)*time.Second))
	}

	// Fast burst: ~10 MiB/s sustained past the 5s sliding window, so the
	// lifetime-diluted slow start fully ages out of the window.
	const burstPerSec = 10 * 1024 * 1024
	cumulative := int64(4 * 1024)
	var speed int64
	var known bool
	for i := 1; i <= 6; i++ {
		cumulative += burstPerSec
		speed, known = tracker.observe(cumulative, base.Add(time.Duration(4+i)*time.Second))
	}
	if !known {
		t.Fatal("expected a recent rate to be established during the burst")
	}
	// A lifetime average here would be ~ (4KiB + 60MiB) / 10s ≈ 6 MiB/s.
	// The windowed rate must be far closer to the 10 MiB/s burst.
	if speed < 8*1024*1024 {
		t.Fatalf("windowed speed should track the burst rate, got %d B/s (want >= %d)", speed, 8*1024*1024)
	}
	// Sanity: it must not exceed the burst rate either (no fabricated number).
	if speed > 12*1024*1024 {
		t.Fatalf("windowed speed should not exceed the burst rate, got %d B/s", speed)
	}
}

// TestTransferRateTrackerResumeDoesNotReportAbsurdRate covers the resume case:
// a non-monotonic byte count (a resume from a smaller partial, or a phase
// reusing the transfer summary) must not yield a negative or absurd rate. The
// window resets and the rate re-establishes honestly from the new samples.
func TestTransferRateTrackerResumeDoesNotReportAbsurdRate(t *testing.T) {
	tracker := &transferRateTracker{}
	base := time.Unix(1_700_000_000, 0)

	// First attempt reaches 8 MiB.
	tracker.observe(0, base)
	tracker.observe(8*1024*1024, base.Add(time.Second))

	// Resume / phase reuse: bytes drop back below the last sample.
	speed, known := tracker.observe(1*1024*1024, base.Add(2*time.Second))
	if known || speed != 0 {
		t.Fatalf("a non-monotonic sample must reset the window, got speed=%d known=%v", speed, known)
	}

	// Re-establish from the resumed point: ~2 MiB/s.
	speed, known = tracker.observe(3*1024*1024, base.Add(3*time.Second))
	if !known {
		t.Fatal("expected a rate to re-establish after the resume reset")
	}
	if speed <= 0 || speed > 4*1024*1024 {
		t.Fatalf("post-resume rate must be honest (~2 MiB/s), got %d B/s", speed)
	}
}

// TestTransferRateTrackerNoRateUntilTwoSamples confirms the tracker projects
// an absent rate (rather than a guessed one) until enough evidence exists.
func TestTransferRateTrackerNoRateUntilTwoSamples(t *testing.T) {
	tracker := &transferRateTracker{}
	base := time.Unix(1_700_000_000, 0)

	if speed, known := tracker.observe(0, base); known || speed != 0 {
		t.Fatalf("a single sample must not yield a rate, got speed=%d known=%v", speed, known)
	}
	// Two samples at the same instant span zero time — still no honest rate.
	if speed, known := tracker.observe(8192, base); known || speed != 0 {
		t.Fatalf("zero-span samples must not yield a rate, got speed=%d known=%v", speed, known)
	}
}

// TestTransferRateTrackerStallYieldsNoRate confirms that once the only
// byte-delivering samples have aged out of the window and the connection has
// gone flat, the tracker projects an absent rate rather than a stale one.
func TestTransferRateTrackerStallYieldsNoRate(t *testing.T) {
	tracker := &transferRateTracker{}
	base := time.Unix(1_700_000_000, 0)

	// A burst of bytes, then the connection stalls completely.
	tracker.observe(0, base)
	tracker.observe(4*1024*1024, base.Add(time.Second))
	// Flat samples for longer than the 5s window so the burst ages out.
	var speed int64
	var known bool
	for i := 2; i <= 9; i++ {
		speed, known = tracker.observe(4*1024*1024, base.Add(time.Duration(i)*time.Second))
	}
	if known || speed != 0 {
		t.Fatalf("a stalled connection past the window must project no rate, got speed=%d known=%v", speed, known)
	}
}

// TestTransferRateTrackerStaysBounded confirms the sample ring is bounded by
// both age and the hard sample cap regardless of callback frequency.
func TestTransferRateTrackerStaysBounded(t *testing.T) {
	tracker := &transferRateTracker{}
	base := time.Unix(1_700_000_000, 0)
	for i := 0; i < 10_000; i++ {
		tracker.observe(int64(i*1024), base.Add(time.Duration(i)*10*time.Millisecond))
	}
	if len(tracker.samples) > transferRateMaxSamples {
		t.Fatalf("sample ring exceeded the cap: %d > %d", len(tracker.samples), transferRateMaxSamples)
	}
}

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
	// A second sample a moment later establishes a concrete recent rate.
	time.Sleep(20 * time.Millisecond)
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

	svc.completeTransfer(sessionID, "register", "model installed", nil)
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
