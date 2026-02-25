package usagemetrics

import (
	"context"
	"strconv"
	"strings"
	"sync"

	"google.golang.org/grpc/metadata"
)

const queueWaitMetadataKey = "x-nimi-queue-wait-ms"

type queueWaitKey struct{}

// QueueWaitRecorder records per-request queue wait in milliseconds.
type QueueWaitRecorder struct {
	mu     sync.RWMutex
	waitMs int64
}

// WithQueueWaitRecorder attaches a mutable queue-wait recorder to context.
func WithQueueWaitRecorder(ctx context.Context) (context.Context, *QueueWaitRecorder) {
	recorder := &QueueWaitRecorder{}
	return context.WithValue(ctx, queueWaitKey{}, recorder), recorder
}

// SetQueueWaitMS sets queue wait when a recorder exists in context.
func SetQueueWaitMS(ctx context.Context, waitMs int64) {
	if waitMs < 0 {
		waitMs = 0
	}
	recorder, ok := RecorderFromContext(ctx)
	if !ok || recorder == nil {
		return
	}
	recorder.Set(waitMs)
}

// QueueWaitMS reads queue wait from recorder in context.
func QueueWaitMS(ctx context.Context) int64 {
	recorder, ok := RecorderFromContext(ctx)
	if !ok || recorder == nil {
		return 0
	}
	return recorder.Value()
}

// RecorderFromContext returns attached queue-wait recorder.
func RecorderFromContext(ctx context.Context) (*QueueWaitRecorder, bool) {
	recorder, ok := ctx.Value(queueWaitKey{}).(*QueueWaitRecorder)
	if !ok || recorder == nil {
		return nil, false
	}
	return recorder, true
}

// Set writes queue wait value into recorder.
func (r *QueueWaitRecorder) Set(waitMs int64) {
	if r == nil {
		return
	}
	if waitMs < 0 {
		waitMs = 0
	}
	r.mu.Lock()
	r.waitMs = waitMs
	r.mu.Unlock()
}

// Value returns recorded queue wait.
func (r *QueueWaitRecorder) Value() int64 {
	if r == nil {
		return 0
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.waitMs
}

// QueueWaitTrailer builds grpc trailer metadata for queue wait.
func QueueWaitTrailer(waitMs int64) metadata.MD {
	if waitMs < 0 {
		waitMs = 0
	}
	return metadata.Pairs(queueWaitMetadataKey, strconv.FormatInt(waitMs, 10))
}

// ParseQueueWaitMD parses queue wait from grpc metadata.
func ParseQueueWaitMD(md metadata.MD) (int64, bool) {
	if len(md) == 0 {
		return 0, false
	}
	values := md.Get(queueWaitMetadataKey)
	if len(values) == 0 {
		return 0, false
	}
	raw := strings.TrimSpace(values[len(values)-1])
	if raw == "" {
		return 0, false
	}
	parsed, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0, false
	}
	if parsed < 0 {
		parsed = 0
	}
	return parsed, true
}
