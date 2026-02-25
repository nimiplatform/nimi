package workflow

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	defaultWorkflowTimeout = 2 * time.Minute
)

func (s *Service) executeTask(taskID string) {
	record, exists := s.getTask(taskID)
	if !exists || record.Graph == nil {
		return
	}

	if !s.setTaskStatus(taskID, runtimev1.WorkflowStatus_WORKFLOW_STATUS_QUEUED, runtimev1.ReasonCode_ACTION_EXECUTED, nil) {
		return
	}
	release, acquireResult, acquireErr := s.scheduler.Acquire(context.Background(), record.AppID)
	if acquireErr != nil {
		s.finishFailed(taskID, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, "workflow scheduler unavailable")
		return
	}
	defer release()
	if acquireResult.Waited > 0 && s.logger != nil {
		waitMs := acquireResult.Waited.Milliseconds()
		if acquireResult.Starved {
			s.logger.Warn("workflow scheduler starvation threshold reached", "task_id", taskID, "app_id", record.AppID, "queue_wait_ms", waitMs)
		} else {
			s.logger.Debug("workflow scheduler queue wait", "task_id", taskID, "app_id", record.AppID, "queue_wait_ms", waitMs)
		}
	}

	if !s.publishIfRunning(taskID, &runtimev1.WorkflowEvent{
		EventType:  runtimev1.WorkflowEventType_WORKFLOW_EVENT_STARTED,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}) {
		s.finishCanceled(taskID)
		return
	}

	if !s.setTaskStatus(taskID, runtimev1.WorkflowStatus_WORKFLOW_STATUS_RUNNING, runtimev1.ReasonCode_ACTION_EXECUTED, nil) {
		return
	}

	timeout := record.RequestedTimeout
	if timeout <= 0 {
		timeout = defaultWorkflowTimeout
	}
	execCtx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	stopWatch := make(chan struct{})
	go func() {
		ticker := time.NewTicker(20 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stopWatch:
				return
			case <-ticker.C:
				if s.isCancelRequested(taskID) {
					cancel()
					return
				}
			}
		}
	}()
	defer close(stopWatch)

	for _, nodeID := range record.NodeOrder {
		if s.isCancelRequested(taskID) {
			s.finishCanceled(taskID)
			return
		}
		if execCtx.Err() != nil {
			s.finishFailed(taskID, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, "workflow timeout reached")
			return
		}

		nodeStatus := s.getNodeStatus(taskID, nodeID)
		if nodeStatus == runtimev1.WorkflowStatus_WORKFLOW_STATUS_SKIPPED {
			continue
		}

		node := record.Graph.NodeByID[nodeID]
		if node == nil {
			s.finishFailed(taskID, runtimev1.ReasonCode_AI_INPUT_INVALID, "workflow node missing")
			return
		}

		inputs, resolveErr := s.resolveNodeInputs(taskID, record.Graph, nodeID)
		if resolveErr != nil {
			s.finishFailed(taskID, runtimev1.ReasonCode_AI_INPUT_INVALID, resolveErr.Error())
			return
		}

		s.setNodeStatus(taskID, nodeID, runtimev1.WorkflowStatus_WORKFLOW_STATUS_RUNNING, 1, "")
		if !s.publishIfRunning(taskID, &runtimev1.WorkflowEvent{
			EventType:  runtimev1.WorkflowEventType_WORKFLOW_EVENT_NODE_STARTED,
			NodeId:     nodeID,
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		}) {
			s.finishCanceled(taskID)
			return
		}

		nodeOutputs, executeErr := s.executeNode(execCtx, record, node, inputs)
		if executeErr != nil {
			if s.isCancelRequested(taskID) || execCtx.Err() == context.Canceled {
				s.finishCanceled(taskID)
				return
			}
			if execCtx.Err() == context.DeadlineExceeded {
				s.finishFailed(taskID, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, "workflow timeout reached")
				return
			}
			s.setNodeStatus(taskID, nodeID, runtimev1.WorkflowStatus_WORKFLOW_STATUS_FAILED, 1, executeErr.Error())
			_ = s.publishEvent(taskID, &runtimev1.WorkflowEvent{
				EventType:       runtimev1.WorkflowEventType_WORKFLOW_EVENT_NODE_COMPLETED,
				NodeId:          nodeID,
				ProgressPercent: 100,
				ReasonCode:      runtimev1.ReasonCode_AI_OUTPUT_INVALID,
				Payload:         structFromMap(map[string]any{"error": executeErr.Error()}),
			})
			s.finishFailed(taskID, runtimev1.ReasonCode_AI_OUTPUT_INVALID, executeErr.Error())
			return
		}

		for slot, value := range nodeOutputs {
			s.resultStore.Write(taskID, nodeID, slot, value)
		}
		s.setNodeStatus(taskID, nodeID, runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED, 1, "")

		payload := nodeOutputs["output"]
		if payload == nil {
			payload = structFromMap(map[string]any{"slots": len(nodeOutputs)})
		}
		if !s.publishIfRunning(taskID, &runtimev1.WorkflowEvent{
			EventType:       runtimev1.WorkflowEventType_WORKFLOW_EVENT_NODE_COMPLETED,
			NodeId:          nodeID,
			ProgressPercent: 100,
			ReasonCode:      runtimev1.ReasonCode_ACTION_EXECUTED,
			Payload:         payload,
		}) {
			s.finishCanceled(taskID)
			return
		}
	}

	output := s.buildWorkflowOutput(taskID, record)
	if !s.setTaskStatus(taskID, runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED, runtimev1.ReasonCode_ACTION_EXECUTED, output) {
		return
	}
	_ = s.publishEvent(taskID, &runtimev1.WorkflowEvent{
		EventType:  runtimev1.WorkflowEventType_WORKFLOW_EVENT_COMPLETED,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		Payload:    output,
	})
	s.markTaskTerminal(taskID)
}

