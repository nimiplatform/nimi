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
	if requirements[0].GetPolicy() != runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE || requirements[0].GetPreferredVerifiedContentId() != "" {
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
	constraints := requirements[1].GetCompatibilityConstraints().AsMap()
	if constraints["engine"] != "llama" || constraints["artifact_role"] != "mmproj" {
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

func TestLlamaInterpretAcceptsTypedExecutionOptionsAndNormalizesContentIDs(t *testing.T) {
	mainUpper := "sha256:" + strings.Repeat("A", 64)
	mmprojUpper := "sha256:" + strings.Repeat("B", 64)
	portable, err := structpb.NewStruct(map[string]any{
		"mainRequirementPolicy":   "strict",
		"mainVerifiedContentId":   mainUpper,
		"mmprojRequirementPolicy": "substitutable",
		"mmprojVerifiedContentId": mmprojUpper,
		"contextSize":             8192,
		"cacheTypeK":              "q8_0",
		"cacheTypeV":              "f16",
		"flashAttention":          true,
		"gpuLayers":               -1,
	})
	if err != nil {
		t.Fatal(err)
	}
	requirements, reason := (LlamaTextDriver{}).Interpret(InterpretInput{PortableConfig: portable, SupportedFeatures: []string{inputImageFeature}})
	if reason != success {
		t.Fatalf("interpret reason = %v", reason)
	}
	if got := requirements[0].GetPreferredVerifiedContentId(); got != strings.ToLower(mainUpper) {
		t.Fatalf("normalized main identity = %q", got)
	}
	if got := requirements[1].GetPreferredVerifiedContentId(); got != strings.ToLower(mmprojUpper) {
		t.Fatalf("normalized mmproj identity = %q", got)
	}
}

func TestLlamaValidateCombinationReturnsPublicReasons(t *testing.T) {
	driver := LlamaTextDriver{}
	mainContentID := "sha256:" + strings.Repeat("a", 64)
	portable, err := structpb.NewStruct(map[string]any{"mainRequirementPolicy": "strict", "mainVerifiedContentId": mainContentID})
	if err != nil {
		t.Fatal(err)
	}
	requirements, reason := driver.Interpret(InterpretInput{PortableConfig: portable})
	if reason != success {
		t.Fatalf("interpret reason = %v", reason)
	}
	binding := &runtimev1.LocalAssetExactBinding{RequirementId: MainGGUFRequirementID, LocalAssetId: "asset-main", VerifiedContentId: mainContentID, EntrySha256: "sha-main"}
	asset := AssetDescriptor{LocalAssetID: "asset-main", VerifiedContentID: mainContentID, EntrySHA256: "sha-main", Engine: "llama", ArtifactRoles: []string{"llm"}}
	if reason := driver.ValidateCombination(requirements, []*runtimev1.LocalAssetExactBinding{binding}, []AssetDescriptor{asset}); reason != success {
		t.Fatalf("valid strict binding reason = %v", reason)
	}
	for _, test := range []struct {
		name     string
		want     runtimev1.LocalCapabilityReason
		bindings []*runtimev1.LocalAssetExactBinding
		assets   []AssetDescriptor
	}{
		{name: "missing", want: runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_REQUIRED_BINDING_MISSING, bindings: nil, assets: nil},
		{name: "extra", want: runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS, bindings: []*runtimev1.LocalAssetExactBinding{binding, binding}, assets: []AssetDescriptor{asset, asset}},
		{name: "wrong requirement", want: runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS, bindings: []*runtimev1.LocalAssetExactBinding{{RequirementId: CompanionMMProjRequirementID, LocalAssetId: "asset-main", VerifiedContentId: mainContentID, EntrySha256: "sha-main"}}, assets: []AssetDescriptor{asset}},
		{name: "incompatible role", want: runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE, bindings: []*runtimev1.LocalAssetExactBinding{binding}, assets: []AssetDescriptor{{LocalAssetID: "asset-main", VerifiedContentID: mainContentID, EntrySHA256: "sha-main", Engine: "llama", ArtifactRoles: []string{"mmproj"}}}},
		{name: "incompatible content", want: runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH, bindings: []*runtimev1.LocalAssetExactBinding{binding}, assets: []AssetDescriptor{{LocalAssetID: "asset-main", VerifiedContentID: "other", EntrySHA256: "sha-main", Engine: "llama", ArtifactRoles: []string{"llm"}}}},
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
	bindings := []*runtimev1.LocalAssetExactBinding{
		{RequirementId: CompanionMMProjRequirementID, LocalAssetId: "projector", VerifiedContentId: "projector-content", EntrySha256: "projector-sha"},
		{RequirementId: MainGGUFRequirementID, LocalAssetId: "model", VerifiedContentId: "model-content", EntrySha256: "model-sha"},
	}
	assets := []AssetDescriptor{
		{LocalAssetID: "projector", VerifiedContentID: "projector-content", EntrySHA256: "projector-sha", Engine: "llama", ArtifactRoles: []string{"mmproj"}},
		{LocalAssetID: "model", VerifiedContentID: "model-content", EntrySHA256: "model-sha", Engine: "llama", ArtifactRoles: []string{"llm"}},
	}
	if reason := driver.ValidateCombination(requirements, bindings, assets); reason != success {
		t.Fatalf("stable ID matched combination reason = %v", reason)
	}
}

func TestLlamaValidateCombinationRejectsReusedOccurrenceIdentity(t *testing.T) {
	driver := LlamaTextDriver{}
	requirements, reason := driver.Interpret(InterpretInput{SupportedFeatures: []string{inputImageFeature}})
	if reason != success {
		t.Fatalf("interpret reason = %v", reason)
	}
	for _, test := range []struct {
		name     string
		bindings []*runtimev1.LocalAssetExactBinding
		assets   []AssetDescriptor
	}{
		{
			name: "same local asset",
			bindings: []*runtimev1.LocalAssetExactBinding{
				{RequirementId: MainGGUFRequirementID, LocalAssetId: "shared", VerifiedContentId: "model-content", EntrySha256: "model-sha"},
				{RequirementId: CompanionMMProjRequirementID, LocalAssetId: "shared", VerifiedContentId: "projector-content", EntrySha256: "projector-sha"},
			},
			assets: []AssetDescriptor{
				{LocalAssetID: "shared", VerifiedContentID: "model-content", EntrySHA256: "model-sha", Engine: "llama", ArtifactRoles: []string{"llm"}},
				{LocalAssetID: "shared", VerifiedContentID: "projector-content", EntrySHA256: "projector-sha", Engine: "llama", ArtifactRoles: []string{"mmproj"}},
			},
		},
		{
			name: "same verified content",
			bindings: []*runtimev1.LocalAssetExactBinding{
				{RequirementId: MainGGUFRequirementID, LocalAssetId: "model", VerifiedContentId: "shared-content", EntrySha256: "shared-sha"},
				{RequirementId: CompanionMMProjRequirementID, LocalAssetId: "projector", VerifiedContentId: "shared-content", EntrySha256: "shared-sha"},
			},
			assets: []AssetDescriptor{
				{LocalAssetID: "model", VerifiedContentID: "shared-content", EntrySHA256: "shared-sha", Engine: "llama", ArtifactRoles: []string{"llm"}},
				{LocalAssetID: "projector", VerifiedContentID: "shared-content", EntrySHA256: "shared-sha", Engine: "llama", ArtifactRoles: []string{"mmproj"}},
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			if reason := driver.ValidateCombination(requirements, test.bindings, test.assets); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS {
				t.Fatalf("reason = %v, want binding ambiguous", reason)
			}
		})
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
		PortableConfig: portable,
		ExactBindings: []InvocationExactBinding{{
			RequirementID: MainGGUFRequirementID, LocalAssetID: "main", AbsolutePath: mainPath,
			VerifiedContentID: "sha256:" + strings.Repeat("a", 64), EntrySHA256: strings.Repeat("b", 64),
		}},
		Request: &runtimev1.TextGenerateScenarioSpec{
			Input:       []*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
			Temperature: 0.7,
			TopP:        0.9,
			TopK:        40,
			MaxTokens:   128,
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
		RequirementID: MainGGUFRequirementID, LocalAssetID: "main", AbsolutePath: mainPath,
		VerifiedContentID: "sha256:" + strings.Repeat("a", 64), EntrySHA256: strings.Repeat("b", 64),
	}
	if _, err := (LlamaTextDriver{}).PlanTextInvocation(TextInvocationInput{ExactBindings: []InvocationExactBinding{main}, Request: request}); err == nil {
		t.Fatal("image invocation without configured mmproj must fail closed")
	}
	plan, err := (LlamaTextDriver{}).PlanTextInvocation(TextInvocationInput{
		ExactBindings: []InvocationExactBinding{main, {
			RequirementID: CompanionMMProjRequirementID, LocalAssetID: "mmproj", AbsolutePath: mmprojPath,
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

func TestLlamaValidateBindingAllowsCompatibleSubstituteOnly(t *testing.T) {
	requirements, reason := (LlamaTextDriver{}).Interpret(InterpretInput{})
	if reason != success {
		t.Fatalf("interpret reason = %v", reason)
	}
	binding := &runtimev1.LocalAssetExactBinding{RequirementId: MainGGUFRequirementID, LocalAssetId: "asset", VerifiedContentId: "other-content", EntrySha256: "sha"}
	asset := AssetDescriptor{LocalAssetID: "asset", VerifiedContentID: "other-content", EntrySHA256: "sha", Engine: "llama", ArtifactRoles: []string{"llm"}}
	if reason := (LlamaTextDriver{}).ValidateBinding(requirements[0], binding, asset); reason != success {
		t.Fatalf("compatible substitute reason = %v", reason)
	}
	asset.Engine = "other"
	if reason := (LlamaTextDriver{}).ValidateBinding(requirements[0], binding, asset); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
		t.Fatalf("incompatible substitute reason = %v", reason)
	}
}
