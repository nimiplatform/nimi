package capabilitydriver

import (
	"encoding/json"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
)

type novaUsage struct {
	Input  *int64 `json:"inputTokens"`
	Output *int64 `json:"outputTokens"`
}
type novaContent struct {
	Text *string `json:"text"`
	Tool *struct {
		ID    string          `json:"toolUseId"`
		Name  string          `json:"name"`
		Input json.RawMessage `json:"input"`
	} `json:"toolUse"`
	Reasoning json.RawMessage `json:"reasoningContent"`
}

func (p BedrockNovaBehavior) Parse(data []byte, spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	var response struct {
		Output struct {
			Message struct {
				Role    string            `json:"role"`
				Content []json.RawMessage `json:"content"`
			} `json:"message"`
		} `json:"output"`
		Stop  string    `json:"stopReason"`
		Usage novaUsage `json:"usage"`
	}
	if json.Unmarshal(data, &response) != nil || response.Output.Message.Role != "assistant" {
		return textbehavior.NormalizedResult{}, deepseekJSONOutputError()
	}
	assembler := textbehavior.NewOrderedStreamAssembler(spec.GetTools(), textbehavior.ValidateToolArguments)
	var index uint32
	for _, raw := range response.Output.Message.Content {
		var union map[string]json.RawMessage
		var item novaContent
		if json.Unmarshal(raw, &union) != nil || len(union) != 1 || json.Unmarshal(raw, &item) != nil {
			return textbehavior.NormalizedResult{}, deepseekJSONOutputError()
		}
		fragment := textbehavior.PrivateFragment{ItemIndex: index, Complete: true}
		switch {
		case item.Text != nil:
			fragment.Kind, fragment.Text = textbehavior.OrderedItemText, *item.Text
		case item.Tool != nil:
			fragment.Kind, fragment.ToolCall = textbehavior.OrderedItemToolCall, &textbehavior.ToolCallFragment{IDPart: item.Tool.ID, NamePart: item.Tool.Name, ArgumentsJSONPart: string(item.Tool.Input)}
		case len(item.Reasoning) > 0:
			// Nova redacts its native reasoning. This is neither a summary nor
			// a replay carrier and never becomes public answer text.
			continue
		default:
			return textbehavior.NormalizedResult{}, deepseekJSONOutputError()
		}
		if _, err := assembler.AppendFragment(fragment); err != nil {
			return textbehavior.NormalizedResult{}, err
		}
		index++
	}
	return finishNova(assembler, response.Stop, response.Usage)
}

func finishNova(assembler *textbehavior.OrderedStreamAssembler, stop string, usage novaUsage) (textbehavior.NormalizedResult, error) {
	var finish runtimev1.FinishReason
	switch stop {
	case "end_turn", "stop_sequence":
		finish = runtimev1.FinishReason_FINISH_REASON_STOP
	case "tool_use":
		finish = runtimev1.FinishReason_FINISH_REASON_TOOL_CALL
	case "max_tokens", "model_context_window_exceeded":
		finish = runtimev1.FinishReason_FINISH_REASON_LENGTH
	case "content_filtered", "guardrail_intervened":
		finish = runtimev1.FinishReason_FINISH_REASON_CONTENT_FILTER
	default:
		return textbehavior.NormalizedResult{}, deepseekJSONOutputError()
	}
	var stats *runtimev1.UsageStats
	if usage.Input != nil && usage.Output != nil {
		if *usage.Input < 0 || *usage.Output < 0 {
			return textbehavior.NormalizedResult{}, deepseekJSONOutputError()
		}
		stats = &runtimev1.UsageStats{InputTokens: *usage.Input, OutputTokens: *usage.Output}
	}
	if finish == runtimev1.FinishReason_FINISH_REASON_CONTENT_FILTER {
		return textbehavior.NormalizedResult{Usage: stats, FinishReason: finish}, nil
	}
	items, err := assembler.FinishItems()
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	return textbehavior.NormalizedResult{Items: items, Usage: stats, FinishReason: finish}, nil
}

type novaBlock struct {
	kind        string
	publicIndex uint32
	done        bool
	bytes       int
}
type novaStream struct {
	assembler                  *textbehavior.OrderedStreamAssembler
	blocks                     map[uint32]*novaBlock
	nextPublic                 uint32
	started, stopped, metadata bool
	stop                       string
	usage                      novaUsage
	bytes                      int
}

func (p BedrockNovaBehavior) Stream(spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	return &novaStream{assembler: textbehavior.NewOrderedStreamAssembler(spec.GetTools(), textbehavior.ValidateToolArguments), blocks: map[uint32]*novaBlock{}}, nil
}

