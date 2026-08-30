package capabilitydriver

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/proto"
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
	wrongDialect.DriverDialect = "llama.cpp/text-generate/v1"
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
	if requirements[0].GetPresence() != runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED ||
		requirements[1].GetPresence() != runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_OPTIONAL_CONDITIONAL ||
		!slices.Equal(requirements[1].GetConditionalFeatures(), []string{inputImageFeature}) {
		t.Fatalf("llama conditional slot presence = %#v", requirements)
	}
	if requirements[1].GetOccurrenceOrdinal() != 0 || requirements[1].GetDisplayLabel() != "Vision projector" {
		t.Fatalf("mmproj occurrence presentation = %#v", requirements[1])
	}
	constraints := requirements[1].GetCompatibilityConstraints().AsMap()
	if _, exists := constraints["engine"]; exists || constraints["artifact_role"] != "mmproj" {
		t.Fatalf("mmproj compatibility constraints = %#v", constraints)
	}
}

func TestLlamaProductionRecipePublishesConditionalImageAndRetiresV1Recipes(t *testing.T) {
	driver := LlamaTextDriver{}
	features, reason := driver.ImplementationSupportedFeatures(LlamaGemma4RecipeID)
	if reason != success || !slices.Equal(features, []string{inputImageFeature}) {
		t.Fatalf("production recipe feature declaration = %v reason=%v", features, reason)
	}
	for _, retiredRecipeID := range []string{
		"llama.text-generate.gemma-4-e2b-it.v1",
		"llama.text-generate.gemma-4-26b-a4b-it.v1",
	} {
		if _, retiredReason := driver.ImplementationSupportedFeatures(retiredRecipeID); retiredReason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED {
			t.Fatalf("retired recipe %q reason = %v", retiredRecipeID, retiredReason)
		}
	}
}

func TestLlamaGemma4FormatProbeBudgetIsScopedToTheExactMainEntry(t *testing.T) {
	driver := LlamaTextDriver{}
	for _, test := range []struct {
		name  string
		input ModelAssetFormatProbeInput
		want  int64
	}{
		{
			name: "Gemma v2 main entry",
			input: ModelAssetFormatProbeInput{
				RecipeID: LlamaGemma4RecipeID, RequirementID: MainGGUFRequirementID,
				RelativePath: "model.gguf", Entry: true,
			},
			want: MaxDriverAssetFormatProbeBytes,
		},
		{
			name: "projector entry",
			input: ModelAssetFormatProbeInput{
				RecipeID: LlamaGemma4RecipeID, RequirementID: CompanionMMProjRequirementID,
				RelativePath: "mmproj.gguf", Entry: true,
			},
			want: MaxAssetFormatProbeBytes,
		},
		{
			name: "non-entry file",
			input: ModelAssetFormatProbeInput{
				RecipeID: LlamaGemma4RecipeID, RequirementID: MainGGUFRequirementID,
				RelativePath: "tokenizer.gguf", Entry: false,
			},
			want: MaxAssetFormatProbeBytes,
		},
		{
			name: "retired recipe",
			input: ModelAssetFormatProbeInput{
				RecipeID: "llama.text-generate.gemma-4-e2b-it.v1", RequirementID: MainGGUFRequirementID,
				RelativePath: "model.gguf", Entry: true,
			},
			want: MaxAssetFormatProbeBytes,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := driver.ModelAssetFormatProbeBytes(test.input); got != test.want {
				t.Fatalf("probe budget = %d, want %d", got, test.want)
			}
		})
	}
}

