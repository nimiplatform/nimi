package nimillm

import (
	"context"
	"io"
	"net/http"
	"sync"
	"time"
)

// @nimi-authority: rule.nimi.runtime.service-operations.scenario-job-execution-scope
// These are budgets for one admitted body transfer, never a Job deadline.
// A parent work's true-authority cancellation remains effective throughout.
type mediaBodyLimits struct {
	headers, idle time.Duration
	bytes         int64
}

func defaultMediaBodyLimits() mediaBodyLimits {
	return mediaBodyLimits{headers: 30 * time.Second, idle: 60 * time.Second, bytes: maxStreamedMediaArtifactBytes}
}

func mediaBodyTotalBudget(bytes int64) time.Duration {
	return time.Duration((bytes+(256<<10)-1)/(256<<10))*time.Second + 120*time.Second
}

type mediaBodyBudget struct {
	ctx                 context.Context
	cancel              context.CancelCauseFunc
	mu                  sync.Mutex
	header, idle, total *time.Timer
	limits              mediaBodyLimits
	started             time.Time
	closed              bool
}

func newMediaBodyRequest(ctx context.Context, uri string, limits mediaBodyLimits) (*http.Client, *http.Request, *mediaBodyBudget, error) {
	work, cancel := context.WithCancelCause(ctx)
	b := &mediaBodyBudget{ctx: work, cancel: cancel, limits: limits, started: time.Now()}
	b.header = time.AfterFunc(limits.headers, func() { cancel(context.DeadlineExceeded) })
	b.total = time.AfterFunc(mediaBodyTotalBudget(limits.bytes), func() { cancel(context.DeadlineExceeded) })
	client, request, err := newSecuredHTTPRequest(work, http.MethodGet, uri, nil)
	if err != nil {
		b.close()
		return nil, nil, nil, err
	}
	// The previous generic client timeout also covered the entire streamed
	// body. Its transport/security/Connector gate stays intact; this transfer's
	// explicit timers now own that resource limit.
	client.Timeout = 0
	return client, request, b, nil
}

func (b *mediaBodyBudget) headersComplete(length int64) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return
	}
	b.header.Stop()
	if length >= 0 && length < b.limits.bytes {
		b.total.Reset(max(time.Nanosecond, mediaBodyTotalBudget(length)-time.Since(b.started)))
	}
}

// Idle means a blocked body read. Consumer backpressure has no read in flight
// and is bounded by the total resource budget, rather than misreported as a
// stalled network. Only one reader owns each response body.
func (b *mediaBodyBudget) startRead() {
	b.mu.Lock()
	defer b.mu.Unlock()
	if !b.closed {
		b.idle = time.AfterFunc(b.limits.idle, func() { b.cancel(context.DeadlineExceeded) })
	}
}
func (b *mediaBodyBudget) endRead() {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.idle != nil {
		b.idle.Stop()
		b.idle = nil
	}
}
func (b *mediaBodyBudget) close() {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return
	}
	b.closed = true
	b.header.Stop()
	b.total.Stop()
	if b.idle != nil {
		b.idle.Stop()
	}
	b.cancel(context.Canceled)
}

type budgetedMediaBody struct {
	io.ReadCloser
	budget *mediaBodyBudget
}

func (r *budgetedMediaBody) Read(p []byte) (int, error) {
	r.budget.startRead()
	n, err := r.ReadCloser.Read(p)
	r.budget.endRead()
	if err != nil && r.budget.ctx.Err() != nil {
		err = context.Cause(r.budget.ctx)
	}
	return n, err
}
func (r *budgetedMediaBody) Close() error { r.budget.close(); return r.ReadCloser.Close() }
