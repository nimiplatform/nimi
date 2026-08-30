package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestValidateLocalAppImageGenerateSpecProjectsExclusiveArtifactReference(t *testing.T) {
	const artifactID = "artifact_qwen_edit_source"
	got, err := validateLocalAppImageGenerateSpec(&runtimev1.LocalAppImageGenerateScenarioSpec{
		Prompt:                   "change the background to a forest",
		ReferenceImageArtifactId: artifactID,
	})
	if err != nil {
		t.Fatalf("validate artifact image spec: %v", err)
	}
	if got.GetReferenceImageArtifactId() != artifactID || len(got.GetReferenceImages()) != 0 {
		t.Fatalf("projected artifact image spec = %+v", got)
	}

	_, err = validateLocalAppImageGenerateSpec(&runtimev1.LocalAppImageGenerateScenarioSpec{
		Prompt:                   "edit",
		ReferenceImages:          []string{"https://example.com/reference.png"},
		ReferenceImageArtifactId: artifactID,
	})
	assertLocalAppTextCandidateError(t, err, codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)

	_, err = validateLocalAppImageGenerateSpec(&runtimev1.LocalAppImageGenerateScenarioSpec{
		Prompt:                   "edit",
		ReferenceImageArtifactId: " padded-artifact-id ",
	})
	assertLocalAppTextCandidateError(t, err, codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_INVALID_INPUT)
}

func TestValidateLocalAppImageGenerateSpecProjectsMaskArtifactAndStrength(t *testing.T) {
	strength := float32(0.6)
	got, err := validateLocalAppImageGenerateSpec(&runtimev1.LocalAppImageGenerateScenarioSpec{
		Prompt:                   "inpaint the marked region",
		ReferenceImageArtifactId: "artifact_source",
		MaskArtifactId:           "artifact_mask",
		Strength:                 &strength,
	})
	if err != nil {
		t.Fatalf("validateLocalAppImageGenerateSpec: %v", err)
	}
	if got.GetReferenceImageArtifactId() != "artifact_source" || got.GetMaskArtifactId() != "artifact_mask" || got.Strength == nil || got.GetStrength() != strength {
		t.Fatalf("projected mask artifact spec = %+v", got)
	}
	for _, invalid := range []*runtimev1.LocalAppImageGenerateScenarioSpec{
		{Prompt: "inpaint", MaskArtifactId: "artifact_mask"},
		{Prompt: "inpaint", ReferenceImageArtifactId: "artifact_source", Mask: "https://example.com/mask.png", MaskArtifactId: "artifact_mask"},
		{Prompt: "inpaint", ReferenceImageArtifactId: "artifact_source", MaskArtifactId: " padded "},
	} {
		_, err := validateLocalAppImageGenerateSpec(invalid)
		if err == nil {
			t.Fatalf("invalid mask artifact spec was accepted: %+v", invalid)
		}
	}
}