func (s *Service) resolveNodeInputs(taskID string, graph *workflowGraph, nodeID string) (map[string]*structpb.Struct, error) {
	inputs := make(map[string]*structpb.Struct, len(graph.Incoming[nodeID]))
	for _, edge := range graph.Incoming[nodeID] {
		value, ok := s.resultStore.Read(taskID, edge.GetFromNodeId(), edge.GetFromOutput())
		if !ok {
			if s.getNodeStatus(taskID, edge.GetFromNodeId()) == runtimev1.WorkflowStatus_WORKFLOW_STATUS_SKIPPED {
				continue
			}
			return nil, fmt.Errorf("missing edge input: %s.%s -> %s.%s", edge.GetFromNodeId(), edge.GetFromOutput(), edge.GetToNodeId(), edge.GetToInput())
		}
		inputs[edge.GetToInput()] = value
	}
	return inputs, nil
}

func (s *Service) executeNode(ctx context.Context, record *taskRecord, node *runtimev1.WorkflowNode, inputs map[string]*structpb.Struct) (map[string]*structpb.Struct, error) {
	switch node.GetNodeType() {
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_GENERATE:
		return s.executeAIGenerateNode(ctx, record, node, inputs)
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_STREAM:
		return s.executeAIStreamNode(ctx, record, node, inputs)
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_EMBED:
		return s.executeAIEmbedNode(ctx, record, node, inputs)
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_IMAGE:
		return s.executeAIImageNode(ctx, record, node, inputs)
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_VIDEO:
		return s.executeAIVideoNode(ctx, record, node, inputs)
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_TTS:
		return s.executeAITTSNode(ctx, record, node, inputs)
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_STT:
		return s.executeAISTTNode(ctx, record, node, inputs)
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_EXTRACT:
		return s.executeExtractNode(node, inputs)
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_TEMPLATE:
		return s.executeTemplateNode(node, inputs)
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_SCRIPT:
		return s.executeScriptNode(ctx, record, node, inputs)
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_CONTROL_BRANCH:
		return s.executeBranchNode(record, node, inputs)
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_CONTROL_MERGE:
		return s.executeMergeNode(record, node, inputs)
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_CONTROL_NOOP:
		return s.executeNoopNode(inputs), nil
	default:
		return nil, fmt.Errorf("unsupported workflow node type: %s", node.GetNodeType().String())
	}
}

func (s *Service) executeAIGenerateNode(ctx context.Context, record *taskRecord, node *runtimev1.WorkflowNode, inputs map[string]*structpb.Struct) (map[string]*structpb.Struct, error) {
	cfg := node.GetAiGenerateConfig()
	prompt := strings.TrimSpace(cfg.GetPrompt())
	if prompt == "" {
		prompt = firstInputString(inputs, "prompt", "text", "input")
	}
	if client := s.runtimeAIClient(); client != nil {
		resp, err := client.Generate(ctx, &runtimev1.GenerateRequest{
			AppId:         record.AppID,
			SubjectUserId: record.SubjectUserID,
			ModelId:       cfg.GetModelId(),
			Modal:         cfg.GetModal(),
			Input:         promptAsMessages(prompt),
			SystemPrompt:  cfg.GetSystemPrompt(),
			Tools:         cfg.GetTools(),
			Temperature:   cfg.GetTemperature(),
			TopP:          cfg.GetTopP(),
			MaxTokens:     cfg.GetMaxTokens(),
			RoutePolicy:   cfg.GetRoutePolicy(),
			Fallback:      cfg.GetFallback(),
			TimeoutMs:     cfg.GetTimeoutMs(),
		})
		if err != nil {
			return nil, err
		}
		output := cloneStruct(resp.GetOutput())
		if output == nil {
			output = structFromMap(map[string]any{})
		}
		text := coerceString(output)
		return map[string]*structpb.Struct{
			"output": output,
			"text":   structFromMap(map[string]any{"value": text}),
		}, nil
	}
	text := prompt
	if text == "" {
		text = "generated"
	}
	return map[string]*structpb.Struct{
		"output": structFromMap(map[string]any{"text": text, "node_type": node.GetNodeType().String()}),
		"text":   structFromMap(map[string]any{"value": text}),
	}, nil
}

