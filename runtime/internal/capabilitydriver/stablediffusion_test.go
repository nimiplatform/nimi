package capabilitydriver

import (
	"crypto/sha256"
	"encoding/hex"
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
	requirements, reason := (StableDiffusionImageDriver{}).Interpret(InterpretInput{PortableConfig: portable})
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
}

func TestStableDiffusionInterpretInputImageSupportMustMatchPortableDeclaration(t *testing.T) {
	driver := StableDiffusionImageDriver{}
	portable := stableDiffusionPortableForTest(t, map[string]any{
		"modelFamily":      "z-image",
		"enableInputImage": true,
	})
	requirements, reason := driver.Interpret(InterpretInput{PortableConfig: portable, SupportedFeatures: []string{
		aicapabilities.FeatureInputImage,
		aicapabilities.FeatureInputMask,
		aicapabilities.FeatureInputImage,
	}})
	if reason != success || len(requirements) != 3 {
		t.Fatalf("img2img interpretation = %v %#v", reason, requirements)
	}
	for _, requirement := range requirements {
		if strings.Contains(requirement.GetRequirementId(), "input") || requirement.GetResourceKind() == inputImageFeature {
			t.Fatalf("input.image was incorrectly projected as a LocalAsset requirement: %#v", requirement)
		}
	}
	if _, reason := driver.Interpret(InterpretInput{PortableConfig: portable}); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED {
		t.Fatalf("missing derived feature claim reason = %v", reason)
	}
	textOnly := stableDiffusionPortableForTest(t, map[string]any{"modelFamily": "z-image"})
	if _, reason := driver.Interpret(InterpretInput{PortableConfig: textOnly, SupportedFeatures: []string{inputImageFeature}}); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED {
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
		requirements, reason := (StableDiffusionImageDriver{}).Interpret(InterpretInput{PortableConfig: portable})
		if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID || requirements != nil {
			t.Fatalf("LoRA config admission = reason=%v requirements=%#v", reason, requirements)
		}
	}
}

func TestStableDiffusionValidateCombinationRejectsRetiredLoRARequirementTail(t *testing.T) {
	portable := stableDiffusionPortableForTest(t, map[string]any{"modelFamily": "z-image"})
	requirements, reason := (StableDiffusionImageDriver{}).Interpret(InterpretInput{PortableConfig: portable})
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
		make([]*runtimev1.LocalAssetExactBinding, len(requirements)),
		make([]AssetDescriptor, len(requirements)),
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
		{"modelFamily": "z-image", "modelPath": "/models/main.gguf"},
		{"modelFamily": "z-image", "mainRequirementPolicy": "strict"},
		{"modelFamily": "z-image", "mainVerifiedContentId": "sha256:" + strings.Repeat("a", 64)},
		{"modelFamily": "z-image", "uncondDiffusionVerifiedContentId": "sha256:" + strings.Repeat("a", 64)},
		{"modelFamily": "z-image", "loras": []any{map[string]any{"occurrenceOrdinal": 2}}},
		{"modelFamily": "z-image", "executionOptions": map[string]any{"steps": 0}},
	} {
		if _, reason := driver.Interpret(InterpretInput{PortableConfig: stableDiffusionPortableForTest(t, fields)}); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID {
			t.Fatalf("fields %#v reason = %v", fields, reason)
		}
	}
}

func TestStableDiffusionIdeogramProjectsUnconditionalDiffusionCompanion(t *testing.T) {
	portable := stableDiffusionPortableForTest(t, map[string]any{"modelFamily": "ideogram4"})
	requirements, reason := (StableDiffusionImageDriver{}).Interpret(InterpretInput{PortableConfig: portable})
	if reason != success || len(requirements) != 4 {
		t.Fatalf("Interpret = %v %#v", reason, requirements)
	}
	uncond := requirements[3]
	if uncond.GetRequirementId() != StableDiffusionUncondDiffusionRequirementID || uncond.GetResourceKind() != "image" || uncond.GetOccurrenceOrdinal() != 0 {
		t.Fatalf("unconditional diffusion requirement = %#v", uncond)
	}
}

