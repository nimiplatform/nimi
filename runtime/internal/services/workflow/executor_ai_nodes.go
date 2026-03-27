package workflow

import (
	"context"
	"fmt"
	"io"
	"strings"
	"sync/atomic"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
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
	client, err := s.requireRuntimeAIClient()
	if err != nil {
		return nil, err
	}
	resp, err := client.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         record.AppID,
			SubjectUserId: record.SubjectUserID,
			ModelId:       cfg.GetModelId(),
			RoutePolicy:   cfg.GetRoutePolicy(),
			Fallback:      cfg.GetFallback(),
			TimeoutMs:     cfg.GetTimeoutMs(),
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					Input:        promptAsMessages(prompt),
					SystemPrompt: cfg.GetSystemPrompt(),
					Tools:        cfg.GetTools(),
					Temperature:  cfg.GetTemperature(),
					TopP:         cfg.GetTopP(),
					MaxTokens:    cfg.GetMaxTokens(),
				},
			},
		},
	})
	if err != nil {
		return nil, err
	}
	output := scenarioOutputToStruct(resp.GetOutput())
	if output == nil {
		return nil, fmt.Errorf("ai generate output missing typed payload")
	}
	text := scenarioOutputText(resp.GetOutput())
	if text == "" {
		text = coerceString(output)
	}
	return map[string]*structpb.Struct{
		"output": output,
		"text":   structFromMap(map[string]any{"value": text}),
	}, nil
}

func (s *Service) executeAIStreamNode(ctx context.Context, record *taskRecord, node *runtimev1.WorkflowNode, inputs map[string]*structpb.Struct) (map[string]*structpb.Struct, error) {
	cfg := node.GetAiStreamConfig()
	prompt := strings.TrimSpace(cfg.GetPrompt())
	if prompt == "" {
		prompt = firstInputString(inputs, "prompt", "text", "input")
	}
	client, err := s.requireRuntimeAIClient()
	if err != nil {
		return nil, err
	}
	stream, err := client.StreamScenario(ctx, &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         record.AppID,
			SubjectUserId: record.SubjectUserID,
			ModelId:       cfg.GetModelId(),
			RoutePolicy:   cfg.GetRoutePolicy(),
			Fallback:      cfg.GetFallback(),
			TimeoutMs:     cfg.GetTimeoutMs(),
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					Input:        promptAsMessages(prompt),
					SystemPrompt: cfg.GetSystemPrompt(),
					Tools:        cfg.GetTools(),
					Temperature:  cfg.GetTemperature(),
					TopP:         cfg.GetTopP(),
					MaxTokens:    cfg.GetMaxTokens(),
				},
			},
		},
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
			output.WriteString(streamDeltaText(delta))
		}
	}
	text := output.String()
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
	client, err := s.requireRuntimeAIClient()
	if err != nil {
		return nil, err
	}
	resp, err := client.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         record.AppID,
			SubjectUserId: record.SubjectUserID,
			ModelId:       cfg.GetModelId(),
			RoutePolicy:   cfg.GetRoutePolicy(),
			Fallback:      cfg.GetFallback(),
			TimeoutMs:     cfg.GetTimeoutMs(),
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextEmbed{
				TextEmbed: &runtimev1.TextEmbedScenarioSpec{
					Inputs: embedInputs,
				},
			},
		},
	})
	if err != nil {
		return nil, err
	}
	vectors := make([]any, 0)
	for _, vector := range scenarioOutputVectors(resp.GetOutput()) {
		row := make([]any, 0, len(vector))
		for _, value := range vector {
			row = append(row, value)
		}
		vectors = append(vectors, row)
	}
	return map[string]*structpb.Struct{
		"output": structFromMap(map[string]any{"vectors": vectors}),
	}, nil
}

func scenarioOutputToStruct(output *runtimev1.ScenarioOutput) *structpb.Struct {
	switch value := output.GetOutput().(type) {
	case *runtimev1.ScenarioOutput_TextGenerate:
		return structFromMap(map[string]any{"text": value.TextGenerate.GetText()})
	case *runtimev1.ScenarioOutput_TextEmbed:
		rows := make([]any, 0, len(value.TextEmbed.GetVectors()))
		for _, vector := range value.TextEmbed.GetVectors() {
			row := make([]any, 0, len(vector.GetValues()))
			for _, item := range vector.GetValues() {
				row = append(row, item)
			}
			rows = append(rows, row)
		}
		return structFromMap(map[string]any{"vectors": rows})
	default:
		return nil
	}
}

func scenarioOutputText(output *runtimev1.ScenarioOutput) string {
	if value, ok := output.GetOutput().(*runtimev1.ScenarioOutput_TextGenerate); ok {
		return strings.TrimSpace(value.TextGenerate.GetText())
	}
	return ""
}

func scenarioOutputVectors(output *runtimev1.ScenarioOutput) [][]float64 {
	value, ok := output.GetOutput().(*runtimev1.ScenarioOutput_TextEmbed)
	if !ok || value.TextEmbed == nil {
		return nil
	}
	rows := make([][]float64, 0, len(value.TextEmbed.GetVectors()))
	for _, vector := range value.TextEmbed.GetVectors() {
		rows = append(rows, append([]float64(nil), vector.GetValues()...))
	}
	return rows
}

