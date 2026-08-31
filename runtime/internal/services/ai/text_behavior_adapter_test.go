package ai

import (
	"encoding/json"
	"errors"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestTextBehaviorAdapterResolutionIsExactAndClosed(t *testing.T) {
	registrations := productionTextBehaviorAdapterRegistrations()
	if len(registrations) != 9 {
		t.Fatalf("production Gemma 4 adapter registrations = %d, want 9", len(registrations))
	}
	seenContents := map[string]struct{}{}
	for _, registration := range registrations {
		if !validTextBehaviorAdapterRegistration(registration) || registration.LocalTarget == nil ||
			registration.DriverDialect != gemma4TextDriverDialect || registration.LocalTarget.RecipeID != gemma4TextRecipeID ||
			len(registration.LocalTarget.ModelContents) != 1 {
			t.Fatalf("invalid production Gemma 4 adapter registration: %+v", registration)
		}
		contentID := registration.LocalTarget.ModelContents[0].ContentID
		if _, duplicate := seenContents[contentID]; duplicate {
			t.Fatalf("duplicate production Gemma 4 adapter content %q", contentID)
		}
		seenContents[contentID] = struct{}{}
	}
	oldFacts := textBehaviorAdapterResolutionFacts{
		ImplementationID: "local.text.generate.llama-cpp", DriverID: "nimi.runtime.driver.llama-cpp",
		DriverDialect: "llama.cpp/text-generate/v1",
		LocalTarget: &textBehaviorLocalResolutionTarget{
			RecipeID: "llama.text-generate.gemma-4-e2b-it.v1", RecipeRevision: "1",
			ModelContents: []textBehaviorModelContent{{
				SlotID: "main.gguf", ContentID: "sha256:9378bc471710229ef165709b62e34bfb62231420ddaf6d729e727305b5b8672d",
				EntrySHA256: "9378bc471710229ef165709b62e34bfb62231420ddaf6d729e727305b5b8672d", // pragma: allowlist secret -- public model entry digest
			}},
			TemplateIdentity: gemma4E2BTemplateIdentity,
		},
	}
	if _, err := resolveTextBehaviorAdapterForFacts(registrations, oldFacts, runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, testTextBehaviorToolSpec()); textBehaviorReason(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
		t.Fatalf("old Gemma v1 facts unexpectedly matched production adapter: %v", err)
	}
	identity := &runtimev1.CapabilityImplementationIdentity{
		ImplementationId: "cloud.text.openai", DriverId: "nimi.runtime.driver.openai", DriverDialect: "openai-chat/v1",
	}
	toolSpec := testTextBehaviorToolSpec()
	baseSpec := &runtimev1.TextGenerateScenarioSpec{}
	registration := testCloudToolAdapter(identity, "openai-tools", "model-a")

	base, err := resolveTextBehaviorAdapter(nil, identity, "openai", "model-a", runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, baseSpec)
	if err != nil || base != nil {
		t.Fatalf("base text resolution = adapter=%+v err=%v", base, err)
	}
	if _, err := resolveTextBehaviorAdapter(nil, identity, "openai", "model-a", runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, toolSpec); textBehaviorReason(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
		t.Fatalf("zero-match tool error = %v", err)
	}
	resolved, err := resolveTextBehaviorAdapter([]textBehaviorAdapterRegistration{registration}, identity, "openai", "model-a", runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, toolSpec)
	if err != nil || resolved == nil || resolved.registration.AdapterID != registration.AdapterID {
		t.Fatalf("exact adapter resolution = adapter=%+v err=%v", resolved, err)
	}
	wrongModel := registration
	wrongTarget := *registration.CloudTarget
	wrongTarget.ProviderModelID = "model-b"
	wrongModel.CloudTarget = &wrongTarget
	if _, err := resolveTextBehaviorAdapter([]textBehaviorAdapterRegistration{wrongModel}, identity, "openai", "model-a", runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, toolSpec); textBehaviorReason(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
		t.Fatalf("wrong-model adapter error = %v", err)
	}
	second := registration
	second.AdapterID = "openai-tools-second"
	if _, err := resolveTextBehaviorAdapter([]textBehaviorAdapterRegistration{registration, second}, identity, "openai", "model-a", runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, toolSpec); textBehaviorReason(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_AMBIGUOUS {
		t.Fatalf("ambiguous adapters error = %v", err)
	}
}

func TestTextBehaviorAdapterCombinationRequiresExactDeclaration(t *testing.T) {
	identity := &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.text.openai", DriverId: "nimi.runtime.driver.openai", DriverDialect: "openai-chat/v1"}
	registration := testCloudToolAdapter(identity, "openai-tools-json", "model-a")
	registration.Support.StructuredOutput = &textBehaviorStructuredOutputSupport{
		Kinds: []runtimev1.ResponseFormatKind{runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT},
	}
	registration.Support.Combinations = append(registration.Support.Combinations, textBehaviorCombination{
		StructuredOutput: true, Modes: []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC},
	})
	spec := testTextBehaviorToolSpec()
	spec.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}
	if _, err := resolveTextBehaviorAdapter([]textBehaviorAdapterRegistration{registration}, identity, "openai", "model-a", runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, spec); textBehaviorReason(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
		t.Fatalf("undeclared combination error = %v", err)
	}
	registration.Support.Combinations = append(registration.Support.Combinations, textBehaviorCombination{
		ToolUse: true, StructuredOutput: true, Modes: []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC},
	})
	if resolved, err := resolveTextBehaviorAdapter([]textBehaviorAdapterRegistration{registration}, identity, "openai", "model-a", runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, spec); err != nil || resolved == nil {
		t.Fatalf("declared combination = adapter=%+v err=%v", resolved, err)
	}
}

