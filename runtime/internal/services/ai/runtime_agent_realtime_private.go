package ai

import (
	"context"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/agentintent"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
)

const runtimeAgentRealtimePrivateAppID = "runtime.agent"

func (s *Service) ResetRuntimeAgentRealtimeContext(ctx context.Context, accountID, sessionID string, generation uint64) error {
	record, err := s.authorizedRealtimeRecord(runtimeAgentRealtimeOwnerContext(ctx, accountID), sessionID, generation)
	if err != nil {
		return err
	}
	if !record.operationMu.TryLock() {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	defer record.operationMu.Unlock()
	record.mu.Lock()
	idle := !record.closed && record.pendingRequestID == "" && !record.selfWaiting
	record.mu.Unlock()
	if !idle {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	driver, ok := record.driver.(interface {
		ResetAgentContext(string) (capabilitydriver.CloudRealtimeEffect, error)
	})
	if !ok {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	effect, err := driver.ResetAgentContext(ulid.Make().String())
	if err != nil {
		return realtimeDriverError(err)
	}
	return s.sendRealtimeEffect(record, effect)
}

// OpenRuntimeAgentRealtime is the private Runtime Agent owner composition seam.
// It resolves only the account-scoped shared LocalAgent AIConfig, then invokes
// the same neutral AI Realtime implementation used by formal Apps.
func (s *Service) OpenRuntimeAgentRealtime(ctx context.Context, accountID string, req *runtimev1.OpenRealtimeSessionRequest) (*runtimev1.OpenRealtimeSessionResponse, error) {
	intent, err := s.runtimeAgentRealtimeIntent(ctx, accountID)
	if err != nil {
		return nil, err
	}
	ownerCtx := runtimeAgentRealtimeOwnerContext(ctx, accountID)
	ownerCtx = executionintent.WithIntent(ownerCtx, intent)
	ownerCtx = agentintent.WithHandler(ownerCtx, agentintent.FromContext(ctx))
	ownerCtx = agentintent.WithUsageObserver(ownerCtx, agentintent.UsageFromContext(ctx))
	return s.OpenRealtimeSession(ownerCtx, req)
}

func (s *Service) AppendRuntimeAgentRealtimeInput(ctx context.Context, accountID string, req *runtimev1.AppendRealtimeInputRequest) (*runtimev1.AppendRealtimeInputResponse, error) {
	return s.appendRealtimeInput(runtimeAgentRealtimeOwnerContext(ctx, accountID), req, false)
}

func (s *Service) RuntimeAgentRealtimeContext(ctx context.Context, accountID, sessionID string, generation uint64) (agentintent.RealtimeContext, error) {
	record, err := s.authorizedRealtimeRecord(runtimeAgentRealtimeOwnerContext(ctx, accountID), sessionID, generation)
	if err != nil {
		return agentintent.RealtimeContext{}, err
	}
	if record.contextMetadata.ContextWindowTokens == 0 {
		return agentintent.RealtimeContext{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	return record.contextMetadata, nil
}
func (s *Service) SubmitRuntimeAgentRealtimeControl(ctx context.Context, accountID string, req *runtimev1.SubmitRealtimeOwnerControlRequest) (*runtimev1.SubmitRealtimeOwnerControlResponse, error) {
	return s.SubmitRealtimeOwnerControl(runtimeAgentRealtimeOwnerContext(ctx, accountID), req)
}

func (s *Service) InterruptRuntimeAgentRealtimeOutput(ctx context.Context, accountID string, req *runtimev1.InterruptRealtimeOutputRequest, expectedRequestID string) (*runtimev1.InterruptRealtimeOutputResponse, error) {
	owner := runtimeAgentRealtimeOwnerContext(ctx, accountID)
	if expectedRequestID == "" {
		return s.InterruptRealtimeOutput(owner, req)
	}
	record, err := s.authorizedRealtimeRecord(owner, req.GetRealtimeSessionId(), req.GetGeneration())
	if err != nil {
		return nil, err
	}
	record.mu.Lock()
	target := record.tracksByRuntime[req.GetOutputTrackId()]
	if target == nil || target.requestID != expectedRequestID {
		record.mu.Unlock()
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_REALTIME_SESSION_NOT_FOUND)
	}
	currentID := ""
	for _, track := range record.tracksByRuntime {
		if track.requestID == expectedRequestID && !track.terminal && !track.requestTerminal && !track.interrupting {
			currentID = track.outputTrackID
			break
		}
	}
	record.mu.Unlock()
	if currentID != "" {
		stopped, stopErr := s.InterruptRealtimeOutput(owner, &runtimev1.InterruptRealtimeOutputRequest{RealtimeSessionId: req.RealtimeSessionId, Generation: req.Generation, OutputTrackId: currentID})
		if stopErr == nil {
			return stopped, nil
		}
	}
	record.mu.Lock()
	pending := record.pendingRequestID == expectedRequestID
	closed := record.closed
	record.mu.Unlock()
	if pending || closed {
		ended, closeErr := s.CloseRealtimeSession(owner, &runtimev1.CloseRealtimeSessionRequest{RealtimeSessionId: req.RealtimeSessionId, Generation: req.Generation})
		if closeErr != nil {
			return nil, closeErr
		}
		return &runtimev1.InterruptRealtimeOutputResponse{Ack: ended.Ack, Control: ended.Control}, nil
	}
	// The exact native request already ended. Do not cancel a newer response.
	return &runtimev1.InterruptRealtimeOutputResponse{Ack: &runtimev1.Ack{Ok: true}, Control: realtimeControl(record, runtimev1.RealtimeLifecycle_REALTIME_LIFECYCLE_READY, 0, "")}, nil
}

func (s *Service) CloseRuntimeAgentRealtime(ctx context.Context, accountID string, req *runtimev1.CloseRealtimeSessionRequest) (*runtimev1.CloseRealtimeSessionResponse, error) {
	owner := runtimeAgentRealtimeOwnerContext(ctx, accountID)
	// Collect a native terminal's actual usage when a response is running.
	// Closing still wins when no track exists or the native stop fails.
	if record, err := s.authorizedRealtimeRecord(owner, req.GetRealtimeSessionId(), req.GetGeneration()); err == nil {
		record.mu.Lock()
		trackID := ""
		if !record.selfWaiting {
			for _, track := range record.tracksByRuntime {
				if !track.terminal && !track.requestTerminal && !track.interrupting {
					trackID = track.outputTrackID
					break
				}
			}
		}
		record.mu.Unlock()
		if trackID != "" {
			_, _ = s.InterruptRealtimeOutput(owner, &runtimev1.InterruptRealtimeOutputRequest{RealtimeSessionId: req.RealtimeSessionId, Generation: req.Generation, OutputTrackId: trackID})
		}
	}
	return s.CloseRealtimeSession(owner, req)
}

func (s *Service) ClaimRuntimeAgentRealtimeEvents(ctx context.Context, accountID string, sessionID string, generation uint64) (<-chan *runtimev1.AiRealtimeEvent, func(), error) {
	record, err := s.authorizedRealtimeRecord(runtimeAgentRealtimeOwnerContext(ctx, accountID), sessionID, generation)
	if err != nil {
		return nil, func() {}, err
	}
	events, release, err := record.stream.ClaimReader()
	if err != nil {
		return nil, func() {}, realtimePublishError(err)
	}
	return events, release, nil
}

func (s *Service) runtimeAgentRealtimeIntent(ctx context.Context, accountID string) (executionintent.Intent, error) {
	accountID = strings.TrimSpace(accountID)
	if s == nil || s.aiConfigStore == nil || accountID == "" {
		return executionintent.Intent{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_NOT_FOUND)
	}
	config, _, found, err := s.aiConfigStore.Get(ctx, accountID, aiconfig.LocalAgentSubsystemOwner())
	if err != nil {
		return executionintent.Intent{}, appAIConfigPersistenceError(fmt.Errorf("read shared LocalAgent AIConfig: %w", err))
	}
	if !found || config == nil {
		return executionintent.Intent{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_NOT_FOUND)
	}
	for _, capability := range config.GetCapabilities() {
		if capability.GetCapabilityContract() != "realtime.interact" {
			continue
		}
		intent, err := executionintent.FromCapability(capability)
		if err != nil {
			return executionintent.Intent{}, grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID, err, grpcerr.ReasonOptions{})
		}
		return intent, nil
	}
	return executionintent.Intent{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
}

func runtimeAgentRealtimeOwnerContext(parent context.Context, accountID string) context.Context {
	if parent == nil {
		parent = context.Background()
	}
	var ctx context.Context
	var cancel context.CancelFunc
	if deadline, ok := parent.Deadline(); ok {
		ctx, cancel = context.WithDeadline(context.Background(), deadline)
	} else {
		ctx, cancel = context.WithCancel(context.Background())
	}
	context.AfterFunc(parent, cancel)
	md, _ := metadata.FromIncomingContext(parent)
	next := md.Copy()
	if next == nil {
		next = metadata.MD{}
	}
	next.Set(metadataAppIDKey, runtimeAgentRealtimePrivateAppID)
	ctx = metadata.NewIncomingContext(ctx, next)
	return authn.WithIdentity(ctx, &authn.Identity{SubjectUserID: strings.TrimSpace(accountID)})
}

// Only the Agent owner sees the request association already held by neutral AI.
func (s *Service) RuntimeAgentRealtimeOutputRequestID(ctx context.Context, accountID, sessionID string, generation uint64, outputID string) (string, error) {
	record, err := s.authorizedRealtimeRecord(runtimeAgentRealtimeOwnerContext(ctx, accountID), sessionID, generation)
	if err != nil {
		return "", err
	}
	record.mu.Lock()
	defer record.mu.Unlock()
	track := record.tracksByRuntime[outputID]
	if track == nil || track.requestID == "" {
		return "", grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_REALTIME_SESSION_NOT_FOUND)
	}
	return track.requestID, nil
}
