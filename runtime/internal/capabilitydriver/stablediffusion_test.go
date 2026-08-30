package capabilitydriver

import (
	"bytes"
	"errors"
	"fmt"
	"math"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestStableDiffusionInterpretTxt2ImgProjectsRequiredFamilyComposition(t *testing.T) {
	portable := stableDiffusionPortableForTest(t, map[string]any{"modelFamily": "z-image"})
	requirements, reason := (StableDiffusionImageDriver{}).Interpret(InterpretInput{RecipeID: "z-image", PortableConfig: portable})
	if reason != success {
		t.Fatalf("Interpret: %v", reason)
	}
	wantIDs := []string{
		StableDiffusionMainRequirementID,
		StableDiffusionTextEncoderRequirementID,
		StableDiffusionVAERequirementID,
	}
	if len(requirements) != len(wantIDs) {
		t.Fatalf("requirements = %#v", requirements)
	}
	for index, wantID := range wantIDs {
		if requirements[index].GetRequirementId() != wantID || requirements[index].GetOccurrenceOrdinal() != 0 || strings.TrimSpace(requirements[index].GetDisplayLabel()) == "" {
			t.Fatalf("requirement[%d] = %#v", index, requirements[index])
		}
	}
	for _, requirement := range requirements {
		if requirement.GetResourceKind() == inputImageFeature {
			t.Fatalf("txt2img projected an input.image resource: %#v", requirements)
		}
		if requirement.GetPolicy() != runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE || requirement.GetPreferredVerifiedContentId() != "" {
			t.Fatalf("image requirement projected asset-selection intent: %#v", requirement)
		}
	}
	if requirements[0].GetRole() != runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN ||
		requirements[1].GetRole() != runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION ||
		requirements[2].GetRole() != runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION {
		t.Fatalf("roles = %#v", requirements)
	}
	if requirements[1].GetResourceKind() != "auxiliary" || requirements[2].GetResourceKind() != "vae" {
		t.Fatalf("independent model-axis kinds = %#v", requirements)
	}
}

func TestStableDiffusionProjectsTextEncoderFromBoundedGGUFMetadata(t *testing.T) {
	driver := StableDiffusionImageDriver{}
	requirements, reason := driver.ProjectRecipe("z-image", stableDiffusionPortableForTest(t, map[string]any{"modelFamily": "z-image"}), nil)
	if reason != success || len(requirements) != 3 {
		t.Fatalf("ProjectRecipe = requirements=%+v reason=%v", requirements, reason)
	}
	contentDigest := strings.Repeat("a", 64)
	entryDigest := strings.Repeat("b", 64)
	projection, reason := driver.ProjectModelAssetBinding(ModelAssetBindingInput{
		RecipeID:    "z-image",
		Requirement: requirements[1],
		Binding: &runtimev1.ModelAssetExactBinding{
			RequirementId: requirements[1].GetRequirementId(), ModelAssetId: "model/text-encoder",
			VerifiedContentId: "sha256:" + contentDigest, EntrySha256: entryDigest,
		},
		Entry: ModelAssetFileFact{
			RelativePath: "qwen3-text-encoder.gguf", SizeBytes: 1 << 30,
			FormatProbe: boundedLLMGGUFProbeWithTruncatedTokenizer(t, "qwen3", 262144),
		},
	})
	if reason != success || projection.Descriptor.Family != "qwen" {
		t.Fatalf("ProjectModelAssetBinding = projection=%+v reason=%v", projection, reason)
	}
}

func TestStableDiffusionInterpretInputImageSupportMustMatchPortableDeclaration(t *testing.T) {
	driver := StableDiffusionImageDriver{}
	portable := stableDiffusionPortableForTest(t, map[string]any{
		"modelFamily": "qwen-image",
		"recipeId":    "qwen-image-edit-2511",
	})
	requirements, reason := driver.Interpret(InterpretInput{RecipeID: StableDiffusionQwenImageEditRecipeID, PortableConfig: portable, SupportedFeatures: []string{
		aicapabilities.FeatureInputImage,
		aicapabilities.FeatureInputImage,
	}})
	if reason != success || len(requirements) != 3 ||
		requirements[0].GetRequirementId() != StableDiffusionMainRequirementID ||
		requirements[1].GetRequirementId() != StableDiffusionTextEncoderRequirementID ||
		requirements[2].GetRequirementId() != StableDiffusionVAERequirementID {
		t.Fatalf("instruction-edit interpretation = %v %#v", reason, requirements)
	}
	for _, requirement := range requirements {
		if strings.Contains(requirement.GetRequirementId(), "input") || requirement.GetResourceKind() == inputImageFeature {
			t.Fatalf("input.image was incorrectly projected as a LocalAsset requirement: %#v", requirement)
		}
	}
	if _, reason := driver.Interpret(InterpretInput{RecipeID: StableDiffusionQwenImageEditRecipeID, PortableConfig: portable}); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED {
		t.Fatalf("missing derived feature claim reason = %v", reason)
	}
	textOnly := stableDiffusionPortableForTest(t, map[string]any{"modelFamily": "qwen-image", "recipeId": "qwen-image"})
	if _, reason := driver.Interpret(InterpretInput{RecipeID: StableDiffusionQwenImageRecipeID, PortableConfig: textOnly, SupportedFeatures: []string{inputImageFeature}}); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED {
		t.Fatalf("undeclared input.image reason = %v", reason)
	}
}

func TestStableDiffusionInterpretRejectsUnsupportedLoRAConfiguration(t *testing.T) {
	for _, loras := range []any{
		[]any{},
		[]any{map[string]any{"displayLabel": "unsupported", "weight": 0.7}},
	} {
		portable := stableDiffusionPortableForTest(t, map[string]any{
			"modelFamily": "z-image",
			"loras":       loras,
		})
		requirements, reason := (StableDiffusionImageDriver{}).Interpret(InterpretInput{RecipeID: "z-image", PortableConfig: portable})
		if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID || requirements != nil {
			t.Fatalf("LoRA config admission = reason=%v requirements=%#v", reason, requirements)
		}
	}
}

func TestStableDiffusionValidateCombinationRejectsRetiredLoRARequirementTail(t *testing.T) {
	portable := stableDiffusionPortableForTest(t, map[string]any{"modelFamily": "z-image"})
	requirements, reason := (StableDiffusionImageDriver{}).Interpret(InterpretInput{RecipeID: "z-image", PortableConfig: portable})
	if reason != success {
		t.Fatalf("Interpret: %v", reason)
	}
	requirements = append(requirements, &runtimev1.LocalCapabilityRequirement{
		RequirementId:     "companion.lora.1",
		Role:              runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION,
		ResourceKind:      "lora",
		Policy:            runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE,
		OccurrenceOrdinal: 1,
		DisplayLabel:      "Retired LoRA",
	})
	reason = (StableDiffusionImageDriver{}).ValidateCombination(
		requirements,
		make([]*runtimev1.ModelAssetExactBinding, len(requirements)),
		make([]ModelAssetDescriptor, len(requirements)),
	)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
		t.Fatalf("retired LoRA requirement tail reason = %v", reason)
	}
}