func TestProductionGemma4TextBehaviorCohortDeclaresOnlyApprovedCombinations(t *testing.T) {
	registration := productionTextBehaviorAdapterRegistrations()[1]
	facts := textBehaviorAdapterResolutionFacts{
		ImplementationID: registration.ImplementationID, DriverID: registration.DriverID,
		DriverDialect: registration.DriverDialect,
		LocalTarget: &textBehaviorLocalResolutionTarget{
			RecipeID: registration.LocalTarget.RecipeID, RecipeRevision: registration.LocalTarget.RecipeRevision,
			ModelContents:    append([]textBehaviorModelContent(nil), registration.LocalTarget.ModelContents...),
			TemplateIdentity: registration.ExecutionSemantics.RequiredTemplateIdentity,
		},
	}
	tool := testTextBehaviorToolSpec()
	reasoning := &runtimev1.TextGenerateScenarioSpec{
		Input: []*runtimev1.ChatMessage{{Role: "user", Content: "reason"}},
		Reasoning: &runtimev1.ReasoningConfig{
			Activation:   runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED,
			Intensity:    &runtimev1.ReasoningConfig_ExactBudgetTokens{ExactBudgetTokens: 32},
			Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN,
		},
	}
	schema, err := structpb.NewStruct(map[string]any{"type": "object"})
	if err != nil {
		t.Fatal(err)
	}
	structured := &runtimev1.TextGenerateScenarioSpec{
		Input: []*runtimev1.ChatMessage{{Role: "user", Content: "json"}},
		ResponseFormat: &runtimev1.ResponseFormat{
			Kind:       runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA,
			JsonSchema: schema, Strict: true,
		},
	}
	for name, spec := range map[string]*runtimev1.TextGenerateScenarioSpec{
		"tool": tool, "reasoning": reasoning, "structured": structured,
	} {
		if resolved, err := resolveTextBehaviorAdapterForFacts(productionTextBehaviorAdapterRegistrations(), facts, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, spec); err != nil || resolved == nil {
			t.Fatalf("approved %s behavior = adapter=%+v err=%v", name, resolved, err)
		}
	}
	toolReasoning := proto.Clone(tool).(*runtimev1.TextGenerateScenarioSpec)
	toolReasoning.Reasoning = reasoning.GetReasoning()
	toolStructured := proto.Clone(tool).(*runtimev1.TextGenerateScenarioSpec)
	toolStructured.ResponseFormat = structured.GetResponseFormat()
	for name, spec := range map[string]*runtimev1.TextGenerateScenarioSpec{
		"tools+reasoning":  toolReasoning,
		"tools+structured": toolStructured,
	} {
		if _, err := resolveTextBehaviorAdapterForFacts(productionTextBehaviorAdapterRegistrations(), facts, runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, spec); textBehaviorReason(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
			t.Fatalf("unsupported %s combination error = %v", name, err)
		}
	}
	effort := proto.Clone(reasoning).(*runtimev1.TextGenerateScenarioSpec)
	effort.Reasoning = &runtimev1.ReasoningConfig{
		Activation:   runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED,
		Intensity:    &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH},
		Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN,
	}
	summary := proto.Clone(reasoning).(*runtimev1.TextGenerateScenarioSpec)
	summary.Reasoning = &runtimev1.ReasoningConfig{
		Activation:   runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED,
		Intensity:    &runtimev1.ReasoningConfig_ExactBudgetTokens{ExactBudgetTokens: 32},
		Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY,
	}
	for name, spec := range map[string]*runtimev1.TextGenerateScenarioSpec{"effort": effort, "summary": summary} {
		if _, err := resolveTextBehaviorAdapterForFacts(productionTextBehaviorAdapterRegistrations(), facts, runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, spec); textBehaviorReason(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
			t.Fatalf("unsupported reasoning %s error = %v", name, err)
		}
	}
}