func TestLocalAppImageArtifactReferenceReachesQwenEditHostAsImmutableBytes(t *testing.T) {
	svc := newTestService(nil)
	installLocalAppImageArtifactTestExecution(t, svc, "local-app-qwen-edit-artifact")
	host := &localImageHostStub{entered: make(chan struct{})}
	svc.SetLocalImageExecutionHost(host)
	payload := l1CarrierPNGBytes(t)
	uploaded, err := svc.UploadLocalAppArtifact(localAppArtifactUploadContext(), &runtimev1.UploadLocalAppArtifactRequest{
		Bytes: payload, MimeType: "image/png",
	})
	if err != nil {
		t.Fatalf("UploadLocalAppArtifact: %v", err)
	}

	submitted, err := svc.SubmitLocalAppScenarioJob(
		localAppScenarioDecisionContext(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit),
		&runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_ImageGenerate{
			ImageGenerate: &runtimev1.LocalAppImageGenerateScenarioSpec{
				Prompt:                   "change the background to a forest",
				ReferenceImageArtifactId: uploaded.GetArtifactId(),
			},
		}},
	)
	if err != nil {
		t.Fatalf("SubmitLocalAppScenarioJob: %v", err)
	}
	terminal := waitForScenarioJobTerminalForLocalTextTest(t, svc, submitted.GetJob().GetJobId())
	if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("terminal Job = %+v", terminal)
	}
	identity := terminal.GetEffectiveInputIdentity()
	if identity.GetLoadoutId() != "local-app-qwen-edit-artifact" || identity.GetRecipeId() != capabilitydriver.StableDiffusionQwenImageEditRecipeID || len(identity.GetModelAxes()) != 3 ||
		len(identity.GetAdmittedFeatures()) != 1 || identity.GetAdmittedFeatures()[0] != aicapabilities.FeatureInputImage {
		t.Fatalf("image Job ResolvedAssembly = %+v", identity)
	}
	if strings.Contains(identity.String(), uploaded.GetArtifactId()) {
		t.Fatalf("invocation artifact leaked into Loadout identity: %+v", identity)
	}

	host.mu.Lock()
	if len(host.plans) != 1 {
		host.mu.Unlock()
		t.Fatalf("image Host plans = %d, want 1", len(host.plans))
	}
	plan := host.plans[0]
	host.mu.Unlock()
	edit, ok := plan.RequestPlan().(capabilitydriver.StableDiffusionCPPInstructionEditRequestPlan)
	if !ok {
		t.Fatalf("request plan = %T, want instruction edit", plan.RequestPlan())
	}
	source := edit.SourceImage()
	if source.SourceIdentity != uploaded.GetArtifactId() || string(source.ImageBytes) != string(payload) {
		t.Fatalf("resolved source = %+v", source)
	}
	source.ImageBytes[0] ^= 0xff
	if got := edit.SourceImage(); got.SourceIdentity != uploaded.GetArtifactId() || string(got.ImageBytes) != string(payload) {
		t.Fatalf("instruction edit source was mutable: %+v", got)
	}
}

func TestLocalAppImageHTTPSReferenceCannotBypassRuntimeArtifactCustody(t *testing.T) {
	svc := newTestService(nil)
	installLocalAppImageArtifactTestExecution(t, svc, "local-app-qwen-edit-https-reject")
	host := &localImageHostStub{}
	svc.SetLocalImageExecutionHost(host)
	response, err := svc.SubmitLocalAppScenarioJob(
		localAppScenarioDecisionContext(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit),
		&runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_ImageGenerate{
			ImageGenerate: &runtimev1.LocalAppImageGenerateScenarioSpec{
				Prompt: "edit", ReferenceImages: []string{"https://example.com/reference.png"},
			},
		}},
	)
	if response != nil {
		t.Fatalf("local HTTPS reference returned Job: %+v", response)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED || statusCode(err) != codes.InvalidArgument {
		t.Fatalf("local HTTPS reference error=%v code=%v reason=%v present=%v", err, statusCode(err), reason, ok)
	}
	host.mu.Lock()
	planCount := len(host.plans)
	host.mu.Unlock()
	svc.scenarioJobs.mu.RLock()
	jobCount := len(svc.scenarioJobs.jobs)
	svc.scenarioJobs.mu.RUnlock()
	if planCount != 0 || jobCount != 0 {
		t.Fatalf("local HTTPS reference created work: host_plans=%d jobs=%d", planCount, jobCount)
	}
}