func (s *Service) executeAIStreamNode(ctx context.Context, record *taskRecord, node *runtimev1.WorkflowNode, inputs map[string]*structpb.Struct) (map[string]*structpb.Struct, error) {
	cfg := node.GetAiStreamConfig()
	prompt := strings.TrimSpace(cfg.GetPrompt())
	if prompt == "" {
		prompt = firstInputString(inputs, "prompt", "text", "input")
	}
	if client := s.runtimeAIClient(); client != nil {
		stream, err := client.StreamGenerate(ctx, &runtimev1.StreamGenerateRequest{
			AppId:         record.AppID,
			SubjectUserId: record.SubjectUserID,
			ModelId:       cfg.GetModelId(),
			Modal:         cfg.GetModal(),
			Input:         promptAsMessages(prompt),
			SystemPrompt:  cfg.GetSystemPrompt(),
			Tools:         cfg.GetTools(),
			Temperature:   cfg.GetTemperature(),
			TopP:          cfg.GetTopP(),
			MaxTokens:     cfg.GetMaxTokens(),
			RoutePolicy:   cfg.GetRoutePolicy(),
			Fallback:      cfg.GetFallback(),
			TimeoutMs:     cfg.GetTimeoutMs(),
		})
		if err != nil {
			return nil, err
		}
		var output strings.Builder
		for {
			event, recvErr := stream.Recv()
			if recvErr == io.EOF {
				break
			}
			if recvErr != nil {
				return nil, recvErr
			}
			if delta := event.GetDelta(); delta != nil {
				output.WriteString(delta.GetText())
			}
		}
		text := output.String()
		return map[string]*structpb.Struct{
			"output": structFromMap(map[string]any{"text": text}),
			"text":   structFromMap(map[string]any{"value": text}),
		}, nil
	}

	text := prompt
	if text == "" {
		text = "streamed"
	}
	return map[string]*structpb.Struct{
		"output": structFromMap(map[string]any{"text": text}),
		"text":   structFromMap(map[string]any{"value": text}),
	}, nil
}

func (s *Service) executeAIEmbedNode(ctx context.Context, record *taskRecord, node *runtimev1.WorkflowNode, inputs map[string]*structpb.Struct) (map[string]*structpb.Struct, error) {
	cfg := node.GetAiEmbedConfig()
	embedInputs := append([]string(nil), cfg.GetInputs()...)
	if len(embedInputs) == 0 {
		embedInputs = firstInputStrings(inputs, "inputs", "input", "text")
	}
	if len(embedInputs) == 0 {
		return nil, fmt.Errorf("embed inputs are empty")
	}
	if client := s.runtimeAIClient(); client != nil {
		resp, err := client.Embed(ctx, &runtimev1.EmbedRequest{
			AppId:         record.AppID,
			SubjectUserId: record.SubjectUserID,
			ModelId:       cfg.GetModelId(),
			Inputs:        embedInputs,
			RoutePolicy:   cfg.GetRoutePolicy(),
			Fallback:      cfg.GetFallback(),
			TimeoutMs:     cfg.GetTimeoutMs(),
		})
		if err != nil {
			return nil, err
		}
		vectors := make([]any, 0, len(resp.GetVectors()))
		for _, vector := range resp.GetVectors() {
			vectors = append(vectors, vector.AsSlice())
		}
		return map[string]*structpb.Struct{
			"output": structFromMap(map[string]any{"vectors": vectors}),
		}, nil
	}

	vectors := make([]any, 0, len(embedInputs))
	for _, value := range embedInputs {
		vectors = append(vectors, []any{float64(len(value))})
	}
	return map[string]*structpb.Struct{
		"output": structFromMap(map[string]any{"vectors": vectors}),
	}, nil
}

