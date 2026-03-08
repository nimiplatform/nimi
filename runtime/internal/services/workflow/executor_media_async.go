package workflow

import (
	"context"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

func shouldExecuteExternalAsync(node *runtimev1.WorkflowNode) bool {
	if node == nil {
		return false
	}
	if node.GetExecutionMode() != runtimev1.WorkflowExecutionMode_WORKFLOW_EXECUTION_MODE_EXTERNAL_ASYNC {
		return false
	}
	switch node.GetNodeType() {
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_IMAGE,
		runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_VIDEO,
		runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_TTS,
		runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_STT:
		return true
	default:
		return false
	}
}

func (s *Service) executeNodeExternalAsync(
	ctx context.Context,
	record *taskRecord,
	node *runtimev1.WorkflowNode,
	inputs map[string]*structpb.Struct,
) (map[string]*structpb.Struct, error) {
	client := s.runtimeAIClient()
	if client == nil {
		return nil, fmt.Errorf("runtime ai client unavailable for external async node")
	}
	submitReq, err := buildSubmitScenarioJobRequest(record, node, inputs)
	if err != nil {
		return nil, err
	}
	submitResp, err := aiSubmitScenarioJob(ctx, client, submitReq)
	if err != nil {
		return nil, err
	}
	job := submitResp.GetJob()
	if job == nil || strings.TrimSpace(job.GetJobId()) == "" {
		return nil, fmt.Errorf("external async submit returned empty job id")
	}
	taskID := record.TaskID
	nodeID := node.GetNodeId()
	jobID := strings.TrimSpace(job.GetJobId())
	cancelForwarded := false
	forwardCancel := func(reason string) {
		if cancelForwarded || jobID == "" {
			return
		}
		cancelForwarded = true
		cancelCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_, _ = aiCancelScenarioJob(cancelCtx, client, &runtimev1.CancelScenarioJobRequest{
			JobId:  jobID,
			Reason: strings.TrimSpace(reason),
		})
	}
	s.setNodeExternalStatus(taskID, nodeID, job.GetProviderJobId(), job.GetNextPollAt(), job.GetRetryCount(), "")
	if err := s.publishEvent(taskID, &runtimev1.WorkflowEvent{
		EventType:  runtimev1.WorkflowEventType_WORKFLOW_EVENT_NODE_EXTERNAL_SUBMITTED,
		NodeId:     nodeID,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		Payload: structFromMap(map[string]any{
			"job_id":          job.GetJobId(),
			"provider_job_id": job.GetProviderJobId(),
			"status":          job.GetStatus().String(),
			"retry_count":     job.GetRetryCount(),
			"reason_code":     job.GetReasonCode().String(),
			"reason_detail":   job.GetReasonDetail(),
		}),
	}); err != nil {
		s.logger.Warn("workflow event publish failed", "task_id", taskID, "error", err)
	}

	retryCount := int32(0)
	runningEventSent := false
	for {
		if ctx.Err() != nil {
			forwardCancel(ctx.Err().Error())
			return nil, ctx.Err()
		}
		pollResp, pollErr := aiGetScenarioJob(ctx, client, &runtimev1.GetScenarioJobRequest{
			JobId: jobID,
		})
		if pollErr != nil {
			if ctx.Err() != nil {
				forwardCancel(ctx.Err().Error())
			}
			return nil, pollErr
		}
		current := pollResp.GetJob()
		if current == nil {
			return nil, fmt.Errorf("external async poll returned empty job")
		}
		retryCount++
		effectiveRetryCount := current.GetRetryCount()
		if effectiveRetryCount < retryCount {
			effectiveRetryCount = retryCount
		}
		s.setNodeExternalStatus(taskID, nodeID, current.GetProviderJobId(), current.GetNextPollAt(), effectiveRetryCount, "")
		switch current.GetStatus() {
		case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING:
			if !runningEventSent || current.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING {
				runningEventSent = true
				if err := s.publishEvent(taskID, &runtimev1.WorkflowEvent{
					EventType:  runtimev1.WorkflowEventType_WORKFLOW_EVENT_NODE_EXTERNAL_RUNNING,
					NodeId:     nodeID,
					ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
					Payload: structFromMap(map[string]any{
						"job_id":          current.GetJobId(),
						"provider_job_id": current.GetProviderJobId(),
						"status":          current.GetStatus().String(),
						"retry_count":     effectiveRetryCount,
						"reason_code":     current.GetReasonCode().String(),
						"reason_detail":   current.GetReasonDetail(),
					}),
				}); err != nil {
					s.logger.Warn("workflow event publish failed", "task_id", taskID, "error", err)
				}
			}
			time.Sleep(400 * time.Millisecond)
			continue
		case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED:
			if err := s.publishEvent(taskID, &runtimev1.WorkflowEvent{
				EventType:  runtimev1.WorkflowEventType_WORKFLOW_EVENT_NODE_EXTERNAL_COMPLETED,
				NodeId:     nodeID,
				ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
				Payload: structFromMap(map[string]any{
					"job_id":          current.GetJobId(),
					"provider_job_id": current.GetProviderJobId(),
					"status":          current.GetStatus().String(),
					"retry_count":     effectiveRetryCount,
					"reason_code":     current.GetReasonCode().String(),
					"reason_detail":   current.GetReasonDetail(),
				}),
			}); err != nil {
				s.logger.Warn("workflow event publish failed", "task_id", taskID, "error", err)
			}
			return outputsFromScenarioJob(s, record, node, current)
		default:
			reasonCode := workflowReasonCodeFromScenarioJob(current)
			lastError := strings.TrimSpace(current.GetReasonDetail())
			if lastError == "" {
				lastError = current.GetReasonCode().String()
			}
			s.setNodeExternalStatus(taskID, nodeID, current.GetProviderJobId(), current.GetNextPollAt(), effectiveRetryCount, lastError)
			if err := s.publishEvent(taskID, &runtimev1.WorkflowEvent{
				EventType:  runtimev1.WorkflowEventType_WORKFLOW_EVENT_NODE_EXTERNAL_FAILED,
				NodeId:     nodeID,
				ReasonCode: reasonCode,
				Payload: structFromMap(map[string]any{
					"job_id":          current.GetJobId(),
					"provider_job_id": current.GetProviderJobId(),
					"status":          current.GetStatus().String(),
					"retry_count":     effectiveRetryCount,
					"reason_code":     current.GetReasonCode().String(),
					"reason_detail":   current.GetReasonDetail(),
				}),
			}); err != nil {
				s.logger.Warn("workflow event publish failed", "task_id", taskID, "error", err)
			}
			return nil, fmt.Errorf("external async scenario job failed: %s", current.GetReasonCode().String())
		}
	}
}

func buildSubmitScenarioJobRequest(
	record *taskRecord,
	node *runtimev1.WorkflowNode,
	inputs map[string]*structpb.Struct,
) (*runtimev1.SubmitScenarioJobRequest, error) {
	if record == nil || node == nil {
		return nil, fmt.Errorf("workflow record/node is nil")
	}
	req := &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         record.AppID,
			SubjectUserId: record.SubjectUserID,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		},
		ExecutionMode:  runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		RequestId:      fmt.Sprintf("%s:%s", record.TaskID, node.GetNodeId()),
		IdempotencyKey: fmt.Sprintf("%s:%s:external-async", record.TaskID, node.GetNodeId()),
		Labels: map[string]string{
			"workflow_task_id": record.TaskID,
			"workflow_node_id": node.GetNodeId(),
		},
	}

	switch node.GetNodeType() {
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_IMAGE:
		cfg := node.GetAiImageConfig()
		prompt := strings.TrimSpace(cfg.GetPrompt())
		if prompt == "" {
			prompt = firstInputString(inputs, "prompt", "text")
		}
		if prompt == "" {
			return nil, fmt.Errorf("image prompt is empty")
		}
		req.Head.ModelId = cfg.GetModelId()
		req.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE
		req.Head.RoutePolicy = cfg.GetRoutePolicy()
		req.Head.Fallback = cfg.GetFallback()
		req.Head.TimeoutMs = cfg.GetTimeoutMs()
		req.Spec = &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_ImageGenerate{
				ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{
					Prompt: prompt,
				},
			},
		}
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_VIDEO:
		cfg := node.GetAiVideoConfig()
		prompt := strings.TrimSpace(cfg.GetPrompt())
		if prompt == "" {
			prompt = firstInputString(inputs, "prompt", "text")
		}
		if prompt == "" {
			return nil, fmt.Errorf("video prompt is empty")
		}
		req.Head.ModelId = cfg.GetModelId()
		req.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE
		req.Head.RoutePolicy = cfg.GetRoutePolicy()
		req.Head.Fallback = cfg.GetFallback()
		req.Head.TimeoutMs = cfg.GetTimeoutMs()
		req.Spec = &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VideoGenerate{
				VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{
					Prompt: prompt,
					Mode:   runtimev1.VideoMode_VIDEO_MODE_T2V,
					Content: []*runtimev1.VideoContentItem{
						{
							Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT,
							Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT,
							Text: prompt,
						},
					},
					Options: &runtimev1.VideoGenerationOptions{},
				},
			},
		}
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_TTS:
		cfg := node.GetAiTtsConfig()
		text := strings.TrimSpace(cfg.GetText())
		if text == "" {
			text = firstInputString(inputs, "text", "prompt")
		}
		if text == "" {
			return nil, fmt.Errorf("tts text is empty")
		}
		req.Head.ModelId = cfg.GetModelId()
		req.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE
		req.Head.RoutePolicy = cfg.GetRoutePolicy()
		req.Head.Fallback = cfg.GetFallback()
		req.Head.TimeoutMs = cfg.GetTimeoutMs()
		req.Spec = &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
					Text: text,
				},
			},
		}
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_STT:
		cfg := node.GetAiSttConfig()
		audio := append([]byte(nil), cfg.GetAudioBytes()...)
		if len(audio) == 0 {
			audio = []byte(firstInputString(inputs, "audio", "input"))
		}
		if len(audio) == 0 {
			return nil, fmt.Errorf("stt audio is empty")
		}
		req.Head.ModelId = cfg.GetModelId()
		req.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE
		req.Head.RoutePolicy = cfg.GetRoutePolicy()
		req.Head.Fallback = cfg.GetFallback()
		req.Head.TimeoutMs = cfg.GetTimeoutMs()
		req.Spec = &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{
				SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{
					MimeType: cfg.GetMimeType(),
					AudioSource: &runtimev1.SpeechTranscriptionAudioSource{
						Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{
							AudioBytes: append([]byte(nil), audio...),
						},
					},
				},
			},
		}
	default:
		return nil, fmt.Errorf("node type does not support external async media execution: %s", node.GetNodeType().String())
	}
	if strings.TrimSpace(req.GetHead().GetModelId()) == "" {
		return nil, fmt.Errorf("model id is empty for external async node")
	}
	if req.GetHead().GetRoutePolicy() == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		req.Head.RoutePolicy = runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL
	}
	if req.GetHead().GetFallback() == runtimev1.FallbackPolicy_FALLBACK_POLICY_UNSPECIFIED {
		req.Head.Fallback = runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY
	}
	return req, nil
}

func outputsFromScenarioJob(
	svc *Service,
	record *taskRecord,
	node *runtimev1.WorkflowNode,
	job *runtimev1.ScenarioJob,
) (map[string]*structpb.Struct, error) {
	if job == nil {
		return nil, fmt.Errorf("scenario job is nil")
	}
	artifacts := job.GetArtifacts()
	if len(artifacts) == 0 {
		return nil, fmt.Errorf("scenario job artifacts are empty")
	}
	first := artifacts[0]
	switch node.GetNodeType() {
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_IMAGE,
		runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_VIDEO,
		runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_TTS:
		return svc.writeArtifact(record, node, "artifact", first.GetMimeType(), first.GetBytes())
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_STT:
		text := strings.TrimSpace(string(first.GetBytes()))
		return map[string]*structpb.Struct{
			"output": structFromMap(map[string]any{"text": text}),
			"text":   structFromMap(map[string]any{"value": text}),
		}, nil
	default:
		return nil, fmt.Errorf("unsupported external async node output mapping: %s", node.GetNodeType().String())
	}
}
