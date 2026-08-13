package runtimeagent

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	defaultLocalImageActionWait   = 20 * time.Minute
	defaultCloudImageActionWait   = 5 * time.Minute
	defaultImageActionPoll        = 100 * time.Millisecond
	imageActionExtensionNamespace = "nimi.scenario.image.request"
)

type publicChatActionScenarioExecutor interface {
	SubmitScenarioJob(context.Context, *runtimev1.SubmitScenarioJobRequest) (*runtimev1.SubmitScenarioJobResponse, error)
	GetScenarioJob(context.Context, *runtimev1.GetScenarioJobRequest) (*runtimev1.GetScenarioJobResponse, error)
	GetScenarioArtifacts(context.Context, *runtimev1.GetScenarioArtifactsRequest) (*runtimev1.GetScenarioArtifactsResponse, error)
	CancelScenarioJob(context.Context, *runtimev1.CancelScenarioJobRequest) (*runtimev1.CancelScenarioJobResponse, error)
}

type PublicChatActionExecutionRequest struct {
	Session publicChatAnchorState
	Turn    publicChatTurnState
	Action  publicChatStructuredAction
}

type PublicChatActionExecutionResult struct {
	ActionID            string
	ProjectionMessageID string
	ArtifactID          string
	MimeType            string
	JobID               string
	ModelResolved       string
}

type PublicChatActionExecutor interface {
	ExecuteImageAction(context.Context, PublicChatActionExecutionRequest) (PublicChatActionExecutionResult, error)
}

type rejectingPublicChatActionExecutor struct{}

func (rejectingPublicChatActionExecutor) ExecuteImageAction(context.Context, PublicChatActionExecutionRequest) (PublicChatActionExecutionResult, error) {
	return PublicChatActionExecutionResult{}, fmt.Errorf("runtime public chat action executor unavailable or not admitted")
}

type aiBackedPublicChatActionExecutor struct {
	ai           publicChatActionScenarioExecutor
	waitTimeout  time.Duration
	pollInterval time.Duration
}

func NewAIBackedPublicChatActionExecutor(ai publicChatActionScenarioExecutor) PublicChatActionExecutor {
	if ai == nil {
		return rejectingPublicChatActionExecutor{}
	}
	return &aiBackedPublicChatActionExecutor{
		ai:           ai,
		pollInterval: defaultImageActionPoll,
	}
}

func (s *Service) SetPublicChatActionExecutor(executor PublicChatActionExecutor) {
	if s == nil || s.isClosed() {
		return
	}
	s.setPublicChatActionExecutor(executor)
}

