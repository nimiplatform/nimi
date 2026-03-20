package ai

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
)

func executeTextGenerateScenario(ctx context.Context, s *Service, req *runtimev1.ExecuteScenarioRequest, ignored []*runtimev1.IgnoredScenarioExtension) (*runtimev1.ExecuteScenarioResponse, error) {
	if req == nil || req.GetHead() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	spec := req.GetSpec().GetTextGenerate()
	if spec == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if len(spec.GetInput()) == 0 && strings.TrimSpace(spec.GetSystemPrompt()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}

	remoteTarget, err := s.prepareScenarioRequest(ctx, req.GetHead(), req.GetScenarioType())
	if err != nil {
		return nil, err
	}

	release, acquireResult, acquireErr := s.scheduler.Acquire(ctx, req.GetHead().GetAppId())
	if acquireErr != nil {
		return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	defer release()
	s.attachQueueWaitUnary(ctx, acquireResult)
	s.logQueueWait("execute_scenario_text_generate", req.GetHead().GetAppId(), acquireResult)
	requestCtx, cancel := withTimeout(ctx, req.GetHead().GetTimeoutMs(), defaultGenerateTimeout)
	defer cancel()

	selectedProvider, routeDecision, modelResolved, routeInfo, err := s.selector.resolveProviderWithTarget(
		ctx,
		req.GetHead().GetRoutePolicy(),
		req.GetHead().GetFallback(),
		req.GetHead().GetModelId(),
		remoteTarget,
	)
	if err != nil {
		return nil, err
	}
	if err := s.validateScenarioCapability(ctx, req.GetScenarioType(), modelResolved, remoteTarget, selectedProvider); err != nil {
		return nil, err
	}
	resolved, err := s.resolveTextGenerateScenario(ctx, req.GetHead(), modelResolved, remoteTarget, selectedProvider, spec)
	if err != nil {
		return nil, err
	}
	defer resolved.release()
	if err := s.validateTextGenerateInputParts(ctx, modelResolved, remoteTarget, selectedProvider, resolved.spec.GetInput()); err != nil {
		return nil, err
	}
	s.recordRouteAutoSwitch(
		req.GetHead().GetAppId(),
		req.GetHead().GetSubjectUserId(),
		req.GetHead().GetModelId(),
		modelResolved,
		routeInfo,
	)

	traceID := ulid.Make().String()
	inputText := nimillm.ComposeInputText(resolved.spec.GetSystemPrompt(), resolved.spec.GetInput())

	var (
		outputText   string
		usage        *runtimev1.UsageStats
		finishReason runtimev1.FinishReason
	)
	if remoteTarget != nil {
		if cp := s.selector.cloudProvider; cp != nil {
			outputText, usage, finishReason, err = cp.GenerateTextScenarioWithTarget(requestCtx, modelResolved, resolved.spec, inputText, remoteTarget)
		} else if scenarioProvider, ok := selectedProvider.(scenarioTextProvider); ok {
			outputText, usage, finishReason, err = scenarioProvider.GenerateTextScenario(requestCtx, modelResolved, resolved.spec, inputText)
		} else {
			err = grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
		}
	} else if scenarioProvider, ok := selectedProvider.(scenarioTextProvider); ok {
		outputText, usage, finishReason, err = scenarioProvider.GenerateTextScenario(requestCtx, modelResolved, resolved.spec, inputText)
	} else {
		err = grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	if err != nil {
		return nil, err
	}
	return &runtimev1.ExecuteScenarioResponse{
		Output: &runtimev1.ScenarioOutput{
			Output: &runtimev1.ScenarioOutput_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateOutput{
					Text: outputText,
				},
			},
		},
		FinishReason:      finishReason,
		Usage:             usage,
		RouteDecision:     routeDecision,
		ModelResolved:     modelResolved,
		TraceId:           traceID,
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
	inputs := spec.GetInputs()

	remoteTarget, err := s.prepareScenarioRequest(ctx, req.GetHead(), req.GetScenarioType())
	if err != nil {
		return nil, err
	}

	release, acquireResult, acquireErr := s.scheduler.Acquire(ctx, req.GetHead().GetAppId())
	if acquireErr != nil {
		return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	defer release()
	s.attachQueueWaitUnary(ctx, acquireResult)
	s.logQueueWait("execute_scenario_text_embed", req.GetHead().GetAppId(), acquireResult)
	requestCtx, cancel := withTimeout(ctx, req.GetHead().GetTimeoutMs(), defaultEmbedTimeout)
	defer cancel()

	selectedProvider, routeDecision, modelResolved, routeInfo, err := s.selector.resolveProviderWithTarget(
		ctx,
		req.GetHead().GetRoutePolicy(),
		req.GetHead().GetFallback(),
		req.GetHead().GetModelId(),
		remoteTarget,
	)
	if err != nil {
		return nil, err
	}
	if err := s.validateScenarioCapability(ctx, req.GetScenarioType(), modelResolved, remoteTarget, selectedProvider); err != nil {
		return nil, err
	}
	s.recordRouteAutoSwitch(
		req.GetHead().GetAppId(),
		req.GetHead().GetSubjectUserId(),
		req.GetHead().GetModelId(),
		modelResolved,
		routeInfo,
	)

	var (
		vectors []*structpb.ListValue
		usage   *runtimev1.UsageStats
	)
	if remoteTarget != nil {
		if cp := s.selector.cloudProvider; cp != nil {
			vectors, usage, err = cp.EmbedWithTarget(requestCtx, modelResolved, inputs, remoteTarget)
		} else {
			vectors, usage, err = selectedProvider.Embed(requestCtx, modelResolved, inputs)
		}
	} else {
		vectors, usage, err = selectedProvider.Embed(requestCtx, modelResolved, inputs)
	}
	if err != nil {
		return nil, err
	}
	if usage == nil {
		var inputTokens int64
		for _, input := range inputs {
			inputTokens += estimateTokens(strings.TrimSpace(input))
		}
		usage = &runtimev1.UsageStats{
			InputTokens:  inputTokens,
			OutputTokens: int64(len(inputs) * 4),
			ComputeMs:    maxInt64(4, int64(len(inputs)*3)),
		}
	}
	vectorPayloads := make([]*runtimev1.EmbeddingVector, 0, len(vectors))
	for _, vector := range vectors {
		values := make([]float64, 0, len(vector.GetValues()))
		for _, value := range vector.GetValues() {
			values = append(values, value.GetNumberValue())
		}
		vectorPayloads = append(vectorPayloads, &runtimev1.EmbeddingVector{
			Values: values,
		})
	}
	return &runtimev1.ExecuteScenarioResponse{
		Output: &runtimev1.ScenarioOutput{
			Output: &runtimev1.ScenarioOutput_TextEmbed{
				TextEmbed: &runtimev1.TextEmbedOutput{
					Vectors: vectorPayloads,
				},
			},
		},
		FinishReason:      runtimev1.FinishReason_FINISH_REASON_STOP,
		Usage:             usage,
		RouteDecision:     routeDecision,
		ModelResolved:     modelResolved,
		TraceId:           ulid.Make().String(),
		IgnoredExtensions: ignored,
	}, nil
}
