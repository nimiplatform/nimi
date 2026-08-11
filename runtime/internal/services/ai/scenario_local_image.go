package ai

import (
	"context"
	"fmt"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
)

func executeLocalImageGenerateScenario(
	ctx context.Context,
	s *Service,
	req *runtimev1.ExecuteScenarioRequest,
	ignored []*runtimev1.IgnoredScenarioExtension,
) (*runtimev1.ExecuteScenarioResponse, error) {
	if req == nil || req.GetHead() == nil || req.GetSpec().GetImageGenerate() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	effective, err := s.captureLocalImageEffectiveInputs(ctx, req.GetHead(), req.GetSpec().GetImageGenerate())
	if err != nil {
		return nil, err
	}

	requestCtx, cancel, err := withTimeout(ctx, req.GetHead().GetTimeoutMs(), defaultGenerateImageTimeout)
	if err != nil {
		return nil, err
	}
	defer cancel()
	var schedulerRelease func()
	defer func() {
		if schedulerRelease != nil {
			schedulerRelease()
		}
	}()
	onStart := func() error {
		release, acquireResult, acquireErr := s.scheduler.Acquire(requestCtx, req.GetHead().GetAppId())
		if acquireErr != nil {
			return schedulerAcquireError(acquireErr)
		}
		s.attachQueueWaitUnary(requestCtx, acquireResult)
		schedulerRelease = release
		return nil
	}

	artifacts := make([]*runtimev1.ScenarioArtifact, 0, effective.plan.ImageCount())
	onArtifact := func(produced localexecution.ImageArtifact) error {
		artifact := localImageArtifact(effective, produced)
		if artifact == nil {
			return fmt.Errorf("local image artifact projection failed")
		}
		if err := s.storeRuntimeOwnedArtifacts(ctx, runtimeArtifactOwnerFromContext(ctx, effective.head), []*runtimev1.ScenarioArtifact{artifact}); err != nil {
			return err
		}
		artifacts = append(artifacts, artifact)
		return nil
	}
	result, err := s.executeCapturedLocalImage(requestCtx, effective, onStart, onArtifact, nil)
	if err != nil {
		return nil, err
	}
	if len(artifacts) != effective.plan.ImageCount() || len(result.Artifacts) != len(artifacts) {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return &runtimev1.ExecuteScenarioResponse{
		Output: &runtimev1.ScenarioOutput{
			Output: &runtimev1.ScenarioOutput_ImageGenerate{
				ImageGenerate: &runtimev1.ImageGenerateResult{Artifacts: cloneScenarioArtifacts(artifacts)},
			},
		},
		FinishReason:      runtimev1.FinishReason_FINISH_REASON_STOP,
		Usage:             localImageUsage(result),
		RouteDecision:     runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		ModelResolved:     effective.modelResolved(),
		TraceId:           ulid.Make().String(),
		IgnoredExtensions: cloneIgnoredScenarioExtensions(ignored),
	}, nil
}