func TestTextBehaviorAdapterLocalResolutionUsesExactContentAndTemplateIdentity(t *testing.T) {
	facts := textBehaviorAdapterResolutionFacts{
		ImplementationID: "llama.text-generate", DriverID: "nimi.runtime.driver.llama", DriverDialect: "llama-server/v2",
		LocalTarget: &textBehaviorLocalResolutionTarget{
			RecipeID: "llama.text-generate.gemma4.v1", RecipeRevision: "1",
			ModelContents:    []textBehaviorModelContent{{SlotID: "main.gguf", ContentID: "sha256:main-a", EntrySHA256: "entry-a"}},
			TemplateIdentity: "gguf-template-sha256:template-a",
			RecipeCustody:    []textBehaviorRecipeCustody{{CustodyID: "custody:chat-template", ContentID: "sha256:custody-a"}},
			LoadOptions:      []textBehaviorLoadOption{{Key: "chat_template", CanonicalValue: "gemma4"}},
		},
	}
	registration := testLocalToolAdapter(facts, "gemma4-tools")
	resolved, err := resolveTextBehaviorAdapterForFacts([]textBehaviorAdapterRegistration{registration}, facts, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, testTextBehaviorToolSpec())
	if err != nil || resolved == nil || resolved.registration.AdapterID != "gemma4-tools" {
		t.Fatalf("exact local resolution = adapter=%+v err=%v", resolved, err)
	}

	wrongTemplate := facts
	wrongTemplateTarget := *facts.LocalTarget
	wrongTemplateTarget.TemplateIdentity = "gguf-template-sha256:template-b"
	wrongTemplate.LocalTarget = &wrongTemplateTarget
	if _, err := resolveTextBehaviorAdapterForFacts([]textBehaviorAdapterRegistration{registration}, wrongTemplate, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, testTextBehaviorToolSpec()); textBehaviorReason(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
		t.Fatalf("wrong-template local resolution = %v", err)
	}

	wrongContent := facts
	wrongContentTarget := *facts.LocalTarget
	wrongContentTarget.ModelContents = []textBehaviorModelContent{{SlotID: "main.gguf", ContentID: "sha256:main-b", EntrySHA256: "entry-b"}}
	wrongContent.LocalTarget = &wrongContentTarget
	if _, err := resolveTextBehaviorAdapterForFacts([]textBehaviorAdapterRegistration{registration}, wrongContent, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, testTextBehaviorToolSpec()); textBehaviorReason(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
		t.Fatalf("wrong-content local resolution = %v", err)
	}

	second := registration
	second.AdapterID = "gemma4-tools-second"
	if _, err := resolveTextBehaviorAdapterForFacts([]textBehaviorAdapterRegistration{registration, second}, facts, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, testTextBehaviorToolSpec()); textBehaviorReason(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_AMBIGUOUS {
		t.Fatalf("ambiguous local resolution = %v", err)
	}
}

func TestTextBehaviorAdapterInvalidRegistrationFailsClosed(t *testing.T) {
	identity := &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.text.openai", DriverId: "nimi.runtime.driver.openai", DriverDialect: "openai-chat/v1"}
	registration := testCloudToolAdapter(identity, "openai-tools", "model-a")
	registration.StreamAssembler = nil
	if validTextBehaviorAdapterRegistration(registration) {
		t.Fatal("registration without stream assembler accepted")
	}
	if _, err := resolveTextBehaviorAdapter([]textBehaviorAdapterRegistration{registration}, identity, "openai", "model-a", runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, testTextBehaviorToolSpec()); textBehaviorReason(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
		t.Fatalf("invalid registration resolution = %v", err)
	}

	registration = testCloudToolAdapter(identity, "openai-tools", "model-a")
	registration.LocalTarget = &textBehaviorLocalTarget{RecipeID: "recipe", RecipeRevision: "1", ModelContents: []textBehaviorModelContent{{SlotID: "main.gguf", ContentID: "sha256:a", EntrySHA256: "entry-a"}}}
	if validTextBehaviorAdapterRegistration(registration) {
		t.Fatal("registration with both Cloud and Local targets accepted")
	}
}

func TestTextBehaviorAdapterRejectsMalformedNamedToolChoiceBeforeResolution(t *testing.T) {
	identity := &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.text.openai", DriverId: "nimi.runtime.driver.openai", DriverDialect: "openai-chat/v1"}
	spec := testTextBehaviorToolSpec()
	spec.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL
	spec.ToolChoiceName = "missing"
	_, err := resolveTextBehaviorAdapter([]textBehaviorAdapterRegistration{testCloudToolAdapter(identity, "openai-tools", "model-a")}, identity, "openai", "model-a", runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, spec)
	if textBehaviorReason(err) != runtimev1.ReasonCode_AI_INPUT_INVALID {
		t.Fatalf("malformed named tool choice = %v", err)
	}
}

func TestTextBehaviorAdapterToolResultRoundTripRequiresDeclaration(t *testing.T) {
	identity := &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.text.openai", DriverId: "nimi.runtime.driver.openai", DriverDialect: "openai-chat/v1"}
	registration := testCloudToolAdapter(identity, "openai-tools", "model-a")
	spec := testTextBehaviorToolSpec()
	spec.Input = []*runtimev1.ChatMessage{{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{
		{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: &runtimev1.ToolCall{Id: "call-1", Name: "lookup", ArgumentsJson: "{}"}}}}},
		{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "call-1", ToolName: "lookup"}}},
	}}}
	if _, err := resolveTextBehaviorAdapter([]textBehaviorAdapterRegistration{registration}, identity, "openai", "model-a", runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, spec); textBehaviorReason(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
		t.Fatalf("undeclared ToolResult round trip = %v", err)
	}
	registration.Support.ToolUse.ToolResultRoundTrip = true
	if resolved, err := resolveTextBehaviorAdapter([]textBehaviorAdapterRegistration{registration}, identity, "openai", "model-a", runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, spec); err != nil || resolved == nil {
		t.Fatalf("declared ToolResult round trip = adapter=%+v err=%v", resolved, err)
	}
}

