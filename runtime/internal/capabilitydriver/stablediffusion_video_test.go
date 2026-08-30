package capabilitydriver

import (
	"encoding/binary"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestStableDiffusionVideoRegistryAndRequirementProjection(t *testing.T) {
	identity := Identity{
		ImplementationID: StableDiffusionVideoImplementationID,
		DriverID:         StableDiffusionVideoDriverID,
		DriverDialect:    StableDiffusionVideoDriverDialect,
	}
	driverValue, reason := NewProductionRegistry().Resolve(StableDiffusionVideoCapabilityContract, identity)
	if reason != success {
		t.Fatalf("video resolve reason = %v", reason)
	}
	driver, ok := driverValue.(VideoInvocationDriver)
	if !ok {
		t.Fatalf("resolved driver = %T, want VideoInvocationDriver", driverValue)
	}
	recipeDriver, ok := driverValue.(RecipeDriver)
	if !ok {
		t.Fatalf("resolved driver = %T, want RecipeDriver", driverValue)
	}
	projected, recipeReason := recipeDriver.ProjectRecipe(StableDiffusionVideoRecipeID, nil, []string{stableDiffusionVideoReferenceImageFeature})
	if recipeReason != success || len(projected) != len(stableDiffusionVideoSlots) {
		t.Fatalf("ProjectRecipe = %#v, %v", projected, recipeReason)
	}
	if _, recipeReason = recipeDriver.ProjectRecipe("other", nil, nil); recipeReason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID {
		t.Fatalf("wrong recipe reason = %v", recipeReason)
	}
	requirements, reason := driver.Interpret(InterpretInput{SupportedFeatures: []string{stableDiffusionVideoReferenceImageFeature}})
	if reason != success {
		t.Fatalf("Interpret: %v", reason)
	}
	if len(requirements) != len(stableDiffusionVideoSlots) {
		t.Fatalf("requirements = %#v", requirements)
	}
	for index, slot := range stableDiffusionVideoSlots {
		requirement := requirements[index]
		if requirement.GetRequirementId() != slot.id || requirement.GetPolicy() != runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE ||
			requirement.GetOccurrenceOrdinal() != 0 || !validStableDiffusionVideoRequirement(requirement, slot) {
			t.Fatalf("requirement[%d] = %#v", index, requirement)
		}
	}
	if _, reason := NewProductionRegistry().Resolve(StableDiffusionCapabilityContract, identity); reason == success {
		t.Fatal("video dialect resolved under image.generate")
	}
}

func TestStableDiffusionVideoPortableRecipeParsesEveryKeyAndRejectsUnknown(t *testing.T) {
	portable := stableDiffusionVideoPortableForTest(t, map[string]any{
		"executionOptions": map[string]any{
			"cfgScale": 2.5, "flowShift": 8.5, "sampleMethod": "euler", "scheduler": "karras",
			"diffusionFlashAttention": false, "offloadParamsToCPU": false, "rng": "cuda",
		},
	})
	parsed, reason := parseStableDiffusionVideoPortableConfig(portable)
	if reason != success {
		t.Fatalf("parse recipe: %v", reason)
	}
	if parsed.recipe.cfgScale != 2.5 || parsed.recipe.flowShift != 8.5 || parsed.recipe.sampleMethod != "euler" || parsed.recipe.scheduler != "karras" ||
		parsed.recipe.diffusionFlashAttention || parsed.recipe.offloadToCPU || parsed.recipe.rng != "cuda" {
		t.Fatalf("parsed recipe = %#v", parsed.recipe)
	}
	defaults, reason := parseStableDiffusionVideoPortableConfig(nil)
	if reason != success || defaults.recipe != defaultStableDiffusionVideoRecipe() {
		t.Fatalf("default recipe = %#v reason=%v", defaults.recipe, reason)
	}
	engineDefault := stableDiffusionVideoPortableForTest(t, map[string]any{
		"executionOptions": map[string]any{"sampleMethod": "engine-default", "scheduler": "engine-default"},
	})
	parsed, reason = parseStableDiffusionVideoPortableConfig(engineDefault)
	if reason != success || parsed.recipe.sampleMethod != "" || parsed.recipe.scheduler != "" {
		t.Fatalf("engine-default recipe = %#v reason=%v", parsed.recipe, reason)
	}
	for _, fields := range []map[string]any{
		{"executionOptions": map[string]any{"unknown": true}},
		{"executionOptions": map[string]any{"cfgScale": 31}},
		{"executionOptions": map[string]any{"flowShift": -1}},
		{"executionOptions": map[string]any{"sampleMethod": "bad token"}},
		{"executionOptions": map[string]any{"scheduler": true}},
		{"executionOptions": map[string]any{"diffusionFlashAttention": "true"}},
		{"executionOptions": map[string]any{"offloadParamsToCPU": 1}},
		{"executionOptions": map[string]any{"rng": "other"}},
	} {
		if _, reason := parseStableDiffusionVideoPortableConfig(stableDiffusionVideoPortableForTest(t, fields)); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID {
			t.Fatalf("fields %#v reason = %v", fields, reason)
		}
	}
}

func TestStableDiffusionVideoInterpretRejectsWrongPortableSlotShape(t *testing.T) {
	driver := StableDiffusionVideoDriver{}
	for _, fields := range []map[string]any{
		{"modelPath": "/absolute/model.gguf"},
		{"fl2vaRequirementPolicy": "strict"},
		{"fl2vaRequirementPolicy": true},
		{"audioVAEVerifiedContentId": "sha256:bad"},
	} {
		portable := stableDiffusionVideoPortableForTest(t, fields)
		if _, reason := driver.Interpret(InterpretInput{PortableConfig: portable}); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID {
			t.Fatalf("fields %#v reason = %v", fields, reason)
		}
	}
	if _, reason := driver.Interpret(InterpretInput{SupportedFeatures: []string{"input.video"}}); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED {
		t.Fatalf("unsupported feature reason = %v", reason)
	}
}

func TestStableDiffusionVideoValidateBindingChecksExactSlotAndBoundedFormat(t *testing.T) {
	driver := StableDiffusionVideoDriver{}
	requirements, reason := driver.Interpret(InterpretInput{})
	if reason != success {
		t.Fatal(reason)
	}
	bindings, assets := stableDiffusionVideoValidationInputsForTest(requirements)
	for index := range requirements {
		if reason := driver.ValidateBinding(requirements[index], bindings[index], assets[index]); reason != success {
			t.Fatalf("binding[%d] reason = %v", index, reason)
		}
		format := requirements[index].GetCompatibilityConstraints().GetFields()["format"].GetStringValue()
		projection, reason := driver.ProjectModelAssetBinding(ModelAssetBindingInput{
			RecipeID: StableDiffusionVideoRecipeID, Requirement: requirements[index], Binding: bindings[index],
			Entry: ModelAssetFileFact{RelativePath: "model." + format, SizeBytes: int64(len(assets[index].FormatProbe)), FormatProbe: assets[index].FormatProbe},
		})
		if reason != success || projection.Descriptor.Kind != assets[index].Kind || projection.Descriptor.ModelAssetID != bindings[index].GetModelAssetId() {
			t.Fatalf("projection[%d] reason=%v projection=%+v", index, reason, projection)
		}
	}
	if reason := driver.ValidateCombination(requirements, bindings, assets); reason != success {
		t.Fatalf("combination reason = %v", reason)
	}

	wrongMagic := assets[0]
	wrongMagic.FormatProbe = []byte("gguf")
	if reason := driver.ValidateBinding(requirements[0], bindings[0], wrongMagic); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
		t.Fatalf("wrong GGUF magic reason = %v", reason)
	}
	badSafetensors := assets[3]
	badSafetensors.FormatProbe = safetensorsProbeForTest([]byte("not-json"))
	if reason := driver.ValidateBinding(requirements[3], bindings[3], badSafetensors); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
		t.Fatalf("bad safetensors reason = %v", reason)
	}
	oversized := make([]byte, 8)
	binary.LittleEndian.PutUint64(oversized, MaxSafetensorsHeaderBytes+1)
	badSafetensors.FormatProbe = oversized
	if reason := driver.ValidateBinding(requirements[3], bindings[3], badSafetensors); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
		t.Fatalf("oversized safetensors reason = %v", reason)
	}

	wrongRole := assets[0]
	wrongRole.ArtifactRoles = []string{"text_encoder", "vae"}
	if reason := driver.ValidateBinding(requirements[0], bindings[0], wrongRole); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
		t.Fatalf("wrong generic role reason = %v", reason)
	}
	encoderInDiT := assets[0]
	encoderInDiT.Kind = runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT
	encoderInDiT.ArtifactRoles = []string{"llm"}
	encoderInDiT.FormatProbe = assets[2].FormatProbe
	if reason := driver.ValidateBinding(requirements[0], bindings[0], encoderInDiT); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
		t.Fatalf("encoder in DiT slot reason = %v", reason)
	}
	videoInAudio := assets[4]
	videoInAudio.FormatProbe = assets[3].FormatProbe
	if reason := driver.ValidateBinding(requirements[4], bindings[4], videoInAudio); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
		t.Fatalf("video VAE in audio slot reason = %v", reason)
	}
	audioInVideo := assets[3]
	audioInVideo.FormatProbe = assets[4].FormatProbe
	if reason := driver.ValidateBinding(requirements[3], bindings[3], audioInVideo); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
		t.Fatalf("audio VAE in video slot reason = %v", reason)
	}
	// FL2VA and Ref2VA are binding declarations over the same observable H3
	// DiT content signature, so their content probes intentionally cross-admit.
	crossRoute := assets[0]
	crossRoute.FormatProbe = assets[1].FormatProbe
	if reason := driver.ValidateBinding(requirements[0], bindings[0], crossRoute); reason != success {
		t.Fatalf("cross-route DiT content reason = %v", reason)
	}
	oversizedProbe := assets[0]
	oversizedProbe.FormatProbe = make([]byte, MaxAssetFormatProbeBytes+1)
	copy(oversizedProbe.FormatProbe, assets[0].FormatProbe)
	if reason := driver.ValidateBinding(requirements[0], bindings[0], oversizedProbe); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
		t.Fatalf("oversized GGUF probe reason = %v", reason)
	}
	if reason := driver.ValidateCombination(requirements, bindings[:4], assets[:4]); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_REQUIRED_BINDING_MISSING {
		t.Fatalf("missing slot reason = %v", reason)
	}
	wrongRequirements := append([]*runtimev1.LocalCapabilityRequirement(nil), requirements...)
	wrongRequirements[0], wrongRequirements[1] = wrongRequirements[1], wrongRequirements[0]
	if reason := driver.ValidateCombination(wrongRequirements, bindings, assets); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
		t.Fatalf("wrong requirement sequence reason = %v", reason)
	}
}

