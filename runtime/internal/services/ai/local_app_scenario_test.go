package ai

import (
	"context"
	"math"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
)

func localAppScenarioDecisionContext(operation accountservice.LocalAppOperation, capability string) context.Context {
	return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
		AccountID:            "account-1",
		AppID:                "nimi.realm-persona-studio",
		RegisteredAppSubject: "principal-1",
		Operation:            operation,
		AuthorityClass:       localappop.AuthorityClassAppAccess,
		OperationCapability:  capability,
	})
}

func localAppScenarioExecuteContext() context.Context {
	return localAppScenarioDecisionContext(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute)
}

func validLocalAppEmbedExecuteRequest() *runtimev1.ExecuteLocalAppScenarioRequest {
	return &runtimev1.ExecuteLocalAppScenarioRequest{
		Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextEmbed{
			TextEmbed: &runtimev1.LocalAppTextEmbedScenarioSpec{Inputs: []string{"embed this"}},
		},
	}
}

func TestValidateLocalAppImageGenerateSpecPreservesBoundedParameters(t *testing.T) {
	got, err := validateLocalAppImageGenerateSpec(&runtimev1.LocalAppImageGenerateScenarioSpec{
		Prompt: "image", N: testInt32(0), Seed: testInt64(0),
		ReferenceImages: []string{"https://example.com/reference.png"},
		Mask:            "https://example.com/mask.png", ResponseFormat: "url",
	})
	if err != nil {
		t.Fatalf("validateLocalAppImageGenerateSpec: %v", err)
	}
	if got.N == nil || got.Seed == nil || len(got.GetReferenceImages()) != 1 ||
		got.GetMask() != "https://example.com/mask.png" || got.GetResponseFormat() != "url" {
		t.Fatalf("projected image spec = %+v", got)
	}
	if _, err := validateLocalAppImageGenerateSpec(&runtimev1.LocalAppImageGenerateScenarioSpec{
		Prompt: "image", ReferenceImages: []string{"http://insecure.example/reference.png"},
	}); err == nil {
		t.Fatal("insecure reference image was accepted")
	}
}

func TestValidateLocalAppImageGenerateSpecPreservesRouteNeutralSeed(t *testing.T) {
	for _, seed := range []int64{math.MinInt64, math.MaxInt64} {
		got, err := validateLocalAppImageGenerateSpec(&runtimev1.LocalAppImageGenerateScenarioSpec{
			Prompt: "image", Seed: testInt64(seed),
		})
		if err != nil || got == nil || got.Seed == nil || got.GetSeed() != seed {
			t.Fatalf("seed %d projected=%+v error=%v", seed, got, err)
		}
	}
}

func TestSubmitLocalAppImageJobReachesSelectedDriverWithNegativeSeed(t *testing.T) {
	svc := newTestService(nil)
	if err := svc.aiConfigStore.Overwrite(context.Background(), "account-1",
		appAIConfig("nimi.realm-persona-studio", localAppAIConfigIntent("image.generate"))); err != nil {
		t.Fatalf("install Local App AIConfig: %v", err)
	}
	host := &localImageHostStub{}
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedImageExecutionForTest(t, "local-app-negative-image-seed")})
	svc.SetLocalImageExecutionHost(host)
	response, err := svc.SubmitLocalAppScenarioJob(
		localAppScenarioDecisionContext(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit),
		&runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_ImageGenerate{
			ImageGenerate: &runtimev1.LocalAppImageGenerateScenarioSpec{Prompt: "image", Seed: testInt64(math.MinInt32)},
		}},
	)
	if err != nil || response == nil || response.GetJob() == nil {
		t.Fatalf("submit negative-seed Local App image Job response=%+v error=%v", response, err)
	}
	terminal := waitForScenarioJobTerminalForLocalTextTest(t, svc, response.GetJob().GetJobId())
	if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("terminal Job=%+v", terminal)
	}
	host.mu.Lock()
	defer host.mu.Unlock()
	if len(host.plans) != 1 {
		t.Fatalf("captured plans=%d, want 1", len(host.plans))
	}
	if host.plans[0].Seed() != math.MinInt32 {
		t.Fatalf("captured seed=%d, want %d", host.plans[0].Seed(), math.MinInt32)
	}
}

func TestValidateLocalAppImageGenerateSpecPreservesRouteNeutralCountOptions(t *testing.T) {
	for _, count := range []int32{0, 5} {
		got, err := validateLocalAppImageGenerateSpec(&runtimev1.LocalAppImageGenerateScenarioSpec{
			Prompt: "image",
			N:      testInt32(count),
		})
		if err != nil || got == nil || got.N == nil || got.GetN() != count {
			t.Fatalf("count %d projected=%+v error=%v", count, got, err)
		}
	}
}

