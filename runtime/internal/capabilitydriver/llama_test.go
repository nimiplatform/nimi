package capabilitydriver

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

const success = runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED

func TestProductionRegistryReturnsContractScopedResolveReasons(t *testing.T) {
	registry := NewProductionRegistry()
	identity := Identity{ImplementationID: LlamaImplementationID, DriverID: LlamaDriverID, DriverDialect: LlamaDriverDialect}
	if _, reason := registry.Resolve(LlamaCapabilityContract, identity); reason != success {
		t.Fatalf("exact llama identity reason = %v", reason)
	}
	if _, reason := registry.Resolve("image.generate", identity); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_IMPLEMENTATION_UNSUPPORTED {
		t.Fatalf("wrong contract reason = %v", reason)
	}
	stableDiffusionIdentity := Identity{
		ImplementationID: StableDiffusionImplementationID,
		DriverID:         StableDiffusionDriverID,
		DriverDialect:    StableDiffusionDriverDialect,
	}
	if driver, reason := registry.Resolve(StableDiffusionCapabilityContract, stableDiffusionIdentity); reason != success || driver == nil {
		t.Fatalf("exact stable-diffusion identity = driver=%T reason=%v", driver, reason)
	}
	wrongDriver := identity
	wrongDriver.DriverID = "nimi.runtime.driver.other"
	if _, reason := registry.Resolve(LlamaCapabilityContract, wrongDriver); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_NOT_FOUND {
		t.Fatalf("wrong driver reason = %v", reason)
	}
	wrongDialect := identity
	wrongDialect.DriverDialect = "llama.cpp/text-generate/v2"
	if _, reason := registry.Resolve(LlamaCapabilityContract, wrongDialect); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED {
		t.Fatalf("wrong dialect reason = %v", reason)
	}
	wrongImplementation := identity
	wrongImplementation.ImplementationID = "local.text.generate.other"
	if _, reason := registry.Resolve(LlamaCapabilityContract, wrongImplementation); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_IMPLEMENTATION_UNSUPPORTED {
		t.Fatalf("wrong implementation reason = %v", reason)
	}
}

func TestLlamaInterpretTextProjectsOneStableMainRequirement(t *testing.T) {
	requirements, reason := (LlamaTextDriver{}).Interpret(InterpretInput{})
	if reason != success {
		t.Fatalf("interpret text reason = %v", reason)
	}
	if len(requirements) != 1 || requirements[0].GetRequirementId() != MainGGUFRequirementID || requirements[0].GetRole() != runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN {
		t.Fatalf("requirements = %#v", requirements)
	}
	if requirements[0].GetPolicy() != runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE ||
		requirements[0].GetPreferredVerifiedContentId() != "" || requirements[0].GetOccurrenceOrdinal() != 0 || requirements[0].GetDisplayLabel() != "Main model" {
		t.Fatalf("main defaults = %#v", requirements[0])
	}
	constraints := requirements[0].GetCompatibilityConstraints().AsMap()
	if constraints["engine"] != "llama" || constraints["artifact_role"] != "llm" {
		t.Fatalf("main compatibility constraints = %#v", constraints)
	}
	if _, exists := constraints["format"]; exists {
		t.Fatalf("main compatibility constraints contain non-canonical format: %#v", constraints)
	}
}

func TestLlamaInterpretImageProjectsDeterministicMainThenCompanion(t *testing.T) {
	requirements, reason := (LlamaTextDriver{}).Interpret(InterpretInput{SupportedFeatures: []string{inputImageFeature, inputImageFeature}})
	if reason != success {
		t.Fatalf("interpret image reason = %v", reason)
	}
	if len(requirements) != 2 || requirements[0].GetRequirementId() != MainGGUFRequirementID || requirements[1].GetRequirementId() != CompanionMMProjRequirementID {
		t.Fatalf("ordered requirements = %#v", requirements)
	}
	if requirements[1].GetOccurrenceOrdinal() != 0 || requirements[1].GetDisplayLabel() != "Vision projector" {
		t.Fatalf("mmproj occurrence presentation = %#v", requirements[1])
	}
	constraints := requirements[1].GetCompatibilityConstraints().AsMap()
	if _, exists := constraints["engine"]; exists || constraints["artifact_role"] != "mmproj" {
		t.Fatalf("mmproj compatibility constraints = %#v", constraints)
	}
}