func TestStableDiffusionValidateBindingChecksCanonicalBundleDigest(t *testing.T) {
	entries := []BundleEntryDescriptor{
		{Ordinal: 1, SHA256: strings.Repeat("a", 64)},
		{Ordinal: 2, SHA256: strings.Repeat("b", 64)},
	}
	digest, err := CanonicalBundleSHA256(entries)
	if err != nil {
		t.Fatal(err)
	}
	portable := stableDiffusionPortableForTest(t, map[string]any{"modelFamily": "z-image"})
	requirements, reason := (StableDiffusionImageDriver{}).Interpret(InterpretInput{PortableConfig: portable})
	if reason != success {
		t.Fatalf("Interpret: %v", reason)
	}
	binding := &runtimev1.LocalAssetExactBinding{
		RequirementId: StableDiffusionMainRequirementID, LocalAssetId: "bundle-main",
		VerifiedContentId: "sha256:" + digest, EntrySha256: digest,
	}
	asset := AssetDescriptor{
		LocalAssetID: "bundle-main", VerifiedContentID: "sha256:" + digest, EntrySHA256: digest,
		Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE, Family: "z-image", BundleEntries: entries,
	}
	driver := StableDiffusionImageDriver{}
	if reason := driver.ValidateBinding(requirements[0], binding, asset); reason != success {
		t.Fatalf("bundle binding reason = %v", reason)
	}
	drifted := asset
	drifted.BundleEntries = append([]BundleEntryDescriptor(nil), entries...)
	drifted.BundleEntries[1].SHA256 = strings.Repeat("c", 64)
	if reason := driver.ValidateBinding(requirements[0], binding, drifted); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH {
		t.Fatalf("drifted bundle reason = %v", reason)
	}
}