func (s *Service) executeAIImageNode(ctx context.Context, record *taskRecord, node *runtimev1.WorkflowNode, inputs map[string]*structpb.Struct) (map[string]*structpb.Struct, error) {
	cfg := node.GetAiImageConfig()
	prompt := strings.TrimSpace(cfg.GetPrompt())
	if prompt == "" {
		prompt = firstInputString(inputs, "prompt", "text")
	}
	if prompt == "" {
		return nil, fmt.Errorf("image prompt is empty")
	}

	content := []byte(prompt)
	mimeType := "image/png"
	if client := s.runtimeAIClient(); client != nil {
		stream, err := client.GenerateImage(ctx, &runtimev1.GenerateImageRequest{
			AppId:         record.AppID,
			SubjectUserId: record.SubjectUserID,
			ModelId:       cfg.GetModelId(),
			Prompt:        prompt,
			RoutePolicy:   cfg.GetRoutePolicy(),
			Fallback:      cfg.GetFallback(),
			TimeoutMs:     cfg.GetTimeoutMs(),
		})
		if err != nil {
			return nil, err
		}
		payload, receivedMime, readErr := readArtifactChunks(stream)
		if readErr != nil {
			return nil, readErr
		}
		if len(payload) > 0 {
			content = payload
		}
		if strings.TrimSpace(receivedMime) != "" {
			mimeType = receivedMime
		}
	}
	artifactOutput, err := s.writeArtifact(record, node, "artifact", mimeType, content)
	if err != nil {
		return nil, err
	}
	return artifactOutput, nil
}

func (s *Service) executeAIVideoNode(ctx context.Context, record *taskRecord, node *runtimev1.WorkflowNode, inputs map[string]*structpb.Struct) (map[string]*structpb.Struct, error) {
	cfg := node.GetAiVideoConfig()
	prompt := strings.TrimSpace(cfg.GetPrompt())
	if prompt == "" {
		prompt = firstInputString(inputs, "prompt", "text")
	}
	if prompt == "" {
		return nil, fmt.Errorf("video prompt is empty")
	}

	content := []byte(prompt)
	mimeType := "video/mp4"
	if client := s.runtimeAIClient(); client != nil {
		stream, err := client.GenerateVideo(ctx, &runtimev1.GenerateVideoRequest{
			AppId:         record.AppID,
			SubjectUserId: record.SubjectUserID,
			ModelId:       cfg.GetModelId(),
			Prompt:        prompt,
			RoutePolicy:   cfg.GetRoutePolicy(),
			Fallback:      cfg.GetFallback(),
			TimeoutMs:     cfg.GetTimeoutMs(),
		})
		if err != nil {
			return nil, err
		}
		payload, receivedMime, readErr := readArtifactChunks(stream)
		if readErr != nil {
			return nil, readErr
		}
		if len(payload) > 0 {
			content = payload
		}
		if strings.TrimSpace(receivedMime) != "" {
			mimeType = receivedMime
		}
	}
	artifactOutput, err := s.writeArtifact(record, node, "artifact", mimeType, content)
	if err != nil {
		return nil, err
	}
	return artifactOutput, nil
}

func (s *Service) executeAITTSNode(ctx context.Context, record *taskRecord, node *runtimev1.WorkflowNode, inputs map[string]*structpb.Struct) (map[string]*structpb.Struct, error) {
	cfg := node.GetAiTtsConfig()
	text := strings.TrimSpace(cfg.GetText())
	if text == "" {
		text = firstInputString(inputs, "text", "prompt")
	}
	if text == "" {
		return nil, fmt.Errorf("tts text is empty")
	}

	content := []byte(text)
	mimeType := "audio/wav"
	if client := s.runtimeAIClient(); client != nil {
		stream, err := client.SynthesizeSpeech(ctx, &runtimev1.SynthesizeSpeechRequest{
			AppId:         record.AppID,
			SubjectUserId: record.SubjectUserID,
			ModelId:       cfg.GetModelId(),
			Text:          text,
			RoutePolicy:   cfg.GetRoutePolicy(),
			Fallback:      cfg.GetFallback(),
			TimeoutMs:     cfg.GetTimeoutMs(),
		})
		if err != nil {
			return nil, err
		}
		payload, receivedMime, readErr := readArtifactChunks(stream)
		if readErr != nil {
			return nil, readErr
		}
		if len(payload) > 0 {
			content = payload
		}
		if strings.TrimSpace(receivedMime) != "" {
			mimeType = receivedMime
		}
	}
	artifactOutput, err := s.writeArtifact(record, node, "artifact", mimeType, content)
	if err != nil {
		return nil, err
	}
	artifactOutput["text"] = structFromMap(map[string]any{"value": text})
	return artifactOutput, nil
}