func TestLlamaInterpretReturnsPublicReasons(t *testing.T) {
	driver := LlamaTextDriver{}
	_, reason := driver.Interpret(InterpretInput{SupportedFeatures: []string{"input.audio"}})
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED {
		t.Fatalf("unsupported feature reason = %v", reason)
	}
	for _, fields := range []map[string]any{
		{"mainRequirementPolicy": "strict"},
		{"mainRequirementPolicy": true},
		{"mainVerifiedContentId": true},
		{"mainVerifiedContentId": "md5:" + strings.Repeat("a", 64)},
		{"mainVerifiedContentId": "sha256:abcd"},
		{"mainVerifiedContentId": "sha256:" + strings.Repeat("z", 64)},
		{"contextSize": 0},
		{"contextSize": 1.5},
		{"contextSize": "8192"},
		{"contextSize": 1e300},
		{"cacheTypeK": "q5_0"},
		{"cacheTypeV": true},
		{"flashAttention": "true"},
		{"gpuLayers": -2},
		{"gpuLayers": 1.5},
		{"gpuLayers": "all"},
		{"gpuLayers": 1e300},
		{"threads": 8},
		{"modelPath": "/models/main.gguf"},
		{"mmprojPath": "/models/mmproj.gguf"},
	} {
		portable, err := structpb.NewStruct(fields)
		if err != nil {
			t.Fatalf("portable struct: %v", err)
		}
		_, reason = driver.Interpret(InterpretInput{PortableConfig: portable})
		if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID {
			t.Fatalf("fields %#v: reason = %v", fields, reason)
		}
	}
}

func TestLlamaInterpretAcceptsTypedExecutionOptionsWithoutModelPins(t *testing.T) {
	portable, err := structpb.NewStruct(map[string]any{
		"contextSize":    8192,
		"cacheTypeK":     "q8_0",
		"cacheTypeV":     "f16",
		"flashAttention": true,
		"gpuLayers":      -1,
	})
	if err != nil {
		t.Fatal(err)
	}
	requirements, reason := (LlamaTextDriver{}).Interpret(InterpretInput{PortableConfig: portable, SupportedFeatures: []string{inputImageFeature}})
	if reason != success {
		t.Fatalf("interpret reason = %v", reason)
	}
	for _, requirement := range requirements {
		if requirement.GetPolicy() != runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE || requirement.GetPreferredVerifiedContentId() != "" {
			t.Fatalf("model pin entered projected requirement: %#v", requirement)
		}
	}
}