func TestTextBehaviorAdapterRejectsMismatchedToolTranscriptBeforeDispatch(t *testing.T) {
	identity := &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.text.openai", DriverId: "nimi.runtime.driver.openai", DriverDialect: "openai-chat/v1"}
	registration := testCloudToolAdapter(identity, "openai-tools", "model-a")
	registration.Support.ToolUse.ToolResultRoundTrip = true
	for _, test := range []struct {
		name       string
		call       *runtimev1.ToolCall
		toolResult *runtimev1.ToolResult
	}{
		{name: "unknown result id", call: &runtimev1.ToolCall{Id: "call-1", Name: "lookup", ArgumentsJson: "{}"}, toolResult: &runtimev1.ToolResult{ToolCallId: "call-2", ToolName: "lookup"}},
		{name: "mismatched result name", call: &runtimev1.ToolCall{Id: "call-1", Name: "lookup", ArgumentsJson: "{}"}, toolResult: &runtimev1.ToolResult{ToolCallId: "call-1", ToolName: "weather"}},
		{name: "undeclared call name", call: &runtimev1.ToolCall{Id: "call-1", Name: "weather", ArgumentsJson: "{}"}, toolResult: &runtimev1.ToolResult{ToolCallId: "call-1", ToolName: "weather"}},
		{name: "malformed call arguments", call: &runtimev1.ToolCall{Id: "call-1", Name: "lookup", ArgumentsJson: "not-json"}, toolResult: &runtimev1.ToolResult{ToolCallId: "call-1", ToolName: "lookup"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			spec := testTextBehaviorToolSpec()
			spec.Input = []*runtimev1.ChatMessage{{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{
				{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: test.call}}}},
				{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: test.toolResult}},
			}}}
			_, err := resolveTextBehaviorAdapter([]textBehaviorAdapterRegistration{registration}, identity, "openai", "model-a", runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, spec)
			if textBehaviorReason(err) != runtimev1.ReasonCode_AI_TOOL_CALL_INVALID {
				t.Fatalf("mismatched transcript error = %v", err)
			}
		})
	}
}