func TestStableDiffusionVideoPlanAppliesFirstPartyDefaultsForAbsentFields(t *testing.T) {
	driver := StableDiffusionVideoDriver{}
	bindings := stableDiffusionVideoInvocationBindingsForTest(t.TempDir())
	// Absent (zero) width/height/fps/frameCount receive the documented
	// first-party vertical-slice default profile (L0: 512x288 / 22f / 24fps).
	request := stableDiffusionVideoRequestForTest()
	request.Width = 0
	request.Height = 0
	request.FrameCount = 0
	request.FPS = 0
	plan, err := driver.PlanVideoInvocation(VideoInvocationInput{
		LoadoutID: "loadout-h3", ExactBindings: bindings, Request: request,
	})
	if err != nil {
		t.Fatalf("absent-field plan: %v", err)
	}
	width, height := plan.Size()
	if plan.RecipeID() != StableDiffusionVideoRecipeID || width != 512 || height != 288 || plan.FrameCount() != 22 || plan.FPS() != 24 || !plan.AudioRequired() {
		t.Fatalf("defaulted plan = %dx%d frames=%d fps=%d audio=%v", width, height, plan.FrameCount(), plan.FPS(), plan.AudioRequired())
	}
}

func TestStableDiffusionVideoDurationAlignsUpToH3FrameGrid(t *testing.T) {
	driver := StableDiffusionVideoDriver{}
	bindings := stableDiffusionVideoInvocationBindingsForTest(t.TempDir())
	for _, test := range []struct {
		durationSec int
		wantFrames  int
	}{
		{durationSec: 1, wantFrames: 39},
		{durationSec: 2, wantFrames: 56},
		{durationSec: 3, wantFrames: 73},
		{durationSec: 5, wantFrames: 124},
		{durationSec: 10, wantFrames: 243},
		{durationSec: 20, wantFrames: 481},
	} {
		request := stableDiffusionVideoRequestForTest()
		request.FrameCount = 0
		request.DurationSec = test.durationSec
		plan, err := driver.PlanVideoInvocation(VideoInvocationInput{LoadoutID: "loadout-h3", ExactBindings: bindings, Request: request})
		if err != nil {
			t.Fatalf("duration %ds: %v", test.durationSec, err)
		}
		if plan.FrameCount() != test.wantFrames {
			t.Fatalf("duration %ds frames=%d, want %d", test.durationSec, plan.FrameCount(), test.wantFrames)
		}
	}
}