func (s *Service) executeAISTTNode(ctx context.Context, record *taskRecord, node *runtimev1.WorkflowNode, inputs map[string]*structpb.Struct) (map[string]*structpb.Struct, error) {
	cfg := node.GetAiSttConfig()
	audio := append([]byte(nil), cfg.GetAudioBytes()...)
	if len(audio) == 0 {
		audio = []byte(firstInputString(inputs, "audio", "input"))
	}
	if len(audio) == 0 {
		return nil, fmt.Errorf("stt audio is empty")
	}
	text := "transcribed"
	if client := s.runtimeAIClient(); client != nil {
		resp, err := client.TranscribeAudio(ctx, &runtimev1.TranscribeAudioRequest{
			AppId:         record.AppID,
			SubjectUserId: record.SubjectUserID,
			ModelId:       cfg.GetModelId(),
			AudioBytes:    audio,
			MimeType:      cfg.GetMimeType(),
			RoutePolicy:   cfg.GetRoutePolicy(),
			Fallback:      cfg.GetFallback(),
			TimeoutMs:     cfg.GetTimeoutMs(),
		})
		if err != nil {
			return nil, err
		}
		if strings.TrimSpace(resp.GetText()) != "" {
			text = resp.GetText()
		}
	}
	return map[string]*structpb.Struct{
		"output": structFromMap(map[string]any{"text": text}),
		"text":   structFromMap(map[string]any{"value": text}),
	}, nil
}

func (s *Service) executeExtractNode(node *runtimev1.WorkflowNode, inputs map[string]*structpb.Struct) (map[string]*structpb.Struct, error) {
	cfg := node.GetExtractConfig()
	source := inputs[cfg.GetSourceInput()]
	if source == nil {
		return nil, fmt.Errorf("extract source_input %q missing", cfg.GetSourceInput())
	}
	value, ok := extractJSONPath(source.AsMap(), cfg.GetJsonPath())
	if !ok {
		return nil, fmt.Errorf("extract json_path %q failed", cfg.GetJsonPath())
	}
	output := structFromValue(value)
	text := coerceString(output)
	result := map[string]*structpb.Struct{"output": output}
	if text != "" {
		result["text"] = structFromMap(map[string]any{"value": text})
	}
	return result, nil
}

func (s *Service) executeTemplateNode(node *runtimev1.WorkflowNode, inputs map[string]*structpb.Struct) (map[string]*structpb.Struct, error) {
	cfg := node.GetTemplateConfig()
	rendered := renderTemplateString(cfg.GetTemplate(), inputs)
	output := structFromMap(map[string]any{
		"text":             rendered,
		"output_mime_type": cfg.GetOutputMimeType(),
	})
	return map[string]*structpb.Struct{
		"output": output,
		"text":   structFromMap(map[string]any{"value": rendered}),
	}, nil
}

func (s *Service) executeScriptNode(ctx context.Context, record *taskRecord, node *runtimev1.WorkflowNode, inputs map[string]*structpb.Struct) (map[string]*structpb.Struct, error) {
	cfg := node.GetScriptConfig()
	if client := s.runtimeScriptClient(); client != nil {
		resp, err := client.Execute(ctx, &runtimev1.ExecuteRequest{
			TaskId:           record.TaskID,
			NodeId:           node.GetNodeId(),
			Inputs:           cloneInputMap(inputs),
			Runtime:          cfg.GetRuntime(),
			Code:             cfg.GetCode(),
			TimeoutMs:        cfg.GetTimeoutMs(),
			MemoryLimitBytes: cfg.GetMemoryLimitBytes(),
		})
		if err != nil {
			return nil, err
		}
		if !resp.GetSuccess() {
			return nil, fmt.Errorf("script worker failed: %s", resp.GetErrorMessage())
		}
		output := cloneStruct(resp.GetOutput())
		if output == nil {
			output = structFromMap(map[string]any{})
		}
		result := map[string]*structpb.Struct{"output": output}
		if text := coerceString(output); text != "" {
			result["text"] = structFromMap(map[string]any{"value": text})
		}
		return result, nil
	}

	output := structFromMap(map[string]any{
		"runtime": cfg.GetRuntime(),
		"inputs":  inputsAsMap(inputs),
	})
	return map[string]*structpb.Struct{"output": output}, nil
}

