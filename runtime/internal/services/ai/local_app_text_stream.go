package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
)

const (
	maxLocalAppTextTurnDeltaBytes      = 64 * 1024
	maxLocalAppTextTurnTotalBytes      = 256 * 1024
	maxLocalAppTextTurnActionHintBytes = 512
)

// StreamLocalAppTextTurn preserves the third-party Local App streaming text
// contract while delegating route composition, scheduling, Driver mapping,
// metering, and execution to the Scenario stream owner. The stream carries
// typed text increments and terminal finish or failure state only; raw chunks,
// reasoning traces, sources, and tool events fail closed before reaching the
// App.
func (s *Service) StreamLocalAppTextTurn(req *runtimev1.StreamLocalAppTextTurnRequest, stream grpc.ServerStreamingServer[runtimev1.StreamLocalAppTextTurnEvent]) error {
	decision, err := localAppScenarioDecision(stream.Context(), accountservice.LocalAppOperationTextTurnStream, localappop.AppOperationIDTextTurnStream)
	if err != nil {
		return err
	}
	systemPrompt, messages, err := validateLocalAppTextTurnRequest(req)
	if err != nil {
		return err
	}
	bridge := &localAppTextTurnStreamBridge{ServerStreamingServer: stream}
	return s.StreamScenario(&runtimev1.StreamScenarioRequest{
		Head:          localAppScenarioHead(decision),
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{
			TextGenerate: &runtimev1.TextGenerateScenarioSpec{
				Input:            messages,
				SystemPrompt:     systemPrompt,
				Temperature:      localAppOptionalFloat32(req.Temperature),
				TopP:             localAppOptionalFloat32(req.TopP),
				MaxTokens:        localAppOptionalInt32(req.MaxTokens),
				TopK:             localAppOptionalInt32(req.TopK),
				PresencePenalty:  localAppOptionalFloat32(req.PresencePenalty),
				FrequencyPenalty: localAppOptionalFloat32(req.FrequencyPenalty),
				Stop:             append([]string(nil), req.GetStop()...),
				Seed:             localAppOptionalInt64(req.Seed),
			},
		}},
	}, bridge)
}

// localAppTextTurnStreamBridge adapts the owner Scenario event stream to the
// trimmed Local App text-turn event stream. Only typed text deltas and the
// terminal completed or failed event cross this boundary.
type localAppTextTurnStreamBridge struct {
	grpc.ServerStreamingServer[runtimev1.StreamLocalAppTextTurnEvent]
	totalBytes int
}

func (b *localAppTextTurnStreamBridge) Send(event *runtimev1.StreamScenarioEvent) error {
	invalid := func() error {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if event == nil {
		return invalid()
	}
	if !localAppOptionalExactText(event.GetTraceId(), maxLocalAppTraceIDBytes) {
		return invalid()
	}
	out := &runtimev1.StreamLocalAppTextTurnEvent{
		Sequence: event.GetSequence(),
		TraceId:  event.GetTraceId(),
	}
	switch payload := event.GetPayload().(type) {
	case *runtimev1.StreamScenarioEvent_Started:
		// Route and model facts on the started event stay Runtime-private.
		return nil
	case *runtimev1.StreamScenarioEvent_Usage:
		return nil
	case *runtimev1.StreamScenarioEvent_Delta:
		text := payload.Delta.GetText()
		if text == nil {
			// Artifact, reasoning, source, and raw deltas are owner-surface
			// shapes; the trimmed text-turn stream fails closed on them.
			return invalid()
		}
		deltaBytes := len([]byte(text.GetText()))
		if deltaBytes == 0 || deltaBytes > maxLocalAppTextTurnDeltaBytes {
			return invalid()
		}
		b.totalBytes += deltaBytes
		if b.totalBytes > maxLocalAppTextTurnTotalBytes {
			return invalid()
		}
		out.Payload = &runtimev1.StreamLocalAppTextTurnEvent_Delta{
			Delta: &runtimev1.LocalAppTextTurnDelta{Text: text.GetText()},
		}
	case *runtimev1.StreamScenarioEvent_Completed:
		if !localAppTextCandidateFinishReason(payload.Completed.GetFinishReason()) {
			return invalid()
		}
		out.Payload = &runtimev1.StreamLocalAppTextTurnEvent_Completed{
			Completed: &runtimev1.LocalAppTextTurnCompleted{FinishReason: payload.Completed.GetFinishReason()},
		}
	case *runtimev1.StreamScenarioEvent_Failed:
		if payload.Failed.GetReasonCode() == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED ||
			!localAppOptionalExactText(payload.Failed.GetActionHint(), maxLocalAppTextTurnActionHintBytes) {
			return invalid()
		}
		out.Payload = &runtimev1.StreamLocalAppTextTurnEvent_Failed{
			Failed: &runtimev1.LocalAppTextTurnFailed{
				ReasonCode: payload.Failed.GetReasonCode(),
				ActionHint: payload.Failed.GetActionHint(),
			},
		}
	default:
		// Tool call, tool result, and tool approval events are owner-surface
		// shapes; the trimmed text-turn stream fails closed on them.
		return invalid()
	}
	return b.ServerStreamingServer.Send(out)
}

func validateLocalAppTextTurnRequest(req *runtimev1.StreamLocalAppTextTurnRequest) (string, []*runtimev1.ChatMessage, error) {
	if req == nil {
		return "", nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return validateLocalAppTextCandidateFields(
		req.GetMessages(), req.Temperature, req.TopP, req.MaxTokens, req.TopK,
		req.PresencePenalty, req.FrequencyPenalty, req.GetStop(),
	)
}
