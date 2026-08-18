package ai

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) submitVoiceWorkflowJob(
	ctx context.Context,
	req *runtimev1.SubmitScenarioJobRequest,
	ignored []*runtimev1.IgnoredScenarioExtension,
) (*runtimev1.SubmitScenarioJobResponse, error) {
	if req == nil || req.GetHead() == nil || req.GetSpec() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if err := validateVoiceWorkflowSpec(req.GetScenarioType(), req.GetSpec()); err != nil {
		return nil, err
	}
	intent, err := scenarioExecutionIntentFromContext(ctx, scenarioTargetCapability(req.GetScenarioType()))
	if err != nil {
		return nil, err
	}
	if intent.IsLocal() {
		return s.submitLocalVoiceWorkflowJob(ctx, req, intent, ignored)
	}
	if strings.TrimSpace(req.GetSpec().GetVoiceCreate().GetTargetModelId()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_TARGET_MODEL_MISMATCH)
	}
	idempotencyScope, err := buildScenarioJobIdempotencyScope(ctx, req)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, err, grpcerr.ReasonOptions{})
	}
	if idempotencyScope != "" {
		if existing, ok := s.scenarioJobs.getByIdempotency(idempotencyScope); ok {
			return &runtimev1.SubmitScenarioJobResponse{Job: existing}, nil
		}
	}
	effective, err := s.captureCloudVoiceWorkflowEffectiveInputs(ctx, req)
	if err != nil {
		return nil, err
	}
	defer effective.release()
	req = effective.request
	timeout, err := scenarioJobTimeoutDuration(req, defaultSynthesizeTimeout, false)
	if err != nil {
		return nil, err
	}

	// Keep caller metadata and credentials out of the detached job. The typed
	// identity below is the only request ownership value retained.
	jobCtx := newDetachedAsyncJobContext(ctx)
	var cancel context.CancelFunc
	if timeout > 0 {
		jobCtx, cancel = context.WithTimeout(jobCtx, timeout)
	} else {
		jobCtx, cancel = context.WithCancel(jobCtx)
	}
	now := timestamppb.New(time.Now().UTC())
	job := &runtimev1.ScenarioJob{
		JobId: ulid.Make().String(), Head: cloneScenarioHead(req.GetHead()),
		ScenarioType: req.GetScenarioType(), ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD, ModelResolved: effective.target.ProviderModelID(),
		Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		CreatedAt: now, UpdatedAt: now, TraceId: effective.traceID,
		IgnoredExtensions: cloneIgnoredScenarioExtensions(ignored),
	}
	if err := s.bindCloudCredentialCustody(job.GetJobId(), effective.resolvedAssembly); err != nil {
		cancel()
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{
			Message: "Cloud voice ScenarioJob credential custody could not be captured",
		})
	}
	if identity := authn.IdentityFromContext(ctx); identity != nil {
		jobCtx = authn.WithIdentity(jobCtx, &authn.Identity{SubjectUserID: identity.SubjectUserID})
	}
	stored, created, persistErr := s.scenarioJobs.createOwnedAndBindCloudAssemblyChecked(
		job, cancel, localAppJobOwnerFromContext(ctx), idempotencyScope, effective.resolvedAssembly,
	)
	if persistErr != nil {
		cancel()
		_ = s.discardPendingCloudCredentialCustody(job.GetJobId(), effective.resolvedAssembly.CredentialCustodyRef)
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, persistErr, grpcerr.ReasonOptions{Message: "Cloud voice ScenarioJob submission could not be persisted"})
	}
	if stored == nil {
		cancel()
		_ = s.discardPendingCloudCredentialCustody(job.GetJobId(), effective.resolvedAssembly.CredentialCustodyRef)
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if !created {
		cancel()
		_ = s.discardPendingCloudCredentialCustody(job.GetJobId(), effective.resolvedAssembly.CredentialCustodyRef)
		return &runtimev1.SubmitScenarioJobResponse{Job: stored}, nil
	}
	go func() {
		defer cancel()
		s.executeCapturedVoiceWorkflowJob(jobCtx, stored.GetJobId())
	}()

	return &runtimev1.SubmitScenarioJobResponse{Job: stored}, nil
}

func voiceAssetReference(voiceAssetID string) *runtimev1.VoiceReference {
	return &runtimev1.VoiceReference{
		Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET,
		Reference: &runtimev1.VoiceReference_VoiceAssetId{
			VoiceAssetId: voiceAssetID,
		},
	}
}
