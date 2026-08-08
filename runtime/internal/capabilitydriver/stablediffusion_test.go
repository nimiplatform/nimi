package capabilitydriver

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
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
		"modelFamily":      "z-image-turbo",
		"enableInputImage": true,
	})
	requirements, reason := driver.Interpret(InterpretInput{PortableConfig: portable, SupportedFeatures: []string{inputImageFeature, inputImageFeature}})
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

func TestStableDiffusionInterpretOrderedLoRAsAndAllowsRepeatedExactAsset(t *testing.T) {
	portable := stableDiffusionPortableForTest(t, map[string]any{
		"modelFamily": "z-image",
		"loras": []any{
			map[string]any{"displayLabel": "Ink", "weight": 0.7},
			map[string]any{"displayLabel": "Lighting", "weight": 1.1},
		},
	})
	driver := StableDiffusionImageDriver{}
	requirements, reason := driver.Interpret(InterpretInput{PortableConfig: portable})
	if reason != success || len(requirements) != 5 {
		t.Fatalf("Interpret = %v %#v", reason, requirements)
	}
	for index, label := range []string{"Ink", "Lighting"} {
		requirement := requirements[index+3]
		ordinal := uint32(index + 1)
		if requirement.GetRequirementId() != StableDiffusionLoRARequirementID(ordinal) || requirement.GetOccurrenceOrdinal() != ordinal || requirement.GetDisplayLabel() != label {
			t.Fatalf("LoRA requirement[%d] = %#v", index, requirement)
		}
	}

	bindings := make([]*runtimev1.LocalAssetExactBinding, 0, len(requirements))
	assets := make([]AssetDescriptor, 0, len(requirements))
	for index, requirement := range requirements {
		digest := strings.Repeat(string(rune('a'+index)), 64)
		localAssetID := "asset-" + requirement.GetRequirementId()
		kind := stableDiffusionAssetKind(requirement.GetResourceKind())
		family := ""
		if kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE || kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_LORA {
			family = "z-image"
		}
		if kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE {
			family = "flux1-vae"
		}
		if requirement.GetResourceKind() == "lora" {
			localAssetID = "asset-shared-lora"
			digest = strings.Repeat("f", 64)
		}
		bindings = append(bindings, &runtimev1.LocalAssetExactBinding{
			RequirementId: requirement.GetRequirementId(), LocalAssetId: localAssetID,
			VerifiedContentId: "sha256:" + digest, EntrySha256: digest,
		})
		assets = append(assets, AssetDescriptor{
			LocalAssetID: localAssetID, VerifiedContentID: "sha256:" + digest, EntrySHA256: digest,
			Kind: kind, Family: family,
		})
	}
	for index := range requirements {
		if reason := driver.ValidateBinding(requirements[index], bindings[index], assets[index]); reason != success {
			t.Fatalf("binding[%d] reason = %v requirement=%#v asset=%#v", index, reason, requirements[index], assets[index])
		}
	}
	if reason := driver.ValidateCombination(requirements, bindings, assets); reason != success {
		t.Fatalf("repeated LoRA asset combination reason = %v", reason)
	}
	wrongVAE := append([]AssetDescriptor(nil), assets...)
	wrongVAE[2].Family = "flux2-vae"
	if reason := driver.ValidateCombination(requirements, bindings, wrongVAE); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
		t.Fatalf("incompatible VAE family reason = %v", reason)
	}
}

func TestStableDiffusionInterpretRejectsUnknownAndProtectedPortableFields(t *testing.T) {
	driver := StableDiffusionImageDriver{}
	for _, fields := range []map[string]any{
		{"modelFamily": "unknown"},
		{"modelFamily": "z-image", "modelPath": "/models/main.gguf"},
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

func TestStableDiffusionPlanPreservesDeclaredLoRAOrderAndNormalizesRequest(t *testing.T) {
	portable := stableDiffusionPortableForTest(t, map[string]any{
		"modelFamily": "z-image",
		"loras": []any{
			map[string]any{"displayLabel": "First", "weight": 0.5},
			map[string]any{"displayLabel": "Second", "weight": 1.25},
		},
		"executionOptions": map[string]any{
			"steps": 30, "cfgScale": 4.5, "width": 640, "height": 640, "seed": 13,
			"sampler": "euler_a", "scheduler": "karras", "threads": 8,
			"diffusionFlashAttention": true, "offloadParamsToCPU": true,
		},
	})
	root := t.TempDir()
	bindings := []InvocationExactBinding{
		stableDiffusionInvocationBindingForTest(StableDiffusionLoRARequirementID(2), "shared-lora", filepath.Join(root, "second.safetensors"), 'f'),
		stableDiffusionInvocationBindingForTest(StableDiffusionVAERequirementID, "vae", filepath.Join(root, "vae.safetensors"), 'c'),
		stableDiffusionInvocationBindingForTest(StableDiffusionMainRequirementID, "main", filepath.Join(root, "main.gguf"), 'a'),
		stableDiffusionInvocationBindingForTest(StableDiffusionLoRARequirementID(1), "shared-lora", filepath.Join(root, "first.safetensors"), 'f'),
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
	if plan.MainModelPath() != filepath.Join(root, "main.gguf") || plan.TextEncoderPath() != filepath.Join(root, "text.gguf") || plan.VAEPath() != filepath.Join(root, "vae.safetensors") {
		t.Fatalf("plan component paths are incomplete: %#v", plan.ModelFiles())
	}
	loras := plan.LoRAs()
	if len(loras) != 2 || loras[0].OccurrenceOrdinal != 1 || loras[0].DisplayLabel != "First" ||
		loras[0].AbsolutePath != filepath.Join(root, "first.safetensors") || loras[1].OccurrenceOrdinal != 2 || loras[1].DisplayLabel != "Second" {
		t.Fatalf("ordered LoRAs = %#v", loras)
	}
	width, height := plan.Size()
	if width != 768 || height != 512 || plan.Steps() != 30 || plan.CFGScale() != 4.5 || plan.Seed() != 99 || plan.ImageCount() != 2 ||
		plan.Prompt() != "a lighthouse" || plan.NegativePrompt() != "fog" || plan.Sampler() != "euler_a" || plan.Scheduler() != "karras" ||
		plan.Threads() != 8 || !plan.DiffusionFlashAttention() || !plan.OffloadParamsToCPU() {
		t.Fatalf("normalized plan sampling fields are incorrect")
	}
	mutable := plan.LoRAs()
	mutable[0].DisplayLabel = "mutated"
	files := plan.ModelFiles()
	files[0].AbsolutePath = "mutated"
	if plan.LoRAs()[0].DisplayLabel == "mutated" || plan.ModelFiles()[0].AbsolutePath == "mutated" {
		t.Fatal("image plan exposed mutable captured state")
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
	plan, err := (StableDiffusionImageDriver{}).PlanImageInvocation(ImageInvocationInput{PortableConfig: withFeature, ExactBindings: bindings, Request: request})
	if err != nil || plan.InputImage() != "input.png" {
		t.Fatalf("declared input.image plan = %#v err=%v", plan, err)
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