func (e *aiBackedPublicChatActionExecutor) ExecuteImageAction(ctx context.Context, req PublicChatActionExecutionRequest) (PublicChatActionExecutionResult, error) {
	if e == nil || e.ai == nil {
		return PublicChatActionExecutionResult{}, fmt.Errorf("runtime public chat action executor unavailable or not admitted")
	}
	actionID := strings.TrimSpace(req.Action.ActionID)
	if actionID == "" {
		return PublicChatActionExecutionResult{}, fmt.Errorf("image action id is required")
	}
	if req.Action.Modality != "image" || req.Action.Operation != "image.generate" || req.Action.PromptPayload.Kind != "image-prompt" {
		return PublicChatActionExecutionResult{}, fmt.Errorf("runtime public chat action %s is not an image.generate action", actionID)
	}
	prompt := strings.TrimSpace(req.Action.PromptPayload.PromptText)
	if prompt == "" {
		return PublicChatActionExecutionResult{}, fmt.Errorf("runtime public chat image action %s requires prompt text", actionID)
	}
	binding, ok := req.Session.Bindings["image.generate"]
	if !ok || strings.TrimSpace(binding.ModelID) == "" || binding.RoutePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		return PublicChatActionExecutionResult{}, fmt.Errorf("runtime public chat image action %s has no committed image.generate Runtime Agent AI Config binding", actionID)
	}
	ownerAppID := firstNonEmpty(strings.TrimSpace(req.Session.CallerAppID), strings.TrimSpace(req.Turn.CallerAppID))
	ownerUserID := firstNonEmpty(strings.TrimSpace(req.Session.OwnerUserID), strings.TrimSpace(req.Session.SubjectUserID), strings.TrimSpace(req.Turn.SubjectUserID))
	if ownerAppID == "" || ownerUserID == "" {
		return PublicChatActionExecutionResult{}, fmt.Errorf("runtime public chat image action %s has no admitted artifact owner", actionID)
	}
	// Caller-carried execution_params remain rejected at ingress. Concrete
	// generation parameters come only from the committed Runtime Agent
	// AIConfig fixed at turn admission.
	var params map[string]any
	if binding.SelectedParams != nil {
		params = binding.SelectedParams.AsMap()
	}
	waitTimeout := e.waitTimeout
	if waitTimeout <= 0 {
		waitTimeout = defaultImageActionWait(binding.RoutePolicy)
	}
	if timeoutMs := publicChatPositiveIntParam(params, "timeoutMs", "timeout_ms"); timeoutMs > 0 {
		waitTimeout = time.Duration(timeoutMs) * time.Millisecond
	}
	actionCtx, cancel := context.WithTimeout(runtimeAgentImageActionContext(ctx, ownerAppID, ownerUserID), waitTimeout)
	defer cancel()
	actionCtx = withPublicChatExecutionIntent(actionCtx, binding, "image.generate")
	idempotencyKey := "runtime-agent-image-action:" + strings.TrimSpace(req.Turn.TurnID) + ":" + actionID
	submitResp, err := e.ai.SubmitScenarioJob(actionCtx, buildPublicChatImageActionSubmitRequest(binding, params, prompt, idempotencyKey, waitTimeout, ownerAppID, ownerUserID))
	if err != nil {
		return PublicChatActionExecutionResult{}, err
	}
	jobID := strings.TrimSpace(submitResp.GetJob().GetJobId())
	if jobID == "" {
		return PublicChatActionExecutionResult{}, fmt.Errorf("runtime public chat image action %s returned empty job id", actionID)
	}
	job, err := e.waitImageActionJob(actionCtx, jobID)
	if err != nil {
		if actionCtx.Err() != nil {
			e.cancelImageActionJob(ownerAppID, ownerUserID, jobID)
		}
		return PublicChatActionExecutionResult{}, err
	}
	artifactsResp, err := e.ai.GetScenarioArtifacts(actionCtx, &runtimev1.GetScenarioArtifactsRequest{JobId: jobID})
	if err != nil {
		return PublicChatActionExecutionResult{}, err
	}
	artifact := firstImageActionArtifact(artifactsResp.GetArtifacts())
	if artifact == nil {
		return PublicChatActionExecutionResult{}, fmt.Errorf("runtime public chat image action %s completed without image artifact", actionID)
	}
	artifactID := strings.TrimSpace(artifact.GetArtifactId())
	mimeType := strings.TrimSpace(artifact.GetMimeType())
	if artifactID == "" || mimeType == "" {
		return PublicChatActionExecutionResult{}, fmt.Errorf("runtime public chat image action %s artifact missing id or mime type", actionID)
	}
	return PublicChatActionExecutionResult{
		ActionID:            actionID,
		ProjectionMessageID: publicChatActionProjectionMessageID(req.Turn.TurnID, req.Action),
		ArtifactID:          artifactID,
		MimeType:            mimeType,
		JobID:               jobID,
		ModelResolved:       strings.TrimSpace(job.GetModelResolved()),
	}, nil
}