func TestLlamaValidateCombinationReturnsPublicReasons(t *testing.T) {
	driver := LlamaTextDriver{}
	mainContentID := "sha256:" + strings.Repeat("a", 64)
	portable, err := structpb.NewStruct(map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	requirements, reason := driver.Interpret(InterpretInput{PortableConfig: portable})
	if reason != success {
		t.Fatalf("interpret reason = %v", reason)
	}
	binding := &runtimev1.ModelAssetExactBinding{RequirementId: MainGGUFRequirementID, ModelAssetId: "asset-main", VerifiedContentId: mainContentID, EntrySha256: "sha-main"}
	asset := ModelAssetDescriptor{ModelAssetID: "asset-main", VerifiedContentID: mainContentID, EntrySHA256: "sha-main", Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT, Engine: "llama", ArtifactRoles: []string{"llm"}}
	if reason := driver.ValidateCombination(requirements, []*runtimev1.ModelAssetExactBinding{binding}, []ModelAssetDescriptor{asset}); reason != success {
		t.Fatalf("valid substitutable binding reason = %v", reason)
	}
	for _, test := range []struct {
		name     string
		want     runtimev1.LocalCapabilityReason
		bindings []*runtimev1.ModelAssetExactBinding
		assets   []ModelAssetDescriptor
	}{
		{name: "missing", want: runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_REQUIRED_BINDING_MISSING, bindings: nil, assets: nil},
		{name: "extra", want: runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS, bindings: []*runtimev1.ModelAssetExactBinding{binding, binding}, assets: []ModelAssetDescriptor{asset, asset}},
		{name: "wrong requirement", want: runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS, bindings: []*runtimev1.ModelAssetExactBinding{{RequirementId: CompanionMMProjRequirementID, ModelAssetId: "asset-main", VerifiedContentId: mainContentID, EntrySha256: "sha-main"}}, assets: []ModelAssetDescriptor{asset}},
		{name: "incompatible role", want: runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE, bindings: []*runtimev1.ModelAssetExactBinding{binding}, assets: []ModelAssetDescriptor{{ModelAssetID: "asset-main", VerifiedContentID: mainContentID, EntrySHA256: "sha-main", Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT, Engine: "llama", ArtifactRoles: []string{"mmproj"}}}},
		{name: "incompatible content", want: runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH, bindings: []*runtimev1.ModelAssetExactBinding{binding}, assets: []ModelAssetDescriptor{{ModelAssetID: "asset-main", VerifiedContentID: "other", EntrySHA256: "sha-main", Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT, Engine: "llama", ArtifactRoles: []string{"llm"}}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			if reason := driver.ValidateCombination(requirements, test.bindings, test.assets); reason != test.want {
				t.Fatalf("reason = %v, want %v", reason, test.want)
			}
		})
	}
}

func TestLlamaValidateCombinationMatchesBindingsByStableID(t *testing.T) {
	driver := LlamaTextDriver{}
	requirements, reason := driver.Interpret(InterpretInput{SupportedFeatures: []string{inputImageFeature}})
	if reason != success {
		t.Fatalf("interpret reason = %v", reason)
	}
	bindings := []*runtimev1.ModelAssetExactBinding{
		{RequirementId: CompanionMMProjRequirementID, ModelAssetId: "projector", VerifiedContentId: "projector-content", EntrySha256: "projector-sha"},
		{RequirementId: MainGGUFRequirementID, ModelAssetId: "model", VerifiedContentId: "model-content", EntrySha256: "model-sha"},
	}
	assets := []ModelAssetDescriptor{
		{ModelAssetID: "projector", VerifiedContentID: "projector-content", EntrySHA256: "projector-sha", Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY, ArtifactRoles: []string{"mmproj"}},
		{ModelAssetID: "model", VerifiedContentID: "model-content", EntrySHA256: "model-sha", Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT, Engine: "llama", ArtifactRoles: []string{"llm"}},
	}
	if reason := driver.ValidateCombination(requirements, bindings, assets); reason != success {
		t.Fatalf("stable ID matched combination reason = %v", reason)
	}
}

func TestLlamaValidateCombinationAllowsOneAssetToSatisfyDistinctOccurrences(t *testing.T) {
	driver := LlamaTextDriver{}
	requirements, reason := driver.Interpret(InterpretInput{SupportedFeatures: []string{inputImageFeature}})
	if reason != success {
		t.Fatalf("interpret reason = %v", reason)
	}
	for _, test := range []struct {
		name     string
		bindings []*runtimev1.ModelAssetExactBinding
		assets   []ModelAssetDescriptor
	}{
		{
			name: "same model asset",
			bindings: []*runtimev1.ModelAssetExactBinding{
				{RequirementId: MainGGUFRequirementID, ModelAssetId: "shared", VerifiedContentId: "model-content", EntrySha256: "model-sha"},
				{RequirementId: CompanionMMProjRequirementID, ModelAssetId: "shared", VerifiedContentId: "projector-content", EntrySha256: "projector-sha"},
			},
			assets: []ModelAssetDescriptor{
				{ModelAssetID: "shared", VerifiedContentID: "model-content", EntrySHA256: "model-sha", Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT, Engine: "llama", ArtifactRoles: []string{"llm"}},
				{ModelAssetID: "shared", VerifiedContentID: "projector-content", EntrySHA256: "projector-sha", Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY, ArtifactRoles: []string{"mmproj"}},
			},
		},
		{
			name: "same verified content",
			bindings: []*runtimev1.ModelAssetExactBinding{
				{RequirementId: MainGGUFRequirementID, ModelAssetId: "model", VerifiedContentId: "shared-content", EntrySha256: "shared-sha"},
				{RequirementId: CompanionMMProjRequirementID, ModelAssetId: "projector", VerifiedContentId: "shared-content", EntrySha256: "shared-sha"},
			},
			assets: []ModelAssetDescriptor{
				{ModelAssetID: "model", VerifiedContentID: "shared-content", EntrySHA256: "shared-sha", Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT, Engine: "llama", ArtifactRoles: []string{"llm"}},
				{ModelAssetID: "projector", VerifiedContentID: "shared-content", EntrySHA256: "shared-sha", Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY, ArtifactRoles: []string{"mmproj"}},
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			if reason := driver.ValidateCombination(requirements, test.bindings, test.assets); reason != success {
				t.Fatalf("reason = %v, want success", reason)
			}
		})
	}
}

func TestLlamaEffectiveRequestDefaultsMatchServerDialect(t *testing.T) {
	defaults := (LlamaTextDriver{}).EffectiveRequestDefaults(LlamaGemma4E2BRecipeID, nil)
	if defaults["temperature"] != "0.8" || defaults["topP"] != "0.95" || defaults["topK"] != "40" || defaults["seed"] != "random" {
		t.Fatalf("effective request defaults = %#v", defaults)
	}
}

func TestLlamaInvocationPlanUsesExactTextBindingAndPortableOptions(t *testing.T) {
	portable, err := structpb.NewStruct(map[string]any{
		"contextSize":    8192,
		"cacheTypeK":     "q8_0",
		"cacheTypeV":     "f16",
		"flashAttention": true,
		"gpuLayers":      -1,
	})
	if err != nil {
		t.Fatal(err)
	}
	mainPath := filepath.Join(t.TempDir(), "main.gguf")
	plan, err := (LlamaTextDriver{}).PlanTextInvocation(TextInvocationInput{
		PortableConfig:           portable,
		ModelContextWindowTokens: 32768,
		ExactBindings: []InvocationExactBinding{{
			RequirementID: MainGGUFRequirementID, ModelAssetID: "main", AbsolutePath: mainPath,
			VerifiedContentID: "sha256:" + strings.Repeat("a", 64), EntrySHA256: strings.Repeat("b", 64),
		}},
		Request: &runtimev1.TextGenerateScenarioSpec{
			Input:       []*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
			Temperature: testFloat32(0.7),
			TopP:        testFloat32(0.9),
			TopK:        testInt32(40),
			MaxTokens:   testInt32(128),
		},
	})
	if err != nil {
		t.Fatalf("PlanTextInvocation: %v", err)
	}
	args := strings.Join(plan.ProcessArgs(), " ")
	for _, expected := range []string{
		"--model " + mainPath,
		"--ctx-size 8192",
		"--cache-type-k q8_0",
		"--cache-type-v f16",
		"--flash-attn on",
		"--n-gpu-layers -1",
	} {
		if !strings.Contains(args, expected) {
			t.Fatalf("process args %q do not contain %q", args, expected)
		}
	}
	if strings.Contains(args, "--mmproj") {
		t.Fatalf("text-only invocation unexpectedly contains mmproj: %s", args)
	}
	mutableArgs := plan.ProcessArgs()
	mutableArgs[0] = "mutated"
	mutableBody := plan.RequestBody()
	mutableBody[0] = 'x'
	if plan.ProcessArgs()[0] == "mutated" || plan.RequestBody()[0] == 'x' {
		t.Fatal("captured invocation plan accessors exposed mutable storage")
	}
	var body map[string]any
	if err := json.Unmarshal(plan.RequestBody(), &body); err != nil {
		t.Fatalf("decode request body: %v", err)
	}
	if body["model"] != "nimi-selected-local" || body["stream"] != false || body["top_k"] != float64(40) {
		t.Fatalf("request body = %#v", body)
	}
}

func TestLlamaInvocationPlanRequiresAndUsesExactMMProjForImage(t *testing.T) {
	root := t.TempDir()
	mainPath := filepath.Join(root, "main.gguf")
	mmprojPath := filepath.Join(root, "mmproj.gguf")
	request := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{
		Role: "user",
		Parts: []*runtimev1.ChatContentPart{
			{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT, Content: &runtimev1.ChatContentPart_Text{Text: "describe"}},
			{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL, Content: &runtimev1.ChatContentPart_ImageUrl{ImageUrl: &runtimev1.ChatContentImageURL{Url: "/tmp/input.png"}}},
		},
	}}}
	main := InvocationExactBinding{
		RequirementID: MainGGUFRequirementID, ModelAssetID: "main", AbsolutePath: mainPath,
		VerifiedContentID: "sha256:" + strings.Repeat("a", 64), EntrySHA256: strings.Repeat("b", 64),
	}
	if _, err := (LlamaTextDriver{}).PlanTextInvocation(TextInvocationInput{ExactBindings: []InvocationExactBinding{main}, Request: request}); err == nil {
		t.Fatal("image invocation without configured mmproj must fail closed")
	}
	plan, err := (LlamaTextDriver{}).PlanTextInvocation(TextInvocationInput{
		ModelContextWindowTokens: 32768,
		ExactBindings: []InvocationExactBinding{main, {
			RequirementID: CompanionMMProjRequirementID, ModelAssetID: "mmproj", AbsolutePath: mmprojPath,
			VerifiedContentID: "sha256:" + strings.Repeat("c", 64), EntrySHA256: strings.Repeat("d", 64),
		}},
		Request: request,
		Stream:  true,
	})
	if err != nil {
		t.Fatalf("PlanTextInvocation(image): %v", err)
	}
	if args := strings.Join(plan.ProcessArgs(), " "); !strings.Contains(args, "--mmproj "+mmprojPath) {
		t.Fatalf("process args = %q", args)
	}
	if !plan.Stream() {
		t.Fatal("stream invocation did not retain request mode")
	}
}

