package capabilitydriver

import (
	"encoding/binary"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

func layaSafetensorsProbe(t *testing.T, names ...string) []byte {
	t.Helper()
	header := map[string]any{}
	for index, name := range names {
		header[name] = map[string]any{"dtype": "F16", "shape": []int{2}, "data_offsets": []int{index * 4, index*4 + 4}}
	}
	encoded, err := json.Marshal(header)
	if err != nil {
		t.Fatal(err)
	}
	probe := make([]byte, 8, 8+len(encoded))
	binary.LittleEndian.PutUint64(probe, uint64(len(encoded)))
	return append(probe, encoded...)
}

func layaBindingInput(t *testing.T, prefix string, mutate func(map[string][]byte)) ModelAssetBindingInput {
	t.Helper()
	requirements, reason := (LayaDriver{}).ProjectRecipe(LayaTypedDecisionsRecipeID, nil, nil)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatal(reason)
	}
	files := map[string][]byte{
		"rl_agent_config.json":            []byte(`{"encoder":"jhu-clsp/mmBERT-base","head_layers":2,"act_costs":{"escalate":0.5},"temperature":[4.7,1.0,1.0],"temperature_by_options":{}}`),
		"encoder/config.json":             []byte(`{"model_type":"modernbert","max_position_embeddings":8192,"hidden_size":768}`),
		"tokenizer/tokenizer.json":        []byte(`{}`),
		"tokenizer/tokenizer_config.json": []byte(`{"tokenizer_class":"PreTrainedTokenizerFast","mask_token":"<mask>","cls_token":"<bos>","sep_token":"<eos>","pad_token":"<pad>"}`),
		"model.safetensors":               layaSafetensorsProbe(t, "encoder.layers.0.attn.Wqkv.weight", "type_emb.weight", "scorer.1.weight", "act_head.0.weight", "head.layers.0.linear1.weight", "temperature"),
	}
	if mutate != nil {
		mutate(files)
	}
	input := ModelAssetBindingInput{
		RecipeID: LayaTypedDecisionsRecipeID, Requirement: requirements[0],
		Binding: &runtimev1.ModelAssetExactBinding{RequirementId: LayaModelSlot, ModelAssetId: "asset-laya", VerifiedContentId: "sha256:" + strings.Repeat("a", 64), EntrySha256: strings.Repeat("b", 64)},
	}
	for name, content := range files {
		fact := ModelAssetFileFact{RelativePath: prefix + name, SizeBytes: int64(len(content)) + 1, FormatProbe: content}
		if name == "model.safetensors" {
			input.Entry = fact
		}
		input.Files = append(input.Files, fact)
	}
	return input
}

func TestLayaRecipeProjectsOneSubstitutableCheckpointSlot(t *testing.T) {
	requirements, reason := (LayaDriver{}).ProjectRecipe(LayaTypedDecisionsRecipeID, nil, nil)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || len(requirements) != 1 {
		t.Fatalf("projection: %v %v", reason, requirements)
	}
	slot := requirements[0]
	if slot.GetRequirementId() != LayaModelSlot || slot.GetPresence() != runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED ||
		slot.GetCompatibilityConstraints().GetFields()["format"].GetStringValue() != LayaModelFormat {
		t.Fatalf("slot: %+v", slot)
	}
	options, _ := structpb.NewStruct(map[string]any{"device": "cuda"})
	if _, reason := (LayaDriver{}).ProjectRecipe(LayaTypedDecisionsRecipeID, options, nil); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID {
		t.Fatal("portable options must not select device or checkpoint behavior")
	}
	if _, reason := (LayaDriver{}).ProjectRecipe(LayaTypedDecisionsRecipeID, nil, []string{"input.image"}); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED {
		t.Fatal("features must be rejected")
	}
	if _, reason := (LayaDriver{}).ImplementationSupportedFeatures("other"); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED {
		t.Fatal("unknown recipe admitted")
	}
	for _, recipeID := range []string{LayaMultilingualRecipeID, LayaBrowserV10sRecipeID} {
		if projected, reason := (LayaDriver{}).ProjectRecipe(recipeID, nil, nil); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || len(projected) != 1 || projected[0].GetRequirementId() != LayaModelSlot {
			t.Fatalf("%s projection: %v %v", recipeID, reason, projected)
		}
	}
	driver, reason := NewProductionRegistry().Resolve(TextDecideContract, Identity{ImplementationID: LayaImplementationID, DriverID: LayaDriverID, DriverDialect: LayaDriverDialect})
	if _, ok := driver.(LayaDriver); !ok || reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatalf("production registry does not resolve the Laya Driver: %v", reason)
	}
}

