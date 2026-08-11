package ai

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func executeTextGenerateScenario(ctx context.Context, s *Service, req *runtimev1.ExecuteScenarioRequest, ignored []*runtimev1.IgnoredScenarioExtension) (*runtimev1.ExecuteScenarioResponse, error) {
	if req == nil || req.GetHead() == nil || req.GetSpec().GetTextGenerate() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	spec := req.GetSpec().GetTextGenerate()
	if len(spec.GetInput()) == 0 && strings.TrimSpace(spec.GetSystemPrompt()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	capturedCtx, localText, err := s.captureLocalTextRoutingIntent(ctx, req.GetHead())
	if err != nil {
		return nil, err
	}
	if localText {
		return executeLocalTextGenerateScenario(capturedCtx, s, req, ignored)
	}
	effective, err := s.captureCloudTextEffectiveInputs(capturedCtx, req.GetHead(), req, runtimev1.ExecutionMode_EXECUTION_MODE_SYNC)
	if err != nil {
		return nil, err
	}
	defer effective.release()

	release, acquireResult, acquireErr := s.scheduler.Acquire(capturedCtx, req.GetHead().GetAppId())
	if acquireErr != nil {
		return nil, schedulerAcquireError(acquireErr)
	}
	defer release()
	s.attachQueueWaitUnary(capturedCtx, acquireResult)
	s.logQueueWait("execute_scenario_text_generate", req.GetHead().GetAppId(), acquireResult)

	requestCtx, cancel := withTimeout(capturedCtx, req.GetHead().GetTimeoutMs(), defaultGenerateTimeout)
	defer cancel()
	result, err := s.executeCapturedCloudText(requestCtx, effective)
	if err != nil {
		return nil, err
	}
	return &runtimev1.ExecuteScenarioResponse{
		Output: &runtimev1.ScenarioOutput{Output: &runtimev1.ScenarioOutput_TextGenerate{
			TextGenerate: &runtimev1.TextGenerateOutput{Text: result.Text, ToolCalls: result.ToolCalls},
		}},
		FinishReason:      result.FinishReason,
		Usage:             result.Usage,
		RouteDecision:     runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		ModelResolved:     effective.modelResolved(),
		TraceId:           effective.traceID,
		IgnoredExtensions: ignored,
	}, nil
}

func executeTextEmbedScenario(ctx context.Context, s *Service, req *runtimev1.ExecuteScenarioRequest, ignored []*runtimev1.IgnoredScenarioExtension) (*runtimev1.ExecuteScenarioResponse, error) {
	if req == nil || req.GetHead() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	spec := req.GetSpec().GetTextEmbed()
	if spec == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if len(spec.GetInputs()) == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	for _, input := range spec.GetInputs() {
		if strings.TrimSpace(input) == "" {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
	}
	intent, err := scenarioExecutionIntentFromContext(ctx, aicapabilities.TextEmbed)
	if err != nil {
		return nil, err
	}
	if intent.IsLocal() {
		return nil, localExactMediaUnsupportedError(req.GetScenarioType())
	}

	effective, err := s.captureCloudEmbedEffectiveInputs(ctx, req.GetHead(), req)
	if err != nil {
		return nil, err
	}
	defer effective.release()

	release, acquireResult, acquireErr := s.scheduler.Acquire(ctx, req.GetHead().GetAppId())
	if acquireErr != nil {
		return nil, schedulerAcquireError(acquireErr)
	}
	defer release()
	s.attachQueueWaitUnary(ctx, acquireResult)
	s.logQueueWait("execute_scenario_text_embed", req.GetHead().GetAppId(), acquireResult)

	requestCtx, cancel := withTimeout(ctx, req.GetHead().GetTimeoutMs(), defaultEmbedTimeout)
	defer cancel()
	result, err := s.executeCapturedCloudEmbed(requestCtx, effective)
	if err != nil {
		return nil, err
	}
	return &runtimev1.ExecuteScenarioResponse{
		Output: &runtimev1.ScenarioOutput{Output: &runtimev1.ScenarioOutput_TextEmbed{
			TextEmbed: &runtimev1.TextEmbedOutput{Vectors: result.Vectors},
		}},
		FinishReason:      runtimev1.FinishReason_FINISH_REASON_STOP,
		Usage:             result.Usage,
		RouteDecision:     runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		ModelResolved:     effective.modelResolved(),
		TraceId:           effective.traceID,
		IgnoredExtensions: ignored,
	}, nil
}
