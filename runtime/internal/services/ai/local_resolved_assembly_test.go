package ai

import (
	"bytes"
	"encoding/json"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

func TestCloneLocalResolvedAssemblyPreservesRequestPayloadBytes(t *testing.T) {
	input := &localResolvedAssembly{
		Request: localResolvedAssemblyRequest{
			Kind:    "text.generate",
			Payload: json.RawMessage(`{"systemPrompt":"<runtime-agent-context>"}`),
		},
	}
	cloned, err := cloneLocalResolvedAssembly(input)
	if err != nil {
		t.Fatalf("clone local ResolvedAssembly: %v", err)
	}
	if !bytes.Equal(cloned.Request.Payload, input.Request.Payload) {
		t.Fatalf("request payload changed during clone: got=%q want=%q", cloned.Request.Payload, input.Request.Payload)
	}
}

func TestValidateRehydratedResolvedAssemblyPlanRejectsCompleteRequestDrift(t *testing.T) {
	captured := &localResolvedAssembly{
		Request: localResolvedAssemblyRequest{
			Kind:        "speech.transcribe",
			Payload:     json.RawMessage(`{"language":"en"}`),
			BinaryInput: []byte{1, 2, 3},
			MIMEType:    "audio/wav",
		},
		LoadPlan:        localResolvedAssemblyLoadPlan{Kind: "speech", Speech: &localResolvedAssemblySpeechPlan{Operation: "transcribe", DriverID: "driver"}},
		ProcessIdentity: localResolvedAssemblyProcessIdentity{ProcessKey: "process", DriverID: "driver"},
	}
	for _, test := range []struct {
		name   string
		mutate func(*localResolvedAssembly)
	}{
		{name: "payload", mutate: func(value *localResolvedAssembly) { value.Request.Payload = json.RawMessage(`{"language":"zh"}`) }},
		{name: "binary input", mutate: func(value *localResolvedAssembly) { value.Request.BinaryInput = []byte{1, 2, 4} }},
		{name: "MIME type", mutate: func(value *localResolvedAssembly) { value.Request.MIMEType = "audio/mpeg" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			reprojected, err := cloneLocalResolvedAssembly(captured)
			if err != nil {
				t.Fatal(err)
			}
			test.mutate(reprojected)
			err = validateRehydratedResolvedAssemblyPlan(captured, reprojected)
			if err == nil || !strings.Contains(err.Error(), "request") {
				t.Fatalf("request drift was not rejected: %v", err)
			}
		})
	}
}

func TestValidateLocalResolvedAssemblyRejectsImplementationOnlyAdmittedFeature(t *testing.T) {
	assembly := &localResolvedAssembly{
		Version:   localResolvedAssemblyVersion,
		LoadoutID: "loadout-conditional", CapabilityContract: "text.generate",
		RecipeID: "recipe-conditional", RecipeRevision: "1",
		DriverIdentity: localResolvedAssemblyDriverIdentity{
			ImplementationID: "implementation", DriverID: "driver", DriverDialect: "dialect",
		},
		ImplementationSupportedFeatures: []string{"input.image"},
		AdmittedFeatures:                []string{"input.image"},
	}
	err := validateLocalResolvedAssembly(assembly)
	if err == nil || !strings.Contains(err.Error(), "feature projections") {
		t.Fatalf("implementation-only feature bypass was admitted: %v", err)
	}
}

func TestLocalTextResolvedAssemblyPersistsTemplateIdentityAndRejectsReplayDrift(t *testing.T) {
	templateIdentity := "sha256:f24189f08c85a1eb19a737306c3a13e85462ee33d964f28108d64a2485fa2171"
	selected := &localexecution.SelectedLocalExecution{
		LoadoutID: "loadout-template", CapabilityContract: capabilitydriver.LlamaCapabilityContract,
		RecipeID: capabilitydriver.LlamaGemma4RecipeID, RecipeRevision: "test-revision",
		DriverIdentity:           (&capabilitydriver.Identity{ImplementationID: capabilitydriver.LlamaImplementationID, DriverID: capabilitydriver.LlamaDriverID, DriverDialect: capabilitydriver.LlamaDriverDialect}).Proto(),
		ModelContextWindowTokens: 32768,
		Requirements: []*runtimev1.LocalCapabilityRequirement{{
			RequirementId: capabilitydriver.MainGGUFRequirementID,
			Role:          runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
			Presence:      runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED,
		}},
		ExactBindings: []localexecution.ExactBinding{{
			RequirementID: capabilitydriver.MainGGUFRequirementID, RequirementRole: runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
			ModelAssetID: "asset-template", AbsolutePath: filepath.Join(t.TempDir(), "model.gguf"),
			VerifiedContentID: "sha256:" + strings.Repeat("a", 64), EntrySHA256: strings.Repeat("b", 64), TemplateIdentity: templateIdentity,
		}},
		Configured: true,
	}
	request := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hello"}}}
	driver := capabilitydriver.LlamaTextDriver{}
	plan, err := driver.PlanTextInvocation(capabilitydriver.TextInvocationInput{
		ModelContextWindowTokens: selected.ModelContextWindowTokens,
		ExactBindings:            projectInvocationExactBindings(selected.ExactBindings),
		BehaviorMatch:            projectLocalTextBehaviorAdapterMatchFacts(selected),
		Request:                  request,
	})
	if err != nil {
		t.Fatalf("PlanTextInvocation: %v", err)
	}
	assembly, err := localResolvedAssemblyForText(selected, request, plan)
	if err != nil {
		t.Fatalf("localResolvedAssemblyForText: %v", err)
	}
	persisted, err := cloneLocalResolvedAssembly(assembly)
	if err != nil {
		t.Fatalf("persist/restore local ResolvedAssembly: %v", err)
	}
	if got := persisted.ModelAxes[0].TemplateIdentity; got != templateIdentity {
		t.Fatalf("persisted model-axis template identity = %q", got)
	}
	if got := persisted.LoadPlan.Text.BehaviorMatch.TemplateIdentity; got != templateIdentity {
		t.Fatalf("persisted behavior-match template identity = %q", got)
	}
	service := &Service{capabilityDrivers: capabilitydriver.NewProductionRegistry()}
	if _, err := service.localTextEffectiveInputsFromResolvedAssembly(persisted); err != nil {
		t.Fatalf("replay exact template identity: %v", err)
	}

	drifted, err := cloneLocalResolvedAssembly(persisted)
	if err != nil {
		t.Fatal(err)
	}
	drifted.LoadPlan.Text.BehaviorMatch.TemplateIdentity = "sha256:" + strings.Repeat("c", 64)
	if _, err := service.localTextEffectiveInputsFromResolvedAssembly(drifted); err == nil || !strings.Contains(err.Error(), "behavior match") {
		t.Fatalf("replay template identity drift was not rejected: %v", err)
	}
}

func TestLocalTextResolvedAssemblyCapturesResolvedAdapterAndRejectsReplayMismatch(t *testing.T) {
	templateIdentity := "sha256:" + strings.Repeat("c", 64)
	selected := &localexecution.SelectedLocalExecution{
		LoadoutID: "loadout-behavior", CapabilityContract: capabilitydriver.LlamaCapabilityContract,
		RecipeID: capabilitydriver.LlamaGemma4RecipeID, RecipeRevision: "test-revision",
		DriverIdentity: (&capabilitydriver.Identity{
			ImplementationID: capabilitydriver.LlamaImplementationID, DriverID: capabilitydriver.LlamaDriverID, DriverDialect: capabilitydriver.LlamaDriverDialect,
		}).Proto(),
		ModelContextWindowTokens: 32768,
		Requirements: []*runtimev1.LocalCapabilityRequirement{{
			RequirementId: capabilitydriver.MainGGUFRequirementID,
			Role:          runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
			Presence:      runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED,
		}},
		ExactBindings: []localexecution.ExactBinding{{
			RequirementID: capabilitydriver.MainGGUFRequirementID, RequirementRole: runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
			ModelAssetID: "asset-behavior", AbsolutePath: filepath.Join(t.TempDir(), "model.gguf"),
			VerifiedContentID: "sha256:" + strings.Repeat("a", 64), EntrySHA256: strings.Repeat("b", 64), TemplateIdentity: templateIdentity,
		}},
		Configured: true,
	}
	match := projectLocalTextBehaviorAdapterMatchFacts(selected)
	facts, err := localTextBehaviorAdapterResolutionFacts(selected, match)
	if err != nil {
		t.Fatal(err)
	}
	registration := testLocalToolAdapter(facts, "synthetic-local-tools")
	request := testTextBehaviorToolSpec()
	resolved, err := resolveTextBehaviorAdapterForFacts([]textBehaviorAdapterRegistration{registration}, facts, runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, request)
	if err != nil {
		t.Fatal(err)
	}
	runtimeAdapter, err := resolved.runtimeAdapter()
	if err != nil {
		t.Fatal(err)
	}
	plan, err := (capabilitydriver.LlamaTextDriver{}).PlanTextInvocation(capabilitydriver.TextInvocationInput{
		ModelContextWindowTokens: selected.ModelContextWindowTokens,
		ExactBindings:            projectInvocationExactBindings(selected.ExactBindings), BehaviorMatch: match,
		BehaviorAdapter: runtimeAdapter, Request: request,
	})
	if err != nil {
		t.Fatalf("PlanTextInvocation: %v", err)
	}
	assembly, err := localResolvedAssemblyForText(selected, request, plan)
	if err != nil {
		t.Fatal(err)
	}
	persisted, err := cloneLocalResolvedAssembly(assembly)
	if err != nil {
		t.Fatal(err)
	}
	capture := persisted.LoadPlan.Text.BehaviorAdapter
	if capture == nil || capture.AdapterID != "synthetic-local-tools" || capture.Version != "1" ||
		capture.RequiredTemplateIdentity != templateIdentity || capture.ProcessIdentityImpact != "adapter_and_template" {
		t.Fatalf("persisted behavior adapter capture = %+v", capture)
	}
	if !slices.Equal(persisted.AdmittedTextBehaviors, []runtimev1.TextBehaviorKind{runtimev1.TextBehaviorKind_TEXT_BEHAVIOR_KIND_TOOL_USE}) {
		t.Fatalf("persisted admitted text behaviors = %v", persisted.AdmittedTextBehaviors)
	}
	service := &Service{capabilityDrivers: capabilitydriver.NewProductionRegistry(), textBehaviorAdapters: []textBehaviorAdapterRegistration{registration}}
	if _, err := service.localTextEffectiveInputsFromResolvedAssembly(persisted); err != nil {
		t.Fatalf("replay exact behavior adapter: %v", err)
	}

	drifted, err := cloneLocalResolvedAssembly(persisted)
	if err != nil {
		t.Fatal(err)
	}
	drifted.LoadPlan.Text.BehaviorAdapter.AdapterID = "synthetic-local-tools-drifted"
	if _, err := service.localTextEffectiveInputsFromResolvedAssembly(drifted); err == nil || !strings.Contains(err.Error(), "load_plan") {
		t.Fatalf("replay adapter identity mismatch was not rejected: %v", err)
	}
}