func TestStableDiffusionVideoFrameCarrierBoundaryAdmits498AndRejects515(t *testing.T) {
	driver := StableDiffusionVideoDriver{}
	bindings := stableDiffusionVideoInvocationBindingsForTest(t.TempDir())
	request := stableDiffusionVideoRequestForTest()
	request.FrameCount = 498
	plan, err := driver.PlanVideoInvocation(VideoInvocationInput{
		LoadoutID: "loadout-h3", ExactBindings: bindings, Request: request,
	})
	if err != nil || plan == nil || plan.FrameCount() != 498 {
		t.Fatalf("498-frame H3 boundary plan=%#v error=%v", plan, err)
	}
	request.FrameCount = 515
	_, err = driver.PlanVideoInvocation(VideoInvocationInput{
		LoadoutID: "loadout-h3", ExactBindings: bindings, Request: request,
	})
	assertVideoInvocationErrorKind(t, err, InvocationFailureInvalidRequest)
}

func TestStableDiffusionVideoRatioDerivationAndContradiction(t *testing.T) {
	driver := StableDiffusionVideoDriver{}
	bindings := stableDiffusionVideoInvocationBindingsForTest(t.TempDir())
	for _, test := range []struct {
		ratio         string
		width, height int
	}{
		{ratio: "16:9", width: 512, height: 288},
		{ratio: "4:3", width: 384, height: 288},
		{ratio: "1:1", width: 384, height: 384},
		{ratio: "3:4", width: 288, height: 384},
		{ratio: "9:16", width: 288, height: 512},
		{ratio: "21:9", width: 672, height: 288},
	} {
		request := stableDiffusionVideoRequestForTest()
		request.Width, request.Height, request.Ratio = 0, 0, test.ratio
		plan, err := driver.PlanVideoInvocation(VideoInvocationInput{LoadoutID: "loadout-h3", ExactBindings: bindings, Request: request})
		if err != nil {
			t.Fatalf("ratio %s: %v", test.ratio, err)
		}
		width, height := plan.Size()
		if width != test.width || height != test.height {
			t.Fatalf("ratio %s size=%dx%d, want %dx%d", test.ratio, width, height, test.width, test.height)
		}
	}

	consistent := stableDiffusionVideoRequestForTest()
	consistent.Width, consistent.Height, consistent.Ratio = 1024, 576, "16:9"
	if _, err := driver.PlanVideoInvocation(VideoInvocationInput{LoadoutID: "loadout-h3", ExactBindings: bindings, Request: consistent}); err != nil {
		t.Fatalf("consistent explicit resolution and ratio: %v", err)
	}
	for _, request := range []VideoInvocationRequest{
		func() VideoInvocationRequest {
			value := stableDiffusionVideoRequestForTest()
			value.Width, value.Height, value.Ratio = 512, 512, "16:9"
			return value
		}(),
		func() VideoInvocationRequest {
			value := stableDiffusionVideoRequestForTest()
			value.Width, value.Height, value.Ratio = 0, 0, "adaptive"
			return value
		}(),
	} {
		_, err := driver.PlanVideoInvocation(VideoInvocationInput{LoadoutID: "loadout-h3", ExactBindings: bindings, Request: request})
		assertVideoInvocationErrorKind(t, err, InvocationFailureInvalidRequest)
	}
}