func TestTextBehaviorAdapterRejectsMalformedReasoningContinuityBeforeResolution(t *testing.T) {
	identity := &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.text.openai", DriverId: "nimi.runtime.driver.openai", DriverDialect: "openai-chat/v1"}
	spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{{
		Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{
			ReasoningContinuity: &runtimev1.ReasoningContinuityCarrier{Kind: "native", Version: 1},
		}}},
	}}}}}
	_, err := resolveTextBehaviorAdapter(nil, identity, "openai", "model-a", runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, spec)
	if textBehaviorReason(err) != runtimev1.ReasonCode_AI_REASONING_CONTINUITY_INVALID {
		t.Fatalf("malformed reasoning continuity error = %v", err)
	}

	spec.Input[0].TurnItems[0].GetOutput().GetReasoningContinuity().Payload = make([]byte, textbehavior.MaxReasoningContinuityPayloadBytes+1)
	_, err = resolveTextBehaviorAdapter(nil, identity, "openai", "model-a", runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, spec)
	if textBehaviorReason(err) != runtimev1.ReasonCode_AI_REASONING_CONTINUITY_INVALID {
		t.Fatalf("oversized reasoning continuity error = %v", err)
	}

	spec.Input[0].TurnItems[0].GetOutput().GetReasoningContinuity().Payload = []byte("opaque")
	_, err = resolveTextBehaviorAdapter(nil, identity, "openai", "model-a", runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, spec)
	if textBehaviorReason(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
		t.Fatalf("valid but unsupported reasoning continuity error = %v", err)
	}
}

