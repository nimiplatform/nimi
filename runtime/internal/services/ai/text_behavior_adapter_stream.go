package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
)

// Resolver-local aliases keep registration vocabulary concise while normalized
// execution ownership lives below services/ai so the llama ExecutionHost can
// consume the same hooks without an upward import. They expose no second
// product path or legacy contract.
type textBehaviorOrderedItemKind = textbehavior.OrderedItemKind

const (
	textBehaviorOrderedItemUnspecified         = textbehavior.OrderedItemUnspecified
	textBehaviorOrderedItemText                = textbehavior.OrderedItemText
	textBehaviorOrderedItemReasoningSummary    = textbehavior.OrderedItemReasoningSummary
	textBehaviorOrderedItemToolCall            = textbehavior.OrderedItemToolCall
	textBehaviorOrderedItemReasoningContinuity = textbehavior.OrderedItemReasoningContinuity
)

type textBehaviorOrderedItem = textbehavior.OrderedItem
type textBehaviorOrderedDelta = textbehavior.OrderedDelta
type textBehaviorNormalizedResult = textbehavior.NormalizedResult
type textBehaviorPrivateFragment = textbehavior.PrivateFragment
type textBehaviorToolCallFragment = textbehavior.ToolCallFragment
type textBehaviorToolArgumentsValidator = textbehavior.ToolArgumentsValidator
type textBehaviorOrderedStreamAssembler = textbehavior.OrderedStreamAssembler

func newTextBehaviorOrderedStreamAssembler(tools []*runtimev1.ToolSpec, validator textBehaviorToolArgumentsValidator) *textBehaviorOrderedStreamAssembler {
	return textbehavior.NewOrderedStreamAssembler(tools, validator)
}