func TestStableDiffusionVideoPlanRejectsEveryH3AdmissionViolation(t *testing.T) {
	driver := StableDiffusionVideoDriver{}
	bindings := stableDiffusionVideoInvocationBindingsForTest(t.TempDir())
	valid := stableDiffusionVideoRequestForTest()
	tests := []struct {
		name   string
		mutate func(*VideoInvocationRequest)
	}{
		{name: "empty prompt", mutate: func(request *VideoInvocationRequest) { request.Prompt = " " }},
		{name: "width", mutate: func(request *VideoInvocationRequest) { request.Width = 641 }},
		{name: "negative width", mutate: func(request *VideoInvocationRequest) { request.Width = -32 }},
		{name: "negative height", mutate: func(request *VideoInvocationRequest) { request.Height = -288 }},
		{name: "height", mutate: func(request *VideoInvocationRequest) { request.Height = 481 }},
		{name: "fps", mutate: func(request *VideoInvocationRequest) { request.FPS = 25 }},
		{name: "frame minimum", mutate: func(request *VideoInvocationRequest) { request.FrameCount = 4 }},
		{name: "frame grid", mutate: func(request *VideoInvocationRequest) { request.FrameCount = 23 }},
		{name: "frame exceeds FFI carrier", mutate: func(request *VideoInvocationRequest) { request.FrameCount = 515 }},
		{name: "duration range", mutate: func(request *VideoInvocationRequest) { request.FrameCount, request.DurationSec = 0, 21 }},
		{name: "duration and frames", mutate: func(request *VideoInvocationRequest) { request.DurationSec = 2 }},
		{name: "audio required", mutate: func(request *VideoInvocationRequest) { request.GenerateAudio = false }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := valid
			test.mutate(&request)
			_, err := driver.PlanVideoInvocation(VideoInvocationInput{LoadoutID: "loadout-h3", ExactBindings: bindings, Request: request})
			assertVideoInvocationErrorKind(t, err, InvocationFailureInvalidRequest)
		})
	}
}