func TestStableDiffusionInterpretRejectsUnknownAndProtectedPortableFields(t *testing.T) {
	driver := StableDiffusionImageDriver{}
	for _, fields := range []map[string]any{
		{"modelFamily": "unknown"},
		{"modelFamily": "z-image-turbo"},
		{"modelFamily": "z-image-base"},
		{"modelFamily": "z-image", "modelPath": "/models/main.gguf"},
		{"modelFamily": "z-image", "mainRequirementPolicy": "strict"},
		{"modelFamily": "z-image", "mainVerifiedContentId": "sha256:" + strings.Repeat("a", 64)},
		{"modelFamily": "z-image", "uncondDiffusionVerifiedContentId": "sha256:" + strings.Repeat("a", 64)},
		{"modelFamily": "z-image", "loras": []any{map[string]any{"occurrenceOrdinal": 2}}},
		{"modelFamily": "z-image", "executionOptions": map[string]any{"steps": 0}},
	} {
		portable, err := structpb.NewStruct(fields)
		if err != nil {
			t.Fatal(err)
		}
		if _, reason := driver.Interpret(InterpretInput{RecipeID: "z-image", PortableConfig: portable}); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID {
			t.Fatalf("fields %#v reason = %v", fields, reason)
		}
	}
}

func TestStableDiffusionIdeogramProjectsUnconditionalDiffusionCompanion(t *testing.T) {
	portable := stableDiffusionPortableForTest(t, map[string]any{"modelFamily": "ideogram4"})
	requirements, reason := (StableDiffusionImageDriver{}).Interpret(InterpretInput{RecipeID: "ideogram4", PortableConfig: portable})
	if reason != success || len(requirements) != 4 {
		t.Fatalf("Interpret = %v %#v", reason, requirements)
	}
	uncond := requirements[3]
	if uncond.GetRequirementId() != StableDiffusionUncondDiffusionRequirementID || uncond.GetResourceKind() != "image" || uncond.GetOccurrenceOrdinal() != 0 {
		t.Fatalf("unconditional diffusion requirement = %#v", uncond)
	}
}

func TestStableDiffusionEffectiveRequestDefaultsUsePortableExecutionOptions(t *testing.T) {
	portable := stableDiffusionPortableForTest(t, map[string]any{
		"modelFamily":      "z-image",
		"executionOptions": map[string]any{"width": 768, "height": 512, "seed": 13},
	})
	defaults := (StableDiffusionImageDriver{}).EffectiveRequestDefaults("z-image", portable)
	if defaults["n"] != "1" || defaults["size"] != "768x512" || defaults["seed"] != "13" {
		t.Fatalf("effective request defaults = %#v", defaults)
	}
}

func TestStableDiffusionPlanNormalizesRequestAndProtectsCapturedState(t *testing.T) {
	portable := stableDiffusionPortableForTest(t, map[string]any{
		"modelFamily": "z-image",
		"executionOptions": map[string]any{
			"steps": 30, "cfgScale": 4.5, "width": 640, "height": 640, "seed": 13,
			"sampler": "euler_a", "scheduler": "karras", "threads": 8,
			"diffusionFlashAttention": true, "offloadParamsToCPU": true,
		},
	})
	root := t.TempDir()
	bindings := []InvocationExactBinding{
		stableDiffusionInvocationBindingForTest(StableDiffusionVAERequirementID, "vae", filepath.Join(root, "vae.safetensors"), 'c'),
		stableDiffusionInvocationBindingForTest(StableDiffusionMainRequirementID, "main", filepath.Join(root, "main.gguf"), 'a'),
		stableDiffusionInvocationBindingForTest(StableDiffusionTextEncoderRequirementID, "text", filepath.Join(root, "text.gguf"), 'b'),
	}
	plan, err := (StableDiffusionImageDriver{}).PlanImageInvocation(ImageInvocationInput{
		RecipeID:       "z-image",
		PortableConfig: portable,
		ExactBindings:  bindings,
		Request: &runtimev1.ImageGenerateScenarioSpec{
			Prompt: "  a lighthouse  ", NegativePrompt: " fog ", N: testInt32(2), Size: "768x512", Seed: testInt64(99),
		},
	})
	if err != nil {
		t.Fatalf("PlanImageInvocation: %v", err)
	}
	load, ok := plan.LoadPlan().(StableDiffusionCPPLoadPlan)
	if !ok {
		t.Fatalf("load plan type = %T", plan.LoadPlan())
	}
	request, ok := plan.RequestPlan().(StableDiffusionCPPTextToImageRequestPlan)
	if !ok {
		t.Fatalf("request plan type = %T", plan.RequestPlan())
	}
	result, ok := plan.ResultConstraints().(StableDiffusionCPPResultConstraints)
	if !ok {
		t.Fatalf("result constraints type = %T", plan.ResultConstraints())
	}
	if load.Main().AbsolutePath() != filepath.Join(root, "main.gguf") || load.TextEncoder().AbsolutePath() != filepath.Join(root, "text.gguf") || load.VAE().AbsolutePath() != filepath.Join(root, "vae.safetensors") {
		t.Fatalf("plan component paths are incomplete: %#v", plan.ModelFiles())
	}
	if request.Width() != 768 || request.Height() != 512 || request.Steps() != 30 || request.CFGScale() != 4.5 || request.Seed() != 99 || result.ArtifactCount() != 2 ||
		request.Prompt() != "a lighthouse" || request.NegativePrompt() != "fog" || request.Sampler() != "euler_a" || request.Scheduler() != "karras" ||
		load.Threads() != 8 || !load.DiffusionFlashAttention() || !load.OffloadParamsToCPU() || result.MediaType() != "image/png" {
		t.Fatalf("normalized plan sampling fields are incorrect")
	}
	files := plan.ModelFiles()
	files[0] = InvocationExactBinding{}
	if plan.ModelFiles()[0].AbsolutePath == "" {
		t.Fatal("image plan exposed mutable captured state")
	}
}