func TestLocalAppImageArtifactReferenceRejectsCustodyViolationsBeforeHost(t *testing.T) {
	svc := newTestService(nil)
	installLocalAppImageArtifactTestExecution(t, svc, "local-app-qwen-edit-reject")
	host := &localImageHostStub{}
	svc.SetLocalImageExecutionHost(host)
	owner := &runtimeartifact.ArtifactOwner{
		SubjectUserID: "account-1", RegisteredAppSubject: "principal-1", AppID: "producer-app",
	}
	foreignOwner := &runtimeartifact.ArtifactOwner{
		SubjectUserID: "account-1", RegisteredAppSubject: "principal-2", AppID: "producer-app",
	}
	putImageArtifactRecordForTest(t, svc, "artifact_image_foreign", foreignOwner, "image/png", l1CarrierPNGBytes(t))
	putImageArtifactRecordForTest(t, svc, "artifact_image_wrong_mime", owner, "audio/wav", []byte("RIFFaudio"))
	putImageArtifactRecordForTest(t, svc, "artifact_image_oversized", owner, "image/png", make([]byte, runtimeartifact.MaxInlineBytes+1))

	tests := []struct {
		name       string
		artifactID string
		wantCode   codes.Code
		wantReason runtimev1.ReasonCode
	}{
		{name: "foreign owner", artifactID: "artifact_image_foreign", wantCode: codes.PermissionDenied, wantReason: runtimev1.ReasonCode_ARTIFACT_FORBIDDEN},
		{name: "wrong MIME", artifactID: "artifact_image_wrong_mime", wantCode: codes.InvalidArgument, wantReason: runtimev1.ReasonCode_ARTIFACT_MIME_MISMATCH},
		{name: "missing", artifactID: "artifact_image_missing", wantCode: codes.PermissionDenied, wantReason: runtimev1.ReasonCode_ARTIFACT_FORBIDDEN},
		{name: "oversized", artifactID: "artifact_image_oversized", wantCode: codes.ResourceExhausted, wantReason: runtimev1.ReasonCode_ARTIFACT_TOO_LARGE},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response, err := svc.SubmitLocalAppScenarioJob(
				localAppScenarioDecisionContext(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit),
				&runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_ImageGenerate{
					ImageGenerate: &runtimev1.LocalAppImageGenerateScenarioSpec{
						Prompt: "edit", ReferenceImageArtifactId: test.artifactID,
					},
				}},
			)
			if response != nil {
				t.Fatalf("rejected artifact returned Job: %+v", response)
			}
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != test.wantReason || statusCode(err) != test.wantCode {
				t.Fatalf("submit error=%v code=%v reason=%v present=%v", err, statusCode(err), reason, ok)
			}
		})
	}
	host.mu.Lock()
	planCount := len(host.plans)
	host.mu.Unlock()
	svc.scenarioJobs.mu.RLock()
	jobCount := len(svc.scenarioJobs.jobs)
	svc.scenarioJobs.mu.RUnlock()
	if planCount != 0 || jobCount != 0 {
		t.Fatalf("rejected artifact created work: host_plans=%d jobs=%d", planCount, jobCount)
	}
}

func TestImageArtifactReferenceParticipatesInSelectedAndCatalogFeatures(t *testing.T) {
	spec := &runtimev1.ImageGenerateScenarioSpec{
		Prompt: "edit", ReferenceImageArtifactId: "artifact_feature_source",
	}
	if err := requireSelectedImageRequestFeatures(spec, []string{aicapabilities.FeatureInputImage}); err != nil {
		t.Fatalf("selected input.image feature rejected artifact reference: %v", err)
	}
	err := requireSelectedImageRequestFeatures(spec, nil)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED {
		t.Fatalf("missing selected feature error=%v reason=%v present=%v", err, reason, ok)
	}

	svc := newTestService(nil)
	if err := svc.validateImageGenerateAgainstCatalog(context.Background(), "openai", "gpt-image-1.5", spec); err != nil {
		t.Fatalf("catalog input.image feature rejected artifact reference: %v", err)
	}
	err = svc.validateImageGenerateAgainstCatalog(context.Background(), "flux", "flux-2-klein-4b", spec)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("missing catalog feature error=%v reason=%v present=%v", err, reason, ok)
	}
}

func TestCloudImageArtifactReferenceIsTypedUnsupported(t *testing.T) {
	request := cloudImageJobRequest("edit from Runtime artifact")
	request.GetSpec().GetImageGenerate().ReferenceImageArtifactId = "artifact_cloud_image"
	if !cloudImageHasLocalOnlyInput(request) {
		t.Fatal("cloud image artifact reference was not detected")
	}

	fixture := newManagedCloudScenarioTestFixture(t, "openai", "gpt-image-1.5", "https://api.openai.com/v1", Config{})
	ctx := withCloudScenarioTestIntent(scenarioJobUserContext("nimi.desktop", "user-001"), capabilitydriver.StableDiffusionCapabilityContract, fixture.targetRef)
	response, err := fixture.service.SubmitScenarioJob(ctx, request)
	if response != nil {
		t.Fatalf("Cloud artifact reference returned Job: %+v", response)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED || statusCode(err) != codes.InvalidArgument {
		t.Fatalf("Cloud artifact submit error=%v code=%v reason=%v present=%v", err, statusCode(err), reason, ok)
	}
	if len(fixture.service.scenarioJobs.jobs) != 0 {
		t.Fatalf("Cloud artifact reference created %d jobs", len(fixture.service.scenarioJobs.jobs))
	}
}

func installLocalAppImageArtifactTestExecution(t *testing.T, svc *Service, configurationID string) {
	t.Helper()
	if err := overwriteAIConfigStoreForTest(context.Background(), svc.aiConfigStore, "account-1",
		appAIConfig("nimi.realm-persona-studio", localAppAIConfigIntent(capabilitydriver.StableDiffusionCapabilityContract))); err != nil {
		t.Fatalf("install Local App AIConfig: %v", err)
	}
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{
		projection: selectedQwenImageEditExecutionForArtifactTest(t, configurationID),
	})
}

