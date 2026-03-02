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
	submitReq, err := buildSubmitMediaJobRequest(record, node, inputs)
	if err != nil {
		return nil, err
	}
	submitResp, err := client.SubmitMediaJob(ctx, submitReq)
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
		_, _ = client.CancelMediaJob(cancelCtx, &runtimev1.CancelMediaJobRequest{
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
		pollResp, pollErr := client.GetMediaJob(ctx, &runtimev1.GetMediaJobRequest{
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
		case runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_SUBMITTED,
			runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_QUEUED,
			runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_RUNNING:
			if !runningEventSent || current.GetStatus() == runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_RUNNING {
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
		case runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED:
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
			return outputsFromMediaJob(s, record, node, current)
		default:
			reasonCode := workflowReasonCodeFromMediaJob(current)
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
			return nil, fmt.Errorf("external async media job failed: %s", current.GetReasonCode().String())
		}
	}
}

func buildSubmitMediaJobRequest(
	record *taskRecord,
	node *runtimev1.WorkflowNode,
	inputs map[string]*structpb.Struct,
) (*runtimev1.SubmitMediaJobRequest, error) {
	if record == nil || node == nil {
		return nil, fmt.Errorf("workflow record/node is nil")
	}
	req := &runtimev1.SubmitMediaJobRequest{
		AppId:          record.AppID,
		SubjectUserId:  record.SubjectUserID,
		RoutePolicy:    runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:       runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
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
		req.ModelId = cfg.GetModelId()
		req.Modal = runtimev1.Modal_MODAL_IMAGE
		req.RoutePolicy = cfg.GetRoutePolicy()
		req.Fallback = cfg.GetFallback()
		req.TimeoutMs = cfg.GetTimeoutMs()
		req.Spec = &runtimev1.SubmitMediaJobRequest_ImageSpec{
			ImageSpec: &runtimev1.ImageGenerationSpec{
				Prompt: prompt,
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
		req.ModelId = cfg.GetModelId()
		req.Modal = runtimev1.Modal_MODAL_VIDEO
		req.RoutePolicy = cfg.GetRoutePolicy()
		req.Fallback = cfg.GetFallback()
		req.TimeoutMs = cfg.GetTimeoutMs()
		req.Spec = &runtimev1.SubmitMediaJobRequest_VideoSpec{
			VideoSpec: &runtimev1.VideoGenerationSpec{
				Prompt: prompt,
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
		req.ModelId = cfg.GetModelId()
		req.Modal = runtimev1.Modal_MODAL_TTS
		req.RoutePolicy = cfg.GetRoutePolicy()
		req.Fallback = cfg.GetFallback()
		req.TimeoutMs = cfg.GetTimeoutMs()
		req.Spec = &runtimev1.SubmitMediaJobRequest_SpeechSpec{
			SpeechSpec: &runtimev1.SpeechSynthesisSpec{
				Text: text,
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
		req.ModelId = cfg.GetModelId()
		req.Modal = runtimev1.Modal_MODAL_STT
		req.RoutePolicy = cfg.GetRoutePolicy()
		req.Fallback = cfg.GetFallback()
		req.TimeoutMs = cfg.GetTimeoutMs()
		req.Spec = &runtimev1.SubmitMediaJobRequest_TranscriptionSpec{
			TranscriptionSpec: &runtimev1.SpeechTranscriptionSpec{
				AudioBytes: audio,
				MimeType:   cfg.GetMimeType(),
			},
		}
	default:
		return nil, fmt.Errorf("node type does not support external async media execution: %s", node.GetNodeType().String())
	}
	if strings.TrimSpace(req.GetModelId()) == "" {
		return nil, fmt.Errorf("model id is empty for external async node")
	}
	if req.GetRoutePolicy() == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		req.RoutePolicy = runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME
	}
	if req.GetFallback() == runtimev1.FallbackPolicy_FALLBACK_POLICY_UNSPECIFIED {
		req.Fallback = runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY
	}
	return req, nil
}

func outputsFromMediaJob(
	svc *Service,
	record *taskRecord,
	node *runtimev1.WorkflowNode,
	job *runtimev1.MediaJob,
) (map[string]*structpb.Struct, error) {
	if job == nil {
		return nil, fmt.Errorf("media job is nil")
	}
	artifacts := job.GetArtifacts()
	if len(artifacts) == 0 {
		return nil, fmt.Errorf("media job artifacts are empty")
	}
	first := artifacts[0]
	switch node.GetNodeType() {
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_IMAGE,
		runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_VIDEO,
		runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_TTS:
		return svc.writeArtifact(record, node, "artifact", first.GetMimeType(), first.GetBytes())
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_STT:
		text := strings.TrimSpace(string(first.GetBytes()))
		if text == "" && first.GetProviderRaw() != nil {
			if value, ok := first.GetProviderRaw().AsMap()["text"].(string); ok {
				text = strings.TrimSpace(value)
			}
		}
		return map[string]*structpb.Struct{
			"output": structFromMap(map[string]any{"text": text}),
			"text":   structFromMap(map[string]any{"value": text}),
		}, nil
	default:
		return nil, fmt.Errorf("unsupported external async node output mapping: %s", node.GetNodeType().String())
	}
}
