package workflow

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

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
		_, artifacts, runErr := s.runMediaJobSync(ctx, client, record, node, inputs)
		if runErr != nil {
			return nil, runErr
		}
		first := firstMediaArtifact(artifacts)
		if first == nil {
			return nil, fmt.Errorf("image artifacts are empty")
		}
		if len(first.GetBytes()) > 0 {
			content = first.GetBytes()
		}
		if strings.TrimSpace(first.GetMimeType()) != "" {
			mimeType = first.GetMimeType()
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
		_, artifacts, runErr := s.runMediaJobSync(ctx, client, record, node, inputs)
		if runErr != nil {
			return nil, runErr
		}
		first := firstMediaArtifact(artifacts)
		if first == nil {
			return nil, fmt.Errorf("video artifacts are empty")
		}
		if len(first.GetBytes()) > 0 {
			content = first.GetBytes()
		}
		if strings.TrimSpace(first.GetMimeType()) != "" {
			mimeType = first.GetMimeType()
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
		_, artifacts, runErr := s.runMediaJobSync(ctx, client, record, node, inputs)
		if runErr != nil {
			return nil, runErr
		}
		first := firstMediaArtifact(artifacts)
		if first == nil {
			return nil, fmt.Errorf("tts artifacts are empty")
		}
		if len(first.GetBytes()) > 0 {
			content = first.GetBytes()
		}
		if strings.TrimSpace(first.GetMimeType()) != "" {
			mimeType = first.GetMimeType()
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
		_, artifacts, runErr := s.runMediaJobSync(ctx, client, record, node, inputs)
		if runErr != nil {
			return nil, runErr
		}
		first := firstMediaArtifact(artifacts)
		if first != nil {
			value := strings.TrimSpace(string(first.GetBytes()))
			if value == "" && first.GetProviderRaw() != nil {
				if rawText, ok := first.GetProviderRaw().AsMap()["text"].(string); ok {
					value = strings.TrimSpace(rawText)
				}
			}
			if value != "" {
				text = value
			}
		}
	}
	return map[string]*structpb.Struct{
		"output": structFromMap(map[string]any{"text": text}),
		"text":   structFromMap(map[string]any{"value": text}),
	}, nil
}

func (s *Service) runMediaJobSync(
	ctx context.Context,
	client runtimev1.RuntimeAiServiceClient,
	record *taskRecord,
	node *runtimev1.WorkflowNode,
	inputs map[string]*structpb.Struct,
) (*runtimev1.MediaJob, []*runtimev1.MediaArtifact, error) {
	submitReq, err := buildSubmitMediaJobRequest(record, node, inputs)
	if err != nil {
		return nil, nil, err
	}

	submitResp, err := client.SubmitMediaJob(ctx, submitReq)
	if err != nil {
		return nil, nil, err
	}
	job := submitResp.GetJob()
	if job == nil || strings.TrimSpace(job.GetJobId()) == "" {
		return nil, nil, fmt.Errorf("media submit returned empty job")
	}

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

	for {
		if ctx.Err() != nil {
			forwardCancel(ctx.Err().Error())
			return nil, nil, ctx.Err()
		}

		switch job.GetStatus() {
		case runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_SUBMITTED,
			runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_QUEUED,
			runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_RUNNING:
			time.Sleep(250 * time.Millisecond)
			pollResp, pollErr := client.GetMediaJob(ctx, &runtimev1.GetMediaJobRequest{
				JobId: jobID,
			})
			if pollErr != nil {
				return nil, nil, pollErr
			}
			if pollResp.GetJob() == nil {
				return nil, nil, fmt.Errorf("media poll returned empty job")
			}
			job = pollResp.GetJob()
			continue
		case runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED:
			artifacts := job.GetArtifacts()
			if len(artifacts) == 0 {
				artifactsResp, artifactsErr := client.GetMediaArtifacts(ctx, &runtimev1.GetMediaArtifactsRequest{
					JobId: jobID,
				})
				if artifactsErr != nil {
					return nil, nil, artifactsErr
				}
				artifacts = artifactsResp.GetArtifacts()
			}
			return job, artifacts, nil
		default:
			reason := strings.TrimSpace(job.GetReasonDetail())
			if reason == "" {
				reason = strings.TrimSpace(job.GetReasonCode().String())
			}
			if reason == "" {
				reason = "unknown media job failure"
			}
			return nil, nil, fmt.Errorf("media job failed: %s", reason)
		}
	}
}

func firstMediaArtifact(artifacts []*runtimev1.MediaArtifact) *runtimev1.MediaArtifact {
	if len(artifacts) == 0 {
		return nil
	}
	return artifacts[0]
}

func workflowReasonCodeFromMediaJob(job *runtimev1.MediaJob) runtimev1.ReasonCode {
	if job == nil {
		return runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
	}
	code := job.GetReasonCode()
	if code == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		return runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
	}
	return code
}

func workflowReasonCodeFromError(err error) runtimev1.ReasonCode {
	if err == nil {
		return runtimev1.ReasonCode_ACTION_EXECUTED
	}
	st, ok := status.FromError(err)
	if !ok {
		return runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
	}
	switch st.Code() {
	case codes.InvalidArgument:
		return runtimev1.ReasonCode_AI_INPUT_INVALID
	case codes.NotFound:
		return runtimev1.ReasonCode_AI_MODEL_NOT_FOUND
	case codes.DeadlineExceeded:
		return runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT
	case codes.FailedPrecondition:
		return runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED
	default:
		if value, exists := runtimev1.ReasonCode_value[strings.TrimSpace(st.Message())]; exists {
			return runtimev1.ReasonCode(value)
		}
		return runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
	}
}