func TestTextBehaviorAdapterRejectsConflictingOrderedTranscriptBeforeSerializer(t *testing.T) {
	identity := &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.text.openai", DriverId: "nimi.runtime.driver.openai", DriverDialect: "openai-chat/v1"}
	registration := testCloudToolAdapter(identity, "openai-tools", "model-a")
	registration.Support.ToolUse.ToolResultRoundTrip = true
	validCall := func() *runtimev1.TextTurnItem {
		return &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{
			ToolCall: &runtimev1.ToolCall{Id: "call-1", Name: "lookup", ArgumentsJson: "{}"},
		}}}}
	}
	for _, message := range []*runtimev1.ChatMessage{
		{Role: "assistant", Content: "legacy", TurnItems: []*runtimev1.TextTurnItem{validCall()}},
		{Role: "user", TurnItems: []*runtimev1.TextTurnItem{validCall()}},
		{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningSummary{
			ReasoningSummary: &runtimev1.ReasoningSummary{},
		}}}}}},
	} {
		spec := testTextBehaviorToolSpec()
		spec.Input = []*runtimev1.ChatMessage{message}
		_, err := resolveTextBehaviorAdapter([]textBehaviorAdapterRegistration{registration}, identity, "openai", "model-a", runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, spec)
		if textBehaviorReason(err) != runtimev1.ReasonCode_AI_INPUT_INVALID {
			t.Fatalf("conflicting ordered transcript error = %v", err)
		}
	}
}

