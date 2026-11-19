package integration

import (
	"context"
	"crypto/sha256"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
)

const snapshotBytes = 64 << 10

type snapshotResult struct {
	value string
	err   error
}

type snapshotObservation struct {
	ctx                 context.Context
	cancel              context.CancelFunc
	consumer            accountservice.LocalAppCallerDecision
	source              *provider
	op                  *runtimev1.IntegrationOperation
	query, consumerName string
	// Only the next read is queued or delivered. Result deliveries are unique
	// even for the same subscription so a late completion cannot replace it.
	readID, cursor string
	delivered      bool
	replies        chan snapshotResult
}

func (s *Service) observationLiveLocked(w *snapshotObservation) bool {
	target := w.source.target.Public.TargetRef
	return !s.closed && w.ctx.Err() == nil && w.source.ctx.Err() == nil && s.providers[target] == w.source &&
		s.scopeLive(w.ctx, w.consumer, localappop.IngressIntegrationSnapshotsSubscribe) &&
		s.scopeLive(w.source.ctx, w.source.decision, localappop.IngressIntegrationProviderPoll) &&
		s.permitted(w.ctx, w.consumer.AccountID, w.consumer.RegisteredAppSubject, target, w.op.Name)
}

// @nimi-authority: rule.nimi.runtime.integration.snapshot-observation
func (s *Service) SubscribeIntegrationSnapshots(req *runtimev1.SubscribeIntegrationSnapshotsRequest, stream runtimev1.RuntimeIntegrationService_SubscribeIntegrationSnapshotsServer) error {
	ctx, cancel := context.WithCancel(stream.Context())
	defer cancel()
	d, err := s.decision(ctx, localappop.OperationIntegrationSnapshotsSubscribe)
	if err != nil {
		return err
	}
	input, err := decodeJSON(req.GetInputJson(), snapshotBytes)
	if err != nil {
		return err
	}
	name := s.consumerDisplayName(ctx, d)
	s.mu.Lock()
	p := s.providers[req.GetTargetRef()]
	if p == nil || p.target.Account != d.AccountID {
		s.mu.Unlock()
		return failure(codes.Unavailable, "INTEGRATION_PROVIDER_UNAVAILABLE")
	}
	op := operation(p.target, req.GetOperation())
	if !op.GetSnapshotRead() {
		s.mu.Unlock()
		return failure(codes.FailedPrecondition, "INTEGRATION_SNAPSHOT_READ_REQUIRED")
	}
	w := &snapshotObservation{ctx: ctx, cancel: cancel, consumer: d, source: p, op: op, query: req.InputJson, consumerName: name, replies: make(chan snapshotResult, 1)}
	if !s.observationLiveLocked(w) {
		s.mu.Unlock()
		return failure(codes.PermissionDenied, "INTEGRATION_PERMISSION_REQUIRED")
	}
	if err := validateSchema(op.InputSchemaJson, input); err != nil {
		s.mu.Unlock()
		return err
	}
	count := 0
	for other := range s.observations {
		if sameScope(other.consumer, d) {
			count++
		}
	}
	if count >= 8 || len(s.observations) >= 64 {
		s.mu.Unlock()
		return failure(codes.ResourceExhausted, "INTEGRATION_SNAPSHOT_LIMIT")
	}
	s.observations[w] = struct{}{}
	s.mu.Unlock()
	defer func() { s.mu.Lock(); delete(s.observations, w); s.mu.Unlock() }()
	for {
		s.mu.Lock()
		if !s.observationLiveLocked(w) {
			s.mu.Unlock()
			return failure(codes.PermissionDenied, "INTEGRATION_SCOPE_ENDED")
		}
		w.readID = "isr_" + ulid.Make().String()
		w.delivered = false
		s.mu.Unlock()
		timeout := time.NewTimer(20 * time.Second)
		select {
		case <-ctx.Done():
			timeout.Stop()
			return ctx.Err()
		case <-d.SessionInvalidated:
			timeout.Stop()
			return failure(codes.PermissionDenied, "INTEGRATION_SCOPE_ENDED")
		case <-p.ctx.Done():
			timeout.Stop()
			return failure(codes.Unavailable, "INTEGRATION_PROVIDER_UNAVAILABLE")
		case <-s.ctx.Done():
			timeout.Stop()
			return failure(codes.Unavailable, "INTEGRATION_UNAVAILABLE")
		case <-timeout.C:
			return failure(codes.DeadlineExceeded, "INTEGRATION_SNAPSHOT_TIMEOUT")
		case reply := <-w.replies:
			timeout.Stop()
			if reply.err != nil {
				return reply.err
			}
			digest := fmt.Sprintf("%x", sha256.Sum256([]byte(reply.value)))
			s.mu.Lock()
			live := s.observationLiveLocked(w)
			changed := digest != w.cursor
			w.cursor = digest
			s.mu.Unlock()
			if !live {
				return failure(codes.PermissionDenied, "INTEGRATION_SCOPE_ENDED")
			}
			if changed {
				if err = stream.Send(&runtimev1.SubscribeIntegrationSnapshotsResponse{Cursor: digest, ResultJson: reply.value}); err != nil {
					return err
				}
			}
		}
		// Backpressure applies to an entire snapshot; slow readers coalesce
		// intermediate changes without accumulating a queue or call history.
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-p.ctx.Done():
			return failure(codes.Unavailable, "INTEGRATION_PROVIDER_UNAVAILABLE")
		case <-time.After(200 * time.Millisecond):
		}
	}
}

