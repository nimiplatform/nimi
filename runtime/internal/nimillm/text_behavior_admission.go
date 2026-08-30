package nimillm

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type textBehaviorAdmissionKey struct{}

// TextBehaviorAdmission is a request-scoped proof created only after Runtime
// resolves one exact private versioned adapter. It is never caller-authored.
type TextBehaviorAdmission struct {
	AdapterID                 string
	Version                   string
	Provider                  string
	ProviderModelID           string
	ToolUse                   bool
	Reasoning                 bool
	StructuredOutput          bool
	Sync                      bool
	Stream                    bool
	Async                     bool
	ToolStructuredCombination bool
}

func WithTextBehaviorAdmission(ctx context.Context, admission *TextBehaviorAdmission) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	if !validTextBehaviorAdmission(admission) {
		return ctx
	}
	copy := *admission
	return context.WithValue(ctx, textBehaviorAdmissionKey{}, &copy)
}

func textBehaviorAdmissionFromContext(ctx context.Context) *TextBehaviorAdmission {
	if ctx == nil {
		return nil
	}
	admission, _ := ctx.Value(textBehaviorAdmissionKey{}).(*TextBehaviorAdmission)
	if !validTextBehaviorAdmission(admission) {
		return nil
	}
	copy := *admission
	return &copy
}

func validTextBehaviorAdmission(admission *TextBehaviorAdmission) bool {
	if admission == nil || strings.TrimSpace(admission.AdapterID) == "" || admission.AdapterID != strings.TrimSpace(admission.AdapterID) ||
		strings.TrimSpace(admission.Version) == "" || admission.Version != strings.TrimSpace(admission.Version) ||
		strings.TrimSpace(admission.Provider) == "" || admission.Provider != strings.TrimSpace(admission.Provider) ||
		strings.TrimSpace(admission.ProviderModelID) == "" || admission.ProviderModelID != strings.TrimSpace(admission.ProviderModelID) ||
		(!admission.ToolUse && !admission.Reasoning && !admission.StructuredOutput) ||
		trueCount(admission.Sync, admission.Stream, admission.Async) != 1 {
		return false
	}
	return !admission.ToolStructuredCombination || (admission.ToolUse && admission.StructuredOutput)
}

func trueCount(values ...bool) int {
	count := 0
	for _, value := range values {
		if value {
			count++
		}
	}
	return count
}

func textMessagesRequestBehavior(input []*runtimev1.ChatMessage) (toolUse bool, reasoning bool) {
	for _, message := range input {
		if message == nil {
			continue
		}
		for _, item := range message.GetTurnItems() {
			if item == nil {
				continue
			}
			if item.GetToolResult() != nil || item.GetOutput().GetToolCall() != nil {
				toolUse = true
			}
			if item.GetOutput().GetReasoningSummary() != nil || item.GetOutput().GetReasoningContinuity() != nil {
				reasoning = true
			}
		}
	}
	return toolUse, reasoning
}