func TestStableDiffusionQwenGeneratePlansExactThreeSlotTopology(t *testing.T) {
	root := t.TempDir()
	mainPath := filepath.Join(root, "qwen-image.gguf")
	textPath := filepath.Join(root, "qwen-vl.gguf")
	vaePath := filepath.Join(root, "qwen-image-vae.safetensors")
	bindings := []InvocationExactBinding{
		stableDiffusionInvocationBindingForTest(StableDiffusionVAERequirementID, "vae", vaePath, 'c'),
		stableDiffusionInvocationBindingForTest(StableDiffusionMainRequirementID, "main", mainPath, 'a'),
		stableDiffusionInvocationBindingForTest(StableDiffusionTextEncoderRequirementID, "text", textPath, 'b'),
	}
	plan, err := (StableDiffusionImageDriver{}).PlanImageInvocation(ImageInvocationInput{
		RecipeID: StableDiffusionQwenImageRecipeID,
		PortableConfig: stableDiffusionPortableForTest(t, map[string]any{
			"modelFamily": "qwen-image", "recipeId": "qwen-image",
		}),
		ExactBindings: bindings,
		Request:       &runtimev1.ImageGenerateScenarioSpec{Prompt: "a moonlit harbor"},
	})
	if err != nil {
		t.Fatalf("PlanImageInvocation: %v", err)
	}
	load, loadOK := plan.LoadPlan().(StableDiffusionCPPLoadPlan)
	_, requestOK := plan.RequestPlan().(StableDiffusionCPPTextToImageRequestPlan)
	files := plan.ModelFiles()
	_, hasUncond := load.UncondDiffusion()
	if !loadOK || !requestOK || load.RecipeID() != "qwen-image" || len(files) != 3 ||
		files[0].AbsolutePath != mainPath || files[1].AbsolutePath != textPath || files[2].AbsolutePath != vaePath ||
		load.Main().AbsolutePath() != mainPath || load.TextEncoder().AbsolutePath() != textPath || load.VAE().AbsolutePath() != vaePath ||
		hasUncond || load.QwenImageZeroCondT() || load.FlowShift() != 3 {
		t.Fatalf("Qwen Image three-slot plan is incomplete: files=%#v load=%#v request=%T", files, load, plan.RequestPlan())
	}
}

func TestStableDiffusionQwenRecipesProjectSubstitutableModelContractSlots(t *testing.T) {
	driver := StableDiffusionImageDriver{}
	for _, test := range []struct {
		name     string
		recipeID string
		features []string
	}{
		{name: "generate", recipeID: StableDiffusionQwenImageRecipeID},
		{name: "edit", recipeID: StableDiffusionQwenImageEditRecipeID, features: []string{aicapabilities.FeatureInputImage}},
	} {
		t.Run(test.name, func(t *testing.T) {
			options := stableDiffusionPortableForTest(t, map[string]any{"modelFamily": "qwen-image", "recipeId": test.recipeID})
			requirements, reason := driver.ProjectRecipe(test.recipeID, options, test.features)
			if reason != success || len(requirements) != 3 {
				t.Fatalf("ProjectRecipe = %v %#v", reason, requirements)
			}
			for _, requirement := range requirements {
				if requirement.GetPolicy() != runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE ||
					requirement.GetPreferredVerifiedContentId() != "" {
					t.Fatalf("catalog recommendation leaked into Driver admission: %#v", requirement)
				}
			}
		})
	}
}

