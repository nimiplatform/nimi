package integration

import (
	"context"
	"io"
	"sync"
	"time"
)

// Reserves the complete buffering/encoding envelope before reading owned
// bytes. A reservation lasts through the external write, not just encoding.
type nativeEncodingBudget struct {
	mu    sync.Mutex
	bytes int64
	count int
}

func (b *nativeEncodingBudget) reserve(size int64) (func(), error) {
	if size < 1 || size > maxMediaBytes {
		return nil, adapterError("INTEGRATION_MEDIA_INVALID")
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	size = size*6 + 1024*1024
	if size <= 0 || size > 128*1024*1024 || b.count >= 4 || b.bytes+size > 128*1024*1024 {
		return nil, adapterError("INTEGRATION_MEDIA_BUSY")
	}
	b.bytes += size
	b.count++
	return func() { b.mu.Lock(); b.bytes -= size; b.count--; b.mu.Unlock() }, nil
}
func (s *Service) encodedNativeAsset(c *invocation, body nativeBody, limit int64) ([]byte, func(), error) {
	if body.Asset.SizeBytes < 1 || body.Asset.SizeBytes > limit || (body.Kind == "file" && !safeNativeFileName(body.FileName)) {
		return nil, nil, adapterError("INTEGRATION_MEDIA_INVALID")
	}
	release, err := s.nativeEncoding.reserve(body.Asset.SizeBytes)
	if err != nil {
		return nil, nil, err
	}
	source, err := s.captureOutboundAsset(c, body.Asset)
	if err != nil {
		release()
		return nil, nil, err
	}
	defer source.Body.Close()
	data, err := io.ReadAll(io.LimitReader(source.Body, body.Asset.SizeBytes+1))
	if err != nil || int64(len(data)) != body.Asset.SizeBytes || mediaDigest(data) != body.Asset.SHA256 {
		release()
		return nil, nil, adapterError("INTEGRATION_MEDIA_INTEGRITY_INVALID")
	}
	if body.Kind == "image" && !nativeImage(data, body.Asset.MediaType) {
		release()
		return nil, nil, adapterError("INTEGRATION_MEDIA_INVALID")
	}
	return data, release, nil
}

// Receiver I/O is admitted by one actual, still-live shared reader. No cached
// decision or delayed cancellation watcher substitutes for this fence.
func (s *Service) admitNativeReception(f *nativeFeed) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	f.mu.Lock()
	calls := make([]*invocation, 0, len(f.leases))
	for c := range f.leases {
		calls = append(calls, c)
	}
	f.mu.Unlock()
	for _, c := range calls {
		if !c.decision.ExpiresAt.IsZero() && !time.Now().Before(c.decision.ExpiresAt) {
			continue
		}
		if s.withCallCommitLocked(c, func(context.Context) error { return nil }) == nil {
			return nil
		}
	}
	return adapterError("INTEGRATION_SCOPE_ENDED")
}