func TestLlamaGemma4BindingCapturesTemplateBeyondGenericProbePrefix(t *testing.T) {
	template := "{{ messages }}"
	probe := llamaGGUFProbeWithPaddingForTest(t, template, MaxAssetFormatProbeBytes+128)
	if len(probe) <= MaxAssetFormatProbeBytes || len(probe) > MaxDriverAssetFormatProbeBytes {
		t.Fatalf("test probe length = %d", len(probe))
	}
	driver := LlamaTextDriver{}
	requirements, reason := driver.ProjectRecipe(LlamaGemma4RecipeID, nil, nil)
	if reason != success || len(requirements) != 1 {
		t.Fatalf("ProjectRecipe = requirements=%d reason=%v", len(requirements), reason)
	}
	binding := &runtimev1.ModelAssetExactBinding{
		RequirementId: MainGGUFRequirementID, ModelAssetId: "gemma",
		VerifiedContentId: "sha256:" + strings.Repeat("a", 64), EntrySha256: strings.Repeat("b", 64),
	}
	projection, gotReason := driver.ProjectModelAssetBinding(ModelAssetBindingInput{
		RecipeID: LlamaGemma4RecipeID, Requirement: requirements[0], Binding: binding,
		Entry: ModelAssetFileFact{RelativePath: "model.gguf", SizeBytes: int64(len(probe)), FormatProbe: probe},
	})
	if gotReason != success || projection.TemplateIdentity != "sha256:f24189f08c85a1eb19a737306c3a13e85462ee33d964f28108d64a2485fa2171" {
		t.Fatalf("template identity = %q reason=%v", projection.TemplateIdentity, gotReason)
	}
}

func TestLlamaBindingProjectionCarriesExactOptionalChatTemplateIdentity(t *testing.T) {
	driver := LlamaTextDriver{}
	requirements, reason := driver.ProjectRecipe(LlamaGemma4RecipeID, nil, nil)
	if reason != success || len(requirements) != 1 {
		t.Fatalf("ProjectRecipe = requirements=%d reason=%v", len(requirements), reason)
	}
	binding := &runtimev1.ModelAssetExactBinding{
		RequirementId: MainGGUFRequirementID, ModelAssetId: "gemma", VerifiedContentId: "sha256:" + strings.Repeat("a", 64), EntrySha256: strings.Repeat("b", 64),
	}
	for _, test := range []struct {
		name     string
		template *string
		want     string
	}{
		{name: "present", template: testString("{{ messages }}"), want: "sha256:f24189f08c85a1eb19a737306c3a13e85462ee33d964f28108d64a2485fa2171"},
		{name: "missing"},
	} {
		t.Run(test.name, func(t *testing.T) {
			probe := llamaGGUFProbeForTest(t, test.template)
			projection, gotReason := driver.ProjectModelAssetBinding(ModelAssetBindingInput{
				RecipeID: LlamaGemma4RecipeID, Requirement: requirements[0], Binding: binding,
				Entry: ModelAssetFileFact{RelativePath: "model.gguf", SizeBytes: int64(len(probe)), FormatProbe: probe},
			})
			if gotReason != success || projection.TemplateIdentity != test.want || projection.ModelContextWindowTokens != 262144 {
				t.Fatalf("projection = %+v reason=%v", projection, gotReason)
			}
		})
	}
}

func llamaGGUFProbeForTest(t *testing.T, template *string) []byte {
	t.Helper()
	entries := 2
	if template != nil {
		entries++
	}
	var buffer bytes.Buffer
	buffer.WriteString("GGUF")
	for _, value := range []any{uint32(3), uint64(0), uint64(entries)} {
		if err := binary.Write(&buffer, binary.LittleEndian, value); err != nil {
			t.Fatal(err)
		}
	}
	writeString := func(value string) {
		t.Helper()
		if err := binary.Write(&buffer, binary.LittleEndian, uint64(len(value))); err != nil {
			t.Fatal(err)
		}
		buffer.WriteString(value)
	}
	writeString("general.architecture")
	_ = binary.Write(&buffer, binary.LittleEndian, uint32(8))
	writeString("gemma4")
	writeString("gemma4.context_length")
	_ = binary.Write(&buffer, binary.LittleEndian, uint32(4))
	_ = binary.Write(&buffer, binary.LittleEndian, uint32(262144))
	if template != nil {
		writeString("tokenizer.chat_template")
		_ = binary.Write(&buffer, binary.LittleEndian, uint32(8))
		writeString(*template)
	}
	return buffer.Bytes()
}