func TestStableDiffusionVideoPlanRoutesPromptAndOneResolvedImage(t *testing.T) {
	root := t.TempDir()
	bindings := stableDiffusionVideoInvocationBindingsForTest(root)
	driver := StableDiffusionVideoDriver{}

	promptPlan, err := driver.PlanVideoInvocation(VideoInvocationInput{
		LoadoutID: "loadout-h3", ExactBindings: bindings, Request: stableDiffusionVideoRequestForTest(),
	})
	if err != nil {
		t.Fatalf("prompt plan: %v", err)
	}
	if promptPlan.ConditioningMode() != VideoConditioningModeFL2VAT2VA || promptPlan.DiffusionModelPath() != filepath.Join(root, "fl2va.gguf") {
		t.Fatalf("prompt route = %q path=%q", promptPlan.ConditioningMode(), promptPlan.DiffusionModelPath())
	}
	if _, ok := promptPlan.ReferenceImage(); ok {
		t.Fatal("prompt-only plan retained a reference image")
	}
	if len(promptPlan.ExactBindings()) != 5 || len(promptPlan.ModelFiles()) != 4 || promptPlan.ModelFiles()[0].RequirementID != StableDiffusionVideoFL2VARequirementID {
		t.Fatalf("prompt bindings all=%#v loaded=%#v", promptPlan.ExactBindings(), promptPlan.ModelFiles())
	}

	request := stableDiffusionVideoRequestForTest()
	referenceBytes := []byte{1, 2, 3, 4}
	request.Inputs = []VideoResolvedInput{{Role: VideoInputRoleReferenceImage, SourceIdentity: "artifact:image:sha256:abc", ImageBytes: referenceBytes}}
	imagePlan, err := driver.PlanVideoInvocation(VideoInvocationInput{
		LoadoutID: "loadout-h3", ExactBindings: bindings, Request: request,
	})
	if err != nil {
		t.Fatalf("image plan: %v", err)
	}
	if imagePlan.ConditioningMode() != VideoConditioningModeRef2VAImage || imagePlan.DiffusionModelPath() != filepath.Join(root, "ref2va.gguf") ||
		imagePlan.ModelFiles()[0].RequirementID != StableDiffusionVideoRef2VARequirementID {
		t.Fatalf("image route = %q path=%q files=%#v", imagePlan.ConditioningMode(), imagePlan.DiffusionModelPath(), imagePlan.ModelFiles())
	}
	referenceBytes[0] = 9
	reference, ok := imagePlan.ReferenceImage()
	if !ok || reference.ImageBytes[0] != 1 || reference.SourceIdentity != "artifact:image:sha256:abc" {
		t.Fatalf("captured reference = %#v ok=%v", reference, ok)
	}
	reference.ImageBytes[0] = 8
	if again, _ := imagePlan.ReferenceImage(); again.ImageBytes[0] != 1 {
		t.Fatal("video plan exposed mutable reference bytes")
	}
}

