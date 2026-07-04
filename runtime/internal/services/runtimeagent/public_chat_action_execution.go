package runtimeagent

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	runtimeAgentImageActionAppID     = "runtime.agent.image_action"
	runtimeAgentImageActionSubjectID = "anonymous"
	defaultImageActionWait           = 10 * time.Minute
	defaultImageActionPoll           = 100 * time.Millisecond
	imageActionExtensionNamespace    = "nimi.scenario.image.request"
)

type publicChatActionScenarioExecutor interface {
	SubmitScenarioJob(context.Context, *runtimev1.SubmitScenarioJobRequest) (*runtimev1.SubmitScenarioJobResponse, error)
	GetScenarioJob(context.Context, *runtimev1.GetScenarioJobRequest) (*runtimev1.GetScenarioJobResponse, error)
	GetScenarioArtifacts(context.Context, *runtimev1.GetScenarioArtifactsRequest) (*runtimev1.GetScenarioArtifactsResponse, error)
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
		waitTimeout:  defaultImageActionWait,
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
		return PublicChatActionExecutionResult{}, fmt.Errorf("runtime public chat image action %s requires execution_bindings.image.generate", actionID)
	}
	params := req.Session.ExecutionParams["image.generate"]
	waitTimeout := e.waitTimeout
	if timeoutMs := publicChatPositiveIntParam(params, "timeoutMs", "timeout_ms"); timeoutMs > 0 {
		waitTimeout = time.Duration(timeoutMs) * time.Millisecond
	}
	if waitTimeout <= 0 {
		waitTimeout = defaultImageActionWait
	}
	actionCtx, cancel := context.WithTimeout(runtimeAgentImageActionContext(ctx), waitTimeout)
	defer cancel()
	idempotencyKey := "runtime-agent-image-action:" + strings.TrimSpace(req.Turn.TurnID) + ":" + actionID
	submitResp, err := e.ai.SubmitScenarioJob(actionCtx, buildPublicChatImageActionSubmitRequest(binding, params, prompt, idempotencyKey, waitTimeout))
	if err != nil {
		return PublicChatActionExecutionResult{}, err
	}
	jobID := strings.TrimSpace(submitResp.GetJob().GetJobId())
	if jobID == "" {
		return PublicChatActionExecutionResult{}, fmt.Errorf("runtime public chat image action %s returned empty job id", actionID)
	}
	job, err := e.waitImageActionJob(actionCtx, jobID)
	if err != nil {
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

func buildPublicChatImageActionSubmitRequest(binding publicChatExecutionBinding, params map[string]any, prompt string, idempotencyKey string, waitTimeout time.Duration) *runtimev1.SubmitScenarioJobRequest {
	spec := &runtimev1.ImageGenerateScenarioSpec{
		Prompt:         strings.TrimSpace(prompt),
		N:              1,
		Size:           publicChatStringParam(params, "size"),
		ResponseFormat: normalizePublicChatImageResponseFormat(publicChatStringParam(params, "responseFormat", "response_format")),
		Seed:           int64(publicChatPositiveIntParam(params, "seed")),
	}
	return &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         runtimeAgentImageActionAppID,
			SubjectUserId: runtimeAgentImageActionSubjectID,
			ModelId:       strings.TrimSpace(binding.ModelID),
			RoutePolicy:   binding.RoutePolicy,
			ConnectorId:   strings.TrimSpace(binding.ConnectorID),
			TargetRef:     clonePublicChatTargetRef(binding.TargetRef),
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
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
			return nil, ctx.Err()
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
				return nil, fmt.Errorf("image action job %s ended with %s: %s", jobID, job.GetStatus().String(), strings.TrimSpace(job.GetReasonDetail()))
			default:
				timer.Reset(pollInterval)
			}
		}
	}
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
	copyImageActionParam(payload, params, "sampler", "sampler")
	copyImageActionParam(payload, params, "scheduler", "scheduler")
	if entries, ok := params["profile_entries"]; ok {
		payload["profile_entries"] = entries
	}
	if overrides, ok := params["entry_overrides"]; ok {
		payload["entry_overrides"] = overrides
	}
	if profileOverrides, ok := params["profile_overrides"]; ok {
		payload["profile_overrides"] = profileOverrides
	}
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
	default:
		return strings.TrimSpace(value)
	}
}

func runtimeAgentImageActionContext(parent context.Context) context.Context {
	if parent == nil {
		parent = context.Background()
	}
	md, _ := metadata.FromIncomingContext(parent)
	next := md.Copy()
	if next == nil {
		next = metadata.MD{}
	}
	next.Set("x-nimi-app-id", runtimeAgentImageActionAppID)
	return metadata.NewIncomingContext(parent, next)
}