func TestStableDiffusionIdeogram4PlansExactFourSlotTopology(t *testing.T) {
	root := t.TempDir()
	mainPath := filepath.Join(root, "ideogram4.gguf")
	textPath := filepath.Join(root, "qwen-vl.gguf")
	vaePath := filepath.Join(root, "flux2-vae.safetensors")
	uncondPath := filepath.Join(root, "ideogram4-uncond.gguf")
	bindings := []InvocationExactBinding{
		stableDiffusionInvocationBindingForTest(StableDiffusionUncondDiffusionRequirementID, "uncond", uncondPath, 'd'),
		stableDiffusionInvocationBindingForTest(StableDiffusionVAERequirementID, "vae", vaePath, 'c'),
		stableDiffusionInvocationBindingForTest(StableDiffusionTextEncoderRequirementID, "text", textPath, 'b'),
		stableDiffusionInvocationBindingForTest(StableDiffusionMainRequirementID, "main", mainPath, 'a'),
	}
	plan, err := (StableDiffusionImageDriver{}).PlanImageInvocation(ImageInvocationInput{
		RecipeID: "ideogram4",
		PortableConfig: stableDiffusionPortableForTest(t, map[string]any{
			"modelFamily": "ideogram4", "recipeId": "ideogram4",
		}),
		ExactBindings: bindings,
		Request:       &runtimev1.ImageGenerateScenarioSpec{Prompt: "editorial poster"},
	})
	if err != nil {
		t.Fatalf("PlanImageInvocation: %v", err)
	}
	load, loadOK := plan.LoadPlan().(StableDiffusionCPPLoadPlan)
	_, requestOK := plan.RequestPlan().(StableDiffusionCPPTextToImageRequestPlan)
	uncond, hasUncond := load.UncondDiffusion()
	files := plan.ModelFiles()
	if !loadOK || !requestOK || load.RecipeID() != "ideogram4" || len(files) != 4 ||
		files[0].AbsolutePath != mainPath || files[1].AbsolutePath != textPath || files[2].AbsolutePath != vaePath || files[3].AbsolutePath != uncondPath ||
		load.Main().AbsolutePath() != mainPath || load.TextEncoder().AbsolutePath() != textPath || load.VAE().AbsolutePath() != vaePath ||
		!hasUncond || uncond.AbsolutePath() != uncondPath || load.QwenImageZeroCondT() {
		t.Fatalf("Ideogram4 four-slot plan is incomplete: files=%#v load=%#v request=%T", files, load, plan.RequestPlan())
	}
}

func TestStableDiffusionDriverTranslatesOnlyValidBackendObservations(t *testing.T) {
	portable := stableDiffusionPortableForTest(t, map[string]any{
		"modelFamily":      "z-image",
		"executionOptions": map[string]any{"steps": 20, "width": 64, "height": 64},
	})
	root := t.TempDir()
	bindings := []InvocationExactBinding{
		stableDiffusionInvocationBindingForTest(StableDiffusionMainRequirementID, "main", filepath.Join(root, "main.gguf"), 'a'),
		stableDiffusionInvocationBindingForTest(StableDiffusionTextEncoderRequirementID, "text", filepath.Join(root, "text.gguf"), 'b'),
		stableDiffusionInvocationBindingForTest(StableDiffusionVAERequirementID, "vae", filepath.Join(root, "vae.safetensors"), 'c'),
	}
	plan, err := (StableDiffusionImageDriver{}).PlanImageInvocation(ImageInvocationInput{
		RecipeID:       "z-image",
		PortableConfig: portable,
		ExactBindings:  bindings,
		Request:        &runtimev1.ImageGenerateScenarioSpec{Prompt: "image", Size: "64x64"},
	})
	if err != nil {
		t.Fatal(err)
	}
	progress, err := plan.TranslateProgress(ImageBackendProgressObservation{CurrentStep: 10, TotalSteps: 20, ProgressPercent: 50})
	if err != nil || progress.CurrentStep != 10 {
		t.Fatalf("valid progress = %+v err=%v", progress, err)
	}
	for _, observation := range []ImageBackendProgressObservation{
		{CurrentStep: 0, TotalSteps: 20, ProgressPercent: 0},
		{CurrentStep: 10, TotalSteps: 19, ProgressPercent: 52},
		{CurrentStep: 10, TotalSteps: 20, ProgressPercent: 49},
	} {
		if _, err := plan.TranslateProgress(observation); err == nil {
			t.Fatalf("invalid progress was accepted: %+v", observation)
		}
	}
	artifact, err := plan.TranslateArtifact(ImageBackendArtifactObservation{
		Index: 1, Seed: 7, Payload: []byte("png"), Format: "png", Width: 64, Height: 64,
	})
	if err != nil || artifact.MediaType != "image/png" || artifact.Seed != 7 {
		t.Fatalf("valid artifact = %+v err=%v", artifact, err)
	}
	for _, observation := range []ImageBackendArtifactObservation{
		{Index: 0, Payload: []byte("png"), Format: "png", Width: 64, Height: 64},
		{Index: 1, Payload: nil, Format: "png", Width: 64, Height: 64},
		{Index: 1, Seed: -1, Payload: []byte("png"), Format: "png", Width: 64, Height: 64},
		{Index: 1, Payload: []byte("png"), Format: "jpeg", Width: 64, Height: 64},
		{Index: 1, Payload: []byte("png"), Format: "png", Width: 128, Height: 64},
	} {
		if _, err := plan.TranslateArtifact(observation); err == nil {
			t.Fatalf("invalid artifact was accepted: %+v", observation)
		}
	}
	if err := plan.TranslateFailure(ImageBackendFailureStage("unknown"), errors.New("backend")); err == nil || !strings.Contains(err.Error(), "stage is unknown") {
		t.Fatalf("unknown failure stage = %v", err)
	}
}