func streamDeltaText(delta *runtimev1.ScenarioStreamDelta) string {
	value, ok := delta.GetDelta().(*runtimev1.ScenarioStreamDelta_Text)
	if !ok || value.Text == nil {
		return ""
	}
	return value.Text.GetText()
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

	client, err := s.requireRuntimeAIClient()
	if err != nil {
		return nil, err
	}
	return s.executeAISyncArtifactNode(ctx, client, record, node, inputs, "image")
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

	client, err := s.requireRuntimeAIClient()
	if err != nil {
		return nil, err
	}
	return s.executeAISyncArtifactNode(ctx, client, record, node, inputs, "video")
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

	client, err := s.requireRuntimeAIClient()
	if err != nil {
		return nil, err
	}
	artifactOutput, err := s.executeAISyncArtifactNode(ctx, client, record, node, inputs, "tts")
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
	client, err := s.requireRuntimeAIClient()
	if err != nil {
		return nil, err
	}
	_, artifacts, runErr := s.runScenarioJobSync(ctx, client, record, node, inputs)
	if runErr != nil {
		return nil, runErr
	}
	first := firstScenarioArtifact(artifacts)
	if first == nil {
		return nil, fmt.Errorf("stt artifacts are empty")
	}
	text := strings.TrimSpace(string(first.GetBytes()))
	if text == "" {
		return nil, fmt.Errorf("stt output text is empty")
	}
	return map[string]*structpb.Struct{
		"output": structFromMap(map[string]any{"text": text}),
		"text":   structFromMap(map[string]any{"value": text}),
	}, nil
}

func (s *Service) requireRuntimeAIClient() (runtimev1.RuntimeAiServiceClient, error) {
	client := s.runtimeAIClient()
	if client == nil {
		return nil, fmt.Errorf("runtime ai client is unavailable")
	}
	return client, nil
}

func (s *Service) executeAISyncArtifactNode(
	ctx context.Context,
	client runtimev1.RuntimeAiServiceClient,
	record *taskRecord,
	node *runtimev1.WorkflowNode,
	inputs map[string]*structpb.Struct,
	artifactKind string,
) (map[string]*structpb.Struct, error) {
	_, artifacts, runErr := s.runScenarioJobSync(ctx, client, record, node, inputs)
	if runErr != nil {
		return nil, runErr
	}
	first := firstScenarioArtifact(artifacts)
	if first == nil || len(first.GetBytes()) == 0 {
		return nil, fmt.Errorf("%s artifacts are empty", artifactKind)
	}
	mimeType := strings.TrimSpace(first.GetMimeType())
	if mimeType == "" {
		return nil, fmt.Errorf("%s artifact mime_type is empty", artifactKind)
	}
	return s.writeArtifact(record, node, "artifact", mimeType, first.GetBytes())
}

func (s *Service) runScenarioJobSync(
	ctx context.Context,
	client runtimev1.RuntimeAiServiceClient,
	record *taskRecord,
	node *runtimev1.WorkflowNode,
	inputs map[string]*structpb.Struct,
) (*runtimev1.ScenarioJob, []*runtimev1.ScenarioArtifact, error) {
	submitReq, err := buildSubmitScenarioJobRequest(record, node, inputs)
	if err != nil {
		return nil, nil, err
	}

	submitResp, err := client.SubmitScenarioJob(ctx, submitReq)
	if err != nil {
		return nil, nil, err
	}
	job := submitResp.GetJob()
	if job == nil || strings.TrimSpace(job.GetJobId()) == "" {
		return nil, nil, fmt.Errorf("media submit returned empty job")
	}

	jobID := strings.TrimSpace(job.GetJobId())
	var cancelForwarded atomic.Bool
	forwardCancel := func(reason string) {
		if jobID == "" || !cancelForwarded.CompareAndSwap(false, true) {
			return
		}
		cancelCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_, _ = client.CancelScenarioJob(cancelCtx, &runtimev1.CancelScenarioJobRequest{
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
		case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING:
			time.Sleep(250 * time.Millisecond)
			pollResp, pollErr := client.GetScenarioJob(ctx, &runtimev1.GetScenarioJobRequest{
				JobId: jobID,
			})
			if pollErr != nil {
				return nil, nil, pollErr
			}
			if pollResp.GetJob() == nil {
				return nil, nil, fmt.Errorf("scenario poll returned empty job")
			}
			job = pollResp.GetJob()
			continue
		case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED:
			artifacts := job.GetArtifacts()
			if len(artifacts) == 0 {
				artifactsResp, artifactsErr := client.GetScenarioArtifacts(ctx, &runtimev1.GetScenarioArtifactsRequest{
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
				reason = "unknown scenario job failure"
			}
			return nil, nil, fmt.Errorf("scenario job failed: %s", reason)
		}
	}
}

func firstScenarioArtifact(artifacts []*runtimev1.ScenarioArtifact) *runtimev1.ScenarioArtifact {
	if len(artifacts) == 0 {
		return nil
	}
	return artifacts[0]
}

func workflowReasonCodeFromScenarioJob(job *runtimev1.ScenarioJob) runtimev1.ReasonCode {
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
		if reason, ok := grpcerr.ExtractReasonCode(err); ok {
			return reason
		}
		return runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
	}
}
