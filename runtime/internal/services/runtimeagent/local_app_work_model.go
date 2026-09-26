package runtimeagent

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"strings"
	"unicode/utf8"
)

func appWorkContextBudget(execution *PublicChatTurnExecutionRequest) error {
	// Match the compiler's conservative UTF-8 byte/token admission, including
	// canonical tool schemas and each continuation message, before every step.
	used := uint64(execution.MaxTokens) + publicChatContextSafetyTokens + publicChatContextAdapterTokens + publicChatReasoningReserveTokens(execution.Reasoning, uint64(execution.MaxTokens))
	for _, message := range execution.Messages {
		data, err := protojson.Marshal(message)
		if err != nil {
			return err
		}
		used += uint64(len(data)) + 32
	}
	for _, tool := range execution.Tools {
		data, err := protojson.Marshal(tool)
		if err != nil {
			return err
		}
		used += uint64(len(data)) + 32
	}
	if used > execution.Binding.ContextWindowTokens {
		return localAppConversationInvalid("App work exceeds the selected Agent context capacity")
	}
	return nil
}

type appWorkModelBatch struct {
	events            []*runtimev1.StreamScenarioEvent
	output            []*runtimev1.TextOutputItem
	calls             []*runtimev1.ToolCall
	open              *runtimev1.TextOutputItem
	next              uint32
	bytes             int
	completed, failed bool
	finish            runtimev1.FinishReason
}

func (b *appWorkModelBatch) accept(event *runtimev1.StreamScenarioEvent) error {
	invalid := func() error { return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID) }
	if event == nil || b.completed {
		return invalid()
	}
	switch event.GetEventType() {
	case runtimev1.StreamEventType_STREAM_EVENT_STARTED:
		if event.GetStarted() == nil {
			return invalid()
		}
	case runtimev1.StreamEventType_STREAM_EVENT_DELTA:
		if event.GetDelta().GetTextOutputItem() == nil {
			return invalid()
		}
	case runtimev1.StreamEventType_STREAM_EVENT_USAGE:
		if event.GetUsage() == nil {
			return invalid()
		}
	case runtimev1.StreamEventType_STREAM_EVENT_COMPLETED:
		if event.GetCompleted() == nil {
			return invalid()
		}
	case runtimev1.StreamEventType_STREAM_EVENT_FAILED:
		if event.GetFailed() == nil {
			return invalid()
		}
	default:
		return invalid()
	}
	b.bytes += proto.Size(event)
	if b.bytes > 512*1024 {
		return invalid()
	}
	b.events = append(b.events, proto.Clone(event).(*runtimev1.StreamScenarioEvent))
	if failed := event.GetFailed(); failed != nil {
		b.failed = true
		b.completed = true
		return nil
	}
	if done := event.GetCompleted(); done != nil {
		b.completed = true
		b.finish = done.GetFinishReason()
		return nil
	}
	delta := event.GetDelta().GetTextOutputItem()
	if delta == nil {
		return nil
	}
	if delta.GetItemIndex() != b.next {
		return invalid()
	}
	switch value := delta.GetDelta().(type) {
	case nil:
		// The canonical stream closes an already open text/summary item with
		// an empty completion marker, not a second content payload.
		if !delta.GetItemCompleted() || b.open == nil {
			return invalid()
		}
	case *runtimev1.TextOutputItemDelta_Text:
		if b.open == nil {
			b.open = &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{}}}
		}
		if b.open.GetText() == nil {
			return invalid()
		}
		b.open.GetText().Text += value.Text.GetText()
	case *runtimev1.TextOutputItemDelta_ReasoningSummary:
		if b.open == nil {
			b.open = &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningSummary{ReasoningSummary: &runtimev1.ReasoningSummary{}}}
		}
		if b.open.GetReasoningSummary() == nil {
			return invalid()
		}
		b.open.GetReasoningSummary().Text += value.ReasoningSummary.GetText()
	case *runtimev1.TextOutputItemDelta_ToolCall:
		if b.open != nil || !delta.GetItemCompleted() {
			return invalid()
		}
		if value.ToolCall == nil {
			return invalid()
		}
		call := proto.Clone(value.ToolCall).(*runtimev1.ToolCall)
		b.calls = append(b.calls, call)
		b.open = &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: call}}
	case *runtimev1.TextOutputItemDelta_ReasoningContinuity:
		if b.open != nil || !delta.GetItemCompleted() || !textbehavior.ValidContinuity(value.ReasoningContinuity) {
			return invalid()
		}
		b.open = &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: proto.Clone(value.ReasoningContinuity).(*runtimev1.ReasoningContinuityCarrier)}}
	default:
		return invalid()
	}
	if b.open != nil {
		text := b.open.GetText().GetText() + b.open.GetReasoningSummary().GetText()
		if !utf8.ValidString(text) || strings.ContainsRune(text, '\x00') {
			return invalid()
		}
	}
	if delta.GetItemCompleted() {
		b.output = append(b.output, b.open)
		b.open = nil
		b.next++
	}
	return nil
}