func TestStableDiffusionVideoPlanRejectsUnsupportedConditioningRoutes(t *testing.T) {
	driver := StableDiffusionVideoDriver{}
	bindings := stableDiffusionVideoInvocationBindingsForTest(t.TempDir())
	image := func(role VideoInputRole, identity string) VideoResolvedInput {
		return VideoResolvedInput{Role: role, SourceIdentity: identity, ImageBytes: []byte{1}}
	}
	for _, test := range []struct {
		name   string
		inputs []VideoResolvedInput
	}{
		{name: "first frame", inputs: []VideoResolvedInput{image(VideoInputRoleFirstFrame, "first")}},
		{name: "last frame", inputs: []VideoResolvedInput{image(VideoInputRoleLastFrame, "last")}},
		{name: "first and last", inputs: []VideoResolvedInput{image(VideoInputRoleFirstFrame, "first"), image(VideoInputRoleLastFrame, "last")}},
		{name: "multiple images", inputs: []VideoResolvedInput{image(VideoInputRoleReferenceImage, "one"), image(VideoInputRoleReferenceImage, "two")}},
		{name: "video", inputs: []VideoResolvedInput{{Role: VideoInputRoleReferenceVideo, SourceIdentity: "video"}}},
		{name: "audio", inputs: []VideoResolvedInput{{Role: VideoInputRoleReferenceAudio, SourceIdentity: "audio"}}},
		{name: "mixed", inputs: []VideoResolvedInput{image(VideoInputRoleReferenceImage, "image"), {Role: VideoInputRoleReferenceAudio, SourceIdentity: "audio"}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := stableDiffusionVideoRequestForTest()
			request.Inputs = test.inputs
			_, err := driver.PlanVideoInvocation(VideoInvocationInput{LoadoutID: "loadout-h3", ExactBindings: bindings, Request: request})
			assertVideoInvocationErrorKind(t, err, InvocationFailureUnsupported)
		})
	}

	request := stableDiffusionVideoRequestForTest()
	request.Inputs = []VideoResolvedInput{{Role: VideoInputRoleReferenceImage, SourceIdentity: "", ImageBytes: []byte{1}}}
	_, err := driver.PlanVideoInvocation(VideoInvocationInput{LoadoutID: "loadout-h3", ExactBindings: bindings, Request: request})
	assertVideoInvocationErrorKind(t, err, InvocationFailureInvalidRequest)
}

func TestStableDiffusionVideoPlanIsImmutableAndRecipeIsExact(t *testing.T) {
	portable := stableDiffusionVideoPortableForTest(t, map[string]any{
		"executionOptions": map[string]any{
			"cfgScale": 2.5, "flowShift": 8, "sampleMethod": "euler", "scheduler": "karras",
			"diffusionFlashAttention": false, "offloadParamsToCPU": false, "rng": "std_default",
		},
	})
	bindings := stableDiffusionVideoInvocationBindingsForTest(t.TempDir())
	request := stableDiffusionVideoRequestForTest()
	request.Prompt = "  ocean  "
	request.NegativePrompt = " blur "
	plan, err := (StableDiffusionVideoDriver{}).PlanVideoInvocation(VideoInvocationInput{
		LoadoutID: "loadout-h3", PortableConfig: portable, ExactBindings: bindings, Request: request,
	})
	if err != nil {
		t.Fatal(err)
	}
	width, height := plan.Size()
	if plan.LoadoutID() != "loadout-h3" || plan.DriverIdentity().DriverDialect != StableDiffusionVideoDriverDialect ||
		plan.Prompt() != "ocean" || plan.NegativePrompt() != "blur" || width != 640 || height != 480 ||
		plan.FrameCount() != 22 || plan.FPS() != 24 || plan.Seed() != 42 || !plan.AudioRequired() ||
		plan.CFGScale() != 2.5 || plan.FlowShift() != 8 || plan.SampleMethod() != "euler" || plan.Scheduler() != "karras" ||
		plan.DiffusionFlashAttention() || plan.OffloadToCPU() || plan.RNG() != "std_default" {
		t.Fatalf("plan recipe is incomplete: %#v", plan)
	}
	portable.Fields["executionOptions"].GetStructValue().Fields["cfgScale"] = structpb.NewNumberValue(7)
	captured := plan.PortableConfig()
	if captured.GetFields()["executionOptions"].GetStructValue().GetFields()["cfgScale"].GetNumberValue() != 2.5 {
		t.Fatal("input portable config mutated the plan")
	}
	captured.GetFields()["executionOptions"].GetStructValue().Fields["cfgScale"] = structpb.NewNumberValue(9)
	if plan.PortableConfig().GetFields()["executionOptions"].GetStructValue().GetFields()["cfgScale"].GetNumberValue() != 2.5 {
		t.Fatal("portable config accessor exposed mutable state")
	}
	files := plan.ExactBindings()
	files[0].AbsolutePath = "mutated"
	if plan.ExactBindings()[0].AbsolutePath == "mutated" {
		t.Fatal("binding accessor exposed mutable state")
	}
}