func (s *Service) executeBranchNode(record *taskRecord, node *runtimev1.WorkflowNode, inputs map[string]*structpb.Struct) (map[string]*structpb.Struct, error) {
	cfg := node.GetBranchConfig()
	matched, err := evaluateBranchCondition(cfg.GetCondition(), inputs)
	if err != nil {
		return nil, err
	}
	selectedTarget := strings.TrimSpace(cfg.GetFalseTarget())
	deselectedTarget := strings.TrimSpace(cfg.GetTrueTarget())
	if matched {
		selectedTarget = strings.TrimSpace(cfg.GetTrueTarget())
		deselectedTarget = strings.TrimSpace(cfg.GetFalseTarget())
	}
	if deselectedTarget != "" {
		s.skipBranchPath(record.TaskID, record.Graph, node.GetNodeId(), deselectedTarget)
	}
	return map[string]*structpb.Struct{
		"output": structFromMap(map[string]any{
			"condition":       cfg.GetCondition(),
			"matched":         matched,
			"selected_target": selectedTarget,
		}),
	}, nil
}

func (s *Service) executeMergeNode(record *taskRecord, node *runtimev1.WorkflowNode, inputs map[string]*structpb.Struct) (map[string]*structpb.Struct, error) {
	cfg := node.GetMergeConfig()
	upstreams := record.Graph.Upstream[node.GetNodeId()]
	completed := 0
	for _, predecessor := range upstreams {
		if s.getNodeStatus(record.TaskID, predecessor) == runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED {
			completed++
		}
	}
	strategy := cfg.GetStrategy()
	if strategy == runtimev1.MergeStrategy_MERGE_STRATEGY_UNSPECIFIED {
		strategy = runtimev1.MergeStrategy_MERGE_STRATEGY_ALL
	}
	valid := false
	switch strategy {
	case runtimev1.MergeStrategy_MERGE_STRATEGY_ALL:
		valid = completed == len(upstreams)
	case runtimev1.MergeStrategy_MERGE_STRATEGY_ANY:
		valid = completed >= 1
	case runtimev1.MergeStrategy_MERGE_STRATEGY_N_OF_M:
		valid = completed >= int(cfg.GetMinCompleted())
	}
	if !valid {
		return nil, fmt.Errorf("merge strategy %s not satisfied", strategy.String())
	}

	aggregated := make(map[string]any, len(inputs))
	for slot, value := range inputs {
		aggregated[slot] = value.AsMap()
	}
	result := map[string]*structpb.Struct{
		"output": structFromMap(aggregated),
	}
	for slot, value := range inputs {
		result[slot] = cloneStruct(value)
	}
	return result, nil
}

func (s *Service) executeNoopNode(inputs map[string]*structpb.Struct) map[string]*structpb.Struct {
	for _, value := range inputs {
		if value != nil {
			return map[string]*structpb.Struct{"output": cloneStruct(value)}
		}
	}
	return map[string]*structpb.Struct{"output": structFromMap(map[string]any{})}
}

func (s *Service) skipBranchPath(taskID string, graph *workflowGraph, branchNodeID string, startNodeID string) {
	if strings.TrimSpace(startNodeID) == "" {
		return
	}
	queue := []string{startNodeID}
	skipped := map[string]bool{}
	for len(queue) > 0 {
		nodeID := queue[0]
		queue = queue[1:]
		if skipped[nodeID] {
			continue
		}
		if nodeID != startNodeID && !s.canSkipNode(taskID, graph, branchNodeID, nodeID, skipped) {
			continue
		}
		if !s.markNodeSkipped(taskID, nodeID, "branch_not_selected") {
			continue
		}
		skipped[nodeID] = true
		for _, next := range graph.Downstream[nodeID] {
			queue = append(queue, next)
		}
	}
}

func (s *Service) canSkipNode(taskID string, graph *workflowGraph, branchNodeID string, nodeID string, skipped map[string]bool) bool {
	for _, predecessor := range graph.Upstream[nodeID] {
		if predecessor == branchNodeID {
			continue
		}
		if skipped[predecessor] {
			continue
		}
		if s.getNodeStatus(taskID, predecessor) != runtimev1.WorkflowStatus_WORKFLOW_STATUS_SKIPPED {
			return false
		}
	}
	return true
}

func (s *Service) markNodeSkipped(taskID string, nodeID string, reason string) bool {
	statusValue := s.getNodeStatus(taskID, nodeID)
	if statusValue == runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED ||
		statusValue == runtimev1.WorkflowStatus_WORKFLOW_STATUS_RUNNING ||
		statusValue == runtimev1.WorkflowStatus_WORKFLOW_STATUS_FAILED {
		return false
	}
	if statusValue == runtimev1.WorkflowStatus_WORKFLOW_STATUS_SKIPPED {
		return true
	}
	if !s.setNodeStatus(taskID, nodeID, runtimev1.WorkflowStatus_WORKFLOW_STATUS_SKIPPED, 0, reason) {
		return false
	}
	_ = s.publishEvent(taskID, &runtimev1.WorkflowEvent{
		EventType:  runtimev1.WorkflowEventType_WORKFLOW_EVENT_NODE_SKIPPED,
		NodeId:     nodeID,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		Payload:    structFromMap(map[string]any{"reason": reason}),
	})
	return true
}