func TestTextBehaviorOrderedAssemblerKeepsToolFragmentsPrivateUntilComplete(t *testing.T) {
	schema := map[string]any{"type": "object"}
	schemaStruct, err := runtimev1Struct(schema)
	if err != nil {
		t.Fatal(err)
	}
	tool := &runtimev1.ToolSpec{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup", InputSchema: schemaStruct}
	assembler := newTextBehaviorOrderedStreamAssembler([]*runtimev1.ToolSpec{tool}, func(_ *runtimev1.ToolSpec, arguments string) error {
		var value map[string]any
		if err := json.Unmarshal([]byte(arguments), &value); err != nil || value["city"] != "Paris" {
			return errors.New("city is required")
		}
		return nil
	})
	if _, err := assembler.AppendFragment(textBehaviorPrivateFragment{ItemIndex: 0, Kind: textBehaviorOrderedItemReasoningSummary, Text: "checking", Complete: true}); err != nil {
		t.Fatal(err)
	}
	deltas, err := assembler.AppendFragment(textBehaviorPrivateFragment{ItemIndex: 1, Kind: textBehaviorOrderedItemToolCall, ToolCall: &textBehaviorToolCallFragment{IDPart: "call-", NamePart: "look", ArgumentsJSONPart: `{"city":`}})
	if err != nil || len(deltas) != 1 || deltas[0].ToolCall != nil || deltas[0].ItemCompleted {
		t.Fatalf("private fragment leaked = deltas=%+v err=%v", deltas, err)
	}
	deltas, err = assembler.AppendFragment(textBehaviorPrivateFragment{ItemIndex: 1, Kind: textBehaviorOrderedItemToolCall, ToolCall: &textBehaviorToolCallFragment{IDPart: "1", NamePart: "up", ArgumentsJSONPart: `"Paris"}`}, Complete: true})
	if err != nil || len(deltas) != 1 || deltas[0].ToolCall.GetId() != "call-1" || deltas[0].ToolCall.GetName() != "lookup" || !deltas[0].ItemCompleted {
		t.Fatalf("completed tool delta = deltas=%+v err=%v", deltas, err)
	}
	if _, err := assembler.AppendFragment(textBehaviorPrivateFragment{ItemIndex: 2, Kind: textBehaviorOrderedItemText, Text: "done", Complete: true}); err != nil {
		t.Fatal(err)
	}
	items, err := assembler.FinishItems()
	if err != nil || len(items) != 3 || items[0].Kind != textBehaviorOrderedItemReasoningSummary || items[1].ToolCall.GetId() != "call-1" || items[2].Text != "done" {
		t.Fatalf("ordered items = %+v err=%v", items, err)
	}
}

func TestTextBehaviorOrderedAssemblerSupportsInterleavedParallelFragmentsAndRejectsIncomplete(t *testing.T) {
	tools := []*runtimev1.ToolSpec{
		{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "first"},
		{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "second"},
	}
	assembler := newTextBehaviorOrderedStreamAssembler(tools, nil)
	_, _ = assembler.AppendFragment(textBehaviorPrivateFragment{ItemIndex: 0, Kind: textBehaviorOrderedItemToolCall, ToolCall: &textBehaviorToolCallFragment{IDPart: "call-1", NamePart: "first", ArgumentsJSONPart: "{"}})
	_, _ = assembler.AppendFragment(textBehaviorPrivateFragment{ItemIndex: 1, Kind: textBehaviorOrderedItemToolCall, ToolCall: &textBehaviorToolCallFragment{IDPart: "call-2", NamePart: "second", ArgumentsJSONPart: "{}"}, Complete: true})
	_, err := assembler.AppendFragment(textBehaviorPrivateFragment{ItemIndex: 0, Kind: textBehaviorOrderedItemToolCall, ToolCall: &textBehaviorToolCallFragment{ArgumentsJSONPart: "}"}, Complete: true})
	if err != nil {
		t.Fatalf("interleaved parallel completion = %v", err)
	}
	items, err := assembler.FinishItems()
	if err != nil || len(items) != 2 || items[0].ToolCall.GetId() != "call-1" || items[1].ToolCall.GetId() != "call-2" {
		t.Fatalf("parallel item order = %+v err=%v", items, err)
	}

	incomplete := newTextBehaviorOrderedStreamAssembler(tools, nil)
	_, _ = incomplete.AppendFragment(textBehaviorPrivateFragment{ItemIndex: 0, Kind: textBehaviorOrderedItemToolCall, ToolCall: &textBehaviorToolCallFragment{IDPart: "call-1", NamePart: "first", ArgumentsJSONPart: "{"}})
	if _, err := incomplete.FinishItems(); textBehaviorReason(err) != runtimev1.ReasonCode_AI_TOOL_CALL_INVALID {
		t.Fatalf("incomplete tool fragment error = %v", err)
	}

	malformed := newTextBehaviorOrderedStreamAssembler(tools, nil)
	_, err = malformed.AppendFragment(textBehaviorPrivateFragment{ItemIndex: 0, Kind: textBehaviorOrderedItemToolCall, ToolCall: &textBehaviorToolCallFragment{IDPart: "call-1", NamePart: "first", ArgumentsJSONPart: "not-json"}, Complete: true})
	if textBehaviorReason(err) != runtimev1.ReasonCode_AI_TOOL_CALL_INVALID {
		t.Fatalf("malformed tool fragment error = %v", err)
	}
}

func TestTextBehaviorOrderedAssemblerRejectsSummaryOnlySuccess(t *testing.T) {
	assembler := newTextBehaviorOrderedStreamAssembler(nil, nil)
	_, err := assembler.AppendFragment(textBehaviorPrivateFragment{
		ItemIndex: 0, Kind: textBehaviorOrderedItemReasoningSummary, Text: "summary", Complete: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := assembler.FinishItems(); textBehaviorReason(err) != runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE {
		t.Fatalf("summary-only output = %v", err)
	}
}

type testTextBehaviorRawAssembler struct{}

func (*testTextBehaviorRawAssembler) Append([]byte) ([]textBehaviorOrderedDelta, error) {
	return nil, nil
}

func (*testTextBehaviorRawAssembler) Finish() (textBehaviorNormalizedResult, error) {
	return textBehaviorNormalizedResult{}, nil
}

func testTextBehaviorToolSpec() *runtimev1.TextGenerateScenarioSpec {
	return &runtimev1.TextGenerateScenarioSpec{Tools: []*runtimev1.ToolSpec{{
		Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup",
	}}}
}

func testCloudToolAdapter(identity *runtimev1.CapabilityImplementationIdentity, adapterID, modelID string) textBehaviorAdapterRegistration {
	registration := testTextBehaviorToolAdapterBase(identity, adapterID)
	registration.CloudTarget = &textBehaviorCloudTarget{Provider: "openai", ProviderModelID: modelID}
	return registration
}

func testLocalToolAdapter(facts textBehaviorAdapterResolutionFacts, adapterID string) textBehaviorAdapterRegistration {
	registration := testTextBehaviorToolAdapterBase(&runtimev1.CapabilityImplementationIdentity{
		ImplementationId: facts.ImplementationID, DriverId: facts.DriverID, DriverDialect: facts.DriverDialect,
	}, adapterID)
	registration.CloudTarget = nil
	registration.LocalTarget = &textBehaviorLocalTarget{
		RecipeID: facts.LocalTarget.RecipeID, RecipeRevision: facts.LocalTarget.RecipeRevision,
		ModelContents: append([]textBehaviorModelContent(nil), facts.LocalTarget.ModelContents...),
	}
	registration.ExecutionSemantics = textBehaviorExecutionSemantics{
		RequiredTemplateIdentity: facts.LocalTarget.TemplateIdentity,
		RequiredRecipeCustody:    append([]textBehaviorRecipeCustody(nil), facts.LocalTarget.RecipeCustody...),
		RequiredLoadOptions:      append([]textBehaviorLoadOption(nil), facts.LocalTarget.LoadOptions...),
		ProcessIdentityImpact:    textBehaviorProcessIdentityAdapterAndTemplate,
	}
	return registration
}

func testTextBehaviorToolAdapterBase(identity *runtimev1.CapabilityImplementationIdentity, adapterID string) textBehaviorAdapterRegistration {
	return textBehaviorAdapterRegistration{
		AdapterID: adapterID, Version: "1", ImplementationID: identity.GetImplementationId(),
		DriverID: identity.GetDriverId(), DriverDialect: identity.GetDriverDialect(),
		Support: textBehaviorSupport{
			ToolUse: &textBehaviorToolUseSupport{
				SpecKinds:        []runtimev1.ToolSpecKind{runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION},
				ChoiceModes:      []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO},
				SingleCall:       true,
				ToolOnlyResponse: true,
			},
			Combinations: []textBehaviorCombination{{
				ToolUse: true,
				Modes:   []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM},
			}},
		},
		ExecutionSemantics:  textBehaviorExecutionSemantics{ProcessIdentityImpact: textBehaviorProcessIdentityUnaffected},
		RequestSerializerID: "test/request/v1",
		RequestSerializer: func(*runtimev1.TextGenerateScenarioSpec, bool) (textBehaviorSerializedRequest, error) {
			return textBehaviorSerializedRequest{ContentType: "application/json", Payload: []byte("{}")}, nil
		},
		NonStreamParserID: "test/nonstream/v1",
		NonStreamParser: func([]byte, *runtimev1.TextGenerateScenarioSpec) (textBehaviorNormalizedResult, error) {
			return textBehaviorNormalizedResult{}, nil
		},
		StreamAssemblerID: "test/stream/v1",
		StreamAssembler: func(*runtimev1.TextGenerateScenarioSpec) (textBehaviorStreamFragmentAssembler, error) {
			return &testTextBehaviorRawAssembler{}, nil
		},
	}
}

func runtimev1Struct(value map[string]any) (*structpb.Struct, error) {
	return structpb.NewStruct(value)
}

func textBehaviorReason(err error) runtimev1.ReasonCode {
	reason, _ := grpcerr.ExtractReasonCode(err)
	return reason
}