func TestStableDiffusionPlanClassifiesImageCountAndSizeAsInvalidOptions(t *testing.T) {
	portable := stableDiffusionPortableForTest(t, map[string]any{"modelFamily": "z-image"})
	root := t.TempDir()
	bindings := []InvocationExactBinding{
		stableDiffusionInvocationBindingForTest(StableDiffusionVAERequirementID, "vae", filepath.Join(root, "vae.safetensors"), 'c'),
		stableDiffusionInvocationBindingForTest(StableDiffusionMainRequirementID, "main", filepath.Join(root, "main.gguf"), 'a'),
		stableDiffusionInvocationBindingForTest(StableDiffusionTextEncoderRequirementID, "text", filepath.Join(root, "text.gguf"), 'b'),
	}
	driver := StableDiffusionImageDriver{}

	valid := []struct {
		name      string
		n         *int32
		size      string
		wantCount int
	}{
		{name: "absent count", wantCount: 1},
		{name: "minimum count and size", n: testInt32(1), size: "64x64", wantCount: 1},
		{name: "maximum count and size", n: testInt32(4), size: "4096x4096", wantCount: 4},
	}
	for _, test := range valid {
		t.Run(test.name, func(t *testing.T) {
			plan, err := driver.PlanImageInvocation(ImageInvocationInput{
				RecipeID:       "z-image",
				PortableConfig: portable,
				ExactBindings:  bindings,
				Request:        &runtimev1.ImageGenerateScenarioSpec{Prompt: "image", N: test.n, Size: test.size},
			})
			if err != nil || plan == nil || plan.ImageCount() != test.wantCount {
				t.Fatalf("plan=%v count=%d err=%v", plan, plan.ImageCount(), err)
			}
		})
	}

	invalid := []struct {
		name string
		n    *int32
		size string
	}{
		{name: "explicit zero count", n: testInt32(0)},
		{name: "negative count", n: testInt32(-1)},
		{name: "count above local maximum", n: testInt32(5)},
		{name: "malformed size", size: "not-a-size"},
		{name: "width below minimum", size: "63x64"},
		{name: "height not divisible by eight", size: "64x65"},
		{name: "dimension above maximum", size: "4104x64"},
	}
	for _, test := range invalid {
		t.Run(test.name, func(t *testing.T) {
			_, err := driver.PlanImageInvocation(ImageInvocationInput{
				RecipeID:       "z-image",
				PortableConfig: portable,
				ExactBindings:  bindings,
				Request:        &runtimev1.ImageGenerateScenarioSpec{Prompt: "image", N: test.n, Size: test.size},
			})
			var invocationErr *InvocationError
			if !errors.As(err, &invocationErr) || invocationErr.Kind != InvocationFailureInvalidOption {
				t.Fatalf("error=%v kind=%v", err, invocationErr)
			}
		})
	}
}

func TestStableDiffusionImageRecipeModelFamilyIsExact(t *testing.T) {
	for recipeID, want := range map[string]string{
		"z-image":              "z-image",
		"ideogram4":            "ideogram4",
		"qwen-image":           "qwen-image",
		"qwen-image-edit-2511": "qwen-image",
	} {
		if got, ok := StableDiffusionImageRecipeModelFamily(recipeID); !ok || got != want {
			t.Fatalf("recipe %q family=%q present=%v, want %q", recipeID, got, ok, want)
		}
	}
	for _, recipeID := range []string{"", "flux"} {
		if got, ok := StableDiffusionImageRecipeModelFamily(recipeID); ok {
			t.Fatalf("unsupported recipe %q returned family %q", recipeID, got)
		}
	}
}

func TestStableDiffusionPlanOwnsResponseFormatAdmission(t *testing.T) {
	t.Parallel()
	portable := stableDiffusionPortableForTest(t, map[string]any{"modelFamily": "z-image"})
	root := t.TempDir()
	bindings := []InvocationExactBinding{
		stableDiffusionInvocationBindingForTest(StableDiffusionVAERequirementID, "vae", filepath.Join(root, "vae.safetensors"), 'c'),
		stableDiffusionInvocationBindingForTest(StableDiffusionMainRequirementID, "main", filepath.Join(root, "main.gguf"), 'a'),
		stableDiffusionInvocationBindingForTest(StableDiffusionTextEncoderRequirementID, "text", filepath.Join(root, "text.gguf"), 'b'),
	}
	driver := StableDiffusionImageDriver{}

	for _, responseFormat := range []string{"", "b64_json", "base64", "url", "B64_JSON"} {
		if _, err := driver.PlanImageInvocation(ImageInvocationInput{
			RecipeID:       "z-image",
			PortableConfig: portable,
			ExactBindings:  bindings,
			Request: &runtimev1.ImageGenerateScenarioSpec{
				Prompt:         "image",
				ResponseFormat: responseFormat,
			},
		}); err != nil {
			t.Fatalf("supported response format %q: %v", responseFormat, err)
		}
	}

	_, err := driver.PlanImageInvocation(ImageInvocationInput{
		RecipeID:       "z-image",
		PortableConfig: portable,
		ExactBindings:  bindings,
		Request: &runtimev1.ImageGenerateScenarioSpec{
			Prompt:         "image",
			ResponseFormat: "binary",
		},
	})
	var invocationErr *InvocationError
	if !errors.As(err, &invocationErr) || invocationErr.Kind != InvocationFailureInvalidOption {
		t.Fatalf("unsupported response format error=%v kind=%v", err, invocationErr)
	}
}

