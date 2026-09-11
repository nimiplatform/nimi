package filedownload

import (
	"testing"
	"time"
)

// TestTransferRateTrackerTracksRecentBurst is the core regression for the
// download-speed fix: a transfer that starts slow then bursts must report a
// speed near the recent burst rate, not the diluted lifetime average. The old
// bytesReceived/lifetime estimator failed exactly this case.
func TestTransferRateTrackerTracksRecentBurst(t *testing.T) {
	tracker := &RateTracker{}
	base := time.Unix(1_700_000_000, 0)

	// Slow start: ~1 KiB/s for 4 seconds.
	tracker.Observe(0, base)
	for i := 1; i <= 4; i++ {
		tracker.Observe(int64(i*1024), base.Add(time.Duration(i)*time.Second))
	}

	// Fast burst: ~10 MiB/s sustained past the 5s sliding window, so the
	// lifetime-diluted slow start fully ages out of the window.
	const burstPerSec = 10 * 1024 * 1024
	cumulative := int64(4 * 1024)
	var speed int64
	var known bool
	for i := 1; i <= 6; i++ {
		cumulative += burstPerSec
		speed, known = tracker.Observe(cumulative, base.Add(time.Duration(4+i)*time.Second))
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

// TestTransferRateTrackerLimitsProjectionCadenceAcrossChunkEvents proves that
// the user-visible rate is not recalculated at the filedownload callback rate.
// Bytes still arrive on every sample, but sub-second chunk jitter must not
// produce a new projected speed for every chunk.
func TestTransferRateTrackerLimitsProjectionCadenceAcrossChunkEvents(t *testing.T) {
	tracker := &RateTracker{}
	base := time.Unix(1_700_000_000, 0)

	tracker.Observe(0, base)
	const baselineBytes = int64(10 * 1024 * 1024)
	baseline, known := tracker.Observe(baselineBytes, base.Add(time.Second))
	if !known || baseline <= 0 {
		t.Fatalf("expected baseline rate, got speed=%d known=%v", baseline, known)
	}

	cumulative := baselineBytes
	for i := 1; i < 10; i++ {
		if i%2 == 0 {
			cumulative += 64 * 1024
		} else {
			cumulative += 2 * 1024 * 1024
		}
		speed, sampleKnown := tracker.Observe(cumulative, base.Add(time.Second+time.Duration(i)*100*time.Millisecond))
		if !sampleKnown {
			t.Fatalf("chunk %d lost an established rate", i)
		}
		if speed != baseline {
			t.Fatalf("chunk %d changed projected speed inside one second: got %d, baseline %d", i, speed, baseline)
		}
	}
}

// TestTransferRateTrackerShortSpikeDoesNotDominateProjection covers a single
// brief throughput spike after a long stable transfer. High callback frequency
// must not collapse the effective window to the hard sample cap and amplify
// the spike into a large speed/ETA jump.
func TestTransferRateTrackerShortSpikeDoesNotDominateProjection(t *testing.T) {
	tracker := &RateTracker{}
	base := time.Unix(1_700_000_000, 0)
	cumulative := int64(0)
	tracker.Observe(cumulative, base)

	const stableChunk = int64(100 * 1024)
	var baseline int64
	var known bool
	for i := 1; i <= 2_000; i++ {
		cumulative += stableChunk
		baseline, known = tracker.Observe(cumulative, base.Add(time.Duration(i)*10*time.Millisecond))
	}
	if !known || baseline <= 0 {
		t.Fatalf("expected stable baseline rate, got speed=%d known=%v", baseline, known)
	}

	cumulative += 8 * 1024 * 1024
	spikeRate, spikeKnown := tracker.Observe(cumulative, base.Add(20*time.Second+10*time.Millisecond))
	if !spikeKnown {
		t.Fatal("brief spike unexpectedly removed an established rate")
	}
	if spikeRate > baseline*5/4 {
		t.Fatalf("brief spike dominated projected rate: got %d, stable baseline %d", spikeRate, baseline)
	}

	for i := 2_002; i <= 2_100; i++ {
		cumulative += stableChunk
		spikeRate, spikeKnown = tracker.Observe(cumulative, base.Add(time.Duration(i)*10*time.Millisecond))
	}
	if !spikeKnown || spikeRate > baseline*5/4 {
		t.Fatalf("brief spike caused a sustained projection jump: got %d, stable baseline %d", spikeRate, baseline)
	}
}

// TestTransferRateTrackerResumeDoesNotReportAbsurdRate covers the resume case:
// a non-monotonic byte count (a resume from a smaller partial, or a phase
// reusing the transfer summary) must not yield a negative or absurd rate. The
// window resets and the rate re-establishes honestly from the new samples.
func TestTransferRateTrackerResumeDoesNotReportAbsurdRate(t *testing.T) {
	tracker := &RateTracker{}
	base := time.Unix(1_700_000_000, 0)

	// First attempt reaches 8 MiB.
	tracker.Observe(0, base)
	tracker.Observe(8*1024*1024, base.Add(time.Second))

	// Resume / phase reuse: bytes drop back below the last sample.
	speed, known := tracker.Observe(1*1024*1024, base.Add(2*time.Second))
	if known || speed != 0 {
		t.Fatalf("a non-monotonic sample must reset the window, got speed=%d known=%v", speed, known)
	}

	// Re-establish from the resumed point: ~2 MiB/s.
	speed, known = tracker.Observe(3*1024*1024, base.Add(3*time.Second))
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
	tracker := &RateTracker{}
	base := time.Unix(1_700_000_000, 0)

	if speed, known := tracker.Observe(0, base); known || speed != 0 {
		t.Fatalf("a single sample must not yield a rate, got speed=%d known=%v", speed, known)
	}
	// Two samples at the same instant span zero time — still no honest rate.
	if speed, known := tracker.Observe(8192, base); known || speed != 0 {
		t.Fatalf("zero-span samples must not yield a rate, got speed=%d known=%v", speed, known)
	}
}

// TestTransferRateTrackerStallYieldsNoRate confirms that once the only
// byte-delivering samples have aged out of the window and the connection has
// gone flat, the tracker projects an absent rate rather than a stale one.
func TestTransferRateTrackerStallYieldsNoRate(t *testing.T) {
	tracker := &RateTracker{}
	base := time.Unix(1_700_000_000, 0)

	// A burst of bytes, then the connection stalls completely.
	tracker.Observe(0, base)
	tracker.Observe(4*1024*1024, base.Add(time.Second))
	// Flat samples for longer than the 5s window so the burst ages out.
	var speed int64
	var known bool
	for i := 2; i <= 9; i++ {
		speed, known = tracker.Observe(4*1024*1024, base.Add(time.Duration(i)*time.Second))
	}
	if known || speed != 0 {
		t.Fatalf("a stalled connection past the window must project no rate, got speed=%d known=%v", speed, known)
	}
}

// TestTransferRateTrackerStaysBounded confirms the sample ring is bounded by
// both age and the hard sample cap regardless of callback frequency.
func TestTransferRateTrackerStaysBounded(t *testing.T) {
	tracker := &RateTracker{}
	base := time.Unix(1_700_000_000, 0)
	for i := 0; i < 10_000; i++ {
		tracker.Observe(int64(i*1024), base.Add(time.Duration(i)*10*time.Millisecond))
	}
	if len(tracker.samples) > rateMaxSamples {
		t.Fatalf("sample ring exceeded the cap: %d > %d", len(tracker.samples), rateMaxSamples)
	}
}