func (e *aiBackedPublicChatActionExecutor) cancelImageActionJob(ownerAppID string, ownerUserID string, jobID string) {
	if e == nil || e.ai == nil || strings.TrimSpace(jobID) == "" {
		return
	}
	// Scenario jobs intentionally outlive the Submit RPC, so the public chat
	// action must cancel the owned job explicitly when its turn context ends.
	// A detached owner context is required because the action context is
	// already canceled and cannot carry the cleanup RPC.
	ctx, cancel := context.WithTimeout(runtimeAgentImageActionContext(context.Background(), ownerAppID, ownerUserID), 5*time.Second)
	defer cancel()
	_, _ = e.ai.CancelScenarioJob(ctx, &runtimev1.CancelScenarioJobRequest{
		JobId:  strings.TrimSpace(jobID),
		Reason: "runtime agent image action ended",
	})
}

func defaultImageActionWait(route runtimev1.RoutePolicy) time.Duration {
	if route == runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
		return defaultLocalImageActionWait
	}
	return defaultCloudImageActionWait
}

func buildPublicChatImageActionSubmitRequest(binding publicChatExecutionBinding, params map[string]any, prompt string, idempotencyKey string, waitTimeout time.Duration, ownerAppID string, ownerUserID string) *runtimev1.SubmitScenarioJobRequest {
	spec := &runtimev1.ImageGenerateScenarioSpec{
		Prompt:         strings.TrimSpace(prompt),
		N:              proto.Int32(1),
		Size:           publicChatStringParam(params, "size"),
		ResponseFormat: normalizePublicChatImageResponseFormat(publicChatStringParam(params, "responseFormat", "response_format")),
	}
	if seed := publicChatPositiveIntParam(params, "seed"); seed != 0 {
		spec.Seed = proto.Int64(int64(seed))
	}
	return &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         strings.TrimSpace(ownerAppID),
			SubjectUserId: strings.TrimSpace(ownerUserID),
			TimeoutMs:     int32(waitTimeout.Milliseconds()),
		},
		ScenarioType:   runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		ExecutionMode:  runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		IdempotencyKey: strings.TrimSpace(idempotencyKey),
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_ImageGenerate{
				ImageGenerate: spec,
			},
		},
		Extensions: publicChatImageScenarioExtensions(params),
	}
}

func (e *aiBackedPublicChatActionExecutor) waitImageActionJob(ctx context.Context, jobID string) (*runtimev1.ScenarioJob, error) {
	pollInterval := e.pollInterval
	if pollInterval <= 0 {
		pollInterval = defaultImageActionPoll
	}
	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			reason := runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CANCELED
			code := codes.Canceled
			message := "Image generation was canceled."
			if ctx.Err() == context.DeadlineExceeded {
				reason = runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT
				code = codes.DeadlineExceeded
				message = "Image generation timed out."
			}
			retryable := true
			return nil, grpcerr.WrapWithReasonCode(code, reason, ctx.Err(), grpcerr.ReasonOptions{
				Message:   message,
				Retryable: &retryable,
				Metadata:  map[string]string{"job_id": jobID},
			})
		case <-timer.C:
			resp, err := e.ai.GetScenarioJob(ctx, &runtimev1.GetScenarioJobRequest{JobId: jobID})
			if err != nil {
				return nil, err
			}
			job := resp.GetJob()
			switch job.GetStatus() {
			case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED:
				return proto.Clone(job).(*runtimev1.ScenarioJob), nil
			case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED,
				runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED,
				runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT:
				return nil, imageActionJobTerminalError(job)
			default:
				timer.Reset(pollInterval)
			}
		}
	}
}

func imageActionJobTerminalError(job *runtimev1.ScenarioJob) error {
	if job == nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	reason := job.GetReasonCode()
	code := codes.FailedPrecondition
	retryable := true
	message := strings.TrimSpace(job.GetReasonDetail())
	switch job.GetStatus() {
	case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED:
		code = codes.Canceled
		if reason == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
			reason = runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CANCELED
		}
		if message == "" {
			message = "Image generation was canceled."
		}
	case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT:
		code = codes.DeadlineExceeded
		if reason == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
			reason = runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT
		}
		if message == "" {
			message = "Image generation timed out."
		}
	default:
		if reason == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
			reason = runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
		}
		switch reason {
		case runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED,
			runtimev1.ReasonCode_AI_INPUT_INVALID,
			runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED:
			code = codes.InvalidArgument
			retryable = false
		}
		if message == "" {
			message = "Image generation failed."
		}
	}
	return grpcerr.WithReasonCodeOptions(code, reason, grpcerr.ReasonOptions{
		Message:   message,
		Retryable: &retryable,
		Metadata: map[string]string{
			"job_id":     strings.TrimSpace(job.GetJobId()),
			"job_status": job.GetStatus().String(),
		},
	})
}