func TestStableDiffusionSeedAdmissionMatchesManagedInt32Carrier(t *testing.T) {
	driver := StableDiffusionImageDriver{}
	for _, seed := range []int64{math.MinInt32, math.MaxInt32} {
		portable := stableDiffusionPortableForTest(t, map[string]any{
			"modelFamily":      "z-image",
			"executionOptions": map[string]any{"seed": seed},
		})
		if _, reason := driver.Interpret(InterpretInput{RecipeID: "z-image", PortableConfig: portable}); reason != success {
			t.Fatalf("portable seed %d reason = %v", seed, reason)
		}
		if got := driver.EffectiveRequestDefaults("z-image", portable)["seed"]; got != fmt.Sprint(seed) {
			t.Fatalf("portable seed %d default = %q", seed, got)
		}
	}
	for _, seed := range []int64{int64(math.MinInt32) - 1, int64(math.MaxInt32) + 1} {
		portable := stableDiffusionPortableForTest(t, map[string]any{
			"modelFamily":      "z-image",
			"executionOptions": map[string]any{"seed": seed},
		})
		if _, reason := driver.Interpret(InterpretInput{RecipeID: "z-image", PortableConfig: portable}); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID {
			t.Fatalf("portable seed %d reason = %v", seed, reason)
		}
	}

	portable := stableDiffusionPortableForTest(t, map[string]any{"modelFamily": "z-image"})
	root := t.TempDir()
	bindings := []InvocationExactBinding{
		stableDiffusionInvocationBindingForTest(StableDiffusionVAERequirementID, "vae", filepath.Join(root, "vae.safetensors"), 'c'),
		stableDiffusionInvocationBindingForTest(StableDiffusionMainRequirementID, "main", filepath.Join(root, "main.gguf"), 'a'),
		stableDiffusionInvocationBindingForTest(StableDiffusionTextEncoderRequirementID, "text", filepath.Join(root, "text.gguf"), 'b'),
	}
	for _, seed := range []int64{0, -1, math.MinInt32, math.MaxInt32} {
		plan, err := driver.PlanImageInvocation(ImageInvocationInput{
			RecipeID:       "z-image",
			PortableConfig: portable,
			ExactBindings:  bindings,
			Request:        &runtimev1.ImageGenerateScenarioSpec{Prompt: "image", Seed: testInt64(seed)},
		})
		if err != nil || plan.RequestPlan().Seed() != seed {
			t.Fatalf("request seed %d plan=%v err=%v", seed, plan, err)
		}
	}
	omitted, err := driver.PlanImageInvocation(ImageInvocationInput{
		RecipeID:       "z-image",
		PortableConfig: portable,
		ExactBindings:  bindings,
		Request:        &runtimev1.ImageGenerateScenarioSpec{Prompt: "image"},
	})
	if err != nil || omitted == nil || omitted.RequestPlan().Seed() != 42 {
		t.Fatalf("omitted request seed plan=%v err=%v", omitted, err)
	}
	for _, seed := range []int64{int64(math.MinInt32) - 1, int64(math.MaxInt32) + 1} {
		_, err := driver.PlanImageInvocation(ImageInvocationInput{
			RecipeID:       "z-image",
			PortableConfig: portable,
			ExactBindings:  bindings,
			Request:        &runtimev1.ImageGenerateScenarioSpec{Prompt: "image", Seed: testInt64(seed)},
		})
		var invocationErr *InvocationError
		if !errors.As(err, &invocationErr) || invocationErr.Kind != InvocationFailureInvalidRequest {
			t.Fatalf("request seed %d error = %v", seed, err)
		}
	}
	_, err = driver.PlanImageInvocation(ImageInvocationInput{
		RecipeID:       "z-image",
		PortableConfig: portable,
		ExactBindings:  bindings,
		Request:        &runtimev1.ImageGenerateScenarioSpec{Prompt: "overflow", N: testInt32(2), Seed: testInt64(math.MaxInt32)},
	})
	var overflowErr *InvocationError
	if !errors.As(err, &overflowErr) || overflowErr.Kind != InvocationFailureInvalidRequest {
		t.Fatalf("batch seed overflow error = %v", err)
	}
	bounded, err := driver.PlanImageInvocation(ImageInvocationInput{
		RecipeID:       "z-image",
		PortableConfig: portable,
		ExactBindings:  bindings,
		Request:        &runtimev1.ImageGenerateScenarioSpec{Prompt: "bounded", N: testInt32(4), Seed: testInt64(math.MaxInt32 - 3)},
	})
	if err != nil {
		t.Fatalf("bounded batch seed plan: %v", err)
	}
	if got, err := bounded.ResolveArtifactSeed(math.MaxInt32-3, 4); err != nil || got != math.MaxInt32 {
		t.Fatalf("last bounded batch seed = %d, err=%v", got, err)
	}
}

func TestStableDiffusionProcessKeyCoversEveryLoadTimeInstruction(t *testing.T) {
	root := t.TempDir()
	bindings := []InvocationExactBinding{
		stableDiffusionInvocationBindingForTest(StableDiffusionMainRequirementID, "main", filepath.Join(root, "main.gguf"), 'a'),
		stableDiffusionInvocationBindingForTest(StableDiffusionTextEncoderRequirementID, "text", filepath.Join(root, "text.gguf"), 'b'),
		stableDiffusionInvocationBindingForTest(StableDiffusionVAERequirementID, "vae", filepath.Join(root, "vae.safetensors"), 'c'),
	}
	plan := func(cfgScale float64, sampler, scheduler, prompt string) *ImageInvocationPlan {
		portable := stableDiffusionPortableForTest(t, map[string]any{
			"modelFamily": "z-image",
			"executionOptions": map[string]any{
				"steps": 9, "cfgScale": cfgScale, "width": 512, "height": 512, "seed": 7,
				"threads": 4, "sampler": sampler, "scheduler": scheduler,
			},
		})
		planned, err := (StableDiffusionImageDriver{}).PlanImageInvocation(ImageInvocationInput{
			RecipeID:       "z-image",
			PortableConfig: portable, ExactBindings: bindings,
			Request: &runtimev1.ImageGenerateScenarioSpec{Prompt: prompt, N: testInt32(1), Size: "512x512", Seed: testInt64(7)},
		})
		if err != nil {
			t.Fatal(err)
		}
		return planned
	}
	baseline := plan(1, "euler", "discrete", "first prompt")
	if baseline.ProcessKey() != plan(1, "euler", "discrete", "different request prompt").ProcessKey() {
		t.Fatal("request-only prompt changed the resident process key")
	}
	for _, changed := range []*ImageInvocationPlan{
		plan(2, "euler", "discrete", "first prompt"),
		plan(1, "euler_a", "discrete", "first prompt"),
		plan(1, "euler", "karras", "first prompt"),
	} {
		if baseline.ProcessKey() == changed.ProcessKey() {
			t.Fatal("load-time instruction was omitted from the resident process key")
		}
	}
}

