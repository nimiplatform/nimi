package capabilitydriver

import (
	"bytes"
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