func firstImageActionArtifact(artifacts []*runtimev1.ScenarioArtifact) *runtimev1.ScenarioArtifact {
	for _, artifact := range artifacts {
		if artifact == nil {
			continue
		}
		mimeType := strings.ToLower(strings.TrimSpace(artifact.GetMimeType()))
		if strings.HasPrefix(mimeType, "image/") {
			return artifact
		}
	}
	return nil
}

func publicChatActionProjectionMessageID(turnID string, action publicChatStructuredAction) string {
	index := action.ActionIndex + 1
	if index <= 0 {
		index = 1
	}
	return strings.TrimSpace(turnID) + ":message:" + strconv.Itoa(index)
}

func publicChatImageScenarioExtensions(params map[string]any) []*runtimev1.ScenarioExtension {
	if len(params) == 0 {
		return nil
	}
	payload := map[string]any{}
	copyImageActionParam(payload, params, "step", "steps")
	copyImageActionParam(payload, params, "cfg_scale", "cfgScale", "cfg_scale")
	copyImageActionParam(payload, params, "guidance_scale", "cfgScale", "guidance_scale")
	copyImageActionParam(payload, params, "mode", "sampler", "mode")
	copyImageActionParam(payload, params, "scheduler", "scheduler")
	if len(payload) == 0 {
		return nil
	}
	structPayload, err := structpb.NewStruct(payload)
	if err != nil {
		return nil
	}
	return []*runtimev1.ScenarioExtension{{
		Namespace: imageActionExtensionNamespace,
		Payload:   structPayload,
	}}
}

func copyImageActionParam(out map[string]any, params map[string]any, outputKey string, inputKeys ...string) {
	for _, key := range inputKeys {
		if value, ok := params[key]; ok {
			out[outputKey] = value
			return
		}
	}
}

func publicChatStringParam(params map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := params[key]; ok {
			switch typed := value.(type) {
			case string:
				if trimmed := strings.TrimSpace(typed); trimmed != "" {
					return trimmed
				}
			}
		}
	}
	return ""
}

func publicChatPositiveIntParam(params map[string]any, keys ...string) int64 {
	for _, key := range keys {
		value, ok := params[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case int:
			if typed > 0 {
				return int64(typed)
			}
		case int32:
			if typed > 0 {
				return int64(typed)
			}
		case int64:
			if typed > 0 {
				return typed
			}
		case float64:
			if typed > 0 {
				return int64(typed)
			}
		case string:
			parsed, err := strconv.ParseInt(strings.TrimSpace(typed), 10, 64)
			if err == nil && parsed > 0 {
				return parsed
			}
		}
	}
	return 0
}

func normalizePublicChatImageResponseFormat(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "auto":
		return ""
	case "base64":
		return "b64_json"
	default:
		return strings.ToLower(strings.TrimSpace(value))
	}
}

func runtimeAgentImageActionContext(parent context.Context, ownerAppID string, ownerUserID string) context.Context {
	if parent == nil {
		parent = context.Background()
	}
	md, _ := metadata.FromIncomingContext(parent)
	next := md.Copy()
	if next == nil {
		next = metadata.MD{}
	}
	next.Set("x-nimi-app-id", strings.TrimSpace(ownerAppID))
	ctx := metadata.NewIncomingContext(parent, next)
	if ownerUserID = strings.TrimSpace(ownerUserID); ownerUserID != "" {
		ctx = authn.WithIdentity(ctx, &authn.Identity{SubjectUserID: ownerUserID})
	}
	return ctx
}