func llamaGGUFProbeWithPaddingForTest(t *testing.T, template string, paddingBytes int) []byte {
	t.Helper()
	var buffer bytes.Buffer
	buffer.WriteString("GGUF")
	for _, value := range []any{uint32(3), uint64(0), uint64(4)} {
		if err := binary.Write(&buffer, binary.LittleEndian, value); err != nil {
			t.Fatal(err)
		}
	}
	writeString := func(value string) {
		if err := binary.Write(&buffer, binary.LittleEndian, uint64(len(value))); err != nil {
			t.Fatal(err)
		}
		buffer.WriteString(value)
	}
	writeString("general.architecture")
	_ = binary.Write(&buffer, binary.LittleEndian, uint32(8))
	writeString("gemma4")
	writeString("gemma4.context_length")
	_ = binary.Write(&buffer, binary.LittleEndian, uint32(4))
	_ = binary.Write(&buffer, binary.LittleEndian, uint32(262144))
	writeString("test.padding")
	_ = binary.Write(&buffer, binary.LittleEndian, uint32(9))
	_ = binary.Write(&buffer, binary.LittleEndian, uint32(8))
	const paddingStringBytes = 1024
	paddingValues := (paddingBytes + paddingStringBytes - 1) / paddingStringBytes
	if err := binary.Write(&buffer, binary.LittleEndian, uint64(paddingValues)); err != nil {
		t.Fatal(err)
	}
	padding := strings.Repeat("x", paddingStringBytes)
	for index := 0; index < paddingValues; index++ {
		writeString(padding)
	}
	writeString("tokenizer.chat_template")
	_ = binary.Write(&buffer, binary.LittleEndian, uint32(8))
	writeString(template)
	return buffer.Bytes()
}

func testString(value string) *string { return &value }

func TestLlamaValidateCombinationAllowsAbsentOptionalProjector(t *testing.T) {
	driver := LlamaTextDriver{}
	requirements, reason := driver.Interpret(InterpretInput{SupportedFeatures: []string{inputImageFeature}})
	if reason != success {
		t.Fatalf("interpret conditional image = %v", reason)
	}
	bindings := []*runtimev1.ModelAssetExactBinding{{
		RequirementId: MainGGUFRequirementID, ModelAssetId: "model", VerifiedContentId: "model-content", EntrySha256: "model-sha",
	}}
	assets := []ModelAssetDescriptor{{
		ModelAssetID: "model", VerifiedContentID: "model-content", EntrySHA256: "model-sha",
		Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT, Engine: "llama", ArtifactRoles: []string{"llm"},
	}}
	if reason := driver.ValidateCombination(requirements, bindings, assets); reason != success {
		t.Fatalf("absent optional projector combination = %v", reason)
	}
}

