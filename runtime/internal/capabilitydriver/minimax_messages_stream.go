package capabilitydriver

import (
	"bytes"
	"encoding/json"
	"io"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
)

type miniMaxThinkingBlock struct {
	Type      string  `json:"type"`
	Thinking  *string `json:"thinking,omitempty"`
	Signature *string `json:"signature,omitempty"`
}

func validateMiniMaxThinking(payload []byte) error {
	if !utf8.Valid(payload) || len(payload) > textbehavior.MaxReasoningContinuityPayloadBytes {
		return nativeReasoningReplayInvalid()
	}
	var block miniMaxThinkingBlock
	var fields map[string]json.RawMessage
	if json.Unmarshal(payload, &fields) != nil {
		return nativeReasoningReplayInvalid()
	}
	for _, key := range []string{"thinking", "signature"} {
		if raw, present := fields[key]; present && bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
			return nativeReasoningReplayInvalid()
		}
	}
	d := json.NewDecoder(bytes.NewReader(payload))
	d.DisallowUnknownFields()
	if d.Decode(&block) != nil || d.Decode(new(any)) != io.EOF || block.Type != "thinking" {
		return nativeReasoningReplayInvalid()
	}
	return nil
}

func (p MiniMaxMessagesBehavior) thinkingCarrier(payload []byte) (*runtimev1.ReasoningContinuityCarrier, error) {
	if err := validateMiniMaxThinking(payload); err != nil {
		return nil, err
	}
	return &runtimev1.ReasoningContinuityCarrier{Kind: p.ContinuityKind(), Version: 1, Payload: append([]byte(nil), payload...)}, nil
}

func (p MiniMaxMessagesBehavior) readThinking(carrier *runtimev1.ReasoningContinuityCarrier) (json.RawMessage, error) {
	if !textbehavior.ValidContinuity(carrier) || carrier.GetKind() != p.ContinuityKind() || carrier.GetVersion() != 1 {
		return nil, nativeReasoningReplayInvalid()
	}
	if err := validateMiniMaxThinking(carrier.GetPayload()); err != nil {
		return nil, err
	}
	return append(json.RawMessage(nil), carrier.GetPayload()...), nil
}

type miniMaxMessage struct {
	Type    string                 `json:"type"`
	Role    string                 `json:"role"`
	Model   string                 `json:"model"`
	Content []json.RawMessage      `json:"content"`
	Stop    string                 `json:"stop_reason"`
	Usage   AnthropicReportedUsage `json:"usage"`
}

func (p MiniMaxMessagesBehavior) messageIdentity(m miniMaxMessage) bool {
	return m.Type == "message" && m.Role == "assistant" && m.Model == p.model
}

func (p MiniMaxMessagesBehavior) Parse(payload []byte, spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	_, thinking, err := p.controls(spec)
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	var message miniMaxMessage
	if !utf8.Valid(payload) || json.Unmarshal(payload, &message) != nil || !p.messageIdentity(message) {
		return textbehavior.NormalizedResult{}, deepseekJSONOutputError()
	}
	a := textbehavior.NewOrderedStreamAssembler(spec.GetTools(), textbehavior.ValidateToolArguments)
	for i, raw := range message.Content {
		var block anthropicBehaviorBlock
		if json.Unmarshal(raw, &block) != nil {
			return textbehavior.NormalizedResult{}, deepseekJSONOutputError()
		}
		f := textbehavior.PrivateFragment{ItemIndex: uint32(i), Complete: true}
		switch block.Type {
		case "thinking":
			if !thinking {
				return textbehavior.NormalizedResult{}, deepseekJSONOutputError()
			}
			carrier, err := p.thinkingCarrier(raw)
			if err != nil {
				return textbehavior.NormalizedResult{}, err
			}
			f.Kind, f.ReasoningContinuity = textbehavior.OrderedItemReasoningContinuity, carrier
		case "text":
			f.Kind, f.Text = textbehavior.OrderedItemText, block.Text
		case "tool_use":
			f.Kind, f.ToolCall = textbehavior.OrderedItemToolCall, &textbehavior.ToolCallFragment{IDPart: block.ID, NamePart: block.Name, ArgumentsJSONPart: string(block.Input)}
		default:
			return textbehavior.NormalizedResult{}, deepseekJSONOutputError()
		}
		if _, err := a.AppendFragment(f); err != nil {
			return textbehavior.NormalizedResult{}, err
		}
	}
	return finishMiniMaxMessage(a, message.Stop, message.Usage, spec)
}

