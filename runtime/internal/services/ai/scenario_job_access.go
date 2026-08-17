package ai

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
	"github.com/nimiplatform/nimi/runtime/internal/rpcctx"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
)

const anonymousScenarioJobOwner = "anonymous"

func normalizeSubmitScenarioJobOwner(ctx context.Context, req *runtimev1.SubmitScenarioJobRequest) (*runtimev1.SubmitScenarioJobRequest, error) {
	return normalizeSubmitScenarioJobOwnerWithProvider(ctx, req, nil)
}

func (s *Service) normalizeSubmitScenarioJobOwner(ctx context.Context, req *runtimev1.SubmitScenarioJobRequest) (*runtimev1.SubmitScenarioJobRequest, error) {
	return normalizeSubmitScenarioJobOwnerWithProvider(ctx, req, s.runtimeAccountProjection)
}

func normalizeSubmitScenarioJobOwnerWithProvider(ctx context.Context, req *runtimev1.SubmitScenarioJobRequest, provider runtimeAccountProjectionProvider) (*runtimev1.SubmitScenarioJobRequest, error) {
	owner, protectedAvatar, err := canonicalScenarioJobOwnerWithProvider(ctx, provider)
	if err != nil {
		return nil, err
	}
	out := cloneSubmitScenarioJobRequest(req)
	if out == nil || out.GetHead() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	out.Head.SubjectUserId = owner
	if protectedAvatar {
		principal, _ := protectedprincipal.FromContext(ctx)
		out.Head.AppId = principal.AppID
	}
	return out, nil
}

func canonicalScenarioJobOwner(ctx context.Context) (string, error) {
	owner, _, err := canonicalScenarioJobOwnerWithProvider(ctx, nil)
	return owner, err
}

func canonicalScenarioJobOwnerWithProvider(ctx context.Context, provider runtimeAccountProjectionProvider) (string, bool, error) {
	if principal, ok := protectedprincipal.FromContext(ctx); ok {
		return principal.AccountID, true, nil
	}
	if identity := authn.IdentityFromContext(ctx); identity != nil {
		subject := strings.TrimSpace(identity.SubjectUserID)
		if subject == "" {
			return "", false, grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_AUTH_TOKEN_INVALID)
		}
		return subject, false, nil
	}
	return anonymousScenarioJobOwner, false, nil
}

func (s *Service) GetScenarioJob(ctx context.Context, req *runtimev1.GetScenarioJobRequest) (*runtimev1.GetScenarioJobResponse, error) {
	if req == nil || strings.TrimSpace(req.GetJobId()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	jobID := strings.TrimSpace(req.GetJobId())
	if job, ok := s.scenarioJobs.get(jobID); ok {
		if err := s.authorizeScenarioJob(ctx, job); err != nil {
			return nil, err
		}
		response := &runtimev1.GetScenarioJobResponse{Job: sanitizeScenarioJobForResponse(job)}
		if job.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE &&
			job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
			asset, reference, found := s.scenarioJobs.completedVoiceResult(jobID)
			if !found || asset.GetAppId() != job.GetHead().GetAppId() || asset.GetSubjectUserId() != job.GetHead().GetSubjectUserId() {
				return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
			}
			response.Asset = asset
			response.VoiceReference = reference
		}
		return response, nil
	}
	return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND)
}

func (s *Service) CancelScenarioJob(ctx context.Context, req *runtimev1.CancelScenarioJobRequest) (*runtimev1.CancelScenarioJobResponse, error) {
	if req == nil || strings.TrimSpace(req.GetJobId()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	jobID := strings.TrimSpace(req.GetJobId())
	if existingJob, exists := s.scenarioJobs.get(jobID); exists {
		if err := s.authorizeScenarioJob(ctx, existingJob); err != nil {
			return nil, err
		}
		if isTerminalScenarioJobStatus(existingJob.GetStatus()) {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_CANCELLABLE)
		}
		var job *runtimev1.ScenarioJob
		var ok bool
		var persistErr error
		for attempt := 1; attempt <= maxScenarioJobTerminalPersistenceAttempts; attempt++ {
			job, ok, persistErr = s.scenarioJobs.requestCancel(jobID, req.GetReason())
			if persistErr == nil {
				break
			}
			s.logScenarioJobPersistenceFailure(
				"scenario job cancellation persistence attempt failed",
				"job_id", jobID,
				"attempt", attempt,
				"max_attempts", maxScenarioJobTerminalPersistenceAttempts,
				"error", persistErr,
			)
		}
		if persistErr != nil {
			s.scenarioJobs.forceFailedInMemory(jobID, scenarioJobTerminalPersistenceFailedReason)
			s.logScenarioJobPersistenceFailure(
				"SCENARIO JOB CANCELLATION COULD NOT BE PERSISTED; forced in-memory FAILED terminal",
				"job_id", jobID,
				"reason", scenarioJobTerminalPersistenceFailedReason,
				"error", persistErr,
			)
			return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, persistErr, grpcerr.ReasonOptions{
				Message: "ScenarioJob cancellation could not be persisted",
			})
		}
		if !ok {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_CANCELLABLE)
		}
		return &runtimev1.CancelScenarioJobResponse{Job: job}, nil
	}
	return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND)
}

