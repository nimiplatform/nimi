package runtimeagent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	localAppVoiceTranscriptionAppID       = "runtime.agent.local_app_voice_transcription"
	maxLocalAppVoiceTranscriptionBytes    = 8 * 1024 * 1024
	maxLocalAppVoiceTranscriptBytes       = 64 * 1024
	maxLocalAppVoiceClientRequestIDBytes  = 128
	defaultLocalAppVoiceTranscriptionWait = 10 * time.Minute
	defaultLocalAppVoiceTranscriptionPoll = 100 * time.Millisecond
)

var admittedLocalAppVoiceMIMETypes = map[string]struct{}{
	"audio/webm": {},
	"audio/ogg":  {},
	"audio/wav":  {},
	"audio/mpeg": {},
	"audio/mp4":  {},
	"audio/flac": {},
}

type localAppVoiceTranscriptionScenarioExecutor interface {
	SubmitScenarioJob(context.Context, *runtimev1.SubmitScenarioJobRequest) (*runtimev1.SubmitScenarioJobResponse, error)
	GetScenarioJob(context.Context, *runtimev1.GetScenarioJobRequest) (*runtimev1.GetScenarioJobResponse, error)
	GetScenarioArtifacts(context.Context, *runtimev1.GetScenarioArtifactsRequest) (*runtimev1.GetScenarioArtifactsResponse, error)
}

type LocalAppVoiceTranscriptionExecutionRequest struct {
	Binding        publicChatExecutionBinding
	SubjectUserID  string
	Audio          []byte
	MIMEType       string
	IdempotencyKey string
}

type LocalAppVoiceTranscriptionExecutionResult struct {
	Transcript string
}

type LocalAppVoiceTranscriptionExecutor interface {
	TranscribeLocalAppVoice(context.Context, LocalAppVoiceTranscriptionExecutionRequest) (LocalAppVoiceTranscriptionExecutionResult, error)
}

type rejectingLocalAppVoiceTranscriptionExecutor struct{}

func (rejectingLocalAppVoiceTranscriptionExecutor) TranscribeLocalAppVoice(context.Context, LocalAppVoiceTranscriptionExecutionRequest) (LocalAppVoiceTranscriptionExecutionResult, error) {
	return LocalAppVoiceTranscriptionExecutionResult{}, fmt.Errorf("runtime local-app voice transcription executor unavailable")
}

type aiBackedLocalAppVoiceTranscriptionExecutor struct {
	ai           localAppVoiceTranscriptionScenarioExecutor
	waitTimeout  time.Duration
	pollInterval time.Duration
}

func NewAIBackedLocalAppVoiceTranscriptionExecutor(ai localAppVoiceTranscriptionScenarioExecutor) LocalAppVoiceTranscriptionExecutor {
	if ai == nil {
		return rejectingLocalAppVoiceTranscriptionExecutor{}
	}
	return &aiBackedLocalAppVoiceTranscriptionExecutor{
		ai:           ai,
		waitTimeout:  defaultLocalAppVoiceTranscriptionWait,
		pollInterval: defaultLocalAppVoiceTranscriptionPoll,
	}
}

func (s *Service) SetLocalAppVoiceTranscriptionExecutor(executor LocalAppVoiceTranscriptionExecutor) {
	if s == nil || s.isClosed() {
		return
	}
	s.setLocalAppVoiceTranscriptionExecutor(executor)
}