func TestStableDiffusionEffectiveRequestDefaultsUsePortableExecutionOptions(t *testing.T) {
	portable := stableDiffusionPortableForTest(t, map[string]any{
		"modelFamily":      "z-image",
		"executionOptions": map[string]any{"width": 768, "height": 512, "seed": 13},
	})
	defaults := (StableDiffusionImageDriver{}).EffectiveRequestDefaults(portable)
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
	files[0] = ImageModelFile{}
	if plan.ModelFiles()[0].AbsolutePath() == "" {
		t.Fatal("image plan exposed mutable captured state")
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
		Index: 1, Payload: []byte("png"), Format: "png", Width: 64, Height: 64,
	})
	if err != nil || artifact.MediaType != "image/png" {
		t.Fatalf("valid artifact = %+v err=%v", artifact, err)
	}
	for _, observation := range []ImageBackendArtifactObservation{
		{Index: 0, Payload: []byte("png"), Format: "png", Width: 64, Height: 64},
		{Index: 1, Payload: nil, Format: "png", Width: 64, Height: 64},
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
		{name: "count above local maximum", n: testInt32(5)},
		{name: "malformed size", size: "not-a-size"},
		{name: "width below minimum", size: "63x64"},
		{name: "height not divisible by eight", size: "64x65"},
		{name: "dimension above maximum", size: "4104x64"},
	}
	for _, test := range invalid {
		t.Run(test.name, func(t *testing.T) {
			_, err := driver.PlanImageInvocation(ImageInvocationInput{
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

func TestStableDiffusionSeedAdmissionMatchesManagedInt32Carrier(t *testing.T) {
	driver := StableDiffusionImageDriver{}
	for _, seed := range []int64{math.MinInt32, math.MaxInt32} {
		portable := stableDiffusionPortableForTest(t, map[string]any{
			"modelFamily":      "z-image",
			"executionOptions": map[string]any{"seed": seed},
		})
		if _, reason := driver.Interpret(InterpretInput{PortableConfig: portable}); reason != success {
			t.Fatalf("portable seed %d reason = %v", seed, reason)
		}
		if got := driver.EffectiveRequestDefaults(portable)["seed"]; got != fmt.Sprint(seed) {
			t.Fatalf("portable seed %d default = %q", seed, got)
		}
	}
	for _, seed := range []int64{int64(math.MinInt32) - 1, int64(math.MaxInt32) + 1} {
		portable := stableDiffusionPortableForTest(t, map[string]any{
			"modelFamily":      "z-image",
			"executionOptions": map[string]any{"seed": seed},
		})
		if _, reason := driver.Interpret(InterpretInput{PortableConfig: portable}); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID {
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
	for _, seed := range []int64{math.MinInt32, math.MaxInt32} {
		plan, err := driver.PlanImageInvocation(ImageInvocationInput{
			PortableConfig: portable,
			ExactBindings:  bindings,
			Request:        &runtimev1.ImageGenerateScenarioSpec{Prompt: "image", Seed: testInt64(seed)},
		})
		if err != nil || plan.RequestPlan().Seed() != seed {
			t.Fatalf("request seed %d plan=%v err=%v", seed, plan, err)
		}
	}
	for _, seed := range []int64{int64(math.MinInt32) - 1, int64(math.MaxInt32) + 1} {
		_, err := driver.PlanImageInvocation(ImageInvocationInput{
			PortableConfig: portable,
			ExactBindings:  bindings,
			Request:        &runtimev1.ImageGenerateScenarioSpec{Prompt: "image", Seed: testInt64(seed)},
		})
		var invocationErr *InvocationError
		if !errors.As(err, &invocationErr) || invocationErr.Kind != InvocationFailureInvalidRequest {
			t.Fatalf("request seed %d error = %v", seed, err)
		}
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

func TestStableDiffusionPlanInputImageRequiresDeclaredFeature(t *testing.T) {
	root := t.TempDir()
	bindings := []InvocationExactBinding{
		stableDiffusionInvocationBindingForTest(StableDiffusionMainRequirementID, "main", filepath.Join(root, "main.gguf"), 'a'),
		stableDiffusionInvocationBindingForTest(StableDiffusionTextEncoderRequirementID, "text", filepath.Join(root, "text.gguf"), 'b'),
		stableDiffusionInvocationBindingForTest(StableDiffusionVAERequirementID, "vae", filepath.Join(root, "vae.safetensors"), 'c'),
	}
	request := &runtimev1.ImageGenerateScenarioSpec{Prompt: "edit", ReferenceImages: []string{"input.png"}}
	withoutFeature := stableDiffusionPortableForTest(t, map[string]any{"modelFamily": "z-image"})
	_, err := (StableDiffusionImageDriver{}).PlanImageInvocation(ImageInvocationInput{PortableConfig: withoutFeature, ExactBindings: bindings, Request: request})
	var invocationErr *InvocationError
	if !errors.As(err, &invocationErr) || invocationErr.Kind != InvocationFailureUnsupported {
		t.Fatalf("undeclared input.image error = %v", err)
	}
	withFeature := stableDiffusionPortableForTest(t, map[string]any{"modelFamily": "z-image", "enableInputImage": true})
	plan, err := (StableDiffusionImageDriver{}).PlanImageInvocation(ImageInvocationInput{
		PortableConfig: withFeature, SupportedFeatures: []string{aicapabilities.FeatureInputImage}, ExactBindings: bindings, Request: request,
	})
	imageToImage, ok := plan.RequestPlan().(StableDiffusionCPPImageToImageRequestPlan)
	if err != nil || !ok || imageToImage.InputImage() != "input.png" || imageToImage.Mask() != "" {
		t.Fatalf("declared input.image plan = %#v err=%v", plan, err)
	}
}

func TestStableDiffusionPlanMaskRequiresIndependentDeclaredFeatureAndInputImage(t *testing.T) {
	root := t.TempDir()
	bindings := []InvocationExactBinding{
		stableDiffusionInvocationBindingForTest(StableDiffusionMainRequirementID, "main", filepath.Join(root, "main.gguf"), 'a'),
		stableDiffusionInvocationBindingForTest(StableDiffusionTextEncoderRequirementID, "text", filepath.Join(root, "text.gguf"), 'b'),
		stableDiffusionInvocationBindingForTest(StableDiffusionVAERequirementID, "vae", filepath.Join(root, "vae.safetensors"), 'c'),
	}
	portable := stableDiffusionPortableForTest(t, map[string]any{"modelFamily": "z-image", "enableInputImage": true})
	request := &runtimev1.ImageGenerateScenarioSpec{Prompt: "inpaint", ReferenceImages: []string{"input.png"}, Mask: "mask.png"}
	driver := StableDiffusionImageDriver{}

	_, err := driver.PlanImageInvocation(ImageInvocationInput{
		PortableConfig: portable, SupportedFeatures: []string{aicapabilities.FeatureInputImage}, ExactBindings: bindings, Request: request,
	})
	var invocationErr *InvocationError
	if !errors.As(err, &invocationErr) || invocationErr.Kind != InvocationFailureUnsupported || !strings.Contains(err.Error(), aicapabilities.FeatureInputMask) {
		t.Fatalf("undeclared input.mask error = %v", err)
	}

	features := []string{aicapabilities.FeatureInputImage, aicapabilities.FeatureInputMask}
	plan, err := driver.PlanImageInvocation(ImageInvocationInput{
		PortableConfig: portable, SupportedFeatures: features, ExactBindings: bindings, Request: request,
	})
	imageToImage, ok := plan.RequestPlan().(StableDiffusionCPPImageToImageRequestPlan)
	if err != nil || !ok || imageToImage.InputImage() != "input.png" || imageToImage.Mask() != "mask.png" {
		t.Fatalf("declared mask plan = %#v err=%v", plan, err)
	}

	_, err = driver.PlanImageInvocation(ImageInvocationInput{
		PortableConfig: portable, SupportedFeatures: features, ExactBindings: bindings,
		Request: &runtimev1.ImageGenerateScenarioSpec{Prompt: "inpaint", Mask: "mask.png"},
	})
	if !errors.As(err, &invocationErr) || invocationErr.Kind != InvocationFailureInvalidRequest || !strings.Contains(err.Error(), "mask requires an input image") {
		t.Fatalf("mask without input image error = %v", err)
	}
}

func TestCanonicalBundleSHA256RejectsInferredOrOutOfOrderOrdinals(t *testing.T) {
	first := strings.Repeat("a", 64)
	second := strings.Repeat("b", 64)
	digest, err := CanonicalBundleSHA256([]BundleEntryDescriptor{{Ordinal: 1, SHA256: first}, {Ordinal: 2, SHA256: second}})
	if err != nil {
		t.Fatal(err)
	}
	hasher := sha256.New()
	firstBytes, _ := hex.DecodeString(first)
	secondBytes, _ := hex.DecodeString(second)
	_, _ = hasher.Write(firstBytes)
	_, _ = hasher.Write(secondBytes)
	if want := hex.EncodeToString(hasher.Sum(nil)); digest != want {
		t.Fatalf("bundle digest = %q, want %q", digest, want)
	}
	if _, err := CanonicalBundleSHA256([]BundleEntryDescriptor{{Ordinal: 2, SHA256: second}, {Ordinal: 1, SHA256: first}}); err == nil {
		t.Fatal("out-of-order bundle entries must not be sorted or inferred")
	}
}

func stableDiffusionPortableForTest(t *testing.T, fields map[string]any) *structpb.Struct {
	t.Helper()
	portable, err := structpb.NewStruct(fields)
	if err != nil {
		t.Fatalf("NewStruct: %v", err)
	}
	return portable
}

func stableDiffusionInvocationBindingForTest(requirementID, localAssetID, absolutePath string, marker byte) InvocationExactBinding {
	digest := strings.Repeat(string(marker), 64)
	return InvocationExactBinding{
		RequirementID: requirementID, LocalAssetID: localAssetID, AbsolutePath: absolutePath,
		VerifiedContentID: "sha256:" + digest, EntrySHA256: digest,
	}
}
