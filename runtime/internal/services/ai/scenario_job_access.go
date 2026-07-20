package ai

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
	"github.com/nimiplatform/nimi/runtime/internal/rpcctx"
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
		return &runtimev1.GetScenarioJobResponse{Job: sanitizeScenarioJobForResponse(job)}, nil
	}
	job, ok := s.voiceAssets.getJob(jobID)
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND)
	}
	if err := s.authorizeScenarioJob(ctx, job); err != nil {
		return nil, err
	}
	return &runtimev1.GetScenarioJobResponse{Job: job}, nil
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
		_, ok := s.scenarioJobs.transition(
			jobID,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED,
			runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_CANCELED,
			func(job *runtimev1.ScenarioJob) {
				job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
				job.ReasonDetail = strings.TrimSpace(req.GetReason())
				job.ReasonMetadata = nil
			},
		)
		if !ok {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_CANCELLABLE)
		}
		s.scenarioJobs.cancel(jobID)
		job, _ := s.scenarioJobs.get(jobID)
		return &runtimev1.CancelScenarioJobResponse{Job: job}, nil
	}
	existingJob, ok := s.voiceAssets.getJob(jobID)
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND)
	}
	if err := s.authorizeScenarioJob(ctx, existingJob); err != nil {
		return nil, err
	}
	job, ok := s.voiceAssets.cancelJob(jobID, req.GetReason())
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_CANCELLABLE)
	}
	return &runtimev1.CancelScenarioJobResponse{Job: job}, nil
}

func (s *Service) SubscribeScenarioJobEvents(req *runtimev1.SubscribeScenarioJobEventsRequest, stream grpc.ServerStreamingServer[runtimev1.ScenarioJobEvent]) error {
	if req == nil || strings.TrimSpace(req.GetJobId()) == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	jobID := strings.TrimSpace(req.GetJobId())
	if job, ok := s.scenarioJobs.get(jobID); ok {
		if err := s.authorizeScenarioJob(stream.Context(), job); err != nil {
			return err
		}
	} else if job, ok := s.voiceAssets.getJob(jobID); ok {
		if err := s.authorizeScenarioJob(stream.Context(), job); err != nil {
			return err
		}
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
	voiceSubID, voiceCh, voiceBacklog, voiceTerminal, voiceOK := s.voiceAssets.subscribe(jobID, 32)
	if !voiceOK {
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND)
	}
	defer s.voiceAssets.unsubscribe(jobID, voiceSubID)
	for _, event := range voiceBacklog {
		if err := stream.Send(event); err != nil {
			return err
		}
	}
	if voiceTerminal {
		return nil
	}
	for {
		select {
		case <-stream.Context().Done():
			if err := rpcctx.ContextDoneError(stream.Context()); err == nil {
				return nil
			}
			return rpcctx.ContextDoneError(stream.Context())
		case event, open := <-voiceCh:
			if !open {
				return nil
			}
			if err := stream.Send(event); err != nil {
				return err
			}
			if isTerminalScenarioJobEvent(event.GetEventType()) {
				return nil
			}
		}
	}
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
		output := buildScenarioOutputFromArtifacts(job, responseArtifacts)
		return &runtimev1.GetScenarioArtifactsResponse{
			JobId:     jobID,
			Artifacts: responseArtifacts,
			TraceId:   traceID,
			Output:    output,
		}, nil
	}
	if job, ok := s.voiceAssets.getJob(jobID); ok {
		if err := s.authorizeScenarioJob(ctx, job); err != nil {
			return nil, err
		}
		if err := scenarioArtifactsTerminalFailure(job); err != nil {
			return nil, err
		}
		return &runtimev1.GetScenarioArtifactsResponse{
			JobId:     jobID,
			Artifacts: []*runtimev1.ScenarioArtifact{},
			TraceId:   job.GetTraceId(),
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
