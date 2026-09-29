package capabilitydriver

import (
	"bytes"
	"fmt"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/ggufmeta"
)

func qwen35GGUFHeaderForTest(t *testing.T) []byte {
	t.Helper()
	var buffer bytes.Buffer
	buffer.WriteString("GGUF")
	for _, value := range []any{uint32(3), uint64(6), uint64(10)} {
		mustWriteLlamaProbeValue(t, &buffer, value)
	}
	for _, entry := range []struct{ key, value string }{
		{"general.architecture", "qwen35"},
		{"general.type", "model"},
		{"tokenizer.ggml.pre", "qwen35"},
		{"tokenizer.chat_template", "<|im_start|>user<|im_end|><think>"},
	} {
		writeLlamaProbeString(t, &buffer, entry.key)
		mustWriteLlamaProbeValue(t, &buffer, uint32(ggufmeta.ValueTypeString))
		writeLlamaProbeString(t, &buffer, entry.value)
	}
	for _, entry := range []struct {
		key   string
		value uint32
	}{
		{"qwen35.context_length", 262144},
		{"qwen35.block_count", 32},
		{"qwen35.embedding_length", 2560},
		{"qwen35.full_attention_interval", 4},
		{"qwen35.ssm.state_size", 128},
		{"qwen35.ssm.inner_size", 4096},
	} {
		writeLlamaProbeString(t, &buffer, entry.key)
		mustWriteLlamaProbeValue(t, &buffer, uint32(ggufmeta.ValueTypeUint32))
		mustWriteLlamaProbeValue(t, &buffer, entry.value)
	}
	for _, name := range []string{
		"token_embd.weight", "output_norm.weight", "blk.0.attn_qkv.weight",
		"blk.0.ssm_a", "blk.31.attn_q.weight", "blk.31.ffn_down.weight",
	} {
		writeLlamaProbeString(t, &buffer, name)
		mustWriteLlamaProbeValue(t, &buffer, uint32(1))
		mustWriteLlamaProbeValue(t, &buffer, uint64(1))
		mustWriteLlamaProbeValue(t, &buffer, uint32(0))
		mustWriteLlamaProbeValue(t, &buffer, uint64(0))
	}
	return buffer.Bytes()
}

func qwen35ProjectorHeaderForTest(t *testing.T) []byte {
	t.Helper()
	var buffer bytes.Buffer
	buffer.WriteString("GGUF")
	for _, value := range []any{uint32(3), uint64(298), uint64(10)} {
		mustWriteLlamaProbeValue(t, &buffer, value)
	}
	for _, entry := range []struct{ key, value string }{
		{"general.architecture", "clip"},
		{"general.type", "mmproj"},
		{"general.base_model.0.name", "Qwen3.5 4B"},
		{"clip.projector_type", "qwen3vl_merger"},
	} {
		writeLlamaProbeString(t, &buffer, entry.key)
		mustWriteLlamaProbeValue(t, &buffer, uint32(ggufmeta.ValueTypeString))
		writeLlamaProbeString(t, &buffer, entry.value)
	}
	for _, entry := range []struct {
		key   string
		value uint32
	}{
		{"clip.vision.projection_dim", 2560},
		{"clip.vision.embedding_length", 1024},
		{"clip.vision.image_size", 768},
		{"clip.vision.patch_size", 16},
		{"clip.vision.block_count", 24},
		{"clip.vision.spatial_merge_size", 2},
	} {
		writeLlamaProbeString(t, &buffer, entry.key)
		mustWriteLlamaProbeValue(t, &buffer, uint32(ggufmeta.ValueTypeUint32))
		mustWriteLlamaProbeValue(t, &buffer, entry.value)
	}
	for index := range 298 {
		name := "v.blk.0.attn_qkv.weight"
		if index > 0 {
			name = fmt.Sprintf("v.test.%d.weight", index)
		}
		writeLlamaProbeString(t, &buffer, name)
		mustWriteLlamaProbeValue(t, &buffer, uint32(1))
		mustWriteLlamaProbeValue(t, &buffer, uint64(1))
		mustWriteLlamaProbeValue(t, &buffer, uint32(0))
		mustWriteLlamaProbeValue(t, &buffer, uint64(0))
	}
	return buffer.Bytes()
}