func finishMiniMaxMessage(a *textbehavior.OrderedStreamAssembler, stop string, usage AnthropicReportedUsage, spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	if stop != "end_turn" && stop != "tool_use" && stop != "max_tokens" {
		return textbehavior.NormalizedResult{}, deepseekJSONOutputError()
	}
	result, err := finishAnthropicBehavior(a, stop, usage, spec)
	if err != nil {
		return result, err
	}
	text, calls := false, false
	for _, item := range result.Items {
		text = text || item.Kind == textbehavior.OrderedItemText && strings.TrimSpace(item.Text) != ""
		calls = calls || item.Kind == textbehavior.OrderedItemToolCall
	}
	if !text && !calls || stop == "max_tokens" && calls {
		return textbehavior.NormalizedResult{Usage: result.Usage}, deepseekIncomplete()
	}
	if (stop == "tool_use") != calls {
		return textbehavior.NormalizedResult{}, deepseekToolInvalid()
	}
	return result, nil
}

type miniMaxStreamBlock struct {
	block     anthropicBehaviorBlock
	thinking  miniMaxThinkingBlock
	arguments bool
	sealed    bool
}

type miniMaxMessagesStream struct {
	profile                    MiniMaxMessagesBehavior
	spec                       *runtimev1.TextGenerateScenarioSpec
	thinking                   bool
	assembler                  *textbehavior.OrderedStreamAssembler
	blocks                     []*miniMaxStreamBlock
	started, stopped, terminal bool
	stop                       string
	usage                      AnthropicReportedUsage
}

func (p MiniMaxMessagesBehavior) Stream(spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	_, thinking, err := p.controls(spec)
	if err != nil {
		return nil, err
	}
	return &miniMaxMessagesStream{profile: p, spec: spec, thinking: thinking, assembler: textbehavior.NewOrderedStreamAssembler(spec.GetTools(), textbehavior.ValidateToolArguments)}, nil
}