func TestStableDiffusionVideoProcessKeyTracksOnlyExactLoadInstructions(t *testing.T) {
	root := t.TempDir()
	bindings := stableDiffusionVideoInvocationBindingsForTest(root)
	driver := StableDiffusionVideoDriver{}
	plan := func(loadoutID string, portable *structpb.Struct, values []InvocationExactBinding, request VideoInvocationRequest) *VideoInvocationPlan {
		planned, err := driver.PlanVideoInvocation(VideoInvocationInput{LoadoutID: loadoutID, PortableConfig: portable, ExactBindings: values, Request: request})
		if err != nil {
			t.Fatal(err)
		}
		return planned
	}
	request := stableDiffusionVideoRequestForTest()
	baseline := plan("one", nil, bindings, request)
	changedRequest := request
	changedRequest.Prompt = "different prompt"
	changedRequest.Width = 672
	if baseline.ProcessKey() != plan("two", nil, bindings, changedRequest).ProcessKey() {
		t.Fatal("request-only or configuration identity changed process key")
	}
	changedUnused := append([]InvocationExactBinding(nil), bindings...)
	changedUnused[1] = stableDiffusionInvocationBindingForTest(StableDiffusionVideoRef2VARequirementID, "new-ref", filepath.Join(root, "new-ref.gguf"), 'f')
	if baseline.ProcessKey() != plan("one", nil, changedUnused, request).ProcessKey() {
		t.Fatal("unused Ref2VA binding changed FL2VA process key")
	}
	changedLoaded := append([]InvocationExactBinding(nil), bindings...)
	changedLoaded[0] = stableDiffusionInvocationBindingForTest(StableDiffusionVideoFL2VARequirementID, "new-fl", filepath.Join(root, "new-fl.gguf"), 'e')
	if baseline.ProcessKey() == plan("one", nil, changedLoaded, request).ProcessKey() {
		t.Fatal("loaded exact identity was omitted from process key")
	}
	refRequest := request
	refRequest.Inputs = []VideoResolvedInput{{Role: VideoInputRoleReferenceImage, SourceIdentity: "image", ImageBytes: []byte{1}}}
	if baseline.ProcessKey() == plan("one", nil, bindings, refRequest).ProcessKey() {
		t.Fatal("conditioning route was omitted from process key")
	}
	for name, options := range map[string]map[string]any{
		"cfg scale":       {"cfgScale": 2},
		"flow shift":      {"flowShift": 9},
		"sample method":   {"sampleMethod": "euler"},
		"scheduler":       {"scheduler": "karras"},
		"flash attention": {"diffusionFlashAttention": false},
		"CPU offload":     {"offloadParamsToCPU": false},
		"RNG":             {"rng": "cuda"},
	} {
		portable := stableDiffusionVideoPortableForTest(t, map[string]any{"executionOptions": options})
		if baseline.ProcessKey() == plan("one", portable, bindings, request).ProcessKey() {
			t.Fatalf("%s was omitted from process key", name)
		}
	}
}

func TestStableDiffusionVideoEffectiveRequestDefaultsMatchPlanDefaults(t *testing.T) {
	defaults := (StableDiffusionVideoDriver{}).EffectiveRequestDefaults(StableDiffusionVideoRecipeID, nil)
	if defaults["options.resolution"] != "512x288" || defaults["options.frames"] != "22" || defaults["options.seed"] != "0" {
		t.Fatalf("effective request defaults = %#v", defaults)
	}
}

func TestStableDiffusionVideoPlanFailsClosedOnWrongOrMissingSlots(t *testing.T) {
	driver := StableDiffusionVideoDriver{}
	bindings := stableDiffusionVideoInvocationBindingsForTest(t.TempDir())
	request := stableDiffusionVideoRequestForTest()
	for _, test := range []struct {
		name     string
		bindings []InvocationExactBinding
	}{
		{name: "missing", bindings: bindings[:4]},
		{name: "duplicate", bindings: append(append([]InvocationExactBinding(nil), bindings...), bindings[0])},
		{name: "wrong", bindings: append(append([]InvocationExactBinding(nil), bindings[:4]...), stableDiffusionInvocationBindingForTest("vae.other", "other", filepath.Join(t.TempDir(), "other.safetensors"), 'f'))},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := driver.PlanVideoInvocation(VideoInvocationInput{LoadoutID: "loadout-h3", ExactBindings: test.bindings, Request: request})
			assertVideoInvocationErrorKind(t, err, InvocationFailureInvalidBinding)
		})
	}
	_, err := driver.PlanVideoInvocation(VideoInvocationInput{ExactBindings: bindings, Request: request})
	assertVideoInvocationErrorKind(t, err, InvocationFailureInvalidConfig)
}