func (e *aiBackedLocalAppVoiceTranscriptionExecutor) TranscribeLocalAppVoice(ctx context.Context, req LocalAppVoiceTranscriptionExecutionRequest) (LocalAppVoiceTranscriptionExecutionResult, error) {
	if e == nil || e.ai == nil {
		return LocalAppVoiceTranscriptionExecutionResult{}, fmt.Errorf("runtime local-app voice transcription executor unavailable")
	}
	if strings.TrimSpace(req.Binding.ModelID) == "" || req.Binding.RoutePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		return LocalAppVoiceTranscriptionExecutionResult{}, fmt.Errorf("committed audio.transcribe binding is unavailable")
	}
	if len(req.Audio) == 0 || len(req.Audio) > maxLocalAppVoiceTranscriptionBytes {
		return LocalAppVoiceTranscriptionExecutionResult{}, fmt.Errorf("bounded transcription audio is required")
	}
	if _, ok := admittedLocalAppVoiceMIMETypes[req.MIMEType]; !ok {
		return LocalAppVoiceTranscriptionExecutionResult{}, fmt.Errorf("transcription MIME type is not admitted")
	}
	waitTimeout := e.waitTimeout
	if waitTimeout <= 0 {
		waitTimeout = defaultLocalAppVoiceTranscriptionWait
	}
	executionCtx, cancel := context.WithTimeout(localAppVoiceTranscriptionContext(ctx), waitTimeout)
	defer cancel()
	submit, err := e.ai.SubmitScenarioJob(executionCtx, &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         localAppVoiceTranscriptionAppID,
			SubjectUserId: strings.TrimSpace(req.SubjectUserID),
			ModelId:       strings.TrimSpace(req.Binding.ModelID),
			RoutePolicy:   req.Binding.RoutePolicy,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     int32(waitTimeout.Milliseconds()),
			ConnectorId:   strings.TrimSpace(req.Binding.ConnectorID),
			TargetRef:     clonePublicChatTargetRef(req.Binding.TargetRef),
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		RequestId:     strings.TrimSpace(req.IdempotencyKey),
		IdempotencyKey: strings.TrimSpace(req.IdempotencyKey),
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{
			SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{
				MimeType: req.MIMEType,
				AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{
					AudioBytes: append([]byte(nil), req.Audio...),
				}},
			},
		}},
	})
	if err != nil {
		return LocalAppVoiceTranscriptionExecutionResult{}, err
	}
	jobID := strings.TrimSpace(submit.GetJob().GetJobId())
	if jobID == "" {
		return LocalAppVoiceTranscriptionExecutionResult{}, fmt.Errorf("transcription job id is empty")
	}
	if _, err := e.waitForLocalAppVoiceTranscription(executionCtx, jobID); err != nil {
		return LocalAppVoiceTranscriptionExecutionResult{}, err
	}
	artifacts, err := e.ai.GetScenarioArtifacts(executionCtx, &runtimev1.GetScenarioArtifactsRequest{JobId: jobID})
	if err != nil {
		return LocalAppVoiceTranscriptionExecutionResult{}, err
	}
	transcription := artifacts.GetOutput().GetSpeechTranscribe()
	if transcription == nil {
		return LocalAppVoiceTranscriptionExecutionResult{}, fmt.Errorf("transcription output is missing")
	}
	text := transcription.GetText()
	if !utf8.ValidString(text) || len([]byte(text)) > maxLocalAppVoiceTranscriptBytes {
		return LocalAppVoiceTranscriptionExecutionResult{}, fmt.Errorf("transcription output exceeds the admitted UTF-8 bound")
	}
	return LocalAppVoiceTranscriptionExecutionResult{Transcript: text}, nil
}

func (e *aiBackedLocalAppVoiceTranscriptionExecutor) waitForLocalAppVoiceTranscription(ctx context.Context, jobID string) (*runtimev1.ScenarioJob, error) {
	pollInterval := e.pollInterval
	if pollInterval <= 0 {
		pollInterval = defaultLocalAppVoiceTranscriptionPoll
	}
	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-timer.C:
			response, err := e.ai.GetScenarioJob(ctx, &runtimev1.GetScenarioJobRequest{JobId: jobID})
			if err != nil {
				return nil, err
			}
			job := response.GetJob()
			if job == nil {
				return nil, fmt.Errorf("transcription job projection is missing")
			}
			switch job.GetStatus() {
			case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED:
				return proto.Clone(job).(*runtimev1.ScenarioJob), nil
			case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED,
				runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED,
				runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT:
				return nil, fmt.Errorf("transcription job ended without a completed result")
			default:
				timer.Reset(pollInterval)
			}
		}
	}
}