func (s *Service) pollSnapshotReadsLocked(d accountservice.LocalAppCallerDecision, result *runtimev1.PollIntegrationProviderResponse) {
	for w := range s.observations {
		if len(result.Calls) >= 64 {
			return
		}
		if w.delivered || w.readID == "" || !sameScope(w.source.decision, d) {
			continue
		}
		if !s.observationLiveLocked(w) {
			w.cancel()
			continue
		}
		cursor := w.cursor
		result.Calls = append(result.Calls, &runtimev1.IntegrationProviderCall{CallId: w.readID, TargetRef: w.source.target.Public.TargetRef, Operation: w.op.Name, InputJson: w.query, ConsumerDisplayName: w.consumerName, ConsumerRef: ref("icons_", w.consumer.AccountID, w.consumer.RegisteredAppSubject), AfterSnapshot: &cursor})
		w.delivered = true
	}
}

func (s *Service) completeSnapshotRead(ctx context.Context, req *runtimev1.CompleteIntegrationProviderRequest) (*runtimev1.CompleteIntegrationProviderResponse, error) {
	d, err := s.decision(ctx, localappop.OperationIntegrationProviderComplete)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for w := range s.observations {
		if w.readID != req.CallId || !w.delivered || !sameScope(d, w.source.decision) {
			continue
		}
		if !s.observationLiveLocked(w) {
			w.cancel()
			break
		}
		var reply snapshotResult
		switch {
		case req.Asset != nil:
			return nil, failure(codes.InvalidArgument, "INTEGRATION_MEDIA_INVALID")
		case req.ErrorCode != "":
			reply.err = failure(codes.FailedPrecondition, "INTEGRATION_PROVIDER_FAILED")
		default:
			value, err := decodeJSON(req.ResultJson, snapshotBytes)
			if err == nil {
				err = validateSchema(w.op.OutputSchemaJson, value)
			}
			if err != nil {
				reply.err = err
			} else {
				reply.value = req.ResultJson
			}
		}
		w.readID = ""
		w.replies <- reply
		return &runtimev1.CompleteIntegrationProviderResponse{Accepted: true}, nil
	}
	return &runtimev1.CompleteIntegrationProviderResponse{}, nil
}

func isSnapshotRead(id string) bool { return strings.HasPrefix(id, "isr_") }

func (s *Service) revokeSnapshotReadsLocked(account, subject, target string, retained map[string]bool) {
	for w := range s.observations {
		if w.consumer.AccountID == account && w.consumer.RegisteredAppSubject == subject && w.source.target.Public.TargetRef == target && !retained[w.op.Name] {
			w.cancel()
		}
	}
}
