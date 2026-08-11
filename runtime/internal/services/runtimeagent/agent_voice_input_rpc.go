package runtimeagent

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	runtimeAgentVoiceInputAppID        = "runtime.agent.voice_input"
	defaultAgentVoiceTranscriptionWait = 90 * time.Second
	defaultAgentVoiceTranscriptionPoll = 50 * time.Millisecond
)

type agentVoiceTranscriptionScenarioExecutor interface {
	SubmitScenarioJob(context.Context, *runtimev1.SubmitScenarioJobRequest) (*runtimev1.SubmitScenarioJobResponse, error)
	GetScenarioJob(context.Context, *runtimev1.GetScenarioJobRequest) (*runtimev1.GetScenarioJobResponse, error)
	GetScenarioArtifacts(context.Context, *runtimev1.GetScenarioArtifactsRequest) (*runtimev1.GetScenarioArtifactsResponse, error)
}

func (s *Service) SetAgentVoiceTranscriptionScenarioExecutor(executor agentVoiceTranscriptionScenarioExecutor) {
	if s == nil || s.isClosed() {
		return
	}
	s.voiceTranscription = executor
}

func (s *Service) HasAgentVoiceTranscriptionScenarioExecutor() bool {
	return s != nil && !s.isClosed() && s.voiceTranscription != nil
}