func (s *miniMaxMessagesStream) Append(payload []byte) ([]textbehavior.OrderedDelta, error) {
	var e struct {
		Type    string          `json:"type"`
		Index   *uint32         `json:"index"`
		Message miniMaxMessage  `json:"message"`
		Block   json.RawMessage `json:"content_block"`
		Delta   struct {
			Type      string  `json:"type"`
			Text      string  `json:"text"`
			JSON      string  `json:"partial_json"`
			Thinking  *string `json:"thinking"`
			Signature *string `json:"signature"`
			Stop      string  `json:"stop_reason"`
		} `json:"delta"`
		Usage AnthropicReportedUsage `json:"usage"`
	}
	if s.stopped || !utf8.Valid(payload) || json.Unmarshal(payload, &e) != nil {
		return nil, deepseekJSONOutputError()
	}
	if e.Type == "ping" {
		return nil, nil
	}
	if e.Type == "error" {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	if e.Type == "message_start" {
		if s.started || !s.profile.messageIdentity(e.Message) || len(e.Message.Content) > 0 {
			return nil, deepseekJSONOutputError()
		}
		s.started = true
		s.usage = e.Message.Usage
		s.usage.Output = nil
		return nil, nil
	}
	if !s.started {
		return nil, deepseekJSONOutputError()
	}
	if e.Type == "message_delta" {
		if s.terminal || e.Delta.Stop == "" {
			return nil, deepseekJSONOutputError()
		}
		for _, b := range s.blocks {
			if !b.sealed {
				return nil, deepseekIncomplete()
			}
		}
		s.terminal = true
		s.stop = e.Delta.Stop
		s.usage = s.usage.WithUpdate(e.Usage)
		return nil, nil
	}
	if e.Type == "message_stop" {
		if !s.terminal {
			return nil, deepseekIncomplete()
		}
		s.stopped = true
		return nil, nil
	}
	if s.terminal || e.Index == nil {
		return nil, deepseekJSONOutputError()
	}
	index := *e.Index
	fragment := textbehavior.PrivateFragment{ItemIndex: index}
	if e.Type == "content_block_start" {
		if int(index) != len(s.blocks) || len(s.blocks) > 0 && !s.blocks[len(s.blocks)-1].sealed {
			return nil, deepseekJSONOutputError()
		}
		b := &miniMaxStreamBlock{}
		if json.Unmarshal(e.Block, &b.block) != nil {
			return nil, deepseekJSONOutputError()
		}
		s.blocks = append(s.blocks, b)
		switch b.block.Type {
		case "thinking":
			if !s.thinking || validateMiniMaxThinking(e.Block) != nil || json.Unmarshal(e.Block, &b.thinking) != nil {
				return nil, nativeReasoningReplayInvalid()
			}
			return nil, nil
		case "text":
			fragment.Kind, fragment.Text = textbehavior.OrderedItemText, b.block.Text
		case "tool_use":
			fragment.Kind, fragment.ToolCall = textbehavior.OrderedItemToolCall, &textbehavior.ToolCallFragment{IDPart: b.block.ID, NamePart: b.block.Name}
		default:
			return nil, deepseekJSONOutputError()
		}
		return s.assembler.AppendFragment(fragment)
	}
	if int(index) >= len(s.blocks) || s.blocks[index].sealed {
		return nil, deepseekJSONOutputError()
	}
	b := s.blocks[index]
	switch e.Type {
	case "content_block_delta":
		switch {
		case b.block.Type == "text" && e.Delta.Type == "text_delta":
			fragment.Kind, fragment.Text = textbehavior.OrderedItemText, e.Delta.Text
		case b.block.Type == "tool_use" && e.Delta.Type == "input_json_delta":
			fragment.Kind, fragment.ToolCall = textbehavior.OrderedItemToolCall, &textbehavior.ToolCallFragment{ArgumentsJSONPart: e.Delta.JSON}
			b.arguments = b.arguments || e.Delta.JSON != ""
		case b.block.Type == "thinking" && e.Delta.Type == "thinking_delta":
			if e.Delta.Thinking == nil {
				return nil, deepseekJSONOutputError()
			}
			if b.thinking.Thinking == nil {
				empty := ""
				b.thinking.Thinking = &empty
			}
			if len(*b.thinking.Thinking)+len(*e.Delta.Thinking) > textbehavior.MaxReasoningContinuityPayloadBytes {
				return nil, nativeReasoningReplayInvalid()
			}
			*b.thinking.Thinking += *e.Delta.Thinking
			return nil, nil
		case b.block.Type == "thinking" && e.Delta.Type == "signature_delta":
			if e.Delta.Signature == nil {
				return nil, deepseekJSONOutputError()
			}
			if b.thinking.Signature == nil {
				empty := ""
				b.thinking.Signature = &empty
			}
			if len(*b.thinking.Signature)+len(*e.Delta.Signature) > textbehavior.MaxReasoningContinuityPayloadBytes {
				return nil, nativeReasoningReplayInvalid()
			}
			*b.thinking.Signature += *e.Delta.Signature
			return nil, nil
		default:
			return nil, deepseekJSONOutputError()
		}
	case "content_block_stop":
		b.sealed = true
		fragment.Complete = true
		switch b.block.Type {
		case "thinking":
			raw, err := json.Marshal(b.thinking)
			if err != nil {
				return nil, err
			}
			carrier, err := s.profile.thinkingCarrier(raw)
			if err != nil {
				return nil, err
			}
			fragment.Kind, fragment.ReasoningContinuity = textbehavior.OrderedItemReasoningContinuity, carrier
		case "text":
			fragment.Kind = textbehavior.OrderedItemText
		case "tool_use":
			fragment.Kind, fragment.ToolCall = textbehavior.OrderedItemToolCall, &textbehavior.ToolCallFragment{}
			if !b.arguments {
				fragment.ToolCall.ArgumentsJSONPart = string(b.block.Input)
			}
		}
	default:
		return nil, deepseekJSONOutputError()
	}
	return s.assembler.AppendFragment(fragment)
}

func (s *miniMaxMessagesStream) Finish() (textbehavior.NormalizedResult, error) {
	if !s.stopped {
		return textbehavior.NormalizedResult{Usage: s.usage.Stats()}, deepseekIncomplete()
	}
	return finishMiniMaxMessage(s.assembler, s.stop, s.usage, s.spec)
}