func TestGemma4ProductionRecipeOwnsConditionalProjectorPairingAndBehaviorProjection(t *testing.T) {
	driver := LlamaTextDriver{}
	features, reason := driver.ImplementationSupportedFeatures(LlamaGemma4RecipeID)
	if reason != success || len(features) != 1 || features[0] != inputImageFeature {
		t.Fatalf("Gemma 4 production features = %#v reason=%v", features, reason)
	}
	requirements, reason := driver.ProjectRecipe(LlamaGemma4RecipeID, nil, features)
	if reason != success || len(requirements) != 2 ||
		requirements[1].GetPresence() != runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_OPTIONAL_CONDITIONAL ||
		requirements[1].GetConditionalFeatures()[0] != inputImageFeature {
		t.Fatalf("Gemma 4 production requirements = %#v reason=%v", requirements, reason)
	}
	entry := Gemma4BehaviorCohort()[1]
	mainBinding := &runtimev1.ModelAssetExactBinding{
		RequirementId: MainGGUFRequirementID, ModelAssetId: "main", VerifiedContentId: entry.ContentID, EntrySha256: entry.EntrySHA256,
	}
	mainAsset := ModelAssetDescriptor{
		ModelAssetID: "main", VerifiedContentID: entry.ContentID, EntrySHA256: entry.EntrySHA256,
		Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT, Engine: "llama", ArtifactRoles: []string{"llm"},
	}
	if reason := driver.ValidateCombination(requirements, []*runtimev1.ModelAssetExactBinding{mainBinding}, []ModelAssetDescriptor{mainAsset}); reason != success {
		t.Fatalf("text-only Gemma 4 combination = %v", reason)
	}
	projectorSHA := strings.TrimPrefix(entry.ProjectorContentID, "sha256:")
	projectorBinding := &runtimev1.ModelAssetExactBinding{
		RequirementId: CompanionMMProjRequirementID, ModelAssetId: "projector", VerifiedContentId: entry.ProjectorContentID, EntrySha256: projectorSHA,
	}
	projectorAsset := ModelAssetDescriptor{
		ModelAssetID: "projector", VerifiedContentID: entry.ProjectorContentID, EntrySHA256: projectorSHA,
		Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY, ArtifactRoles: []string{"mmproj"},
	}
	if reason := driver.ValidateCombination(requirements, []*runtimev1.ModelAssetExactBinding{mainBinding, projectorBinding}, []ModelAssetDescriptor{mainAsset, projectorAsset}); reason != success {
		t.Fatalf("paired Gemma 4 projector combination = %v", reason)
	}
	wrongProjector := proto.Clone(projectorBinding).(*runtimev1.ModelAssetExactBinding)
	wrongProjector.VerifiedContentId = Gemma426BProjectorContentID
	wrongProjector.EntrySha256 = strings.TrimPrefix(Gemma426BProjectorContentID, "sha256:")
	wrongAsset := projectorAsset
	wrongAsset.VerifiedContentID, wrongAsset.EntrySHA256 = wrongProjector.GetVerifiedContentId(), wrongProjector.GetEntrySha256()
	if reason := driver.ValidateCombination(requirements, []*runtimev1.ModelAssetExactBinding{mainBinding, wrongProjector}, []ModelAssetDescriptor{mainAsset, wrongAsset}); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
		t.Fatalf("mismatched Gemma 4 projector reason = %v", reason)
	}
	configured, reason := driver.TextBehaviorCapabilitiesForBindings(LlamaGemma4RecipeID, []TextBehaviorBindingFacts{{
		RequirementID: MainGGUFRequirementID, VerifiedContentID: entry.ContentID,
		EntrySHA256: entry.EntrySHA256, TemplateIdentity: entry.TemplateIdentity,
	}})
	if reason != success || len(configured) != 3 {
		t.Fatalf("configured Gemma 4 behaviors = %#v reason=%v", configured, reason)
	}
	for _, behavior := range configured {
		if !behavior.GetImplementationSupported() || behavior.GetConfigurationState() != runtimev1.TextBehaviorConfigurationState_TEXT_BEHAVIOR_CONFIGURATION_STATE_CONFIGURED || len(behavior.GetReasons()) != 0 {
			t.Fatalf("configured Gemma 4 behavior = %#v", behavior)
		}
	}
	wrongTemplate := entry
	wrongTemplate.TemplateIdentity = "sha256:" + strings.Repeat("f", 64)
	unavailable, _ := driver.TextBehaviorCapabilitiesForBindings(LlamaGemma4RecipeID, []TextBehaviorBindingFacts{{
		RequirementID: MainGGUFRequirementID, VerifiedContentID: wrongTemplate.ContentID,
		EntrySHA256: wrongTemplate.EntrySHA256, TemplateIdentity: wrongTemplate.TemplateIdentity,
	}})
	if unavailable[0].GetConfigurationState() != runtimev1.TextBehaviorConfigurationState_TEXT_BEHAVIOR_CONFIGURATION_STATE_UNAVAILABLE {
		t.Fatalf("wrong-template behavior projection = %#v", unavailable)
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
	defaults := (LlamaTextDriver{}).EffectiveRequestDefaults(LlamaGemma4RecipeID, nil)
	if defaults["temperature"] != "0.8" || defaults["topP"] != "0.95" || defaults["topK"] != "40" || defaults["seed"] != "random" {
		t.Fatalf("effective request defaults = %#v", defaults)
	}
}