func TestStableDiffusionQwenEditRequiresTypedRecipeAndSource(t *testing.T) {
	root := t.TempDir()
	source := ImageResolvedInput{Role: ImageResolvedInputRoleSource, SourceIdentity: "artifact_qwen_edit_source", ImageBytes: []byte("source-image")}
	mainPath := filepath.Join(root, "main.gguf")
	textPath := filepath.Join(root, "text.gguf")
	vaePath := filepath.Join(root, "vae.safetensors")
	bindings := []InvocationExactBinding{
		stableDiffusionInvocationBindingForTest(StableDiffusionMainRequirementID, "main", mainPath, 'a'),
		stableDiffusionInvocationBindingForTest(StableDiffusionTextEncoderRequirementID, "text", textPath, 'b'),
		stableDiffusionInvocationBindingForTest(StableDiffusionVAERequirementID, "vae", vaePath, 'c'),
	}
	request := &runtimev1.ImageGenerateScenarioSpec{
		Prompt: "change the sky to sunset",
	}
	withoutFeature := stableDiffusionPortableForTest(t, map[string]any{
		"modelFamily": "qwen-image", "recipeId": "qwen-image-edit-2511",
	})
	_, err := (StableDiffusionImageDriver{}).PlanImageInvocation(ImageInvocationInput{RecipeID: StableDiffusionQwenImageEditRecipeID, PortableConfig: withoutFeature, ExactBindings: bindings, Request: request, Inputs: []ImageResolvedInput{source}})
	var invocationErr *InvocationError
	if !errors.As(err, &invocationErr) || invocationErr.Kind != InvocationFailureInvalidConfig {
		t.Fatalf("undeclared input.image error = %v", err)
	}
	plan, err := (StableDiffusionImageDriver{}).PlanImageInvocation(ImageInvocationInput{
		RecipeID:          StableDiffusionQwenImageEditRecipeID,
		PortableConfig:    withoutFeature,
		SupportedFeatures: []string{aicapabilities.FeatureInputImage},
		ExactBindings:     bindings,
		Request:           request,
		Inputs:            []ImageResolvedInput{source},
	})
	if err != nil {
		t.Fatalf("PlanImageInvocation: %v", err)
	}
	edit, ok := plan.RequestPlan().(StableDiffusionCPPInstructionEditRequestPlan)
	load, loadOK := plan.LoadPlan().(StableDiffusionCPPLoadPlan)
	plannedSource := edit.SourceImage()
	_, hasUncond := load.UncondDiffusion()
	files := plan.ModelFiles()
	if !ok || !loadOK || load.RecipeID() != "qwen-image-edit-2511" || len(files) != 3 ||
		files[0].AbsolutePath != mainPath || files[1].AbsolutePath != textPath || files[2].AbsolutePath != vaePath ||
		load.Main().AbsolutePath() != mainPath || load.TextEncoder().AbsolutePath() != textPath || load.VAE().AbsolutePath() != vaePath ||
		hasUncond ||
		!load.QwenImageZeroCondT() || load.FlowShift() != 3 || plannedSource.SourceIdentity != source.SourceIdentity ||
		!bytes.Equal(plannedSource.ImageBytes, source.ImageBytes) || edit.ImageCount() != 1 {
		t.Fatalf("typed Qwen edit plan is incomplete: plan=%#v load=%#v", plan, load)
	}
	source.ImageBytes[0] = 'X'
	plannedSource.ImageBytes[0] = 'Y'
	if got := edit.SourceImage().ImageBytes; !bytes.Equal(got, []byte("source-image")) {
		t.Fatalf("Qwen edit plan did not retain immutable source bytes: %q", got)
	}
	withUnexpected := append(append([]InvocationExactBinding(nil), bindings...),
		stableDiffusionInvocationBindingForTest("companion.unexpected", "unexpected", filepath.Join(root, "unexpected.gguf"), 'd'))
	_, err = (StableDiffusionImageDriver{}).PlanImageInvocation(ImageInvocationInput{
		RecipeID:          StableDiffusionQwenImageEditRecipeID,
		PortableConfig:    withoutFeature,
		SupportedFeatures: []string{aicapabilities.FeatureInputImage},
		ExactBindings:     withUnexpected,
		Request:           request,
		Inputs:            []ImageResolvedInput{{Role: ImageResolvedInputRoleSource, SourceIdentity: "artifact_qwen_edit_source", ImageBytes: []byte("source-image")}},
	})
	if !errors.As(err, &invocationErr) || invocationErr.Kind != InvocationFailureInvalidBinding {
		t.Fatalf("Qwen edit unexpected binding error = %v", err)
	}
}

