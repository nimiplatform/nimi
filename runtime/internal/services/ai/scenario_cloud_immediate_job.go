// @nimi-authority: rule.nimi.runtime.ai-provider.r006

package ai

import (
	"context"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/remoteexecution"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) captureImmediateCloudScenarioJob(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	scenarioType runtimev1.ScenarioType,
	mode runtimev1.ExecutionMode,
	modelResolved string,
	ignored []*runtimev1.IgnoredScenarioExtension,
	assembly *cloudResolvedAssembly,
) (*runtimev1.ScenarioJob, context.Context, error) {
	markImmediateCloudExecution(ctx)
	job, jobCtx, err := s.prepareCloudScenarioJobWithOptions(
		ctx, head, scenarioType, mode, modelResolved, ignored, assembly,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED, true,
	)
	if err != nil {
		return nil, nil, err
	}
	if !s.scenarioJobs.startExecution(job.GetJobId()) {
		s.scenarioJobs.abortUnstartedImmediateExecution(job.GetJobId())
		return nil, nil, grpcerr.WithReasonCode(codes.Canceled, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CANCELED)
	}
	jobCtx = remoteexecution.WithImmediateDispatchObserver(jobCtx, func() {
		markImmediateCloudDispatchPossible(ctx)
	})
	return job, jobCtx, nil
}

func (s *Service) prepareCloudScenarioJob(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	scenarioType runtimev1.ScenarioType,
	mode runtimev1.ExecutionMode,
	modelResolved string,
	ignored []*runtimev1.IgnoredScenarioExtension,
	assembly *cloudResolvedAssembly,
	payload ...*embeddingPayload,
) (*runtimev1.ScenarioJob, context.Context, error) {
	return s.prepareCloudScenarioJobWithOptions(
		ctx, head, scenarioType, mode, modelResolved, ignored, assembly,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED, false, payload...,
	)
}

func (s *Service) prepareCloudScenarioJobWithOptions(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	scenarioType runtimev1.ScenarioType,
	mode runtimev1.ExecutionMode,
	modelResolved string,
	ignored []*runtimev1.IgnoredScenarioExtension,
	assembly *cloudResolvedAssembly,
	initialStatus runtimev1.ScenarioJobStatus,
	ephemeralCustody bool,
	payload ...*embeddingPayload,
) (*runtimev1.ScenarioJob, context.Context, error) {
	if s == nil || head == nil || assembly == nil {
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
		JobId: ulid.Make().String(), Head: capturedHead, ScenarioType: scenarioType, ExecutionMode: mode,
		RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD, ModelResolved: modelResolved,
		Status:     initialStatus,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED, CreatedAt: now, UpdatedAt: now,
		TraceId: assembly.TraceID, IgnoredExtensions: cloneIgnoredScenarioExtensions(ignored),
	}
	discardCustody := func() {
		if ephemeralCustody {
			_ = s.releaseCloudCredentialCustody(assembly.CredentialCustodyRef)
			return
		}
		_ = s.discardPendingCloudCredentialCustody(job.GetJobId(), assembly.CredentialCustodyRef)
	}
	if ephemeralCustody {
		err = s.bindImmediateCloudCredentialCustody(ctx, job.GetJobId(), assembly)
	} else {
		err = s.bindCloudCredentialCustody(ctx, job.GetJobId(), assembly)
	}
	if err != nil {
		cancel()
		return nil, nil, cloudCredentialCustodyError(err, "Cloud ScenarioJob credential custody could not be captured")
	}
	var stored *runtimev1.ScenarioJob
	var created bool
	var persistErr error
	if ephemeralCustody {
		jobID := job.GetJobId()
		capturedRef := assembly.CredentialCustodyRef
		releaseEphemeral := func() {
			if releaseErr := s.releaseCloudCredentialCustody(capturedRef); releaseErr != nil {
				s.logScenarioJobPersistenceFailure(
					"terminal Cloud ScenarioJob ephemeral credential custody could not be released",
					"job_id", jobID,
					"error", releaseErr,
				)
			}
		}
		stored, created, persistErr = s.scenarioJobs.createOwnedAndBindImmediateCloudAssemblyChecked(
			job, cancel, localAppJobOwnerFromContext(ctx), "", assembly, releaseEphemeral, payload...,
		)
	} else {
		stored, created, persistErr = s.scenarioJobs.createOwnedAndBindCloudAssemblyChecked(
			job, cancel, localAppJobOwnerFromContext(ctx), "", assembly, payload...,
		)
	}
	if persistErr != nil {
		cancel()
		discardCustody()
		s.logScenarioJobPersistenceFailure(
			"Cloud ScenarioJob capture persistence failed",
			"job_id", job.GetJobId(),
			"scenario_type", scenarioType.String(),
			"error", persistErr,
		)
		return nil, nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, persistErr, grpcerr.ReasonOptions{
			Message: "captured Cloud ResolvedAssembly and ScenarioJob could not be committed atomically",
		})
	}
	if !created || stored == nil {
		cancel()
		if !created {
			discardCustody()
		}
		return nil, nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return stored, s.scenarioObservationContext(jobCtx, stored.GetJobId()), nil
}