func (s *novaStream) Append(data []byte) ([]textbehavior.OrderedDelta, error) {
	var envelope map[string]json.RawMessage
	if json.Unmarshal(data, &envelope) != nil || len(envelope) != 1 || s.metadata {
		return nil, deepseekJSONOutputError()
	}
	var kind string
	var payload json.RawMessage
	for k, v := range envelope {
		kind, payload = k, v
	}
	if kind == "messageStart" {
		var start struct {
			Role string `json:"role"`
		}
		if json.Unmarshal(payload, &start) != nil || start.Role != "assistant" || s.started {
			return nil, deepseekJSONOutputError()
		}
		s.started = true
		return nil, nil
	}
	if !s.started {
		return nil, deepseekJSONOutputError()
	}
	if kind == "metadata" {
		if !s.stopped {
			return nil, deepseekJSONOutputError()
		}
		var metadata struct {
			Usage novaUsage `json:"usage"`
		}
		if json.Unmarshal(payload, &metadata) != nil {
			return nil, deepseekJSONOutputError()
		}
		s.metadata, s.usage = true, metadata.Usage
		return nil, nil
	}
	if s.stopped {
		return nil, deepseekJSONOutputError()
	}
	if kind == "messageStop" {
		var stop struct {
			Reason string `json:"stopReason"`
		}
		if json.Unmarshal(payload, &stop) != nil || stop.Reason == "" {
			return nil, deepseekJSONOutputError()
		}
		for _, block := range s.blocks {
			if !block.done {
				return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE)
			}
		}
		s.stopped, s.stop = true, stop.Reason
		return nil, nil
	}
	var event struct {
		Index *uint32 `json:"contentBlockIndex"`
		Start struct {
			Tool *struct {
				ID   string `json:"toolUseId"`
				Name string `json:"name"`
			} `json:"toolUse"`
		} `json:"start"`
		Delta struct {
			Text *string `json:"text"`
			Tool *struct {
				Input string `json:"input"`
			} `json:"toolUse"`
			Reasoning json.RawMessage `json:"reasoningContent"`
		} `json:"delta"`
	}
	if json.Unmarshal(payload, &event) != nil || event.Index == nil {
		return nil, deepseekJSONOutputError()
	}
	index := *event.Index
	block := s.blocks[index]
	newBlock := func(kind string) (*novaBlock, error) {
		if block != nil || index != uint32(len(s.blocks)) || len(s.blocks) >= 4096 {
			return nil, deepseekJSONOutputError()
		}
		b := &novaBlock{kind: kind, publicIndex: s.nextPublic}
		if kind != "reasoning" {
			s.nextPublic++
		}
		s.blocks[index] = b
		return b, nil
	}
	if block != nil && block.done {
		return nil, deepseekJSONOutputError()
	}
	fragment := textbehavior.PrivateFragment{}
	switch kind {
	case "contentBlockStart":
		if event.Start.Tool == nil || event.Start.Tool.ID == "" || event.Start.Tool.Name == "" {
			return nil, deepseekJSONOutputError()
		}
		var err error
		block, err = newBlock("tool")
		if err != nil {
			return nil, err
		}
		fragment.Kind, fragment.ToolCall = textbehavior.OrderedItemToolCall, &textbehavior.ToolCallFragment{IDPart: event.Start.Tool.ID, NamePart: event.Start.Tool.Name}
	case "contentBlockDelta":
		fields := 0
		if event.Delta.Text != nil {
			fields++
		}
		if event.Delta.Tool != nil {
			fields++
		}
		if len(event.Delta.Reasoning) > 0 {
			fields++
		}
		if fields != 1 {
			return nil, deepseekJSONOutputError()
		}
		if event.Delta.Text != nil {
			if block == nil {
				var err error
				block, err = newBlock("text")
				if err != nil {
					return nil, err
				}
			}
			if block.kind != "text" {
				return nil, deepseekJSONOutputError()
			}
			fragment.Kind, fragment.Text = textbehavior.OrderedItemText, *event.Delta.Text
			block.bytes += len(fragment.Text)
			s.bytes += len(fragment.Text)
		} else if event.Delta.Tool != nil {
			if block == nil || block.kind != "tool" {
				return nil, deepseekJSONOutputError()
			}
			fragment.Kind, fragment.ToolCall = textbehavior.OrderedItemToolCall, &textbehavior.ToolCallFragment{ArgumentsJSONPart: event.Delta.Tool.Input}
			block.bytes += len(event.Delta.Tool.Input)
			s.bytes += len(event.Delta.Tool.Input)
		} else {
			if block == nil {
				var err error
				block, err = newBlock("reasoning")
				if err != nil {
					return nil, err
				}
			}
			if block.kind != "reasoning" {
				return nil, deepseekJSONOutputError()
			}
			return nil, nil
		}
	case "contentBlockStop":
		if block == nil {
			return nil, deepseekJSONOutputError()
		}
		block.done = true
		if block.kind == "reasoning" {
			return nil, nil
		}
		fragment.Complete = true
		if block.kind == "tool" {
			fragment.Kind = textbehavior.OrderedItemToolCall
			fragment.ToolCall = &textbehavior.ToolCallFragment{}
		} else {
			fragment.Kind = textbehavior.OrderedItemText
		}
	default:
		return nil, deepseekJSONOutputError()
	}
	if block.bytes > responsesItemTextLimit || s.bytes > responsesItemTextLimit {
		return nil, deepseekJSONOutputError()
	}
	fragment.ItemIndex = block.publicIndex
	return s.assembler.AppendFragment(fragment)
}

func (s *novaStream) Finish() (textbehavior.NormalizedResult, error) {
	if !s.started || !s.stopped || !s.metadata || strings.TrimSpace(s.stop) == "" {
		return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE)
	}
	return finishNova(s.assembler, s.stop, s.usage)
}