func TestLocalAppImageOptionsUseResolvedLocalDriverClassificationBeforeWork(t *testing.T) {
	options := []struct {
		name string
		n    *int32
		size string
		seed *int64
	}{
		{name: "explicit zero count", n: testInt32(0), size: "64x64"},
		{name: "count above local maximum", n: testInt32(5), size: "64x64"},
		{name: "invalid size", n: testInt32(1), size: "65x64"},
		{name: "seed below local carrier", n: testInt32(1), size: "64x64", seed: testInt64(math.MinInt32 - 1)},
		{name: "seed above local carrier", n: testInt32(1), size: "64x64", seed: testInt64(math.MaxInt32 + 1)},
	}
	for _, async := range []bool{false, true} {
		mode := "sync"
		if async {
			mode = "async"
		}
		for _, option := range options {
			t.Run(mode+"/"+option.name, func(t *testing.T) {
				svc := newTestService(nil)
				if err := svc.aiConfigStore.Overwrite(context.Background(), "account-1",
					appAIConfig("nimi.realm-persona-studio", localAppAIConfigIntent("image.generate"))); err != nil {
					t.Fatalf("install Local App AIConfig: %v", err)
				}
				host := &localImageHostStub{}
				svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedImageExecutionForTest(t, "local-app-image-option-"+mode+"-"+option.name)})
				svc.SetLocalImageExecutionHost(host)
				spec := &runtimev1.LocalAppImageGenerateScenarioSpec{Prompt: "image", N: option.n, Size: option.size, Seed: option.seed}

				var err error
				if async {
					response, callErr := svc.SubmitLocalAppScenarioJob(
						localAppScenarioDecisionContext(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit),
						&runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_ImageGenerate{ImageGenerate: spec}},
					)
					if response != nil {
						t.Fatalf("unsupported option returned Local App Job: %+v", response)
					}
					err = callErr
				} else {
					response, callErr := svc.ExecuteLocalAppScenario(
						localAppScenarioExecuteContext(),
						&runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_ImageGenerate{ImageGenerate: spec}},
					)
					if response != nil {
						t.Fatalf("unsupported option returned Local App response: %+v", response)
					}
					err = callErr
				}
				if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED || statusCode(err) != codes.InvalidArgument {
					t.Fatalf("option error=%v code=%v reason=%v present=%v", err, statusCode(err), reason, ok)
				}
				host.mu.Lock()
				planCount := len(host.plans)
				host.mu.Unlock()
				svc.scenarioJobs.mu.RLock()
				jobCount := len(svc.scenarioJobs.jobs)
				svc.scenarioJobs.mu.RUnlock()
				if planCount != 0 || jobCount != 0 {
					t.Fatalf("unsupported Local App option created work: host_plans=%d jobs=%d", planCount, jobCount)
				}
			})
		}
	}
}

func TestExecuteLocalAppScenarioRequiresExactDecision(t *testing.T) {
	svc := &Service{}
	_, err := svc.ExecuteLocalAppScenario(context.Background(), validLocalAppEmbedExecuteRequest())
	assertLocalAppTextCandidateError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)

	wrongOperation := localAppScenarioDecisionContext(accountservice.LocalAppOperationTextCandidateGenerate, localappop.AppOperationIDTextCandidateGenerate)
	_, err = svc.ExecuteLocalAppScenario(wrongOperation, validLocalAppEmbedExecuteRequest())
	assertLocalAppTextCandidateError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
}

func TestExecuteLocalAppScenarioRejectsInvalidInput(t *testing.T) {
	svc := &Service{}
	invalid := []*runtimev1.ExecuteLocalAppScenarioRequest{
		{},
		{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextEmbed{TextEmbed: &runtimev1.LocalAppTextEmbedScenarioSpec{}}},
		{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextEmbed{TextEmbed: &runtimev1.LocalAppTextEmbedScenarioSpec{Inputs: []string{" padded "}}}},
		{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextEmbed{TextEmbed: &runtimev1.LocalAppTextEmbedScenarioSpec{Inputs: []string{strings.Repeat("x", maxLocalAppScenarioEmbedInputBytes+1)}}}},
		{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_ImageGenerate{ImageGenerate: &runtimev1.LocalAppImageGenerateScenarioSpec{}}},
		{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_ImageGenerate{ImageGenerate: &runtimev1.LocalAppImageGenerateScenarioSpec{Prompt: "image", N: testInt32(5)}}},
		{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_ImageGenerate{ImageGenerate: &runtimev1.LocalAppImageGenerateScenarioSpec{Prompt: "image", Size: strings.Repeat("s", maxLocalAppScenarioOptionTextBytes+1)}}},
	}
	for index, request := range invalid {
		_, err := svc.ExecuteLocalAppScenario(localAppScenarioExecuteContext(), request)
		if err == nil {
			t.Fatalf("invalid request %d was accepted", index)
		}
	}
}

