package localservice

import "time"

// transferRateWindow bounds how far back the sliding-window rate estimator
// looks. Speed is the byte delta across the samples still inside this window,
// so a connection that started slow then sped up (or stalled, or throttled)
// reports a number that tracks the *current* rate rather than the diluted
// lifetime average.
const transferRateWindow = 5 * time.Second

// transferRateProjectionInterval prevents the projected speed from changing
// at the filedownload chunk callback rate. Byte progress is still published
// for every callback; the estimator admits at most one new rate sample per
// second so the effective window is stable and ETA does not amplify
// sub-second transport jitter.
const transferRateProjectionInterval = time.Second

// transferRateMaxSamples caps the per-transfer sample ring so the tracker
// stays bounded regardless of how often the filedownload progress callback
// fires. Older samples are pruned by age first; this cap is a hard ceiling.
const transferRateMaxSamples = 64

// transferRateSample is one observed (monotonic clock instant, cumulative
// bytes received) point for a single transfer.
type transferRateSample struct {
	at    time.Time
	bytes int64
}

// transferRateTracker is a bounded, per-transfer sliding-window download-rate
// estimator. It holds only the recent samples needed to derive a recent rate
// from observed byte deltas — never totalBytes / lifetime. One tracker lives
// per in-flight transfer in Service.transferRates, created lazily and dropped
// when the transfer reaches a terminal state. All access is serialized by
// Service.mu; the tracker holds no lock of its own.
type transferRateTracker struct {
	samples           []transferRateSample
	lastObservedBytes int64
	hasLastObserved   bool
}

// observe records a new cumulative-bytes sample and returns the recent download
// rate in bytes/sec, or (0, false) when no honest rate can yet be established.
//
// It deliberately fails closed in two ways rather than fabricating a number:
//   - A non-monotonic byte count (bytesReceived dropped below the last sample)
//     means a resume from a smaller partial, or a phase reusing the transfer
//     summary with unrelated counts. The window is reset; the prior samples
//     would otherwise yield a negative or absurd rate.
//   - A single sample, or samples spanning zero wall time, yields no rate.
//
// `now` is injected so tests can drive a deterministic clock.
func (t *transferRateTracker) observe(bytesReceived int64, now time.Time) (int64, bool) {
	speed, known, _ := t.observeProjection(bytesReceived, now)
	return speed, known
}

// observeProjection additionally reports whether this observation was
// admitted as a new projection sample. Callers use that signal to keep ETA on
// the same cadence as speed while continuing to publish raw byte progress.
func (t *transferRateTracker) observeProjection(bytesReceived int64, now time.Time) (int64, bool, bool) {
	if bytesReceived < 0 {
		bytesReceived = 0
	}
	if t.hasLastObserved && bytesReceived < t.lastObservedBytes {
		// Non-monotonic: resume / phase reuse. Drop the stale window and
		// restart from this sample so the next rate is honest.
		t.samples = t.samples[:0]
	}
	t.lastObservedBytes = bytesReceived
	t.hasLastObserved = true
	if n := len(t.samples); n > 0 {
		elapsed := now.Sub(t.samples[n-1].at)
		if elapsed < 0 || elapsed > transferRateWindow {
			// time.Now carries a monotonic reading in production. Fail closed
			// for an injected backwards clock or a long observation gap.
			t.samples = t.samples[:0]
		} else if elapsed < transferRateProjectionInterval {
			speed, known := t.rate()
			return speed, known, false
		}
	}
	t.samples = append(t.samples, transferRateSample{at: now, bytes: bytesReceived})
	t.prune(now)
	speed, known := t.rate()
	return speed, known, true
}

// prune drops samples older than the sliding window and enforces the hard
// sample-count ceiling. The most recent sample is always kept.
func (t *transferRateTracker) prune(now time.Time) {
	cutoff := now.Add(-transferRateWindow)
	drop := 0
	for drop < len(t.samples)-1 && t.samples[drop].at.Before(cutoff) {
		drop++
	}
	if drop > 0 {
		t.samples = append(t.samples[:0], t.samples[drop:]...)
	}
	if over := len(t.samples) - transferRateMaxSamples; over > 0 {
		t.samples = append(t.samples[:0], t.samples[over:]...)
	}
}

// rate computes the recent rate as the byte delta over the wall time spanned
// by the samples still inside the window. It returns (0, false) when fewer
// than two samples exist, when the span is non-positive, or when the delta is
// non-positive — an honest "no rate yet" rather than a guessed one.
func (t *transferRateTracker) rate() (int64, bool) {
	n := len(t.samples)
	if n < 2 {
		return 0, false
	}
	oldest := t.samples[0]
	newest := t.samples[n-1]
	span := newest.at.Sub(oldest.at)
	if span <= 0 {
		return 0, false
	}
	delta := newest.bytes - oldest.bytes
	if delta <= 0 {
		return 0, false
	}
	speed := int64(float64(delta) / span.Seconds())
	if speed <= 0 {
		return 0, false
	}
	return speed, true
}