func TestLayaCheckpointAdmissionUsesVerifiedFacts(t *testing.T) {
	for _, prefix := range []string{"", "multilingual/"} {
		projection, reason := (LayaDriver{}).ProjectModelAssetBinding(layaBindingInput(t, prefix, nil))
		if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED ||
			projection.Descriptor.Family != LayaModelFamily || projection.Descriptor.Kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY {
			t.Fatalf("prefix %q: %v %+v", prefix, reason, projection)
		}
	}
	for name, mutate := range map[string]func(map[string][]byte){
		"missing tokenizer": func(files map[string][]byte) { delete(files, "tokenizer/tokenizer.json") },
		"remote encoder code": func(files map[string][]byte) {
			files["encoder/config.json"] = []byte(`{"model_type":"modernbert","max_position_embeddings":8192,"hidden_size":768,"auto_map":{"AutoModel":"x.Y"}}`)
		},
		"foreign encoder": func(files map[string][]byte) {
			files["encoder/config.json"] = []byte(`{"model_type":"bert","max_position_embeddings":512,"hidden_size":768}`)
		},
		"no head layers": func(files map[string][]byte) { files["rl_agent_config.json"] = []byte(`{"encoder":"x"}`) },
		"malformed temperatures": func(files map[string][]byte) {
			files["rl_agent_config.json"] = []byte(`{"encoder":"x","head_layers":2,"temperature":[1,1]}`)
		},
		"slow tokenizer class": func(files map[string][]byte) {
			files["tokenizer/tokenizer_config.json"] = []byte(`{"tokenizer_class":"BertTokenizer","mask_token":"[MASK]","cls_token":"[CLS]","sep_token":"[SEP]","pad_token":"[PAD]"}`)
		},
		"no decision head": func(files map[string][]byte) {
			files["model.safetensors"] = layaSafetensorsProbe(t, "encoder.x", "type_emb.weight", "head.layers.0.x")
		},
		"head layer mismatch": func(files map[string][]byte) {
			files["model.safetensors"] = layaSafetensorsProbe(t, "encoder.x", "type_emb.weight", "scorer.1.weight", "act_head.0.weight")
		},
		"unreadable weights head": func(files map[string][]byte) { files["model.safetensors"] = []byte("not safetensors") },
	} {
		t.Run(name, func(t *testing.T) {
			if _, reason := (LayaDriver{}).ProjectModelAssetBinding(layaBindingInput(t, "ckpt/", mutate)); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
				t.Fatalf("admitted: %v", reason)
			}
		})
	}
	if limit := (LayaDriver{}).ModelAssetFormatProbeBytes(ModelAssetFormatProbeInput{RelativePath: "ckpt/tokenizer/tokenizer_config.json"}); limit != layaConfigProbeBytes {
		t.Fatalf("tokenizer config probe: %d", limit)
	}
	if limit := (LayaDriver{}).ModelAssetFormatProbeBytes(ModelAssetFormatProbeInput{RelativePath: "ckpt/tokenizer/tokenizer.json"}); limit != 4096 {
		t.Fatalf("tokenizer probe: %d", limit)
	}
}

