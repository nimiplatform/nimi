package ai

import (
	"math"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

const (
	maxLocalAppTextTurnDeltaBytes      = 64 * 1024
	maxLocalAppTextTurnTotalBytes      = 256 * 1024
	maxLocalAppTextTurnActionHintBytes = 512
)

// StreamLocalAppTextTurn preserves the third-party Local App streaming text
// contract while delegating route composition, scheduling, Driver mapping,
// metering, and execution to the Scenario stream owner. The stream carries
// ordered text increments, complete function calls and terminal state; private
// reasoning, source and raw payloads never cross the App boundary.
// @nimi-authority: rule.nimi.runtime.ai-provider.local-app-text-behaviors
func (s *Service) StreamLocalAppTextTurn(req *runtimev1.StreamLocalAppTextTurnRequest, stream grpc.ServerStreamingServer[runtimev1.StreamLocalAppTextTurnEvent]) error {
	decision, err := localAppScenarioDecision(stream.Context(), accountservice.LocalAppOperationTextTurnStream, localappop.AppOperationIDTextTurnStream)
	if err != nil {
		return err
	}
	spec, err := localAppTextGenerateSpec(req)
	if err != nil {
		return err
	}
	declared := make(map[string]*runtimev1.ToolSpec, len(spec.GetTools()))
	for _, tool := range spec.GetTools() {
		declared[tool.GetName()] = tool
	}
	bridge := &localAppTextTurnStreamBridge{
		ServerStreamingServer: stream, tools: declared,
		toolChoice: spec.GetToolChoice(), toolChoiceName: spec.GetToolChoiceName(),
	}
	return s.StreamScenario(&runtimev1.StreamScenarioRequest{
		Head:          localAppScenarioHead(decision),
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{
			TextGenerate: spec,
		}},
	}, bridge)
}

// localAppTextTurnStreamBridge adapts the owner Scenario event stream to the
// Local App text-turn event stream. A ToolCall is emitted only as a complete
// item; the external host waits for terminal success before executing a batch.
type localAppTextTurnStreamBridge struct {
	grpc.ServerStreamingServer[runtimev1.StreamLocalAppTextTurnEvent]
	totalBytes     int
	sequence       uint64
	nextItemIndex  uint32
	textOpen       bool
	hasOutput      bool
	hasTool        bool
	terminal       bool
	tools          map[string]*runtimev1.ToolSpec
	seenCalls      map[string]struct{}
	toolChoice     runtimev1.ToolChoiceMode
	toolChoiceName string
}

func (b *localAppTextTurnStreamBridge) Send(event *runtimev1.StreamScenarioEvent) error {
	invalid := func() error {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if event == nil || b.terminal {
		return invalid()
	}
	if !localAppOptionalExactText(event.GetTraceId(), maxLocalAppTraceIDBytes) {
		return invalid()
	}
	out := &runtimev1.StreamLocalAppTextTurnEvent{
		TraceId: event.GetTraceId(),
	}
	switch payload := event.GetPayload().(type) {
	case *runtimev1.StreamScenarioEvent_Started:
		// Route and model facts on the started event stay Runtime-private.
		return nil
	case *runtimev1.StreamScenarioEvent_Usage:
		return nil
	case *runtimev1.StreamScenarioEvent_Delta:
		item := payload.Delta.GetTextOutputItem()
		if item == nil || item.GetItemIndex() != b.nextItemIndex {
			return invalid()
		}
		if call := item.GetToolCall(); call != nil {
			if b.textOpen || !item.GetItemCompleted() {
				return invalid()
			}
			if validateLocalAppTextToolCall(call, b.tools) != nil || !localAppTextOutputChoiceValid(b.toolChoice, b.toolChoiceName, call) {
				return localAppTextOutputToolInvalid()
			}
			if b.seenCalls == nil {
				b.seenCalls = make(map[string]struct{})
			}
			if _, duplicate := b.seenCalls[call.GetId()]; duplicate {
				return invalid()
			}
			b.totalBytes += proto.Size(call)
			if b.totalBytes > maxLocalAppTextTurnTotalBytes {
				return invalid()
			}
			b.seenCalls[call.GetId()] = struct{}{}
			b.hasOutput, b.hasTool = true, true
			b.nextItemIndex++
			out.Payload = &runtimev1.StreamLocalAppTextTurnEvent_ToolCall{
				ToolCall: &runtimev1.LocalAppTextTurnToolCall{
					ItemIndex: item.GetItemIndex(), ToolCall: proto.Clone(call).(*runtimev1.ToolCall),
				},
			}
			break
		}
		text := item.GetText()
		if text == nil {
			if item.GetItemCompleted() && item.GetDelta() == nil && b.textOpen {
				b.textOpen = false
				b.nextItemIndex++
				return nil
			}
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
			Delta: &runtimev1.LocalAppTextTurnDelta{Text: text.GetText(), ItemIndex: item.GetItemIndex()},
		}
		b.hasOutput = true
		b.textOpen = !item.GetItemCompleted()
		if item.GetItemCompleted() {
			b.nextItemIndex++
		}
	case *runtimev1.StreamScenarioEvent_Completed:
		if !b.hasOutput || b.textOpen || !localAppTextFinishReason(payload.Completed.GetFinishReason()) ||
			(payload.Completed.GetFinishReason() == runtimev1.FinishReason_FINISH_REASON_TOOL_CALL && !b.hasTool) {
			return invalid()
		}
		if localAppTextRequiresTool(b.toolChoice) && !b.hasTool {
			return localAppTextOutputToolInvalid()
		}
		out.Payload = &runtimev1.StreamLocalAppTextTurnEvent_Completed{
			Completed: &runtimev1.LocalAppTextTurnCompleted{FinishReason: payload.Completed.GetFinishReason()},
		}
		b.terminal = true
	case *runtimev1.StreamScenarioEvent_Failed:
		if payload.Failed.GetReasonCode() == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED ||
			!localAppOptionalExactText(payload.Failed.GetActionHint(), maxLocalAppTextTurnActionHintBytes) {
			return invalid()
		}
		failed := &runtimev1.LocalAppTextTurnFailed{
			ReasonCode: payload.Failed.GetReasonCode(),
			ActionHint: payload.Failed.GetActionHint(),
		}
		if interruption := payload.Failed.GetInterruption(); interruption != nil {
			failed.Interruption, _ = proto.Clone(interruption).(*runtimev1.ExecutionInterruption)
		}
		out.Payload = &runtimev1.StreamLocalAppTextTurnEvent_Failed{Failed: failed}
		b.terminal = true
	default:
		// Tool results and approval workflows are never Runtime output.
		return invalid()
	}
	// Owner-only Started and Usage events are intentionally omitted, so the
	// Local App stream owns a dense sequence over only its projected events.
	b.sequence++
	out.Sequence = b.sequence
	return b.ServerStreamingServer.Send(out)
}

func invalidLocalAppTextTurnScalar(value *float32, minValue float32, maxValue float32) bool {
	return value != nil && (math.IsNaN(float64(*value)) || math.IsInf(float64(*value), 0) || *value < minValue || *value > maxValue)
}