func (s *Service) TranscribeLocalAppAgentAudio(ctx context.Context, req *runtimev1.TranscribeLocalAppAgentAudioRequest) (*runtimev1.TranscribeLocalAppAgentAudioResponse, error) {
	if s == nil || s.isClosed() {
		return nil, status.Error(codes.FailedPrecondition, "runtime agent service unavailable")
	}
	decision, authorized := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	if !authorized || decision.Operation != accountservice.LocalAppOperationVoiceTranscribe {
		return nil, status.Error(codes.PermissionDenied, "protected local-app voice transcription authorization is required")
	}
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "voice transcription request is required")
	}
	agentID := strings.TrimSpace(req.GetAgentId())
	clientRequestID := req.GetClientRequestId()
	if agentID == "" || req.GetAgentId() != agentID {
		return nil, status.Error(codes.InvalidArgument, "agent_id is required")
	}
	if !validLocalAppVoiceClientRequestID(clientRequestID) {
		return nil, status.Error(codes.InvalidArgument, "client_request_id is invalid")
	}
	audio := req.GetAudio()
	if len(audio) == 0 || len(audio) > maxLocalAppVoiceTranscriptionBytes {
		return nil, status.Error(codes.InvalidArgument, "audio must be between 1 byte and 8 MiB")
	}
	mimeType, err := normalizeLocalAppVoiceMIMEType(req.GetMimeType())
	if err != nil {
		return nil, err
	}
	auditStore := s.localAppVoiceTranscriptionAuditStore()
	if auditStore == nil {
		return nil, status.Error(codes.FailedPrecondition, "voice transcription audit storage is unavailable")
	}
	entry, err := s.agentByID(agentID)
	if err != nil {
		return nil, err
	}
	identity, err := validateLocalAgentIdentity(entry.Agent.GetOwnerUserId(), entry.Agent.GetRuntimeSourceRef(), entry.Agent.GetLocalAgentRef())
	if err != nil || identity.OwnerUserID != decision.AccountID {
		return nil, status.Error(codes.PermissionDenied, "voice transcription Agent is not owned by the current account")
	}
	if entry.Agent.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE {
		return nil, status.Error(codes.FailedPrecondition, "voice transcription Agent is not active")
	}
	binding, revision, err := s.committedLocalAppVoiceTranscriptionBinding(agentID)
	if err != nil {
		return nil, status.Error(codes.FailedPrecondition, "committed audio.transcribe binding is unavailable")
	}
	if err := s.refreshRuntimeAgentAIConfigReadiness(agentID); err != nil {
		return nil, status.Error(codes.FailedPrecondition, "audio.transcribe readiness is unavailable")
	}
	readiness, err := s.currentRuntimeAgentAIConfigReadinessSnapshot(agentID)
	if err != nil || readiness.GetConfigRevision() != revision || !runtimeAgentCapabilityReady(readiness, runtimeAgentAIConfigCapabilityAudioTranscribe) {
		return nil, status.Error(codes.FailedPrecondition, "audio.transcribe binding is not ready")
	}
	result, err := s.currentLocalAppVoiceTranscriptionExecutor().TranscribeLocalAppVoice(ctx, LocalAppVoiceTranscriptionExecutionRequest{
		Binding:        binding,
		SubjectUserID:  decision.AccountID,
		Audio:          audio,
		MIMEType:       mimeType,
		IdempotencyKey: localAppVoiceTranscriptionIdempotencyKey(decision, agentID, clientRequestID),
	})
	if err != nil {
		return nil, status.Error(codes.Unavailable, "Runtime Agent voice transcription failed")
	}
	if !utf8.ValidString(result.Transcript) || len([]byte(result.Transcript)) > maxLocalAppVoiceTranscriptBytes {
		return nil, status.Error(codes.DataLoss, "Runtime Agent voice transcription output is invalid")
	}
	s.appendLocalAppVoiceTranscriptionAudit(auditStore, decision, mimeType, len(audio), len([]byte(result.Transcript)))
	return &runtimev1.TranscribeLocalAppAgentAudioResponse{ClientRequestId: clientRequestID, Transcript: result.Transcript}, nil
}

func (s *Service) committedLocalAppVoiceTranscriptionBinding(agentID string) (publicChatExecutionBinding, uint64, error) {
	config, err := s.committedRuntimeAgentAIConfigByAgentInstanceID(agentID)
	if err != nil {
		return publicChatExecutionBinding{}, 0, err
	}
	for _, intent := range config.GetIntents() {
		if strings.TrimSpace(intent.GetCapability()) != runtimeAgentAIConfigCapabilityAudioTranscribe {
			continue
		}
		binding := runtimeAgentAIConfigIntentToPublicChatBinding(intent)
		if binding.ModelID == "" || binding.RoutePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
			return publicChatExecutionBinding{}, 0, fmt.Errorf("audio.transcribe binding is structurally invalid")
		}
		return binding, config.GetRevision(), nil
	}
	return publicChatExecutionBinding{}, 0, fmt.Errorf("audio.transcribe binding is not configured")
}

func runtimeAgentCapabilityReady(snapshot *runtimev1.RuntimeAgentAIConfigReadinessSnapshot, capability string) bool {
	if snapshot == nil {
		return false
	}
	for _, item := range snapshot.GetCapabilities() {
		if strings.TrimSpace(item.GetCapability()) == capability {
			return item.GetState() == runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_READY
		}
	}
	return false
}

