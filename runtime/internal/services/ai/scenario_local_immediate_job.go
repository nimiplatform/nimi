// @nimi-authority: rule.nimi.runtime.ai-provider.r006

package ai

import (
	"context"
	"fmt"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) captureImmediateLocalScenarioJob(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	scenarioType runtimev1.ScenarioType,
	mode runtimev1.ExecutionMode,
	modelResolved string,
	ignored []*runtimev1.IgnoredScenarioExtension,
	effectiveInputIdentity *runtimev1.LoadoutEffectiveInputIdentity,
	assembly *localResolvedAssembly,
) (*runtimev1.ScenarioJob, context.Context, error) {
	if s == nil || head == nil || effectiveInputIdentity == nil || assembly == nil {
		return nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	owner, protectedAvatar, err := canonicalScenarioJobOwnerWithProvider(ctx, s.runtimeAccountProjection)
	if err != nil {
		return nil, nil, err
	}
	capturedHead := cloneScenarioHead(head)
	capturedHead.SubjectUserId = owner
	if protectedAvatar {
		normalized := &runtimev1.SubmitScenarioJobRequest{Head: capturedHead}
		normalized, err = s.normalizeSubmitScenarioJobOwner(ctx, normalized)
		if err != nil {
			return nil, nil, err
		}
		capturedHead = normalized.GetHead()
	}
	jobCtx, cancel := context.WithCancel(ctx)
	if identity := authn.IdentityFromContext(ctx); identity != nil {
		jobCtx = authn.WithIdentity(jobCtx, identity)
	}
	now := timestamppb.New(time.Now().UTC())
	job := &runtimev1.ScenarioJob{
		JobId:                  ulid.Make().String(),
		Head:                   capturedHead,
		ScenarioType:           scenarioType,
		ExecutionMode:          mode,
		RouteDecision:          runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		ModelResolved:          modelResolved,
		Status:                 runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
		ReasonCode:             runtimev1.ReasonCode_ACTION_EXECUTED,
		CreatedAt:              now,
		UpdatedAt:              now,
		TraceId:                ulid.Make().String(),
		IgnoredExtensions:      cloneIgnoredScenarioExtensions(ignored),
		EffectiveInputIdentity: effectiveInputIdentity,
	}
	stored, created, persistErr := s.scenarioJobs.createOwnedAndBindAssemblyChecked(
		job, cancel, localAppJobOwnerFromContext(ctx), "", assembly,
	)
	if persistErr != nil {
		cancel()
		return nil, nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, persistErr, grpcerr.ReasonOptions{
			Message: "captured ResolvedAssembly and ScenarioJob could not be committed atomically",
		})
	}
	if !created || stored == nil || !s.scenarioJobs.startExecution(stored.GetJobId()) {
		cancel()
		return nil, nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return stored, jobCtx, nil
}

func (s *Service) queueImmediateLocalScenarioJob(jobID string) error {
	if _, ok, err := s.transitionScenarioJob(
		jobID,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_QUEUED,
		nil,
	); err != nil {
		s.failScenarioJobPersistencePrecondition(jobID, scenarioJobQueuedPersistenceFailedReason, err)
		return fmt.Errorf("persist immediate local ScenarioJob queue state: %w", err)
	} else if !ok {
		return grpcerr.WithReasonCode(codes.Canceled, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CANCELED)
	}
	return nil
}

func (s *Service) startImmediateLocalScenarioJob(jobID string) error {
	if _, ok, err := s.transitionScenarioJob(
		jobID,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING,
		nil,
	); err != nil {
		s.failScenarioJobPersistencePrecondition(jobID, scenarioJobRunningPersistenceFailedReason, err)
		return fmt.Errorf("persist immediate local ScenarioJob running state: %w", err)
	} else if !ok {
		return grpcerr.WithReasonCode(codes.Canceled, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CANCELED)
	}
	return nil
}

func (s *Service) completeImmediateLocalScenarioJob(
	jobID string,
	artifacts []*runtimev1.ScenarioArtifact,
	usage *runtimev1.UsageStats,
) error {
	if len(artifacts) > 0 {
		if err := s.storeRuntimeArtifacts(artifacts); err != nil {
			return err
		}
	}
	_, ok, err := s.transitionScenarioJob(
		jobID,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED,
		func(job *runtimev1.ScenarioJob) {
			job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
			job.ReasonDetail = ""
			job.ReasonMetadata = nil
			job.ProgressPercent = 100
			job.Artifacts = cloneScenarioArtifacts(artifacts)
			job.Usage = usage
		},
	)
	if err != nil {
		return err
	}
	if !ok {
		return grpcerr.WithReasonCode(codes.Canceled, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CANCELED)
	}
	return nil
}