func (s *Service) writeArtifact(record *taskRecord, node *runtimev1.WorkflowNode, slot string, mimeType string, content []byte) (map[string]*structpb.Struct, error) {
	if s.artifactStore == nil {
		return map[string]*structpb.Struct{
			"artifact": structFromMap(map[string]any{
				"artifact_id": "",
				"mime_type":   mimeType,
				"size":        len(content),
			}),
			"output": structFromMap(map[string]any{"mime_type": mimeType, "size": len(content)}),
		}, nil
	}
	meta, err := s.artifactStore.Write(record.TaskID, node.GetNodeId(), slot, mimeType, content)
	if err != nil {
		return nil, err
	}
	artifact := structFromMap(map[string]any{
		"artifact_id": meta.ArtifactID,
		"mime_type":   meta.MimeType,
		"size":        meta.Size,
		"path":        meta.Path,
	})
	return map[string]*structpb.Struct{
		"artifact": artifact,
		"output":   artifact,
	}, nil
}

func (s *Service) buildWorkflowOutput(taskID string, record *taskRecord) *structpb.Struct {
	completed := 0
	skipped := 0
	failed := 0
	for _, nodeID := range record.NodeOrder {
		switch s.getNodeStatus(taskID, nodeID) {
		case runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED:
			completed++
		case runtimev1.WorkflowStatus_WORKFLOW_STATUS_SKIPPED:
			skipped++
		case runtimev1.WorkflowStatus_WORKFLOW_STATUS_FAILED:
			failed++
		}
	}

	lastNode := ""
	lastOutput := map[string]any{}
	for i := len(record.NodeOrder) - 1; i >= 0; i-- {
		nodeID := record.NodeOrder[i]
		if statusValue := s.getNodeStatus(taskID, nodeID); statusValue != runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED {
			continue
		}
		if output, ok := s.resultStore.Read(taskID, nodeID, "output"); ok {
			lastNode = nodeID
			lastOutput = output.AsMap()
			break
		}
	}

	artifactCount := 0
	if s.artifactStore != nil {
		artifactCount = len(s.artifactStore.SnapshotTask(taskID))
	}

	return structFromMap(map[string]any{
		"task_id":         taskID,
		"workflow_type":   record.Definition.GetWorkflowType(),
		"completed_nodes": completed,
		"skipped_nodes":   skipped,
		"failed_nodes":    failed,
		"artifacts":       artifactCount,
		"last_node":       lastNode,
		"output":          lastOutput,
	})
}

func (s *Service) runtimeAIClient() runtimev1.RuntimeAiServiceClient {
	if s.aiClient != nil {
		return s.aiClient
	}
	if s.workerPool == nil {
		return nil
	}
	conn, err := s.workerPool.Conn("ai")
	if err != nil {
		if s.logger != nil {
			s.logger.Debug("workflow ai worker unavailable", "error", err)
		}
		return nil
	}
	return runtimev1.NewRuntimeAiServiceClient(conn)
}

func (s *Service) runtimeScriptClient() runtimev1.ScriptWorkerServiceClient {
	if s.scriptClient != nil {
		return s.scriptClient
	}
	if s.workerPool == nil {
		return nil
	}
	conn, err := s.workerPool.Conn("script")
	if err != nil {
		if s.logger != nil {
			s.logger.Debug("workflow script worker unavailable", "error", err)
		}
		return nil
	}
	return runtimev1.NewScriptWorkerServiceClient(conn)
}

func readArtifactChunks(stream interface {
	Recv() (*runtimev1.ArtifactChunk, error)
}) ([]byte, string, error) {
	var payload bytes.Buffer
	mimeType := ""
	for {
		chunk, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, "", err
		}
		if mimeType == "" {
			mimeType = chunk.GetMimeType()
		}
		if len(chunk.GetChunk()) > 0 {
			_, _ = payload.Write(chunk.GetChunk())
		}
		if chunk.GetEof() {
			break
		}
	}
	return payload.Bytes(), mimeType, nil
}

func promptAsMessages(prompt string) []*runtimev1.ChatMessage {
	trimmed := strings.TrimSpace(prompt)
	if trimmed == "" {
		return []*runtimev1.ChatMessage{}
	}
	return []*runtimev1.ChatMessage{{Role: "user", Content: trimmed}}
}

func firstInputString(inputs map[string]*structpb.Struct, slots ...string) string {
	for _, slot := range slots {
		if value, ok := inputs[slot]; ok {
			if text := coerceString(value); text != "" {
				return text
			}
		}
	}
	for _, value := range inputs {
		if text := coerceString(value); text != "" {
			return text
		}
	}
	return ""
}