func TestLlamaTextRequestBodyPreservesOptionalScalarPresence(t *testing.T) {
	optionalKeys := []string{
		"temperature",
		"top_p",
		"max_tokens",
		"top_k",
		"presence_penalty",
		"frequency_penalty",
		"seed",
	}
	for _, stream := range []bool{false, true} {
		name := "sync"
		if stream {
			name = "stream"
		}
		t.Run(name, func(t *testing.T) {
			input := []*runtimev1.ChatMessage{{Role: "user", Content: "hello"}}
			for testName, spec := range map[string]*runtimev1.TextGenerateScenarioSpec{
				"omitted": {Input: input},
				"explicit zero": {
					Input:       input,
					Temperature: testFloat32(0), TopP: testFloat32(0), MaxTokens: testInt32(0), TopK: testInt32(0),
					PresencePenalty: testFloat32(0), FrequencyPenalty: testFloat32(0), Seed: testInt64(0),
				},
			} {
				t.Run(testName, func(t *testing.T) {
					payload, err := llamaTextRequestBody(spec, stream, false)
					if err != nil {
						t.Fatalf("llamaTextRequestBody: %v", err)
					}
					var body map[string]any
					if err := json.Unmarshal(payload, &body); err != nil {
						t.Fatalf("decode request body: %v", err)
					}
					wantPresent := testName == "explicit zero"
					for _, key := range optionalKeys {
						value, present := body[key]
						if present != wantPresent {
							t.Fatalf("field %q presence = %t, want %t; body=%#v", key, present, wantPresent, body)
						}
						if present && value != float64(0) {
							t.Fatalf("field %q value = %#v, want explicit zero", key, value)
						}
					}
				})
			}
		})
	}
}

func TestLlamaReasoningConfigFailsClosedWithoutBehaviorAdapter(t *testing.T) {
	request := func(reasoning *runtimev1.ReasoningConfig) *runtimev1.TextGenerateScenarioSpec {
		return &runtimev1.TextGenerateScenarioSpec{
			Input:     []*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
			Reasoning: reasoning,
		}
	}
	for _, reasoning := range []*runtimev1.ReasoningConfig{
		nil,
		{},
		{
			Activation:   runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED,
			Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN,
		},
	} {
		if _, err := llamaTextRequestBody(request(reasoning), false, false); err != nil {
			t.Fatalf("disabled/omitted reasoning failed: %v", err)
		}
	}

	tests := []struct {
		name      string
		reasoning *runtimev1.ReasoningConfig
		want      InvocationFailureKind
	}{
		{
			name: "disabled summary is invalid algebra",
			reasoning: &runtimev1.ReasoningConfig{
				Activation:   runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED,
				Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY,
			},
			want: InvocationFailureInvalidRequest,
		},
		{
			name: "adaptive requires intensity",
			reasoning: &runtimev1.ReasoningConfig{
				Activation:   runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE,
				Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN,
			},
			want: InvocationFailureInvalidRequest,
		},
		{
			name: "zero exact budget is invalid",
			reasoning: &runtimev1.ReasoningConfig{
				Activation:   runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED,
				Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN,
				Intensity:    &runtimev1.ReasoningConfig_ExactBudgetTokens{},
			},
			want: InvocationFailureInvalidRequest,
		},
		{
			name: "valid effort is unsupported",
			reasoning: &runtimev1.ReasoningConfig{
				Activation:   runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED,
				Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY,
				Intensity: &runtimev1.ReasoningConfig_Effort{
					Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH,
				},
			},
			want: InvocationFailureTextBehaviorUnsupported,
		},
		{
			name: "valid exact budget is unsupported",
			reasoning: &runtimev1.ReasoningConfig{
				Activation:   runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE,
				Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN,
				Intensity: &runtimev1.ReasoningConfig_ExactBudgetTokens{
					ExactBudgetTokens: 64,
				},
			},
			want: InvocationFailureTextBehaviorUnsupported,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := llamaTextRequestBody(request(test.reasoning), false, false)
			assertLlamaInvocationFailureKind(t, err, test.want)
		})
	}
}