func TestLlamaTextContextWindowUsesModelAuthoredCapacityUnlessFixed(t *testing.T) {
	driver := LlamaTextDriver{}
	if got, err := driver.TextContextWindow(nil, 32768); err != nil || got != 32768 {
		t.Fatalf("automatic context window = (%d, %v), want (32768, nil)", got, err)
	}
	fixed, err := structpb.NewStruct(map[string]any{"contextSize": 8192})
	if err != nil {
		t.Fatal(err)
	}
	if got, err := driver.TextContextWindow(fixed, 32768); err != nil || got != 8192 {
		t.Fatalf("fixed context window = (%d, %v), want (8192, nil)", got, err)
	}
	if _, err := driver.TextContextWindow(fixed, 4096); err == nil {
		t.Fatal("fixed context window above model-authored capacity must fail closed")
	}
	if _, err := driver.TextContextWindow(nil, 0); err == nil {
		t.Fatal("missing model-authored context capacity must fail closed")
	}
}

func TestLlamaValidateBindingAllowsCompatibleSubstituteOnly(t *testing.T) {
	requirements, reason := (LlamaTextDriver{}).Interpret(InterpretInput{})
	if reason != success {
		t.Fatalf("interpret reason = %v", reason)
	}
	binding := &runtimev1.ModelAssetExactBinding{RequirementId: MainGGUFRequirementID, ModelAssetId: "asset", VerifiedContentId: "other-content", EntrySha256: "sha"}
	asset := ModelAssetDescriptor{ModelAssetID: "asset", VerifiedContentID: "other-content", EntrySHA256: "sha", Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT, Engine: "llama", ArtifactRoles: []string{"llm"}}
	if reason := (LlamaTextDriver{}).ValidateBinding(requirements[0], binding, asset); reason != success {
		t.Fatalf("compatible substitute reason = %v", reason)
	}
	asset.Engine = "other"
	if reason := (LlamaTextDriver{}).ValidateBinding(requirements[0], binding, asset); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
		t.Fatalf("incompatible substitute reason = %v", reason)
	}
}

func TestLlamaValidateBindingAcceptsEngineIndependentPassiveMMProj(t *testing.T) {
	requirements, reason := (LlamaTextDriver{}).Interpret(InterpretInput{SupportedFeatures: []string{inputImageFeature}})
	if reason != success {
		t.Fatalf("interpret reason = %v", reason)
	}
	requirement := requirements[1]
	binding := &runtimev1.ModelAssetExactBinding{
		RequirementId:     CompanionMMProjRequirementID,
		ModelAssetId:      "projector",
		VerifiedContentId: "projector-content",
		EntrySha256:       "projector-sha",
	}
	asset := ModelAssetDescriptor{
		ModelAssetID:      "projector",
		VerifiedContentID: "projector-content",
		EntrySHA256:       "projector-sha",
		Kind:              runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY,
		ArtifactRoles:     []string{"mmproj"},
	}
	if reason := (LlamaTextDriver{}).ValidateBinding(requirement, binding, asset); reason != success {
		t.Fatalf("engine-independent mmproj reason = %v", reason)
	}
	asset.Kind = runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT
	if reason := (LlamaTextDriver{}).ValidateBinding(requirement, binding, asset); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
		t.Fatalf("runnable mmproj kind reason = %v", reason)
	}
}
