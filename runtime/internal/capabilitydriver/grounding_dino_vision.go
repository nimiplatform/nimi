package capabilitydriver

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r127
const (
	GroundingDinoImplementationID = "local.vision.locate.grounding-dino"
	GroundingDinoDriverID         = "nimi.runtime.driver.grounding-dino"
	GroundingDinoDriverDialect    = "grounding-dino/vision-locate/box-v2"
	GroundingDinoRecipeID         = "grounding-dino.vision-locate.box-v2"
	GroundingDinoModelSlot        = "vision.model"
	GroundingDinoConsumerID       = "vision.grounding-dino.python"
	GroundingDinoBackend          = "grounding-dino-transformers"
	GroundingDinoProtocol         = "nimi-vision-grounding-dino/1"
)

type GroundingDinoDriver struct{}

func (GroundingDinoDriver) ImplementationSupportedFeatures(recipeID string) ([]string, runtimev1.LocalCapabilityReason) {
	if recipeID != GroundingDinoRecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (GroundingDinoDriver) EffectiveRequestDefaults(string, *structpb.Struct) map[string]string {
	return nil
}

func (driver GroundingDinoDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return driver.ProjectRecipe(input.RecipeID, input.PortableConfig, input.SupportedFeatures)
}

func (driver GroundingDinoDriver) ProjectRecipe(recipeID string, options *structpb.Struct, features []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return driver.ProjectRecipeForHost(recipeID, options, features, "windows/amd64")
}

func (GroundingDinoDriver) ProjectRecipeForHost(recipeID string, options *structpb.Struct, features []string, platformTuple string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if recipeID != GroundingDinoRecipeID || len(options.GetFields()) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	if len(features) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}
	if platformTuple != "windows/amd64" {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	constraints, _ := structpb.NewStruct(map[string]any{
		"format": "safetensors", "model_type": "grounding-dino", "driver_backend": GroundingDinoBackend,
	})
	return []*runtimev1.LocalCapabilityRequirement{{
		RequirementId: GroundingDinoModelSlot,
		Role:          runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
		Presence:      runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED,
		ResourceKind:  "vision", DisplayLabel: "Grounding DINO model",
		Policy:                   runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE,
		CompatibilityConstraints: constraints,
	}}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

// @nimi-authority: rule.nimi.runtime.ai-provider.grounding-dino-swin-box-admission
func (driver GroundingDinoDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	invalid := runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	if input.RecipeID != GroundingDinoRecipeID || input.Requirement.GetRequirementId() != GroundingDinoModelSlot || input.Entry.RelativePath != "model.safetensors" ||
		input.Requirement.GetCompatibilityConstraints().GetFields()["driver_backend"].GetStringValue() != GroundingDinoBackend {
		return ModelAssetBindingProjection{}, invalid
	}
	config, ok := modelAssetFileFact(input, "config.json")
	if !ok {
		return ModelAssetBindingProjection{}, invalid
	}
	var modelConfig struct {
		ModelType     string   `json:"model_type"`
		Architectures []string `json:"architectures"`
		DModel        int      `json:"d_model"`
		Backbone      struct {
			ModelType  string          `json:"model_type"`
			EmbedDim   json.RawMessage `json:"embed_dim"`
			WindowSize json.RawMessage `json:"window_size"`
			Depths     []int64         `json:"depths"`
			Heads      []int64         `json:"num_heads"`
		} `json:"backbone_config"`
		Text struct {
			ModelType  string          `json:"model_type"`
			VocabSize  json.RawMessage `json:"vocab_size"`
			HiddenSize json.RawMessage `json:"hidden_size"`
			PadTokenID json.RawMessage `json:"pad_token_id"`
		} `json:"text_config"`
		Quantization          json.RawMessage `json:"quantization_config"`
		AutoMap               json.RawMessage `json:"auto_map"`
		UseTimmBackbone       bool            `json:"use_timm_backbone"`
		UsePretrainedBackbone bool            `json:"use_pretrained_backbone"`
		DecoderBBoxEmbedShare bool            `json:"decoder_bbox_embed_share"`
		BackboneRef           json.RawMessage `json:"backbone"`
		BackboneKwargs        json.RawMessage `json:"backbone_kwargs"`
	}
	if json.Unmarshal(config.FormatProbe, &modelConfig) != nil || modelConfig.ModelType != "grounding-dino" ||
		!contains(modelConfig.Architectures, "GroundingDinoForObjectDetection") || modelConfig.DModel != 256 ||
		modelConfig.Backbone.ModelType != "swin" || modelConfig.Text.ModelType != "bert" ||
		len(modelConfig.Quantization) != 0 || len(modelConfig.AutoMap) != 0 || modelConfig.UseTimmBackbone || modelConfig.UsePretrainedBackbone {
		return ModelAssetBindingProjection{}, invalid
	}
	var backboneKwargs map[string]json.RawMessage
	if len(modelConfig.BackboneRef) != 0 && string(modelConfig.BackboneRef) != "null" ||
		len(modelConfig.BackboneKwargs) != 0 && (json.Unmarshal(modelConfig.BackboneKwargs, &backboneKwargs) != nil || len(backboneKwargs) != 0) {
		return ModelAssetBindingProjection{}, invalid
	}
	// The official Swin-T checkpoint omits these built-in Swin defaults.
	embedDim, embedValid := groundingDinoConfigInteger(modelConfig.Backbone.EmbedDim, 96)
	windowSize, windowValid := groundingDinoConfigInteger(modelConfig.Backbone.WindowSize, 7)
	vocabSize, vocabValid := groundingDinoConfigInteger(modelConfig.Text.VocabSize, 30522)
	hiddenSize, hiddenValid := groundingDinoConfigInteger(modelConfig.Text.HiddenSize, 768)
	padID, padValid := groundingDinoConfigInteger(modelConfig.Text.PadTokenID, 0)
	family := ""
	if embedDim == 96 && windowSize == 7 && int64SlicesEqual(modelConfig.Backbone.Depths, []int64{2, 2, 6, 2}) && int64SlicesEqual(modelConfig.Backbone.Heads, []int64{3, 6, 12, 24}) {
		family = "grounding-dino-tiny"
	} else if embedDim == 128 && windowSize == 12 && int64SlicesEqual(modelConfig.Backbone.Depths, []int64{2, 2, 18, 2}) && int64SlicesEqual(modelConfig.Backbone.Heads, []int64{4, 8, 16, 32}) {
		family = "grounding-dino-base"
	}
	if family == "" || !embedValid || !windowValid || !vocabValid || !hiddenValid || !padValid || vocabSize != 30522 || hiddenSize != 768 || padID != 0 {
		return ModelAssetBindingProjection{}, invalid
	}
	for _, name := range []string{"preprocessor_config.json", "tokenizer_config.json", "tokenizer.json", "vocab.txt", "special_tokens_map.json"} {
		if _, ok := modelAssetFileFact(input, name); !ok {
			return ModelAssetBindingProjection{}, invalid
		}
	}
	if !groundingDinoTokenizerCompatible(input) {
		return ModelAssetBindingProjection{}, invalid
	}
	tensors, ok := safetensorsTensorFacts(input.Entry.FormatProbe)
	if !ok {
		return ModelAssetBindingProjection{}, invalid
	}
	for name, shape := range map[string][]int64{
		"model.backbone.conv_encoder.model.embeddings.patch_embeddings.projection.weight": {embedDim, 3, 4, 4},
		"model.text_backbone.embeddings.word_embeddings.weight":                           {30522, 768},
		"model.decoder.layers.0.fc1.weight":                                               {2048, 256},
	} {
		fact, exists := tensors[name]
		if !exists || fact.DType != "F32" || !int64SlicesEqual(fact.Shape, shape) {
			return ModelAssetBindingProjection{}, invalid
		}
	}
	boxHeadNames := []string{"bbox_embed.0.layers.0.weight"}
	// These are tied names of the same built-in head, not alternate loaders.
	// The official Base safetensors stores only its decoder alias.
	if modelConfig.DecoderBBoxEmbedShare {
		boxHeadNames = append(boxHeadNames, "model.decoder.bbox_embed.0.layers.0.weight")
	}
	boxHeadPresent := false
	for _, name := range boxHeadNames {
		if fact, exists := tensors[name]; exists {
			if fact.DType != "F32" || !int64SlicesEqual(fact.Shape, []int64{256, 256}) {
				return ModelAssetBindingProjection{}, invalid
			}
			boxHeadPresent = true
		}
	}
	if !boxHeadPresent {
		return ModelAssetBindingProjection{}, invalid
	}
	return validatedModelAssetBindingProjection(input, ModelAssetDescriptor{
		Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VISION, Family: family,
		ArtifactRoles: []string{"vision_model"}, FormatProbe: input.Entry.FormatProbe,
	}, 0, driver.ValidateBinding)
}

func groundingDinoConfigInteger(raw json.RawMessage, fallback int64) (int64, bool) {
	if len(raw) == 0 {
		return fallback, true
	}
	var value *int64
	if json.Unmarshal(raw, &value) != nil || value == nil {
		return 0, false
	}
	return *value, true
}

func (GroundingDinoDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.ModelAssetExactBinding, asset ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if requirement.GetRequirementId() != GroundingDinoModelSlot || binding.GetRequirementId() != GroundingDinoModelSlot {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	if binding.GetModelAssetId() == "" || binding.GetModelAssetId() != asset.ModelAssetID {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_NOT_FOUND
	}
	if binding.GetVerifiedContentId() == "" || binding.GetEntrySha256() == "" ||
		binding.GetVerifiedContentId() != asset.VerifiedContentID || binding.GetEntrySha256() != asset.EntrySHA256 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH
	}
	if asset.Kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VISION || !contains([]string{"grounding-dino-tiny", "grounding-dino-base"}, asset.Family) || !contains(asset.ArtifactRoles, "vision_model") {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

// @nimi-authority: rule.nimi.runtime.ai-provider.grounding-dino-swin-box-admission
func groundingDinoTokenizerCompatible(input ModelAssetBindingInput) bool {
	read := func(name string, target any) bool {
		fact, ok := modelAssetFileFact(input, name)
		return ok && int64(len(fact.FormatProbe)) == fact.SizeBytes && json.Unmarshal(fact.FormatProbe, target) == nil
	}
	var preprocessing map[string]json.RawMessage
	if !read("preprocessor_config.json", &preprocessing) || preprocessing == nil {
		return false
	}
	for key, expected := range map[string]string{"processor_class": "GroundingDinoProcessor", "image_processor_type": "GroundingDinoImageProcessor"} {
		if raw, present := preprocessing[key]; present {
			var name *string
			if json.Unmarshal(raw, &name) != nil || name != nil && *name != expected {
				return false
			}
		}
	}
	if raw, present := preprocessing["auto_map"]; present && string(raw) != "null" {
		return false
	}
	type addedToken struct {
		ID      int    `json:"id"`
		Content string `json:"content"`
		Special bool   `json:"special"`
	}
	var tokenizer struct {
		Model struct {
			Type  string         `json:"type"`
			Vocab map[string]int `json:"vocab"`
		} `json:"model"`
		Added []addedToken `json:"added_tokens"`
	}
	var config struct {
		Class     string                `json:"tokenizer_class"`
		Processor string                `json:"processor_class"`
		Added     map[string]addedToken `json:"added_tokens_decoder"`
		AutoMap   json.RawMessage       `json:"auto_map"`
	}
	var special map[string]string
	var configTokens map[string]json.RawMessage
	if !read("tokenizer.json", &tokenizer) || !read("tokenizer_config.json", &config) || !read("special_tokens_map.json", &special) || !read("tokenizer_config.json", &configTokens) ||
		tokenizer.Model.Type != "WordPiece" || len(tokenizer.Model.Vocab) != 30522 || !contains([]string{"BertTokenizer", "BertTokenizerFast"}, config.Class) || config.Processor != "GroundingDinoProcessor" || len(config.AutoMap) != 0 {
		return false
	}
	vocab, ok := modelAssetFileFact(input, "vocab.txt")
	if !ok || int64(len(vocab.FormatProbe)) != vocab.SizeBytes {
		return false
	}
	lines := strings.Split(strings.TrimSuffix(string(vocab.FormatProbe), "\n"), "\n")
	if len(lines) != 30522 {
		return false
	}
	for id, line := range lines {
		if actual, exists := tokenizer.Model.Vocab[strings.TrimSuffix(line, "\r")]; !exists || actual != id {
			return false
		}
	}
	for _, token := range tokenizer.Added {
		if id, exists := tokenizer.Model.Vocab[token.Content]; !exists || id != token.ID {
			return false
		}
	}
	for key, token := range config.Added {
		id, err := strconv.Atoi(key)
		if actual, exists := tokenizer.Model.Vocab[token.Content]; err != nil || !exists || actual != id {
			return false
		}
	}
	for key, expected := range map[string]struct {
		content string
		id      int
	}{
		"pad_token": {"[PAD]", 0}, "unk_token": {"[UNK]", 100}, "cls_token": {"[CLS]", 101}, "sep_token": {"[SEP]", 102}, "mask_token": {"[MASK]", 103},
	} {
		var token string
		if special[key] != expected.content || json.Unmarshal(configTokens[key], &token) != nil || token != expected.content || tokenizer.Model.Vocab[expected.content] != expected.id {
			return false
		}
		decoder, exists := config.Added[strconv.Itoa(expected.id)]
		if !exists || decoder.Content != expected.content || !decoder.Special {
			return false
		}
		found := false
		for _, added := range tokenizer.Added {
			if added.Content == expected.content && added.ID == expected.id && added.Special {
				found = true
			}
		}
		if !found {
			return false
		}
	}
	// This redundant file is optional in the official Base bundle. If declared,
	// its entries must agree with the same complete tokenizer and embedding rows.
	for _, fact := range input.Files {
		if fact.RelativePath != "added_tokens.json" {
			continue
		}
		var added map[string]int
		if fact.SizeBytes <= 0 || int64(len(fact.FormatProbe)) != fact.SizeBytes || json.Unmarshal(fact.FormatProbe, &added) != nil {
			return false
		}
		for content, id := range added {
			if actual, exists := tokenizer.Model.Vocab[content]; !exists || actual != id {
				return false
			}
		}
	}
	return true
}

func (driver GroundingDinoDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.ModelAssetExactBinding, assets []ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if len(requirements) != 1 || len(bindings) != 1 || len(assets) != 1 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	return driver.ValidateBinding(requirements[0], bindings[0], assets[0])
}

func (GroundingDinoDriver) SupportsGeometry(geometry runtimev1.VisionLocateGeometry) bool {
	return geometry == runtimev1.VisionLocateGeometry_VISION_LOCATE_GEOMETRY_BOX
}

func (GroundingDinoDriver) PlanVisionLocateInvocation(input VisionLocateInvocationInput) (*VisionLocateInvocationPlan, error) {
	if input.RecipeID != GroundingDinoRecipeID || input.PlatformTuple != "windows/amd64" || input.Request == nil ||
		input.Request.Geometry != runtimev1.VisionLocateGeometry_VISION_LOCATE_GEOMETRY_BOX || len(input.Bindings) != 1 ||
		input.Bindings[0].RequirementID != GroundingDinoModelSlot {
		return nil, fmt.Errorf("Grounding DINO box invocation has incomplete captured input")
	}
	return planVisionLocateInvocation(input, GroundingDinoBackend, GroundingDinoConsumerID, GroundingDinoProtocol)
}