func (s *Service) TranscribeAgentVoiceInput(
	ctx context.Context,
	req *runtimev1.TranscribeAgentVoiceInputRequest,
) (*runtimev1.TranscribeAgentVoiceInputResponse, error) {
	if s == nil || s.isClosed() || s.voiceTranscription == nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	agentID := strings.TrimSpace(req.GetAgentId())
	anchorID := strings.TrimSpace(req.GetConversationAnchorId())
	mimeType := strings.ToLower(strings.TrimSpace(req.GetMimeType()))
	requestID := strings.TrimSpace(req.GetRequestId())
	if agentID == "" || anchorID == "" || len(req.GetAudioBytes()) == 0 ||
		!strings.HasPrefix(mimeType, "audio/") || requestID == "" || len(requestID) > 256 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	protected, err := s.authorizeProtectedAccountAgent(ctx, req.GetContext(), agentID, runtimeAgentTurnWriteScope)
	if err != nil {
		return nil, err
	}
	if !protected {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	identity, err := localAgentIdentityFromContext(req.GetContext())
	if err != nil {
		return nil, err
	}
	if err := s.validateAgentVoiceInputAnchor(identity, anchorID); err != nil {
		return nil, err
	}
	binding, err := s.resolveAgentVoiceInputBinding(ctx, identity)
	if err != nil {
		return nil, err
	}

	waitCtx, cancel := context.WithTimeout(ctx, defaultAgentVoiceTranscriptionWait)
	defer cancel()
	waitCtx = withPublicChatExecutionIntent(waitCtx, binding, runtimeAgentAIConfigCapabilityAudioTranscribe)
	submit, err := s.voiceTranscription.SubmitScenarioJob(waitCtx, &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         runtimeAgentVoiceInputAppID,
			SubjectUserId: identity.OwnerUserID,
			TimeoutMs:     int32(defaultAgentVoiceTranscriptionWait.Milliseconds()),
		},
		ScenarioType:   runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
		ExecutionMode:  runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		RequestId:      requestID,
		IdempotencyKey: strings.Join([]string{"runtime-agent-voice-input", anchorID, requestID}, ":"),
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{
			SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{
				MimeType: mimeType,
				AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{
					AudioBytes: append([]byte(nil), req.GetAudioBytes()...),
				}},
			},
		}},
	})
	if err != nil {
		return nil, err
	}
	jobID := strings.TrimSpace(submit.GetJob().GetJobId())
	if jobID == "" {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	job, err := s.waitAgentVoiceTranscriptionJob(waitCtx, jobID)
	if err != nil {
		return nil, err
	}
	artifacts, err := s.voiceTranscription.GetScenarioArtifacts(waitCtx, &runtimev1.GetScenarioArtifactsRequest{JobId: jobID})
	if err != nil {
		return nil, err
	}
	text := strings.TrimSpace(artifacts.GetOutput().GetSpeechTranscribe().GetText())
	if text == "" {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	traceID := strings.TrimSpace(artifacts.GetTraceId())
	if traceID == "" {
		traceID = strings.TrimSpace(job.GetTraceId())
	}
	return &runtimev1.TranscribeAgentVoiceInputResponse{Text: text, JobId: jobID, TraceId: traceID}, nil
}

func (s *Service) validateAgentVoiceInputAnchor(identity localAgentIdentity, anchorID string) error {
	s.chatSurfaceMu.Lock()
	anchor := clonePublicChatAnchorState(s.chatAnchors[strings.TrimSpace(anchorID)])
	s.chatSurfaceMu.Unlock()
	if anchor == nil {
		return status.Error(codes.NotFound, "conversation anchor not found")
	}
	if !conversationAnchorIsResumable(anchor.Status) || anchor.AgentID != identity.LocalAgentRef ||
		anchor.LocalAgentRef != identity.LocalAgentRef || anchor.OwnerUserID != identity.OwnerUserID ||
		anchor.SubjectUserID != identity.OwnerUserID || anchor.RuntimeSourceRef != identity.RuntimeSourceRef {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	return nil
}

func (s *Service) resolveAgentVoiceInputBinding(
	ctx context.Context,
	identity localAgentIdentity,
) (publicChatExecutionBinding, error) {
	bindings, accountNamespace, err := s.machineExecutionBindingsForAgent(
		ctx,
		identity.LocalAgentRef,
		runtimeAgentAIConfigCapabilityAudioTranscribe,
	)
	if err != nil {
		return publicChatExecutionBinding{}, err
	}
	if accountNamespace != identity.OwnerUserID {
		return publicChatExecutionBinding{}, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	binding, ok := bindings[runtimeAgentAIConfigCapabilityAudioTranscribe]
	if !ok {
		return publicChatExecutionBinding{}, grpcerr.WithReasonCode(
			codes.FailedPrecondition,
			runtimev1.ReasonCode_AGENT_AI_CONFIG_CAPABILITY_MISMATCH,
		)
	}
	if validateRuntimePrivateExecutorBinding(runtimeAgentAIConfigCapabilityAudioTranscribe, binding) != nil {
		return publicChatExecutionBinding{}, unresolvedSharedAIConfigExecutionBindingError()
	}
	intent := executionintent.Clone(binding.ExecutionIntent)
	switch binding.RoutePolicy {
	case runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL:
		if !binding.LocalAIConfigIntent || binding.LocalExecution == nil || !intent.IsLocal() ||
			intent.CapabilityContract != runtimeAgentAIConfigCapabilityAudioTranscribe {
			return publicChatExecutionBinding{}, unresolvedSharedAIConfigExecutionBindingError()
		}
	case runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD:
		cloud := binding.TargetRef.GetCloud()
		if cloud == nil || !intent.IsAIConfigCloud() || intent.CapabilityContract != runtimeAgentAIConfigCapabilityAudioTranscribe ||
			intent.ModelID() != strings.TrimSpace(cloud.GetProviderModelId()) ||
			intent.GrantID() != strings.TrimSpace(cloud.GetConnectorGrantId()) {
			return publicChatExecutionBinding{}, unresolvedSharedAIConfigExecutionBindingError()
		}
	default:
		return publicChatExecutionBinding{}, unresolvedSharedAIConfigExecutionBindingError()
	}
	return clonePublicChatExecutionBindings(publicChatExecutionBindings{
		runtimeAgentAIConfigCapabilityAudioTranscribe: binding,
	})[runtimeAgentAIConfigCapabilityAudioTranscribe], nil
}

func (s *Service) waitAgentVoiceTranscriptionJob(ctx context.Context, jobID string) (*runtimev1.ScenarioJob, error) {
	ticker := time.NewTicker(defaultAgentVoiceTranscriptionPoll)
	defer ticker.Stop()
	for {
		response, err := s.voiceTranscription.GetScenarioJob(ctx, &runtimev1.GetScenarioJobRequest{JobId: jobID})
		if err != nil {
			return nil, err
		}
		job := response.GetJob()
		switch job.GetStatus() {
		case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED:
			return job, nil
		case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT:
			reason := job.GetReasonCode()
			if reason == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
				reason = runtimev1.ReasonCode_AI_OUTPUT_INVALID
			}
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, reason)
		}
		select {
		case <-ctx.Done():
			return nil, status.FromContextError(ctx.Err()).Err()
		case <-ticker.C:
		}
	}
}