func TestExecuteLocalAppScenarioFailsClosedWithoutAIConfig(t *testing.T) {
	svc := newTestService(nil)
	response, err := svc.ExecuteLocalAppScenario(localAppScenarioExecuteContext(), validLocalAppEmbedExecuteRequest())
	if response != nil {
		t.Fatalf("response = %+v, want nil", response)
	}
	assertLocalAppTextCandidateError(t, err, codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_NOT_FOUND)
}

func TestExecuteLocalAppScenarioLocalEmbedFailsClosedWithoutMachineSelection(t *testing.T) {
	svc := newTestService(nil)
	if err := svc.aiConfigStore.Overwrite(context.Background(), "account-1", &runtimev1.AIConfig{
		Owner:        derivedAppAIConfigOwner("nimi.realm-persona-studio"),
		Capabilities: []*runtimev1.AIConfigCapabilityIntent{localAppAIConfigIntent("text.embed")},
	}); err != nil {
		t.Fatalf("install App AIConfig: %v", err)
	}
	_, err := svc.ExecuteLocalAppScenario(localAppScenarioExecuteContext(), validLocalAppEmbedExecuteRequest())
	assertLocalAppTextCandidateError(t, err, codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND)
}

func TestExecuteLocalAppScenarioCloudEmbedFailsClosedWithoutBinding(t *testing.T) {
	svc := newTestService(nil)
	if err := svc.aiConfigStore.Overwrite(context.Background(), "account-1",
		appAIConfig("nimi.realm-persona-studio", grantlessCloudAIConfigIntent(t, "text.embed"))); err != nil {
		t.Fatalf("install Cloud App AIConfig: %v", err)
	}
	// The request passes admission and clamps and enters owner AIConfig
	// composition; without a resolvable Cloud binding it fails closed.
	_, err := svc.ExecuteLocalAppScenario(localAppScenarioExecuteContext(), validLocalAppEmbedExecuteRequest())
	assertLocalAppTextCandidateError(t, err, codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
}

func TestProjectLocalAppScenarioArtifactTrimsOwnerFields(t *testing.T) {
	projected, err := projectLocalAppScenarioArtifact(&runtimev1.ScenarioArtifact{
		ArtifactId: "artifact-1",
		MimeType:   "image/png",
		Bytes:      []byte("payload"),
		SizeBytes:  7,
		Sha256:     "sha256:abc",
		Uri:        "file:///runtime/private/path.png",
		Metadata:   nil,
	})
	if err != nil {
		t.Fatalf("project artifact: %v", err)
	}
	if projected.GetArtifactId() != "artifact-1" || projected.GetMimeType() != "image/png" ||
		len(projected.GetBytes()) != 0 || projected.GetSizeBytes() != 7 || projected.GetSha256() != "sha256:abc" {
		t.Fatalf("projected artifact = %+v", projected)
	}

	large, err := projectLocalAppScenarioArtifact(&runtimev1.ScenarioArtifact{
		ArtifactId: "artifact-1", MimeType: "image/png", Bytes: make([]byte, maxLocalAppInlineArtifactBytes+1),
		SizeBytes: maxLocalAppInlineArtifactBytes + 1,
	})
	if err != nil || large.GetSizeBytes() != maxLocalAppInlineArtifactBytes+1 || len(large.GetBytes()) != 0 {
		t.Fatalf("large metadata projection = %+v, error=%v", large, err)
	}
	if _, err := projectLocalAppScenarioArtifact(&runtimev1.ScenarioArtifact{MimeType: "image/png"}); err == nil {
		t.Fatal("artifact without id or bytes passed projection")
	}
	if _, err := projectLocalAppScenarioArtifact(&runtimev1.ScenarioArtifact{ArtifactId: " padded ", MimeType: "image/png"}); err == nil {
		t.Fatal("padded artifact id passed projection")
	}
}