func normalizeLocalAppVoiceMIMEType(value string) (string, error) {
	if value == "" || len(value) > 256 || strings.ContainsAny(value, "\r\n") {
		return "", status.Error(codes.InvalidArgument, "voice transcription MIME type is invalid")
	}
	base, _, _ := strings.Cut(value, ";")
	base = strings.ToLower(strings.TrimSpace(base))
	if _, ok := admittedLocalAppVoiceMIMETypes[base]; !ok {
		return "", status.Error(codes.InvalidArgument, "voice transcription MIME type is not admitted")
	}
	return base, nil
}

func validLocalAppVoiceClientRequestID(value string) bool {
	if value == "" || value != strings.TrimSpace(value) || len([]byte(value)) > maxLocalAppVoiceClientRequestIDBytes || !utf8.ValidString(value) {
		return false
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

func localAppVoiceTranscriptionIdempotencyKey(decision accountservice.LocalAppCallerDecision, agentID string, clientRequestID string) string {
	digest := sha256.Sum256([]byte("nimi.runtime-agent.local-app-voice-transcription.v1\x00" + decision.AccountID + "\x00" + decision.LocalAppPrincipalID + "\x00" + agentID + "\x00" + clientRequestID))
	return "lavt_v1_" + hex.EncodeToString(digest[:])
}

func localAppVoiceTranscriptionContext(parent context.Context) context.Context {
	if parent == nil {
		parent = context.Background()
	}
	incoming, _ := metadata.FromIncomingContext(parent)
	next := incoming.Copy()
	if next == nil {
		next = metadata.MD{}
	}
	next.Set("x-nimi-app-id", localAppVoiceTranscriptionAppID)
	return metadata.NewIncomingContext(parent, next)
}

func (s *Service) localAppVoiceTranscriptionAuditStore() *auditlog.Store {
	if s == nil {
		return nil
	}
	s.execAuditMu.Lock()
	defer s.execAuditMu.Unlock()
	return s.auditStore
}

func (s *Service) appendLocalAppVoiceTranscriptionAudit(store *auditlog.Store, caller accountservice.LocalAppCallerDecision, mimeType string, audioBytes int, transcriptBytes int) {
	if store == nil {
		return
	}
	now := time.Now().UTC()
	auditID := "runtime-agent-local-app-voice-" + ulid.Make().String()
	payload, _ := structpb.NewStruct(map[string]any{
		"audio_byte_count":      audioBytes,
		"transcript_byte_count": transcriptBytes,
		"mime_type":             mimeType,
	})
	store.AppendEvent(&runtimev1.AuditEventRecord{
		AuditId:       auditID,
		AppId:         caller.AppID,
		SubjectUserId: caller.AccountID,
		Domain:        "runtime.agent.local_app_voice",
		Operation:     string(accountservice.LocalAppOperationVoiceTranscribe),
		ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
		TraceId:       auditID,
		Timestamp:     timestamppb.New(now),
		Payload:       payload,
		CallerKind:    runtimev1.CallerKind_CALLER_KIND_THIRD_PARTY_APP,
		CallerId:      caller.LocalAppPrincipalID,
		PrincipalId:   caller.LocalAppPrincipalID,
		PrincipalType: "local_app",
		SurfaceId:     "runtime.agent.local_app_voice",
		Capability:    "runtime.agent.voice.transcribe",
	})
}

func (s *Service) appendLocalAppVoiceStreamSubscriptionAudit(store *auditlog.Store, caller accountservice.LocalAppCallerDecision, backlogEvents int) {
	if store == nil {
		return
	}
	now := time.Now().UTC()
	auditID := "runtime-agent-local-app-voice-stream-" + ulid.Make().String()
	payload, _ := structpb.NewStruct(map[string]any{"backlog_event_count": backlogEvents})
	store.AppendEvent(&runtimev1.AuditEventRecord{
		AuditId:       auditID,
		AppId:         caller.AppID,
		SubjectUserId: caller.AccountID,
		Domain:        "runtime.agent.local_app_voice",
		Operation:     string(accountservice.LocalAppOperationVoiceStreamSubscribe),
		ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
		TraceId:       auditID,
		Timestamp:     timestamppb.New(now),
		Payload:       payload,
		CallerKind:    runtimev1.CallerKind_CALLER_KIND_THIRD_PARTY_APP,
		CallerId:      caller.LocalAppPrincipalID,
		PrincipalId:   caller.LocalAppPrincipalID,
		PrincipalType: "local_app",
		SurfaceId:     "runtime.agent.local_app_voice",
		Capability:    "runtime.agent.voice.read",
	})
}
