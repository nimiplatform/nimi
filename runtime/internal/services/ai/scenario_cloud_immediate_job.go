// @nimi-authority: rule.nimi.runtime.ai-provider.r006

package ai

import (
	"context"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
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
		Status:     runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED, CreatedAt: now, UpdatedAt: now,
		TraceId: assembly.TraceID, IgnoredExtensions: cloneIgnoredScenarioExtensions(ignored),
	}
	if err := s.bindCloudCredentialCustody(job.GetJobId(), assembly); err != nil {
		cancel()
		return nil, nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{
			Message: "Cloud ScenarioJob credential custody could not be captured",
		})
	}
	stored, created, persistErr := s.scenarioJobs.createOwnedAndBindCloudAssemblyChecked(
		job, cancel, localAppJobOwnerFromContext(ctx), "", assembly,
	)
	if persistErr != nil {
		cancel()
		_ = s.discardPendingCloudCredentialCustody(job.GetJobId(), assembly.CredentialCustodyRef)
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
	if !created || stored == nil || !s.scenarioJobs.startExecution(stored.GetJobId()) {
		cancel()
		if !created {
			_ = s.discardPendingCloudCredentialCustody(job.GetJobId(), assembly.CredentialCustodyRef)
		}
		return nil, nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return stored, jobCtx, nil
}
