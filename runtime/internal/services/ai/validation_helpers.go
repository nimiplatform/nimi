package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
	"strings"
	"time"
)

func validateGenerateRequest(req *runtimev1.GenerateRequest) error {
	if req == nil {
		return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID.String())
	}
	if err := validateBaseRequest(req.GetAppId(), req.GetSubjectUserId(), req.GetModelId(), req.GetRoutePolicy()); err != nil {
		return err
	}
	if req.GetModal() == runtimev1.Modal_MODAL_UNSPECIFIED {
		return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
	}
	if len(req.GetInput()) == 0 && strings.TrimSpace(req.GetSystemPrompt()) == "" {
		return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
	}
	return nil
}

func (s *Service) recordRouteAutoSwitch(appID string, subjectUserID string, requestedModelID string, resolvedModelID string, decision routeDecisionInfo) {
	if !decision.HintAutoSwitch {
		return
	}
	s.persistModelRegistry()
	if s.audit == nil {
		return
	}
	payload, _ := structpb.NewStruct(map[string]any{
		"requestedModelId": strings.TrimSpace(requestedModelID),
		"resolvedModelId":  strings.TrimSpace(resolvedModelID),
		"backendName":      strings.TrimSpace(decision.BackendName),
		"hintFrom":         strings.TrimSpace(decision.HintFrom),
		"hintTo":           strings.TrimSpace(decision.HintTo),
	})
	s.audit.AppendEvent(&runtimev1.AuditEventRecord{
		AuditId:       ulid.Make().String(),
		AppId:         strings.TrimSpace(appID),
		SubjectUserId: strings.TrimSpace(subjectUserID),
		Domain:        "runtime.ai",
		Operation:     "route.auto_switch",
		ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
		TraceId:       ulid.Make().String(),
		Timestamp:     timestamppb.New(time.Now().UTC()),
		Payload:       payload,
	})
}

func (s *Service) persistModelRegistry() {
	if s.registry == nil || s.registryPath == "" {
		return
	}
	if err := s.registry.SaveToFile(s.registryPath); err != nil && s.logger != nil {
		s.logger.Error("persist model registry from ai route switch failed", "path", s.registryPath, "error", err)
	}
}

func validateStreamGenerateRequest(req *runtimev1.StreamGenerateRequest) error {
	if req == nil {
		return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID.String())
	}
	if err := validateBaseRequest(req.GetAppId(), req.GetSubjectUserId(), req.GetModelId(), req.GetRoutePolicy()); err != nil {
		return err
	}
	if req.GetModal() == runtimev1.Modal_MODAL_UNSPECIFIED {
		return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
	}
	if len(req.GetInput()) == 0 && strings.TrimSpace(req.GetSystemPrompt()) == "" {
		return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
	}
	return nil
}

func validateEmbedRequest(req *runtimev1.EmbedRequest) error {
	if req == nil {
		return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID.String())
	}
	if err := validateBaseRequest(req.GetAppId(), req.GetSubjectUserId(), req.GetModelId(), req.GetRoutePolicy()); err != nil {
		return err
	}
	if len(req.GetInputs()) == 0 {
		return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
	}
	for _, input := range req.GetInputs() {
		if strings.TrimSpace(input) == "" {
			return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
	}
	return nil
}

func validatePromptRequest(appID string, subjectUserID string, modelID string, prompt string, route runtimev1.RoutePolicy) error {
	if err := validateBaseRequest(appID, subjectUserID, modelID, route); err != nil {
		return err
	}
	if strings.TrimSpace(prompt) == "" {
		return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
	}
	return nil
}

func validateTranscribeRequest(req *runtimev1.TranscribeAudioRequest) error {
	if req == nil {
		return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID.String())
	}
	if err := validateBaseRequest(req.GetAppId(), req.GetSubjectUserId(), req.GetModelId(), req.GetRoutePolicy()); err != nil {
		return err
	}
	if len(req.GetAudioBytes()) == 0 || strings.TrimSpace(req.GetMimeType()) == "" {
		return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
	}
	return nil
}

func validateBaseRequest(appID string, subjectUserID string, modelID string, route runtimev1.RoutePolicy) error {
	if strings.TrimSpace(appID) == "" || strings.TrimSpace(subjectUserID) == "" || strings.TrimSpace(modelID) == "" {
		return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID.String())
	}
	if route == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID.String())
	}
	if isMultiModel(strings.TrimSpace(modelID)) {
		return status.Error(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String())
	}
	return nil
}