func TestQwen35FourBBaseTextModelContractBindsOnlyExplicitMainAsset(t *testing.T) {
	driver := LlamaTextDriver{}
	if budget := driver.ModelAssetFormatProbeBytes(ModelAssetFormatProbeInput{
		RecipeID: LlamaQwen35RecipeID, RequirementID: MainGGUFRequirementID, RelativePath: "model.gguf", Entry: true,
	}); budget != MaxDriverAssetFormatProbeBytes {
		t.Fatalf("Qwen main GGUF probe budget = %d", budget)
	}
	if features, reason := driver.ImplementationSupportedFeatures(LlamaQwen35RecipeID); reason != success || len(features) != 0 {
		t.Fatalf("Qwen base text features = %v reason=%v", features, reason)
	}
	requirements, reason := driver.ProjectRecipe(LlamaQwen35RecipeID, nil, nil)
	if reason != success || len(requirements) != 1 || requirements[0].GetRequirementId() != MainGGUFRequirementID ||
		requirements[0].GetCompatibilityConstraints().GetFields()["qwen35_4b_contract"].GetStringValue() != "v1" {
		t.Fatalf("Qwen exact main recipe = %+v reason=%v", requirements, reason)
	}
	probe := qwen35GGUFHeaderForTest(t)
	binding := &runtimev1.ModelAssetExactBinding{
		RequirementId: MainGGUFRequirementID, ModelAssetId: "qwen-asset",
		VerifiedContentId: "sha256:" + strings.Repeat("a", 64), EntrySha256: strings.Repeat("a", 64),
	}
	projection, reason := driver.ProjectModelAssetBinding(ModelAssetBindingInput{
		RecipeID: LlamaQwen35RecipeID, Requirement: requirements[0], Binding: binding,
		Entry: ModelAssetFileFact{RelativePath: "model.gguf", SizeBytes: int64(len(probe)), FormatProbe: probe},
	})
	if reason != success || projection.ModelContextWindowTokens != 262144 || projection.TemplateIdentity == "" ||
		projection.Descriptor.Kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT {
		t.Fatalf("Qwen binding projection = %+v reason=%v", projection, reason)
	}
	if reason := driver.ValidateCombination(requirements, []*runtimev1.ModelAssetExactBinding{binding}, []ModelAssetDescriptor{projection.Descriptor}); reason != success {
		t.Fatalf("Qwen exact Loadout binding rejected: %v", reason)
	}
	if behaviors, reason := driver.TextBehaviorCapabilities(LlamaQwen35RecipeID); reason != success || len(behaviors) != 3 ||
		!behaviors[0].GetImplementationSupported() || behaviors[0].GetConfigurationState() != runtimev1.TextBehaviorConfigurationState_TEXT_BEHAVIOR_CONFIGURATION_STATE_UNAVAILABLE ||
		behaviors[1].GetImplementationSupported() || !behaviors[2].GetImplementationSupported() {
		t.Fatalf("Qwen behavior projection before exact binding = %+v reason=%v", behaviors, reason)
	}
	facts := []TextBehaviorBindingFacts{{RequirementID: MainGGUFRequirementID, VerifiedContentID: Qwen35Q4ContentID,
		EntrySHA256: Qwen35Q4EntrySHA256, TemplateIdentity: Qwen35Q4TemplateIdentity}}
	if behaviors, reason := driver.TextBehaviorCapabilitiesForBindings(LlamaQwen35RecipeID, facts); reason != success ||
		behaviors[0].GetConfigurationState() != runtimev1.TextBehaviorConfigurationState_TEXT_BEHAVIOR_CONFIGURATION_STATE_CONFIGURED ||
		behaviors[0].GetConfiguredToolUse() == nil ||
		behaviors[1].GetConfigurationState() != runtimev1.TextBehaviorConfigurationState_TEXT_BEHAVIOR_CONFIGURATION_STATE_UNAVAILABLE ||
		behaviors[2].GetConfigurationState() != runtimev1.TextBehaviorConfigurationState_TEXT_BEHAVIOR_CONFIGURATION_STATE_CONFIGURED {
		t.Fatalf("Qwen exact behavior projection = %+v reason=%v", behaviors, reason)
	}
}

