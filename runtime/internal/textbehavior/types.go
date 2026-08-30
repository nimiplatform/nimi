// Package textbehavior owns the Runtime-private normalized execution seam for
// versioned text behavior adapters. It has no route, model-selection,
// registration, process, or public workflow ownership.
// @nimi-authority: rule.nimi.runtime.ai-provider.r119
// @nimi-authority: rule.nimi.runtime.ai-provider.r120
// @nimi-authority: rule.nimi.runtime.ai-provider.r123
package textbehavior

import (
	"encoding/json"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

// ProcessIdentityImpact declares the exact resident-process identity axes
// affected by an adapter. Request-time behavior selection never changes this
// declaration.
type ProcessIdentityImpact string

const (
	ProcessIdentityUnaffected         ProcessIdentityImpact = "unaffected"
	ProcessIdentityAdapter            ProcessIdentityImpact = "adapter"
	ProcessIdentityTemplate           ProcessIdentityImpact = "template"
	ProcessIdentityAdapterAndTemplate ProcessIdentityImpact = "adapter_and_template"
)

// AdapterCapture is the durable, function-free identity of one exact adapter
// implementation. Hook IDs are versioned semantic identities; changing a hook
// without changing its ID is invalid authoring.
type AdapterCapture struct {
	AdapterID                string                `json:"adapter_id"`
	Version                  string                `json:"version"`
	RequestSerializerID      string                `json:"request_serializer_id"`
	NonStreamParserID        string                `json:"non_stream_parser_id"`
	StreamAssemblerID        string                `json:"stream_assembler_id"`
	RequiredTemplateIdentity string                `json:"required_template_identity,omitempty"`
	ProcessIdentityImpact    ProcessIdentityImpact `json:"process_identity_impact"`
}

func (capture AdapterCapture) Validate() error {
	for _, value := range []string{
		capture.AdapterID, capture.Version, capture.RequestSerializerID,
		capture.NonStreamParserID, capture.StreamAssemblerID,
	} {
		if !exactNonEmptyValue(value) {
			return fmt.Errorf("text behavior adapter capture is incomplete")
		}
	}
	if capture.RequiredTemplateIdentity != "" && strings.TrimSpace(capture.RequiredTemplateIdentity) != capture.RequiredTemplateIdentity {
		return fmt.Errorf("text behavior adapter template identity is not canonical")
	}
	switch capture.ProcessIdentityImpact {
	case ProcessIdentityUnaffected, ProcessIdentityAdapter, ProcessIdentityTemplate, ProcessIdentityAdapterAndTemplate:
		return nil
	default:
		return fmt.Errorf("text behavior adapter process identity impact is invalid")
	}
}

type SerializedRequest struct {
	ContentType string
	Payload     []byte
}

type RequestSerializer func(*runtimev1.TextGenerateScenarioSpec, bool) (SerializedRequest, error)
type NonStreamParser func([]byte, *runtimev1.TextGenerateScenarioSpec) (NormalizedResult, error)
type StreamAssemblerFactory func(*runtimev1.TextGenerateScenarioSpec) (StreamFragmentAssembler, error)

type StreamFragmentAssembler interface {
	Append([]byte) ([]OrderedDelta, error)
	Finish() (NormalizedResult, error)
}

// Adapter is an immutable Runtime-private hook bundle produced only after the
// higher-level exact registration resolver has admitted one unique match.
type Adapter struct {
	capture         AdapterCapture
	serialize       RequestSerializer
	parseNonStream  NonStreamParser
	streamAssembler StreamAssemblerFactory
}

func NewAdapter(
	capture AdapterCapture,
	serializer RequestSerializer,
	parser NonStreamParser,
	assembler StreamAssemblerFactory,
) (*Adapter, error) {
	if err := capture.Validate(); err != nil {
		return nil, err
	}
	if serializer == nil || parser == nil || assembler == nil {
		return nil, fmt.Errorf("text behavior adapter hooks are incomplete")
	}
	return &Adapter{capture: capture, serialize: serializer, parseNonStream: parser, streamAssembler: assembler}, nil
}

func (adapter *Adapter) Capture() *AdapterCapture {
	if adapter == nil {
		return nil
	}
	value := adapter.capture
	return &value
}

func (adapter *Adapter) ValidateTemplateIdentity(observed string) error {
	if adapter == nil {
		return nil
	}
	required := adapter.capture.RequiredTemplateIdentity
	if required != "" && observed != required {
		return fmt.Errorf("text behavior adapter template identity does not match the exact model template")
	}
	if (adapter.capture.ProcessIdentityImpact == ProcessIdentityTemplate ||
		adapter.capture.ProcessIdentityImpact == ProcessIdentityAdapterAndTemplate) &&
		!exactNonEmptyValue(observed) {
		return fmt.Errorf("text behavior adapter process identity requires an exact template identity")
	}
	return nil
}

// ProcessIdentityValues returns only the axes explicitly declared to affect
// resident-process identity. The caller supplies the already-verified exact
// template identity; no template discovery occurs here.
func (adapter *Adapter) ProcessIdentityValues(templateIdentity string) ([]string, error) {
	if adapter == nil {
		return nil, nil
	}
	if err := adapter.ValidateTemplateIdentity(templateIdentity); err != nil {
		return nil, err
	}
	switch adapter.capture.ProcessIdentityImpact {
	case ProcessIdentityUnaffected:
		return nil, nil
	case ProcessIdentityAdapter:
		return []string{"text-behavior-adapter", adapter.capture.AdapterID, adapter.capture.Version}, nil
	case ProcessIdentityTemplate:
		return []string{"text-behavior-template", templateIdentity}, nil
	case ProcessIdentityAdapterAndTemplate:
		return []string{
			"text-behavior-adapter", adapter.capture.AdapterID, adapter.capture.Version,
			"text-behavior-template", templateIdentity,
		}, nil
	default:
		return nil, fmt.Errorf("text behavior adapter process identity impact is invalid")
	}
}

// Invocation binds immutable request truth to an already-resolved adapter.
// The engine receives this object through the Driver plan and cannot resolve or
// select another adapter.
type Invocation struct {
	adapter *Adapter
	spec    *runtimev1.TextGenerateScenarioSpec
}

func (adapter *Adapter) Bind(spec *runtimev1.TextGenerateScenarioSpec) (*Invocation, error) {
	if adapter == nil || spec == nil {
		return nil, fmt.Errorf("text behavior adapter invocation is incomplete")
	}
	cloned, _ := proto.Clone(spec).(*runtimev1.TextGenerateScenarioSpec)
	if cloned == nil {
		return nil, fmt.Errorf("text behavior adapter request cannot be captured")
	}
	return &Invocation{adapter: adapter, spec: cloned}, nil
}

func (invocation *Invocation) Capture() *AdapterCapture {
	if invocation == nil || invocation.adapter == nil {
		return nil
	}
	return invocation.adapter.Capture()
}

func (invocation *Invocation) Serialize(stream bool) (SerializedRequest, error) {
	if invocation == nil || invocation.adapter == nil || invocation.spec == nil {
		return SerializedRequest{}, fmt.Errorf("text behavior adapter invocation is incomplete")
	}
	serialized, err := invocation.adapter.serialize(cloneSpec(invocation.spec), stream)
	if err != nil {
		return SerializedRequest{}, err
	}
	serialized.ContentType = strings.TrimSpace(serialized.ContentType)
	if serialized.ContentType == "" || len(serialized.Payload) == 0 {
		return SerializedRequest{}, fmt.Errorf("text behavior adapter serialized request is incomplete")
	}
	serialized.Payload = append([]byte(nil), serialized.Payload...)
	return serialized, nil
}

func (invocation *Invocation) ParseNonStream(payload []byte) (NormalizedResult, error) {
	if invocation == nil || invocation.adapter == nil || invocation.spec == nil {
		return NormalizedResult{}, fmt.Errorf("text behavior adapter invocation is incomplete")
	}
	result, err := invocation.adapter.parseNonStream(append([]byte(nil), payload...), cloneSpec(invocation.spec))
	if err != nil {
		return NormalizedResult{}, err
	}
	return validateAndCloneNormalizedResult(result, invocation.spec)
}

func (invocation *Invocation) NewStreamAssembler() (StreamFragmentAssembler, error) {
	if invocation == nil || invocation.adapter == nil || invocation.spec == nil {
		return nil, fmt.Errorf("text behavior adapter invocation is incomplete")
	}
	assembler, err := invocation.adapter.streamAssembler(cloneSpec(invocation.spec))
	if err != nil {
		return nil, err
	}
	if assembler == nil {
		return nil, fmt.Errorf("text behavior adapter stream assembler is unavailable")
	}
	declaredTools := make(map[string]struct{}, len(invocation.spec.GetTools()))
	for _, tool := range invocation.spec.GetTools() {
		if tool != nil {
			declaredTools[tool.GetName()] = struct{}{}
		}
	}
	return &validatingStreamAssembler{
		inner: assembler, spec: cloneSpec(invocation.spec),
		declaredTools: declaredTools, seenToolIDs: map[string]struct{}{},
	}, nil
}

type validatingStreamAssembler struct {
	inner         StreamFragmentAssembler
	spec          *runtimev1.TextGenerateScenarioSpec
	declaredTools map[string]struct{}
	seenToolIDs   map[string]struct{}
}

func (assembler *validatingStreamAssembler) Append(payload []byte) ([]OrderedDelta, error) {
	deltas, err := assembler.inner.Append(append([]byte(nil), payload...))
	if err != nil {
		return nil, err
	}
	cloned := make([]OrderedDelta, len(deltas))
	for index, delta := range deltas {
		if delta.Kind == OrderedItemReasoningContinuity &&
			(!delta.ItemCompleted || delta.Text != "" || delta.ToolCall != nil || !ValidContinuity(delta.ReasoningContinuity)) {
			return nil, invalidReasoningContinuityError()
		}
		if !validOrderedDelta(delta) || delta.Kind == OrderedItemReasoningSummary && !reasoningSummaryRequested(assembler.spec) {
			return nil, invalidOutputError()
		}
		if delta.Kind == OrderedItemToolCall && delta.ItemCompleted {
			if _, declared := assembler.declaredTools[delta.ToolCall.GetName()]; !declared {
				return nil, invalidToolCallError()
			}
			if _, duplicate := assembler.seenToolIDs[delta.ToolCall.GetId()]; duplicate {
				return nil, invalidToolCallError()
			}
			assembler.seenToolIDs[delta.ToolCall.GetId()] = struct{}{}
		}
		cloned[index] = cloneOrderedDelta(delta)
	}
	return cloned, nil
}

func (assembler *validatingStreamAssembler) Finish() (NormalizedResult, error) {
	result, err := assembler.inner.Finish()
	if err != nil {
		return NormalizedResult{}, err
	}
	return validateAndCloneNormalizedResult(result, assembler.spec)
}

func validateAndCloneNormalizedResult(result NormalizedResult, spec *runtimev1.TextGenerateScenarioSpec) (NormalizedResult, error) {
	switch result.FinishReason {
	case runtimev1.FinishReason_FINISH_REASON_STOP,
		runtimev1.FinishReason_FINISH_REASON_LENGTH,
		runtimev1.FinishReason_FINISH_REASON_TOOL_CALL,
		runtimev1.FinishReason_FINISH_REASON_CONTENT_FILTER:
	case runtimev1.FinishReason_FINISH_REASON_UNSPECIFIED,
		runtimev1.FinishReason_FINISH_REASON_ERROR:
		return NormalizedResult{}, invalidOutputError()
	default:
		return NormalizedResult{}, invalidOutputError()
	}
	if result.FinishReason == runtimev1.FinishReason_FINISH_REASON_LENGTH && reasoningRequested(spec) {
		return NormalizedResult{}, incompleteOutputError()
	}
	if len(result.Items) == 0 {
		return NormalizedResult{}, incompleteOutputError()
	}
	declaredTools := make(map[string]struct{}, len(spec.GetTools()))
	for _, tool := range spec.GetTools() {
		if tool != nil {
			declaredTools[tool.GetName()] = struct{}{}
		}
	}
	seenToolIDs := map[string]struct{}{}
	hasPrimary := false
	hasToolCall := false
	cloned := NormalizedResult{FinishReason: result.FinishReason}
	if result.Usage != nil {
		cloned.Usage, _ = proto.Clone(result.Usage).(*runtimev1.UsageStats)
	}
	for _, item := range result.Items {
		if item.Kind == OrderedItemReasoningContinuity &&
			(item.Text != "" || item.ToolCall != nil || !ValidContinuity(item.ReasoningContinuity)) {
			return NormalizedResult{}, invalidReasoningContinuityError()
		}
		if !validOrderedItem(item) {
			return NormalizedResult{}, invalidOutputError()
		}
		if item.Kind == OrderedItemReasoningSummary && !reasoningSummaryRequested(spec) {
			return NormalizedResult{}, invalidOutputError()
		}
		if item.Kind == OrderedItemToolCall {
			if _, declared := declaredTools[item.ToolCall.GetName()]; !declared {
				return NormalizedResult{}, invalidToolCallError()
			}
			if _, duplicate := seenToolIDs[item.ToolCall.GetId()]; duplicate {
				return NormalizedResult{}, invalidToolCallError()
			}
			seenToolIDs[item.ToolCall.GetId()] = struct{}{}
			hasPrimary = true
			hasToolCall = true
		}
		if item.Kind == OrderedItemText && item.Text != "" {
			hasPrimary = true
		}
		cloned.Items = append(cloned.Items, cloneOrderedItem(item))
	}
	if !hasPrimary {
		return NormalizedResult{}, incompleteOutputError()
	}
	if result.FinishReason == runtimev1.FinishReason_FINISH_REASON_TOOL_CALL && !hasToolCall {
		return NormalizedResult{}, invalidOutputError()
	}
	return cloned, nil
}

func reasoningSummaryRequested(spec *runtimev1.TextGenerateScenarioSpec) bool {
	return reasoningRequested(spec) && spec.GetReasoning().GetPresentation() == runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY
}

func reasoningRequested(spec *runtimev1.TextGenerateScenarioSpec) bool {
	if spec == nil || spec.GetReasoning() == nil {
		return false
	}
	reasoning := spec.GetReasoning()
	return reasoning.GetActivation() == runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE ||
		reasoning.GetActivation() == runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED
}

func validOrderedItem(item OrderedItem) bool {
	switch item.Kind {
	case OrderedItemText:
		return item.Text != "" && item.ToolCall == nil && item.ReasoningContinuity == nil
	case OrderedItemReasoningSummary:
		return item.Text != "" && item.ToolCall == nil && item.ReasoningContinuity == nil
	case OrderedItemToolCall:
		if item.Text != "" || item.ToolCall == nil || item.ReasoningContinuity != nil ||
			!exactNonEmptyValue(item.ToolCall.GetId()) || !exactNonEmptyValue(item.ToolCall.GetName()) {
			return false
		}
		var object map[string]any
		return json.Unmarshal([]byte(item.ToolCall.GetArgumentsJson()), &object) == nil && object != nil
	case OrderedItemReasoningContinuity:
		return item.Text == "" && item.ToolCall == nil && ValidContinuity(item.ReasoningContinuity)
	default:
		return false
	}
}

func validOrderedDelta(delta OrderedDelta) bool {
	if !ValidOrderedItemKind(delta.Kind) {
		return false
	}
	switch delta.Kind {
	case OrderedItemText, OrderedItemReasoningSummary:
		return delta.ToolCall == nil && delta.ReasoningContinuity == nil
	case OrderedItemToolCall:
		if delta.Text != "" || delta.ReasoningContinuity != nil {
			return false
		}
		return delta.ToolCall == nil && !delta.ItemCompleted ||
			delta.ItemCompleted && validOrderedItem(OrderedItem{Kind: OrderedItemToolCall, ToolCall: delta.ToolCall})
	case OrderedItemReasoningContinuity:
		return delta.ItemCompleted && delta.Text == "" && delta.ToolCall == nil && ValidContinuity(delta.ReasoningContinuity)
	default:
		return false
	}
}

func cloneSpec(input *runtimev1.TextGenerateScenarioSpec) *runtimev1.TextGenerateScenarioSpec {
	cloned, _ := proto.Clone(input).(*runtimev1.TextGenerateScenarioSpec)
	return cloned
}

func exactNonEmptyValue(value string) bool {
	return strings.TrimSpace(value) != "" && strings.TrimSpace(value) == value
}