func TestLlamaTextTurnItemsDoNotGuessUnsupportedBehavior(t *testing.T) {
	textTurn := &runtimev1.ChatMessage{
		Role: "assistant",
		TurnItems: []*runtimev1.TextTurnItem{
			{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: "hello "}}}}},
			{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: "world"}}}}},
		},
	}
	payload, err := llamaTextRequestBody(&runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{textTurn}}, false, false)
	if err != nil {
		t.Fatalf("text-only ordered turn: %v", err)
	}
	var body map[string]any
	if err := json.Unmarshal(payload, &body); err != nil {
		t.Fatalf("decode request body: %v", err)
	}
	messages, _ := body["messages"].([]any)
	message, _ := messages[0].(map[string]any)
	if message["role"] != "assistant" || message["content"] != "hello world" {
		t.Fatalf("ordered text turn projection = %#v", message)
	}

	tests := []struct {
		name    string
		message *runtimev1.ChatMessage
		want    InvocationFailureKind
	}{
		{
			name: "content conflicts with ordered items",
			message: &runtimev1.ChatMessage{Role: "assistant", Content: "parallel truth", TurnItems: []*runtimev1.TextTurnItem{{
				Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: "canonical"}}}},
			}}},
			want: InvocationFailureInvalidRequest,
		},
		{
			name: "tool call transcript unsupported",
			message: &runtimev1.ChatMessage{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{{
				Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: &runtimev1.ToolCall{Id: "call-1", Name: "lookup", ArgumentsJson: "{}"}}}},
			}}},
			want: InvocationFailureTextBehaviorUnsupported,
		},
		{
			name: "preliminary tool result fragment unsupported",
			message: &runtimev1.ChatMessage{Role: "tool", TurnItems: []*runtimev1.TextTurnItem{{
				Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "call-1", ToolName: "lookup", Preliminary: true}},
			}}},
			want: InvocationFailureTextBehaviorUnsupported,
		},
		{
			name: "reasoning summary unsupported",
			message: &runtimev1.ChatMessage{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{{
				Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningSummary{ReasoningSummary: &runtimev1.ReasoningSummary{Text: "summary"}}}},
			}}},
			want: InvocationFailureTextBehaviorUnsupported,
		},
		{
			name: "reasoning continuity unsupported",
			message: &runtimev1.ChatMessage{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{{
				Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: &runtimev1.ReasoningContinuityCarrier{Kind: "native", Version: 1, Payload: []byte("opaque")}}}},
			}}},
			want: InvocationFailureTextBehaviorUnsupported,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := llamaTextRequestBody(&runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{test.message}}, false, false)
			assertLlamaInvocationFailureKind(t, err, test.want)
		})
	}
}