func streamArtifact(stream grpc.ServerStreamingServer[runtimev1.ArtifactChunk], mimeType string, routeDecision runtimev1.RoutePolicy, modelResolved string, payload []byte, usage *runtimev1.UsageStats) error {
	traceID := ulid.Make().String()
	artifactID := ulid.Make().String()
	if len(payload) == 0 {
		payload = []byte("artifact")
	}
	if usage == nil {
		usage = &runtimev1.UsageStats{
			InputTokens:  0,
			OutputTokens: estimateTokens(string(payload)),
			ComputeMs:    0,
		}
	}
	parts := splitBytes(payload, defaultChunkSize)

	for i, part := range parts {
		eof := i == len(parts)-1
		chunk := &runtimev1.ArtifactChunk{
			ArtifactId:    artifactID,
			MimeType:      mimeType,
			Sequence:      uint64(i + 1),
			Chunk:         part,
			Eof:           eof,
			RouteDecision: routeDecision,
			ModelResolved: modelResolved,
			TraceId:       traceID,
		}
		if eof {
			chunk.Usage = usage
		}
		if err := stream.Send(chunk); err != nil {
			return err
		}
	}
	return nil
}

func composeInputText(systemPrompt string, input []*runtimev1.ChatMessage) string {
	parts := make([]string, 0, len(input)+1)
	if trimmed := strings.TrimSpace(systemPrompt); trimmed != "" {
		parts = append(parts, trimmed)
	}
	for _, message := range input {
		content := strings.TrimSpace(message.GetContent())
		if content == "" {
			continue
		}
		parts = append(parts, content)
	}
	return strings.Join(parts, "\n")
}

func splitText(text string, chunkSize int) []string {
	if chunkSize <= 0 {
		chunkSize = 1
	}
	runes := []rune(text)
	if len(runes) == 0 {
		return []string{""}
	}

	parts := make([]string, 0, (len(runes)+chunkSize-1)/chunkSize)
	for start := 0; start < len(runes); start += chunkSize {
		end := start + chunkSize
		if end > len(runes) {
			end = len(runes)
		}
		parts = append(parts, string(runes[start:end]))
	}
	return parts
}

func splitBytes(data []byte, chunkSize int) [][]byte {
	if chunkSize <= 0 {
		chunkSize = len(data)
	}
	if len(data) == 0 {
		return [][]byte{{}}
	}
	parts := make([][]byte, 0, (len(data)+chunkSize-1)/chunkSize)
	for start := 0; start < len(data); start += chunkSize {
		end := start + chunkSize
		if end > len(data) {
			end = len(data)
		}
		part := append([]byte(nil), data[start:end]...)
		parts = append(parts, part)
	}
	return parts
}

func estimateUsage(input string, output string) *runtimev1.UsageStats {
	inTokens := estimateTokens(input)
	outTokens := estimateTokens(output)
	return &runtimev1.UsageStats{
		InputTokens:  inTokens,
		OutputTokens: outTokens,
		ComputeMs:    maxInt64(5, outTokens*3),
	}
}

func estimateTokens(text string) int64 {
	count := len([]rune(strings.TrimSpace(text)))
	if count == 0 {
		return 0
	}
	tokens := count / 4
	if count%4 != 0 {
		tokens++
	}
	if tokens < 1 {
		tokens = 1
	}
	return int64(tokens)
}

func wordCount(input string) int {
	fields := strings.Fields(strings.TrimSpace(input))
	return len(fields)
}

func vowelCount(input string) int {
	count := 0
	for _, r := range strings.ToLower(input) {
		switch r {
		case 'a', 'e', 'i', 'o', 'u':
			count++
		}
	}
	return count
}

func consonantCount(input string) int {
	count := 0
	for _, r := range strings.ToLower(input) {
		if r < 'a' || r > 'z' {
			continue
		}
		switch r {
		case 'a', 'e', 'i', 'o', 'u':
			continue
		default:
			count++
		}
	}
	return count
}

func isMultiModel(modelID string) bool {
	return strings.Contains(modelID, ",") || strings.Contains(modelID, "->") || strings.Contains(modelID, "|")
}

func maxInt64(a int64, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