func TestQwen35FourBProjectorRequiresTheExactVerifiedPair(t *testing.T) {
	driver := LlamaTextDriver{}
	if _, reason := driver.ProjectRecipe(LlamaQwen35RecipeID, nil, []string{inputImageFeature}); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED {
		t.Fatalf("base Qwen recipe admitted image: %v", reason)
	}
	features, reason := driver.ImplementationSupportedFeatures(LlamaQwen35VisionRecipeID)
	if reason != success || len(features) != 1 || features[0] != inputImageFeature {
		t.Fatalf("Qwen vision features = %v reason=%v", features, reason)
	}
	if _, reason := driver.ProjectRecipeForHost(LlamaQwen35VisionRecipeID, nil, features, "darwin/arm64"); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED {
		t.Fatalf("unadmitted Mac Qwen vision recipe = %v", reason)
	}
	requirements, reason := driver.ProjectRecipeForHost(LlamaQwen35VisionRecipeID, nil, features, "windows/amd64")
	if reason != success || len(requirements) != 2 ||
		requirements[1].GetPresence() != runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED ||
		len(requirements[1].GetConditionalFeatures()) != 0 ||
		requirements[1].GetCompatibilityConstraints().GetFields()["qwen35_4b_projector_contract"].GetStringValue() != "v1" {
		t.Fatalf("Qwen vision requirements = %+v reason=%v", requirements, reason)
	}
	probe := qwen35ProjectorHeaderForTest(t)
	summary, err := ggufmeta.Inspect(bytes.NewReader(probe))
	if err != nil || !qwen35ProjectorModelContract(summary) {
		t.Fatalf("Qwen projector header rejected: %v", err)
	}
	wrongStructure := summary
	wrongStructure.Entries = append([]ggufmeta.MetadataEntry(nil), summary.Entries...)
	for index := range wrongStructure.Entries {
		if wrongStructure.Entries[index].Key == "clip.projector_type" {
			wrongStructure.Entries[index].StringValue = "other_merger"
		}
	}
	if qwen35ProjectorModelContract(wrongStructure) {
		t.Fatal("different projector structure admitted")
	}
	main := &runtimev1.ModelAssetExactBinding{RequirementId: MainGGUFRequirementID, ModelAssetId: "main",
		VerifiedContentId: Qwen35Q4ContentID, EntrySha256: Qwen35Q4EntrySHA256}
	projector := &runtimev1.ModelAssetExactBinding{RequirementId: CompanionMMProjRequirementID, ModelAssetId: "projector",
		VerifiedContentId: Qwen35Q4ProjectorContentID, EntrySha256: strings.TrimPrefix(Qwen35Q4ProjectorContentID, "sha256:")}
	projected, reason := driver.ProjectModelAssetBinding(ModelAssetBindingInput{
		RecipeID: LlamaQwen35VisionRecipeID, Requirement: requirements[1], Binding: projector,
		Entry: ModelAssetFileFact{RelativePath: "mmproj-F16.gguf", SizeBytes: int64(len(probe)), FormatProbe: probe},
	})
	if reason != success || projected.Descriptor.Kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY {
		t.Fatalf("Qwen projector projection = %+v reason=%v", projected, reason)
	}
	mainAsset := ModelAssetDescriptor{ModelAssetID: "main", VerifiedContentID: Qwen35Q4ContentID,
		EntrySHA256: Qwen35Q4EntrySHA256, Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT,
		Engine: "llama", ArtifactRoles: []string{"llm"}}
	if reason := driver.ValidateCombination(requirements, []*runtimev1.ModelAssetExactBinding{main}, []ModelAssetDescriptor{mainAsset}); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_REQUIRED_BINDING_MISSING {
		t.Fatalf("vision recipe without projector was admitted: %v", reason)
	}
	bindings := []*runtimev1.ModelAssetExactBinding{main, projector}
	assets := []ModelAssetDescriptor{mainAsset, projected.Descriptor}
	if reason := driver.ValidateCombination(requirements, bindings, assets); reason != success {
		t.Fatalf("verified Qwen vision pair rejected: %v", reason)
	}
	foreign := *projector
	foreign.VerifiedContentId = "sha256:" + strings.Repeat("a", 64)
	foreign.EntrySha256 = strings.Repeat("a", 64)
	foreignAsset := projected.Descriptor
	foreignAsset.VerifiedContentID = foreign.VerifiedContentId
	foreignAsset.EntrySHA256 = foreign.EntrySha256
	if reason := driver.ValidateCombination(requirements, []*runtimev1.ModelAssetExactBinding{main, &foreign}, []ModelAssetDescriptor{mainAsset, foreignAsset}); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
		t.Fatalf("foreign Qwen projector admitted: %v", reason)
	}
	wrongMain := *main
	wrongMain.VerifiedContentId = "sha256:" + strings.Repeat("b", 64)
	wrongMain.EntrySha256 = strings.Repeat("b", 64)
	wrongMainAsset := mainAsset
	wrongMainAsset.VerifiedContentID = wrongMain.VerifiedContentId
	wrongMainAsset.EntrySHA256 = wrongMain.EntrySha256
	if reason := driver.ValidateCombination(requirements, []*runtimev1.ModelAssetExactBinding{&wrongMain, projector}, []ModelAssetDescriptor{wrongMainAsset, projected.Descriptor}); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
		t.Fatalf("foreign Qwen main admitted for vision: %v", reason)
	}
}

func TestQwen35FourBBaseTextModelContractRejectsDifferentStructure(t *testing.T) {
	summary, err := ggufmeta.Inspect(bytes.NewReader(qwen35GGUFHeaderForTest(t)))
	if err != nil || !qwen35BaseTextModelContract(summary) {
		t.Fatalf("valid Qwen header rejected: %v", err)
	}
	for _, tc := range []struct {
		name string
		edit func(*ggufmeta.Summary)
	}{
		{"wrong 4B width", func(s *ggufmeta.Summary) {
			for i := range s.Entries {
				if s.Entries[i].Key == "qwen35.embedding_length" {
					s.Entries[i].Uint64Value = 4096
				}
			}
		}},
		{"missing hybrid tensor", func(s *ggufmeta.Summary) { s.TensorNames = append(s.TensorNames[:3], s.TensorNames[4:]...) }},
		{"missing template", func(s *ggufmeta.Summary) {
			for i := range s.Entries {
				if s.Entries[i].Key == "tokenizer.chat_template" {
					s.Entries[i].StringValue = ""
				}
			}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			changed := summary
			changed.Entries = append([]ggufmeta.MetadataEntry(nil), summary.Entries...)
			changed.TensorNames = append([]string(nil), summary.TensorNames...)
			tc.edit(&changed)
			if qwen35BaseTextModelContract(changed) {
				t.Fatal("different Model Contract structure admitted")
			}
		})
	}
}
