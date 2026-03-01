package ai

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

func (s *Service) Embed(ctx context.Context, req *runtimev1.EmbedRequest) (*runtimev1.EmbedResponse, error) {
	if err := validateEmbedRequest(req); err != nil {
		return nil, err
	}

	// K-KEYSRC-004: parse and validate key-source
	parsed := parseKeySource(ctx, req.GetConnectorId())
	if err := validateKeySource(parsed); err != nil {
		return nil, err
	}
	remoteTarget, err := resolveKeySourceToTarget(parsed, s.connStore)
	if err != nil {
		return nil, err
	}

	release, acquireResult, acquireErr := s.scheduler.Acquire(ctx, req.GetAppId())
	if acquireErr != nil {
		return nil, status.Error(codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	defer release()
	s.attachQueueWaitUnary(ctx, acquireResult)
	s.logQueueWait("embed", req.GetAppId(), acquireResult)
	requestCtx, cancel := withTimeout(ctx, req.GetTimeoutMs(), defaultEmbedTimeout)
	defer cancel()

	selectedProvider, routeDecision, modelResolved, routeInfo, err := s.selector.resolveProviderWithTarget(ctx, req.GetRoutePolicy(), req.GetFallback(), req.GetModelId(), remoteTarget)
	if err != nil {
		return nil, err
	}
	s.recordRouteAutoSwitch(req.GetAppId(), req.GetSubjectUserId(), req.GetModelId(), modelResolved, routeInfo)

	// Use WithTarget if remote target is available
	var vectors []*structpb.ListValue
	var usage *runtimev1.UsageStats
	if remoteTarget != nil {
		if cp := s.selector.cloudProvider; cp != nil {
			vectors, usage, err = cp.EmbedWithTarget(requestCtx, modelResolved, req.GetInputs(), remoteTarget)
		} else {
			vectors, usage, err = selectedProvider.Embed(requestCtx, modelResolved, req.GetInputs())
		}
	} else {
		vectors, usage, err = selectedProvider.Embed(requestCtx, modelResolved, req.GetInputs())
	}
	if err != nil {
		return nil, err
	}
	if usage == nil {
		var inputTokens int64
		for _, input := range req.GetInputs() {
			inputTokens += estimateTokens(strings.TrimSpace(input))
		}
		usage = &runtimev1.UsageStats{
			InputTokens:  inputTokens,
			OutputTokens: int64(len(req.GetInputs()) * 4),
			ComputeMs:    maxInt64(4, int64(len(req.GetInputs())*3)),
		}
	}

	return &runtimev1.EmbedResponse{
		Vectors:       vectors,
		Usage:         usage,
		RouteDecision: routeDecision,
		ModelResolved: modelResolved,
		TraceId:       ulid.Make().String(),
	}, nil
}

func mediaJobStatusToError(job *runtimev1.MediaJob) error {
	if job == nil {
		return status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
	}
	reasonCode := job.GetReasonCode()
	if reasonCode == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		reasonCode = runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
	}
	switch reasonCode {
	case runtimev1.ReasonCode_AI_INPUT_INVALID:
		return status.Error(codes.InvalidArgument, reasonCode.String())
	case runtimev1.ReasonCode_AI_MODEL_NOT_FOUND:
		return status.Error(codes.NotFound, reasonCode.String())
	case runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT:
		return status.Error(codes.DeadlineExceeded, reasonCode.String())
	case runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED, runtimev1.ReasonCode_AI_MODEL_NOT_READY:
		return status.Error(codes.FailedPrecondition, reasonCode.String())
	case runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED:
		return status.Error(codes.PermissionDenied, reasonCode.String())
	default:
		return status.Error(codes.Unavailable, reasonCode.String())
	}
}