func selectedQwenImageEditExecutionForArtifactTest(t *testing.T, configurationID string) *localexecution.SelectedLocalExecution {
	t.Helper()
	portable, err := structpb.NewStruct(map[string]any{
		"executionOptions": map[string]any{
			"steps": 2.0, "cfgScale": 2.5, "width": 64.0, "height": 64.0,
			"seed": 7.0, "threads": 1.0, "sampler": "euler",
			"diffusionFlashAttention": true, "offloadParamsToCPU": true,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	driver := capabilitydriver.StableDiffusionImageDriver{}
	features := []string{aicapabilities.FeatureInputImage}
	requirements, reason := driver.Interpret(capabilitydriver.InterpretInput{
		RecipeID: capabilitydriver.StableDiffusionQwenImageEditRecipeID, PortableConfig: portable, SupportedFeatures: features,
	})
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatalf("Interpret Qwen edit: %v", reason)
	}
	root := t.TempDir()
	bindings := make([]localexecution.ExactBinding, 0, len(requirements))
	for _, requirement := range requirements {
		extension := ".gguf"
		if requirement.GetRequirementId() == capabilitydriver.StableDiffusionVAERequirementID {
			extension = ".safetensors"
		}
		path := filepath.Join(root, requirement.GetRequirementId()+extension)
		content := []byte(requirement.GetRequirementId())
		if err := os.WriteFile(path, content, 0o600); err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(content)
		entrySHA256 := hex.EncodeToString(digest[:])
		modelAssetID := configurationID + "-" + requirement.GetRequirementId()
		bindings = append(bindings, localexecution.ExactBinding{
			RequirementID:     requirement.GetRequirementId(),
			ModelAssetID:      modelAssetID,
			AbsolutePath:      path,
			VerifiedContentID: "sha256:" + entrySHA256,
			EntrySHA256:       entrySHA256,
		})
	}
	return &localexecution.SelectedLocalExecution{
		LoadoutID:          configurationID,
		RecipeID:           capabilitydriver.StableDiffusionQwenImageEditRecipeID,
		RecipeRevision:     "1",
		CapabilityContract: capabilitydriver.StableDiffusionCapabilityContract,
		DisplayName:        configurationID,
		DriverIdentity: (&capabilitydriver.Identity{
			ImplementationID: capabilitydriver.StableDiffusionImplementationID,
			DriverID:         capabilitydriver.StableDiffusionDriverID,
			DriverDialect:    capabilitydriver.StableDiffusionDriverDialect,
		}).Proto(),
		PortableConfig:                  portable,
		Requirements:                    requirements,
		ExactBindings:                   bindings,
		ImplementationSupportedFeatures: append([]string(nil), features...),
		ConfiguredFeatures:              append([]string(nil), features...),
		Configured:                      true,
	}
}

func putImageArtifactRecordForTest(
	t *testing.T,
	svc *Service,
	artifactID string,
	owner *runtimeartifact.ArtifactOwner,
	mimeType string,
	payload []byte,
) {
	t.Helper()
	if err := svc.runtimeArtifacts.Put(artifactID, runtimeartifact.ArtifactRecord{
		Bytes: payload, MimeType: mimeType, Owner: owner,
	}); err != nil {
		t.Fatalf("put image artifact %q: %v", artifactID, err)
	}
}
