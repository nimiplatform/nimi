package ai

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
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
	job, jobCtx, err := s.captureImmediateCloudScenarioJob(
		capturedCtx, req.GetHead(), runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, effective.modelResolved(), ignored, effective.resolvedAssembly,
	)
	if err != nil {
		return nil, err
	}
	jobID := job.GetJobId()
	defer s.finishScenarioJobExecution(jobID)
	if err := s.queueImmediateScenarioJob(jobID); err != nil {
		return nil, err
	}

	release, acquireResult, acquireErr := s.scheduler.Acquire(jobCtx, req.GetHead().GetAppId())
	if acquireErr != nil {
		executionErr := schedulerAcquireError(acquireErr)
		s.finishCloudScenarioJobFailure(jobCtx, jobID, executionErr)
		return nil, executionErr
	}
	defer release()
	s.attachQueueWaitUnary(jobCtx, acquireResult)
	s.logQueueWait("execute_scenario_text_generate", req.GetHead().GetAppId(), acquireResult)

	if err := s.startImmediateScenarioJob(jobID); err != nil {
		return nil, err
	}
	assembly, ok := s.scenarioJobs.cloudResolvedAssembly(jobID)
	if !ok {
		err := grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		s.finishCloudScenarioJobFailure(jobCtx, jobID, err)
		return nil, err
	}
	executionEffective, err := s.cloudTextEffectiveInputsFromResolvedAssembly(assembly)
	if err != nil {
		s.finishCloudScenarioJobFailure(jobCtx, jobID, err)
		return nil, err
	}
	defer executionEffective.release()
	requestCtx, cancel, err := withTimeout(jobCtx, req.GetHead().GetTimeoutMs(), defaultGenerateTimeout)
	if err != nil {
		s.finishCloudScenarioJobFailure(jobCtx, jobID, err)
		return nil, err
	}
	defer cancel()
	result, err := s.executeCapturedCloudText(requestCtx, executionEffective)
	if err != nil {
		s.finishCloudScenarioJobFailure(requestCtx, jobID, err)
		return nil, err
	}
	artifact := nimillm.BinaryArtifact("text/plain; charset=utf-8", []byte(result.Text), map[string]any{"finish_reason": result.FinishReason.String()})
	if err := s.completeImmediateScenarioJob(jobID, []*runtimev1.ScenarioArtifact{artifact}, result.Usage); err != nil {
		s.finishCloudScenarioJobFailure(requestCtx, jobID, err)
		return nil, err
	}
	return &runtimev1.ExecuteScenarioResponse{
		Output: &runtimev1.ScenarioOutput{Output: &runtimev1.ScenarioOutput_TextGenerate{
			TextGenerate: &runtimev1.TextGenerateOutput{Text: result.Text, ToolCalls: result.ToolCalls},
		}},
		FinishReason:      result.FinishReason,
		Usage:             result.Usage,
		RouteDecision:     runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		ModelResolved:     executionEffective.modelResolved(),
		TraceId:           job.GetTraceId(),
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
		return executeLocalTextEmbedScenario(ctx, s, req, ignored)
	}

	effective, err := s.captureCloudEmbedEffectiveInputs(ctx, req.GetHead(), req)
	if err != nil {
		return nil, err
	}
	defer effective.release()
	result, job, err := s.executeCapturedCloudEmbedJob(ctx, req.GetHead(), effective, ignored)
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
		TraceId:           job.GetTraceId(),
		IgnoredExtensions: ignored,
	}, nil
}