func (s *Service) SubscribeScenarioJobEvents(req *runtimev1.SubscribeScenarioJobEventsRequest, stream grpc.ServerStreamingServer[runtimev1.ScenarioJobEvent]) error {
	if req == nil || strings.TrimSpace(req.GetJobId()) == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	jobID := strings.TrimSpace(req.GetJobId())
	job, exists := s.scenarioJobs.get(jobID)
	if !exists {
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND)
	}
	if err := s.authorizeScenarioJob(stream.Context(), job); err != nil {
		return err
	}
	subID, ch, backlog, terminal, ok := s.scenarioJobs.subscribe(jobID, 32)
	if ok {
		defer s.scenarioJobs.unsubscribe(jobID, subID)
		for _, event := range backlog {
			if err := stream.Send(sanitizeScenarioJobEventForResponse(event)); err != nil {
				return err
			}
		}
		if terminal {
			return nil
		}
		for {
			select {
			case <-stream.Context().Done():
				if err := rpcctx.ContextDoneError(stream.Context()); err == nil {
					return nil
				}
				return rpcctx.ContextDoneError(stream.Context())
			case event, open := <-ch:
				if !open {
					return nil
				}
				if err := stream.Send(sanitizeScenarioJobEventForResponse(event)); err != nil {
					return err
				}
				if isTerminalScenarioJobEvent(event.GetEventType()) {
					return nil
				}
			}
		}
	}
	return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND)
}

func (s *Service) GetScenarioArtifacts(ctx context.Context, req *runtimev1.GetScenarioArtifactsRequest) (*runtimev1.GetScenarioArtifactsResponse, error) {
	if req == nil || strings.TrimSpace(req.GetJobId()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	jobID := strings.TrimSpace(req.GetJobId())
	job, artifacts, traceID, ok := s.scenarioJobs.listArtifacts(jobID)
	if ok {
		if err := s.authorizeScenarioJob(ctx, job); err != nil {
			return nil, err
		}
		if err := scenarioArtifactsTerminalFailure(job); err != nil {
			return nil, err
		}
		responseArtifacts := sanitizeScenarioArtifactsForResponse(job, artifacts)
		if job.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE && responseArtifacts == nil {
			responseArtifacts = []*runtimev1.ScenarioArtifact{}
		}
		output := buildScenarioOutputFromArtifacts(job, responseArtifacts)
		return &runtimev1.GetScenarioArtifactsResponse{
			JobId:     jobID,
			Artifacts: responseArtifacts,
			TraceId:   traceID,
			Output:    output,
		}, nil
	}
	return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND)
}

func scenarioArtifactsTerminalFailure(job *runtimev1.ScenarioJob) error {
	if job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED &&
		job.GetReasonCode() == runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED)
	}
	return nil
}

func authorizeScenarioJob(ctx context.Context, job *runtimev1.ScenarioJob) error {
	return authorizeScenarioJobWithProvider(ctx, job, nil)
}

func (s *Service) authorizeScenarioJob(ctx context.Context, job *runtimev1.ScenarioJob) error {
	if _, localAppCall := accountservice.AuthorizedLocalAppDecisionFromContext(ctx); localAppCall {
		jobID := ""
		if job != nil {
			jobID = strings.TrimSpace(job.GetJobId())
		}
		if owner, ok := s.scenarioJobs.localAppOwner(jobID); ok {
			return authorizeLocalAppJobOwner(ctx, owner)
		}
		// Historical Local App Jobs without an immutable subject-bound owner
		// are a hard cut and cannot fall back to AppID or ScenarioRequestHead.
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	return authorizeScenarioJobWithProvider(ctx, job, s.runtimeAccountProjection)
}

func authorizeScenarioJobWithProvider(ctx context.Context, job *runtimev1.ScenarioJob, provider runtimeAccountProjectionProvider) error {
	if job == nil || job.GetHead() == nil {
		return nil
	}
	head := job.GetHead()
	expectedAppID := strings.TrimSpace(head.GetAppId())
	expectedSubject := strings.TrimSpace(head.GetSubjectUserId())
	if expectedAppID == "" || expectedSubject == "" {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	appID := incomingAppID(ctx)
	if appID == "" || expectedAppID != appID {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	if principal, ok := protectedprincipal.FromContext(ctx); ok {
		if expectedAppID != principal.AppID || !principal.Owns(expectedSubject) {
			return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
		}
		return nil
	}
	if identity := authn.IdentityFromContext(ctx); identity != nil {
		actualSubject := strings.TrimSpace(identity.SubjectUserID)
		if actualSubject == "" || expectedSubject != actualSubject {
			return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
		}
		return nil
	}
	if expectedSubject != anonymousScenarioJobOwner {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	return nil
}

func isTerminalScenarioJobEvent(eventType runtimev1.ScenarioJobEventType) bool {
	switch eventType {
	case runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_FAILED,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_CANCELED,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_TIMEOUT:
		return true
	default:
		return false
	}
}