func TestLayaInvocationPlanCapturesCheckpointDirectoryAndExactProfile(t *testing.T) {
	bundle := filepath.Join(t.TempDir(), "asset")
	declared := []string{"v10s/encoder/config.json", "v10s/model.safetensors", "v10s/rl_agent_config.json", "v10s/tokenizer/tokenizer.json", "v10s/tokenizer/tokenizer_config.json"}
	binding := InvocationExactBinding{
		RequirementID: LayaModelSlot, ModelAssetID: "asset-laya", BundleDir: bundle, AbsolutePath: filepath.Join(bundle, "v10s", "model.safetensors"),
		DeclaredFiles: declared, VerifiedContentID: "sha256:" + strings.Repeat("a", 64), EntrySHA256: strings.Repeat("b", 64),
	}
	profileDigest := strings.Repeat("c", 64)
	profile := InvocationExactDependencySource{
		DependencyFamily: "python.package-set", DependencyID: "python-profile." + profileDigest, ConsumerScope: LayaConsumerID,
		SelectedSourceRecordID: "record", CanonicalRoot: filepath.Join(bundle, "profile"), Version: profileDigest,
		Hashes: map[string]string{"profile_digest": profileDigest, "driver_bundle_sha256": strings.Repeat("d", 64)},
	}
	request := &runtimev1.TextDecideScenarioSpec{State: &runtimev1.TextDecisionContent{Value: &runtimev1.TextDecisionContent_Text{Text: "s"}}}
	plan, err := (LayaDriver{}).PlanTextDecisionInvocation(TextDecisionInvocationInput{RecipeID: LayaTypedDecisionsRecipeID, Request: request, Bindings: []InvocationExactBinding{binding}, DependencySources: []InvocationExactDependencySource{profile}})
	if err != nil {
		t.Fatal(err)
	}
	if plan.ModelDir != filepath.Join(bundle, "v10s") || plan.ProfileDigest != profileDigest || plan.DriverBundleDigest != strings.Repeat("d", 64) || plan.DriverProtocol != LayaProtocol || plan.Request == request {
		t.Fatalf("plan: %+v", plan)
	}
	for name, mutate := range map[string]func(*InvocationExactBinding, *InvocationExactDependencySource){
		"undeclared tokenizer": func(binding *InvocationExactBinding, _ *InvocationExactDependencySource) {
			binding.DeclaredFiles = declared[:3]
		},
		"entry outside bundle": func(binding *InvocationExactBinding, _ *InvocationExactDependencySource) {
			binding.AbsolutePath = filepath.Join(filepath.Dir(bundle), "model.safetensors")
		},
		"non-weights entry": func(binding *InvocationExactBinding, _ *InvocationExactDependencySource) {
			binding.AbsolutePath = filepath.Join(bundle, "v10s", "rl_agent_config.json")
		},
		"other consumer profile": func(_ *InvocationExactBinding, source *InvocationExactDependencySource) {
			source.ConsumerScope = SpacyConsumerID
		},
		"stale profile digest": func(_ *InvocationExactBinding, source *InvocationExactDependencySource) {
			source.Version = strings.Repeat("e", 64)
		},
	} {
		t.Run(name, func(t *testing.T) {
			changedBinding, changedProfile := binding, profile
			changedBinding.DeclaredFiles = append([]string(nil), binding.DeclaredFiles...)
			mutate(&changedBinding, &changedProfile)
			if _, err := (LayaDriver{}).PlanTextDecisionInvocation(TextDecisionInvocationInput{RecipeID: LayaTypedDecisionsRecipeID, Request: request, Bindings: []InvocationExactBinding{changedBinding}, DependencySources: []InvocationExactDependencySource{changedProfile}}); err == nil {
				t.Fatal("incomplete capture was planned")
			}
		})
	}
}

// This opt-in test admits real upstream checkpoint directories with the same
// bounded probes Runtime reads, e.g. NIMI_LAYA_TEST_CHECKPOINTS=dir1;dir2.
func TestLayaAdmitsInstalledUpstreamCheckpoints(t *testing.T) {
	roots := strings.FieldsFunc(os.Getenv("NIMI_LAYA_TEST_CHECKPOINTS"), func(r rune) bool { return r == ';' })
	if len(roots) == 0 {
		t.Skip("requires NIMI_LAYA_TEST_CHECKPOINTS")
	}
	requirements, _ := (LayaDriver{}).ProjectRecipe(LayaTypedDecisionsRecipeID, nil, nil)
	for _, root := range roots {
		input := ModelAssetBindingInput{
			RecipeID: LayaTypedDecisionsRecipeID, Requirement: requirements[0],
			Binding: &runtimev1.ModelAssetExactBinding{RequirementId: LayaModelSlot, ModelAssetId: "asset", VerifiedContentId: "sha256:" + strings.Repeat("a", 64), EntrySha256: strings.Repeat("b", 64)},
		}
		for _, name := range []string{"rl_agent_config.json", "model.safetensors", "encoder/config.json", "tokenizer/tokenizer.json", "tokenizer/tokenizer_config.json"} {
			relative := "ckpt/" + name
			file, err := os.Open(filepath.Join(root, filepath.FromSlash(name)))
			if err != nil {
				t.Fatal(err)
			}
			info, _ := file.Stat()
			limit := (LayaDriver{}).ModelAssetFormatProbeBytes(ModelAssetFormatProbeInput{RecipeID: LayaTypedDecisionsRecipeID, RequirementID: LayaModelSlot, RelativePath: relative, Entry: name == "model.safetensors"})
			probe, err := io.ReadAll(io.LimitReader(file, limit))
			_ = file.Close()
			if err != nil {
				t.Fatal(err)
			}
			fact := ModelAssetFileFact{RelativePath: relative, SizeBytes: info.Size(), FormatProbe: probe}
			if name == "model.safetensors" {
				input.Entry = fact
			}
			input.Files = append(input.Files, fact)
		}
		if _, reason := (LayaDriver{}).ProjectModelAssetBinding(input); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
			t.Fatalf("%s was not admitted: %v", root, reason)
		}
	}
}