func stableDiffusionVideoPortableForTest(t *testing.T, fields map[string]any) *structpb.Struct {
	t.Helper()
	portable, err := structpb.NewStruct(fields)
	if err != nil {
		t.Fatal(err)
	}
	return portable
}

func stableDiffusionVideoInvocationBindingsForTest(root string) []InvocationExactBinding {
	return []InvocationExactBinding{
		stableDiffusionInvocationBindingForTest(StableDiffusionVideoFL2VARequirementID, "fl2va", filepath.Join(root, "fl2va.gguf"), 'a'),
		stableDiffusionInvocationBindingForTest(StableDiffusionVideoRef2VARequirementID, "ref2va", filepath.Join(root, "ref2va.gguf"), 'b'),
		stableDiffusionInvocationBindingForTest(StableDiffusionVideoEncoderRequirementID, "encoder", filepath.Join(root, "encoder.gguf"), 'c'),
		stableDiffusionInvocationBindingForTest(StableDiffusionVideoVAERequirementID, "video-vae", filepath.Join(root, "video-vae.safetensors"), 'd'),
		stableDiffusionInvocationBindingForTest(StableDiffusionAudioVAERequirementID, "audio-vae", filepath.Join(root, "audio-vae.safetensors"), 'e'),
	}
}

func stableDiffusionVideoValidationInputsForTest(requirements []*runtimev1.LocalCapabilityRequirement) ([]*runtimev1.ModelAssetExactBinding, []ModelAssetDescriptor) {
	bindings := make([]*runtimev1.ModelAssetExactBinding, 0, len(requirements))
	assets := make([]ModelAssetDescriptor, 0, len(requirements))
	for index, slot := range stableDiffusionVideoSlots {
		digest := strings.Repeat(string(rune('a'+index)), 64)
		modelAssetID := "asset-" + slot.id
		bindings = append(bindings, &runtimev1.ModelAssetExactBinding{
			RequirementId: slot.id, ModelAssetId: modelAssetID, VerifiedContentId: "sha256:" + digest, EntrySha256: digest,
		})
		var probe []byte
		switch slot.id {
		case StableDiffusionVideoFL2VARequirementID:
			probe = []byte("GGUF blocks.0.adaln_proj.linear.weight condition_proj.weight audio_patch_proj.weight time_embedder.weight")
		case StableDiffusionVideoRef2VARequirementID:
			probe = []byte("GGUF blocks.0.adaln_proj.linear.weight condition_proj.weight audio_patch_proj.weight adaln_t_table")
		case StableDiffusionVideoEncoderRequirementID:
			probe = []byte("GGUF visual.deepstack_merger_list.0.linear_fc1.weight")
		case StableDiffusionVideoVAERequirementID:
			probe = safetensorsProbeForTest([]byte(`{"decoder.mask_token":{"dtype":"F16","shape":[1],"data_offsets":[0,2]}}`))
		case StableDiffusionAudioVAERequirementID:
			probe = safetensorsProbeForTest([]byte(`{"dec_in_proj.weight":{"dtype":"F32","shape":[1],"data_offsets":[0,4]}}`))
		}
		roles := []string(nil)
		if slot.artifactRole != "" {
			roles = []string{slot.artifactRole}
		}
		assets = append(assets, ModelAssetDescriptor{
			ModelAssetID: modelAssetID, VerifiedContentID: "sha256:" + digest, EntrySHA256: digest,
			Kind: slot.assetKind, ArtifactRoles: roles, FormatProbe: probe,
		})
	}
	return bindings, assets
}

func safetensorsProbeForTest(header []byte) []byte {
	result := make([]byte, 8+len(header))
	binary.LittleEndian.PutUint64(result[:8], uint64(len(header)))
	copy(result[8:], header)
	return result
}

func stableDiffusionVideoRequestForTest() VideoInvocationRequest {
	return VideoInvocationRequest{
		Prompt: "video", Width: 640, Height: 480, FrameCount: 22, FPS: 24, Seed: 42, GenerateAudio: true,
	}
}

func assertVideoInvocationErrorKind(t *testing.T, err error, want InvocationFailureKind) {
	t.Helper()
	var invocationErr *InvocationError
	if !errors.As(err, &invocationErr) || invocationErr.Kind != want {
		t.Fatalf("error = %v, want InvocationError kind %q", err, want)
	}
}