func firstInputStrings(inputs map[string]*structpb.Struct, slots ...string) []string {
	for _, slot := range slots {
		if value, ok := inputs[slot]; ok && value != nil {
			if list := stringsFromStruct(value); len(list) > 0 {
				return list
			}
		}
	}
	for _, value := range inputs {
		if list := stringsFromStruct(value); len(list) > 0 {
			return list
		}
	}
	return []string{}
}

func stringsFromStruct(input *structpb.Struct) []string {
	if input == nil {
		return []string{}
	}
	mapped := input.AsMap()
	if values, ok := mapped["values"].([]any); ok {
		result := make([]string, 0, len(values))
		for _, value := range values {
			if text, ok := value.(string); ok {
				result = append(result, text)
			}
		}
		return result
	}
	if value, ok := mapped["value"].(string); ok && strings.TrimSpace(value) != "" {
		return []string{value}
	}
	if text := coerceString(input); text != "" {
		return []string{text}
	}
	return []string{}
}

func cloneInputMap(inputs map[string]*structpb.Struct) map[string]*structpb.Struct {
	if len(inputs) == 0 {
		return map[string]*structpb.Struct{}
	}
	copied := make(map[string]*structpb.Struct, len(inputs))
	for key, value := range inputs {
		copied[key] = cloneStruct(value)
	}
	return copied
}

func inputsAsMap(inputs map[string]*structpb.Struct) map[string]any {
	mapped := make(map[string]any, len(inputs))
	for key, value := range inputs {
		if value == nil {
			mapped[key] = map[string]any{}
			continue
		}
		mapped[key] = value.AsMap()
	}
	return mapped
}

func (s *Service) publishIfRunning(taskID string, event *runtimev1.WorkflowEvent) bool {
	if s.isCancelRequested(taskID) {
		return false
	}
	return s.publishEvent(taskID, event) == nil
}

func (s *Service) finishFailed(taskID string, reason runtimev1.ReasonCode, why string) {
	_ = s.setTaskStatus(taskID, runtimev1.WorkflowStatus_WORKFLOW_STATUS_FAILED, reason, nil)
	payload := structFromMap(map[string]any{"reason": why})
	_ = s.publishEvent(taskID, &runtimev1.WorkflowEvent{
		EventType:  runtimev1.WorkflowEventType_WORKFLOW_EVENT_FAILED,
		ReasonCode: reason,
		Payload:    payload,
	})
	s.markTaskTerminal(taskID)
}

func (s *Service) finishCanceled(taskID string) {
	_ = s.setTaskStatus(taskID, runtimev1.WorkflowStatus_WORKFLOW_STATUS_CANCELED, runtimev1.ReasonCode_ACTION_EXECUTED, nil)
	_ = s.publishEvent(taskID, &runtimev1.WorkflowEvent{
		EventType:  runtimev1.WorkflowEventType_WORKFLOW_EVENT_CANCELED,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	})
	s.markTaskTerminal(taskID)
}

func (s *Service) markTaskTerminal(taskID string) {
	if s.resultStore != nil {
		s.resultStore.MarkTaskDone(taskID)
		s.resultStore.CleanupExpired(time.Now().UTC())
	}
	if s.artifactStore != nil {
		s.artifactStore.MarkTaskDone(taskID)
		s.artifactStore.CleanupExpired(time.Now().UTC())
	}
}

func (s *Service) publishEvent(taskID string, event *runtimev1.WorkflowEvent) error {
	s.mu.Lock()
	record, exists := s.tasks[taskID]
	if !exists {
		s.mu.Unlock()
		return fmt.Errorf("%s", runtimev1.ReasonCode_APP_GRANT_INVALID.String())
	}

	logs := s.eventLog[taskID]
	emitted := cloneEvent(event)
	emitted.TaskId = taskID
	emitted.TraceId = record.TraceID
	emitted.Sequence = uint64(len(logs) + 1)
	if emitted.Timestamp == nil {
		emitted.Timestamp = timestamppb.New(time.Now().UTC())
	}
	s.eventLog[taskID] = append(logs, emitted)

	targets := make([]subscriber, 0, len(s.subscribers))
	for _, sub := range s.subscribers {
		if sub.TaskID == taskID {
			targets = append(targets, sub)
		}
	}
	s.mu.Unlock()

	for _, sub := range targets {
		clone := cloneEvent(emitted)
		select {
		case sub.Ch <- clone:
			continue
		default:
		}

		select {
		case <-sub.Ch:
		default:
		}
		select {
		case sub.Ch <- clone:
		default:
		}
	}
	return nil
}