func assertLlamaInvocationFailureKind(t *testing.T, err error, want InvocationFailureKind) {
	t.Helper()
	invocation, ok := err.(*InvocationError)
	if !ok || invocation.Kind != want {
		t.Fatalf("error = %T %v, want InvocationError kind %q", err, err, want)
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
	mainBinding := InvocationExactBinding{
		RequirementID: MainGGUFRequirementID, ModelAssetID: "main", AbsolutePath: mainPath,
		VerifiedContentID: "sha256:" + strings.Repeat("a", 64), EntrySHA256: strings.Repeat("b", 64),
	}
	plan, err := (LlamaTextDriver{}).PlanTextInvocation(TextInvocationInput{
		PortableConfig:           portable,
		ModelContextWindowTokens: 32768,
		ExactBindings:            []InvocationExactBinding{mainBinding},
		BehaviorMatch:            llamaBehaviorMatchFactsForTest(mainBinding),
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
	if plan.RequestContentType() != "application/json" || plan.BehaviorAdapterCapture() != nil {
		t.Fatalf("base llama v1 behavior capture = content-type %q adapter %+v", plan.RequestContentType(), plan.BehaviorAdapterCapture())
	}
	var body map[string]any
	if err := json.Unmarshal(plan.RequestBody(), &body); err != nil {
		t.Fatalf("decode request body: %v", err)
	}
	if body["model"] != "nimi-selected-local" || body["stream"] != false || body["top_k"] != float64(40) {
		t.Fatalf("request body = %#v", body)
	}
	driftedFacts := llamaBehaviorMatchFactsForTest(mainBinding)
	driftedFacts.TemplateIdentity = "sha256:" + strings.Repeat("c", 64)
	if _, err := (LlamaTextDriver{}).PlanTextInvocation(TextInvocationInput{
		PortableConfig: portable, ModelContextWindowTokens: 32768, ExactBindings: []InvocationExactBinding{mainBinding},
		BehaviorMatch: driftedFacts, Request: &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hello"}}},
	}); err == nil {
		t.Fatal("text behavior match facts that differ from the exact binding were accepted")
	}
}

type llamaTestBehaviorAssembler struct{}

func (*llamaTestBehaviorAssembler) Append([]byte) ([]textbehavior.OrderedDelta, error) {
	return nil, nil
}
func (*llamaTestBehaviorAssembler) Finish() (textbehavior.NormalizedResult, error) {
	return textbehavior.NormalizedResult{Items: []textbehavior.OrderedItem{{Kind: textbehavior.OrderedItemText, Text: "ok"}}}, nil
}

func TestLlamaInvocationPlanUsesResolvedBehaviorSerializerAndDeclaredProcessImpact(t *testing.T) {
	templateIdentity := "sha256:" + strings.Repeat("c", 64)
	main := InvocationExactBinding{
		RequirementID: MainGGUFRequirementID, ModelAssetID: "main", AbsolutePath: filepath.Join(t.TempDir(), "main.gguf"),
		VerifiedContentID: "sha256:" + strings.Repeat("a", 64), EntrySHA256: strings.Repeat("b", 64),
		TemplateIdentity: templateIdentity,
	}
	request := &runtimev1.TextGenerateScenarioSpec{
		Input: []*runtimev1.ChatMessage{{Role: "user", Content: "use a tool"}},
		Tools: []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup"}},
	}
	newAdapter := func(id, requiredTemplate string, impact textbehavior.ProcessIdentityImpact) *textbehavior.Adapter {
		t.Helper()
		adapter, err := textbehavior.NewAdapter(textbehavior.AdapterCapture{
			AdapterID: id, Version: "1", RequestSerializerID: "test/request/v1",
			NonStreamParserID: "test/sync/v1", StreamAssemblerID: "test/stream/v1",
			RequiredTemplateIdentity: requiredTemplate, ProcessIdentityImpact: impact,
		}, func(spec *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
			payload, err := json.Marshal(map[string]any{"tool": spec.GetTools()[0].GetName(), "stream": stream, "adapter": id})
			return textbehavior.SerializedRequest{ContentType: "application/x-nimi-text-behavior", Payload: payload}, err
		}, func([]byte, *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
			return textbehavior.NormalizedResult{Items: []textbehavior.OrderedItem{{Kind: textbehavior.OrderedItemText, Text: "ok"}}}, nil
		}, func(*runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
			return &llamaTestBehaviorAssembler{}, nil
		})
		if err != nil {
			t.Fatal(err)
		}
		return adapter
	}
	planFor := func(binding InvocationExactBinding, adapter *textbehavior.Adapter) *TextInvocationPlan {
		t.Helper()
		plan, err := (LlamaTextDriver{}).PlanTextInvocation(TextInvocationInput{
			ModelContextWindowTokens: 32768, ExactBindings: []InvocationExactBinding{binding},
			BehaviorMatch: llamaBehaviorMatchFactsForTest(binding), BehaviorAdapter: adapter, Request: request, Stream: true,
		})
		if err != nil {
			t.Fatal(err)
		}
		return plan
	}
	unaffectedA := planFor(main, newAdapter("adapter-a", templateIdentity, textbehavior.ProcessIdentityUnaffected))
	unaffectedB := planFor(main, newAdapter("adapter-b", templateIdentity, textbehavior.ProcessIdentityUnaffected))
	if unaffectedA.ProcessKey() != unaffectedB.ProcessKey() {
		t.Fatal("adapter identity changed process key despite unaffected declaration")
	}
	adapterA := planFor(main, newAdapter("adapter-a", templateIdentity, textbehavior.ProcessIdentityAdapter))
	adapterB := planFor(main, newAdapter("adapter-b", templateIdentity, textbehavior.ProcessIdentityAdapter))
	if adapterA.ProcessKey() == adapterB.ProcessKey() {
		t.Fatal("adapter identity did not change process key when declared")
	}
	otherTemplateIdentity := "sha256:" + strings.Repeat("d", 64)
	otherTemplate := main
	otherTemplate.TemplateIdentity = otherTemplateIdentity
	unaffectedTemplateA := planFor(main, newAdapter("adapter-template", templateIdentity, textbehavior.ProcessIdentityUnaffected))
	unaffectedTemplateB := planFor(otherTemplate, newAdapter("adapter-template", otherTemplateIdentity, textbehavior.ProcessIdentityUnaffected))
	if unaffectedTemplateA.ProcessKey() != unaffectedTemplateB.ProcessKey() {
		t.Fatal("template identity changed process key despite unaffected declaration")
	}
	templateA := planFor(main, newAdapter("adapter-template", templateIdentity, textbehavior.ProcessIdentityTemplate))
	templateB := planFor(otherTemplate, newAdapter("adapter-template", otherTemplateIdentity, textbehavior.ProcessIdentityTemplate))
	if templateA.ProcessKey() == templateB.ProcessKey() {
		t.Fatal("template identity did not change process key when declared")
	}
	if adapterA.RequestContentType() != "application/x-nimi-text-behavior" || adapterA.BehaviorAdapterCapture().AdapterID != "adapter-a" {
		t.Fatalf("behavior plan capture = content-type %q adapter %+v", adapterA.RequestContentType(), adapterA.BehaviorAdapterCapture())
	}
	var serialized map[string]any
	if err := json.Unmarshal(adapterA.RequestBody(), &serialized); err != nil || serialized["tool"] != "lookup" || serialized["stream"] != true {
		t.Fatalf("adapter serialized request = %#v err=%v", serialized, err)
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
	if _, err := (LlamaTextDriver{}).PlanTextInvocation(TextInvocationInput{ExactBindings: []InvocationExactBinding{main}, BehaviorMatch: llamaBehaviorMatchFactsForTest(main), Request: request}); err == nil {
		t.Fatal("image invocation without configured mmproj must fail closed")
	}
	plan, err := (LlamaTextDriver{}).PlanTextInvocation(TextInvocationInput{
		ModelContextWindowTokens: 32768,
		BehaviorMatch:            llamaBehaviorMatchFactsForTest(main),
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

func llamaBehaviorMatchFactsForTest(main InvocationExactBinding) TextBehaviorAdapterMatchFacts {
	return TextBehaviorAdapterMatchFacts{
		RecipeID: LlamaGemma4RecipeID, RecipeRevision: "test-revision", DriverDialect: LlamaDriverDialect,
		ModelAssetID: main.ModelAssetID, VerifiedContentID: main.VerifiedContentID, EntrySHA256: main.EntrySHA256,
		TemplateIdentity: main.TemplateIdentity,
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