func TestStableDiffusionRecipesOwnImageInputSemantics(t *testing.T) {
	root := t.TempDir()
	bindings := []InvocationExactBinding{
		stableDiffusionInvocationBindingForTest(StableDiffusionMainRequirementID, "main", filepath.Join(root, "main.gguf"), 'a'),
		stableDiffusionInvocationBindingForTest(StableDiffusionTextEncoderRequirementID, "text", filepath.Join(root, "text.gguf"), 'b'),
		stableDiffusionInvocationBindingForTest(StableDiffusionVAERequirementID, "vae", filepath.Join(root, "vae.safetensors"), 'c'),
	}
	portable := stableDiffusionPortableForTest(t, map[string]any{
		"modelFamily": "qwen-image", "recipeId": "qwen-image-edit-2511",
	})
	driver := StableDiffusionImageDriver{}
	for _, test := range []struct {
		name     string
		portable *structpb.Struct
		features []string
		inputs   []ImageResolvedInput
		mask     string
		maskID   string
		strength *float32
		negative string
		n        *int32
	}{
		{
			name: "edit missing source", portable: portable,
			features: []string{aicapabilities.FeatureInputImage},
		},
		{
			name: "edit multiple sources", portable: portable,
			features: []string{aicapabilities.FeatureInputImage}, inputs: []ImageResolvedInput{
				{Role: ImageResolvedInputRoleSource, SourceIdentity: "artifact_source_a", ImageBytes: []byte("a")},
				{Role: ImageResolvedInputRoleSource, SourceIdentity: "artifact_source_b", ImageBytes: []byte("b")},
			},
		},
		{
			name: "edit rejects mask", portable: portable,
			features: []string{aicapabilities.FeatureInputImage}, inputs: []ImageResolvedInput{{Role: ImageResolvedInputRoleSource, SourceIdentity: "artifact_source", ImageBytes: []byte("source")}}, mask: "mask.png",
		},
		{
			name: "edit rejects mask artifact", portable: portable,
			features: []string{aicapabilities.FeatureInputImage}, inputs: []ImageResolvedInput{
				{Role: ImageResolvedInputRoleSource, SourceIdentity: "artifact_source", ImageBytes: []byte("source")},
				{Role: ImageResolvedInputRoleMask, SourceIdentity: "artifact_mask", ImageBytes: []byte("mask")},
			}, maskID: "artifact_mask",
		},
		{
			name: "edit rejects strength", portable: portable,
			features: []string{aicapabilities.FeatureInputImage}, inputs: []ImageResolvedInput{{Role: ImageResolvedInputRoleSource, SourceIdentity: "artifact_source", ImageBytes: []byte("source")}}, strength: testFloat32(0.5),
		},
		{
			name: "edit rejects multiple outputs", portable: portable,
			features: []string{aicapabilities.FeatureInputImage}, inputs: []ImageResolvedInput{{Role: ImageResolvedInputRoleSource, SourceIdentity: "artifact_source", ImageBytes: []byte("source")}}, n: testInt32(2),
		},
		{
			name: "edit rejects negative prompt", portable: portable,
			features: []string{aicapabilities.FeatureInputImage}, inputs: []ImageResolvedInput{{Role: ImageResolvedInputRoleSource, SourceIdentity: "artifact_source", ImageBytes: []byte("source")}}, negative: "do not change the background",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := driver.PlanImageInvocation(ImageInvocationInput{
				RecipeID:          StableDiffusionQwenImageEditRecipeID,
				PortableConfig:    test.portable,
				SupportedFeatures: test.features,
				ExactBindings:     bindings,
				Request:           &runtimev1.ImageGenerateScenarioSpec{Prompt: "edit", NegativePrompt: test.negative, Mask: test.mask, MaskArtifactId: test.maskID, Strength: test.strength, N: test.n},
				Inputs:            test.inputs,
			})
			var invocationErr *InvocationError
			if !errors.As(err, &invocationErr) || invocationErr.Kind != InvocationFailureUnsupported {
				t.Fatalf("recipe input error = %v", err)
			}
		})
	}
}

func TestStableDiffusionGenerateRecipeRejectsInputImageAfterExactBinding(t *testing.T) {
	root := t.TempDir()
	bindings := []InvocationExactBinding{
		stableDiffusionInvocationBindingForTest(StableDiffusionMainRequirementID, "main", filepath.Join(root, "main.gguf"), 'a'),
		stableDiffusionInvocationBindingForTest(StableDiffusionTextEncoderRequirementID, "text", filepath.Join(root, "text.gguf"), 'b'),
		stableDiffusionInvocationBindingForTest(StableDiffusionVAERequirementID, "vae", filepath.Join(root, "vae.safetensors"), 'c'),
	}
	portable := stableDiffusionPortableForTest(t, map[string]any{"modelFamily": "qwen-image", "recipeId": "qwen-image"})
	driver := StableDiffusionImageDriver{}
	if _, err := driver.PlanImageInvocation(ImageInvocationInput{
		RecipeID:       StableDiffusionQwenImageRecipeID,
		PortableConfig: portable, ExactBindings: bindings,
		Request: &runtimev1.ImageGenerateScenarioSpec{Prompt: "generate"},
	}); err != nil {
		t.Fatalf("exact generate bindings were not valid: %v", err)
	}
	_, err := driver.PlanImageInvocation(ImageInvocationInput{
		RecipeID:       StableDiffusionQwenImageRecipeID,
		PortableConfig: portable, ExactBindings: bindings,
		Request: &runtimev1.ImageGenerateScenarioSpec{Prompt: "generate"},
		Inputs:  []ImageResolvedInput{{Role: ImageResolvedInputRoleSource, SourceIdentity: "artifact_source", ImageBytes: []byte("source")}},
	})
	var invocationErr *InvocationError
	if !errors.As(err, &invocationErr) || invocationErr.Kind != InvocationFailureUnsupported ||
		!strings.Contains(err.Error(), "input.image") || strings.Contains(strings.ToLower(err.Error()), "binding") {
		t.Fatalf("generate input.image must fail at request semantics after exact binding: %v", err)
	}
}

func stableDiffusionPortableForTest(t *testing.T, fields map[string]any) *structpb.Struct {
	t.Helper()
	owned := make(map[string]any, len(fields))
	for key, value := range fields {
		if key == "modelFamily" || key == "recipeId" {
			continue
		}
		owned[key] = value
	}
	portable, err := structpb.NewStruct(owned)
	if err != nil {
		t.Fatalf("NewStruct: %v", err)
	}
	return portable
}

func stableDiffusionInvocationBindingForTest(requirementID, modelAssetID, absolutePath string, marker byte) InvocationExactBinding {
	digest := strings.Repeat(string(marker), 64)
	return InvocationExactBinding{
		RequirementID: requirementID, ModelAssetID: modelAssetID, AbsolutePath: absolutePath,
		VerifiedContentID: "sha256:" + digest, EntrySHA256: digest,
	}
}
