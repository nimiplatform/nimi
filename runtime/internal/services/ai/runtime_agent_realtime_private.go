package ai

import (
	"context"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
)

const runtimeAgentRealtimePrivateAppID = "runtime.agent"

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
	return s.OpenRealtimeSession(ownerCtx, req)
}

func (s *Service) AppendRuntimeAgentRealtimeInput(ctx context.Context, accountID string, req *runtimev1.AppendRealtimeInputRequest) (*runtimev1.AppendRealtimeInputResponse, error) {
	return s.AppendRealtimeInput(runtimeAgentRealtimeOwnerContext(ctx, accountID), req)
}

func (s *Service) SubmitRuntimeAgentRealtimeControl(ctx context.Context, accountID string, req *runtimev1.SubmitRealtimeOwnerControlRequest) (*runtimev1.SubmitRealtimeOwnerControlResponse, error) {
	return s.SubmitRealtimeOwnerControl(runtimeAgentRealtimeOwnerContext(ctx, accountID), req)
}

func (s *Service) InterruptRuntimeAgentRealtimeOutput(ctx context.Context, accountID string, req *runtimev1.InterruptRealtimeOutputRequest) (*runtimev1.InterruptRealtimeOutputResponse, error) {
	return s.InterruptRealtimeOutput(runtimeAgentRealtimeOwnerContext(ctx, accountID), req)
}

func (s *Service) CloseRuntimeAgentRealtime(ctx context.Context, accountID string, req *runtimev1.CloseRealtimeSessionRequest) (*runtimev1.CloseRealtimeSessionResponse, error) {
	return s.CloseRealtimeSession(runtimeAgentRealtimeOwnerContext(ctx, accountID), req)
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
