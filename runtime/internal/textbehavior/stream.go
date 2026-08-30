package textbehavior

import (
	"encoding/json"
	"errors"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

type OrderedItemKind uint8

// MaxReasoningContinuityPayloadBytes is the canonical transport ceiling for
// one self-contained opaque continuity carrier. Exact adapters may impose a
// smaller bound, never a larger one.
const MaxReasoningContinuityPayloadBytes = 64 << 10

const (
	OrderedItemUnspecified OrderedItemKind = iota
	OrderedItemText
	OrderedItemReasoningSummary
	OrderedItemToolCall
	OrderedItemReasoningContinuity
)

type OrderedItem struct {
	Kind                OrderedItemKind
	Text                string
	ToolCall            *runtimev1.ToolCall
	ReasoningContinuity *runtimev1.ReasoningContinuityCarrier
}

type OrderedDelta struct {
	ItemIndex           uint32
	Kind                OrderedItemKind
	Text                string
	ToolCall            *runtimev1.ToolCall
	ReasoningContinuity *runtimev1.ReasoningContinuityCarrier
	ItemCompleted       bool
}

func (delta OrderedDelta) HasPublicPayload() bool {
	return delta.Text != "" || delta.ToolCall != nil || delta.ReasoningContinuity != nil || delta.ItemCompleted
}

type NormalizedResult struct {
	Items        []OrderedItem
	Usage        *runtimev1.UsageStats
	FinishReason runtimev1.FinishReason
}

// PrivateFragment is emitted only after an exact dialect adapter parses one
// raw engine fragment. Tool-call parts remain private until completion.
type PrivateFragment struct {
	ItemIndex           uint32
	Kind                OrderedItemKind
	Text                string
	ToolCall            *ToolCallFragment
	ReasoningContinuity *runtimev1.ReasoningContinuityCarrier
	Complete            bool
}

type ToolCallFragment struct {
	IDPart            string
	NamePart          string
	ArgumentsJSONPart string
	Dynamic           *bool
}

type ToolArgumentsValidator func(*runtimev1.ToolSpec, string) error

type OrderedStreamAssembler struct {
	declaredTools map[string]*runtimev1.ToolSpec
	validateArgs  ToolArgumentsValidator
	states        map[uint32]*streamItemState
	completed     map[uint32]OrderedItem
	seenToolIDs   map[string]struct{}
	nextItemIndex uint32
}

type streamItemState struct {
	kind      OrderedItemKind
	text      strings.Builder
	toolID    strings.Builder
	toolName  strings.Builder
	arguments strings.Builder
	dynamic   *bool
	sealed    bool
}

func NewOrderedStreamAssembler(tools []*runtimev1.ToolSpec, validator ToolArgumentsValidator) *OrderedStreamAssembler {
	declared := make(map[string]*runtimev1.ToolSpec, len(tools))
	for _, tool := range tools {
		if tool == nil || strings.TrimSpace(tool.GetName()) == "" {
			continue
		}
		cloned, _ := proto.Clone(tool).(*runtimev1.ToolSpec)
		declared[strings.TrimSpace(tool.GetName())] = cloned
	}
	return &OrderedStreamAssembler{
		declaredTools: declared, validateArgs: validator, states: map[uint32]*streamItemState{},
		completed: map[uint32]OrderedItem{}, seenToolIDs: map[string]struct{}{},
	}
}

func (assembler *OrderedStreamAssembler) AppendFragment(fragment PrivateFragment) ([]OrderedDelta, error) {
	if assembler == nil || !ValidOrderedItemKind(fragment.Kind) {
		return nil, invalidOutputError()
	}
	state := assembler.states[fragment.ItemIndex]
	if state == nil {
		if fragment.ItemIndex != assembler.nextItemIndex {
			return nil, invalidOutputError()
		}
		state = &streamItemState{kind: fragment.Kind}
		assembler.states[fragment.ItemIndex] = state
		assembler.nextItemIndex++
	}
	if state.sealed || state.kind != fragment.Kind {
		return nil, invalidOutputError()
	}

	delta := OrderedDelta{ItemIndex: fragment.ItemIndex, Kind: fragment.Kind, ItemCompleted: fragment.Complete}
	switch fragment.Kind {
	case OrderedItemText, OrderedItemReasoningSummary:
		if fragment.ToolCall != nil || fragment.ReasoningContinuity != nil {
			return nil, invalidOutputError()
		}
		state.text.WriteString(fragment.Text)
		delta.Text = fragment.Text
		if fragment.Complete {
			assembler.completed[fragment.ItemIndex] = OrderedItem{Kind: fragment.Kind, Text: state.text.String()}
		}
	case OrderedItemToolCall:
		if fragment.ToolCall == nil || fragment.Text != "" || fragment.ReasoningContinuity != nil {
			return nil, invalidToolCallError()
		}
		state.toolID.WriteString(fragment.ToolCall.IDPart)
		state.toolName.WriteString(fragment.ToolCall.NamePart)
		state.arguments.WriteString(fragment.ToolCall.ArgumentsJSONPart)
		if fragment.ToolCall.Dynamic != nil {
			if state.dynamic != nil && *state.dynamic != *fragment.ToolCall.Dynamic {
				return nil, invalidToolCallError()
			}
			value := *fragment.ToolCall.Dynamic
			state.dynamic = &value
		}
		if fragment.Complete {
			call, err := assembler.completeToolCall(state)
			if err != nil {
				return nil, err
			}
			delta.ToolCall = call
			assembler.completed[fragment.ItemIndex] = OrderedItem{Kind: fragment.Kind, ToolCall: cloneToolCall(call)}
		}
	case OrderedItemReasoningContinuity:
		if !fragment.Complete || fragment.Text != "" || fragment.ToolCall != nil || !ValidContinuity(fragment.ReasoningContinuity) {
			return nil, invalidReasoningContinuityError()
		}
		continuity := cloneContinuity(fragment.ReasoningContinuity)
		delta.ReasoningContinuity = continuity
		assembler.completed[fragment.ItemIndex] = OrderedItem{Kind: fragment.Kind, ReasoningContinuity: cloneContinuity(continuity)}
	}
	if fragment.Complete {
		state.sealed = true
	}
	return []OrderedDelta{delta}, nil
}

func (assembler *OrderedStreamAssembler) completeToolCall(state *streamItemState) (*runtimev1.ToolCall, error) {
	id := strings.TrimSpace(state.toolID.String())
	name := strings.TrimSpace(state.toolName.String())
	arguments := strings.TrimSpace(state.arguments.String())
	if id == "" || name == "" || arguments == "" {
		return nil, invalidToolCallError()
	}
	if _, duplicate := assembler.seenToolIDs[id]; duplicate {
		return nil, invalidToolCallError()
	}
	tool := assembler.declaredTools[name]
	if tool == nil {
		return nil, invalidToolCallError()
	}
	var object map[string]any
	if err := json.Unmarshal([]byte(arguments), &object); err != nil || object == nil {
		return nil, invalidToolCallError()
	}
	if tool.GetInputSchema() != nil && assembler.validateArgs == nil {
		return nil, invalidToolCallError()
	}
	if assembler.validateArgs != nil {
		if err := assembler.validateArgs(tool, arguments); err != nil {
			return nil, invalidToolCallError()
		}
	}
	assembler.seenToolIDs[id] = struct{}{}
	call := &runtimev1.ToolCall{Id: id, Name: name, ArgumentsJson: arguments}
	if state.dynamic != nil {
		call.Dynamic = *state.dynamic
	}
	return call, nil
}

func (assembler *OrderedStreamAssembler) FinishItems() ([]OrderedItem, error) {
	if assembler == nil {
		return nil, invalidOutputError()
	}
	for _, state := range assembler.states {
		if !state.sealed {
			if state.kind == OrderedItemToolCall {
				return nil, invalidToolCallError()
			}
			return nil, invalidOutputError()
		}
	}
	indices := make([]int, 0, len(assembler.completed))
	for index := range assembler.completed {
		indices = append(indices, int(index))
	}
	sort.Ints(indices)
	items := make([]OrderedItem, 0, len(indices))
	hasPrimaryOutput := false
	for _, index := range indices {
		item := cloneOrderedItem(assembler.completed[uint32(index)])
		items = append(items, item)
		hasPrimaryOutput = hasPrimaryOutput || item.Kind == OrderedItemToolCall || item.Kind == OrderedItemText && item.Text != ""
	}
	if !hasPrimaryOutput {
		return nil, incompleteOutputError()
	}
	return items, nil
}

func ValidOrderedItemKind(kind OrderedItemKind) bool {
	switch kind {
	case OrderedItemText, OrderedItemReasoningSummary, OrderedItemToolCall, OrderedItemReasoningContinuity:
		return true
	default:
		return false
	}
}

func ValidContinuity(value *runtimev1.ReasoningContinuityCarrier) bool {
	return value != nil && exactNonEmptyValue(value.GetKind()) && value.GetVersion() > 0 &&
		len(value.GetPayload()) > 0 && len(value.GetPayload()) <= MaxReasoningContinuityPayloadBytes
}

func cloneOrderedItem(input OrderedItem) OrderedItem {
	return OrderedItem{Kind: input.Kind, Text: input.Text, ToolCall: cloneToolCall(input.ToolCall), ReasoningContinuity: cloneContinuity(input.ReasoningContinuity)}
}

func cloneOrderedDelta(input OrderedDelta) OrderedDelta {
	return OrderedDelta{ItemIndex: input.ItemIndex, Kind: input.Kind, Text: input.Text, ToolCall: cloneToolCall(input.ToolCall), ReasoningContinuity: cloneContinuity(input.ReasoningContinuity), ItemCompleted: input.ItemCompleted}
}

func CloneOrderedItems(values []OrderedItem) []OrderedItem {
	cloned := make([]OrderedItem, len(values))
	for index, value := range values {
		cloned[index] = cloneOrderedItem(value)
	}
	return cloned
}

func cloneToolCall(input *runtimev1.ToolCall) *runtimev1.ToolCall {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.ToolCall)
	return cloned
}

func cloneContinuity(input *runtimev1.ReasoningContinuityCarrier) *runtimev1.ReasoningContinuityCarrier {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.ReasoningContinuityCarrier)
	return cloned
}

func invalidToolCallError() error {
	return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_TOOL_CALL_INVALID, errors.New("text behavior tool-call fragments are invalid"), grpcerr.ReasonOptions{})
}

func invalidOutputError() error {
	return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, errors.New("text behavior ordered output is invalid"), grpcerr.ReasonOptions{})
}

func invalidReasoningContinuityError() error {
	return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_REASONING_CONTINUITY_INVALID, errors.New("text behavior reasoning continuity is invalid"), grpcerr.ReasonOptions{})
}

func incompleteOutputError() error {
	return grpcerr.WrapWithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE, errors.New("text behavior output has no final text or complete tool call"), grpcerr.ReasonOptions{})
}
