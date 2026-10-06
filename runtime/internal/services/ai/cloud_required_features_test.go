package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

func publicCloudFeatureIntent(t *testing.T, fixture managedCloudScenarioTestFixture, appID, contract string) *runtimev1.AIConfigCapabilityIntent {
	t.Helper()
	options, err := fixture.service.ListAppAIConfigOptions(localAppAIConfigContext("user-001", appID, accountservice.LocalAppOperationAppAIConfigOptionsList), &runtimev1.ListAppAIConfigOptionsRequest{
		Query: &runtimev1.ListAppAIConfigOptionsRequest_CloudTargets{CloudTargets: &runtimev1.AIConfigCloudTargetOptionsQuery{CapabilityContract: contract, ConnectorRef: fixture.connectorID}},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, option := range options.GetCloudTargets().GetOptions() {
		if option.GetProviderModelTarget().GetFields()["providerModelId"].GetStringValue() == fixture.descriptor.GetProviderModelId() {
			return &runtimev1.AIConfigCapabilityIntent{CapabilityContract: contract, Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
				ConnectorRef: fixture.connectorID, Implementation: option.GetImplementation(), ProviderModelTarget: option.GetProviderModelTarget(),
			}}}
		}
	}
	t.Fatal("exact public target option missing")
	return nil
}

func TestCloudRequiredFeaturesPublicConfigAndCapture(t *testing.T) {
	for _, tc := range []struct{ contract, provider, model, supported, unsupported string }{
		{"text.generate", "openai", "gpt-4o-mini", "input.image", "input.audio"},
		{"image.generate", "openai", "gpt-image-1.5", "", "input.mask"},
	} {
		t.Run(tc.contract, func(t *testing.T) {
			fixture := newManagedCloudScenarioTestFixture(t, tc.provider, tc.model, "https://provider.example.test", Config{})
			appID := "app.required-features"
			intent := publicCloudFeatureIntent(t, fixture, appID, tc.contract)
			writeCtx := protectedAppAIConfigPrincipalContext("user-001", appID)
			readCtx := localAppAIConfigContext("user-001", appID, accountservice.LocalAppOperationAppAIConfigRead)
			captureCtx := scenarioJobUserContext(appID, "user-001")
			head := &runtimev1.ScenarioRequestHead{AppId: appID, SubjectUserId: "user-001", TimeoutMs: 10_000}
			capture := func() (any, func(), error) {
				if tc.contract == "image.generate" {
					req := cloudImageJobRequest("plain prompt without mask")
					req.Head = head
					value, err := fixture.service.captureCloudMediaEffectiveInputs(captureCtx, head, req, runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB)
					if err != nil {
						return nil, func() {}, err
					}
					return value.resolvedAssembly, value.release, nil
				}
				req := &runtimev1.ExecuteScenarioRequest{Head: head, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
					Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{TextGenerate: &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "plain text"}}}}}}
				value, err := fixture.service.captureCloudTextEffectiveInputs(captureCtx, head, req, runtimev1.ExecutionMode_EXECUTION_MODE_SYNC)
				if err != nil {
					return nil, func() {}, err
				}
				return value.resolvedAssembly, value.release, nil
			}
			intent.RequiredFeatures = []string{tc.unsupported}
			written, err := fixture.service.OverwriteAppAIConfig(writeCtx, &runtimev1.OverwriteAppAIConfigRequest{Config: appAIConfig(appID, intent), ExpectedRevision: "0"})
			if err != nil || !written.GetCommitted() {
				t.Fatalf("public overwrite mismatch: %v %v", written, err)
			}
			read, err := fixture.service.GetAppAIConfig(readCtx, &runtimev1.GetAppAIConfigRequest{})
			selection := read.GetEffectiveSelections()[0]
			if err != nil || selection.GetState() != runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_BLOCKED || selection.GetCloud().GetTarget().GetState() != selection.GetState() ||
				len(selection.GetReasons()) != 1 || selection.GetReasons()[0] != runtimev1.ReasonCode_AI_CONFIG_INVALID.String() || read.GetConfig().GetCapabilities()[0].GetRequiredFeatures()[0] != tc.unsupported {
				t.Fatalf("mismatch Get = %v %v", read, err)
			}
			if _, _, err := capture(); status.Code(err) != codes.FailedPrecondition {
				t.Fatalf("mismatch capture = %v", err)
			} else if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_CONFIG_INVALID {
				t.Fatalf("capture reason = %v", err)
			}
			// The protected handler must also reject before publishing a Job or
			// dispatching plain text, even though the request has no media input.
			decision := func(op accountservice.LocalAppOperation, capability string) context.Context {
				return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: appID, RegisteredAppSubject: "required-feature-principal", Operation: op, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: capability})
			}
			if tc.contract == "image.generate" {
				response, err := fixture.service.SubmitLocalAppScenarioJob(decision(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit), &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_ImageGenerate{ImageGenerate: &runtimev1.LocalAppImageGenerateScenarioSpec{Prompt: "plain prompt"}}})
				if response != nil || status.Code(err) != codes.FailedPrecondition {
					t.Fatalf("protected submit mismatch = %v %v", response, err)
				}
			} else {
				response, err := fixture.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute), &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "plain text"}}}}})
				if response != nil || status.Code(err) != codes.FailedPrecondition {
					t.Fatalf("protected text mismatch = %v %v", response, err)
				}
			}
			intent.RequiredFeatures = nil
			if tc.supported != "" {
				intent.RequiredFeatures = []string{tc.supported}
			}
			written, err = fixture.service.OverwriteAppAIConfig(writeCtx, &runtimev1.OverwriteAppAIConfigRequest{Config: appAIConfig(appID, intent), ExpectedRevision: written.GetRevision()})
			if err != nil || !written.GetCommitted() {
				t.Fatalf("public supported overwrite = %v %v", written, err)
			}
			read, err = fixture.service.GetAppAIConfig(readCtx, &runtimev1.GetAppAIConfigRequest{})
			if err != nil || read.GetEffectiveSelections()[0].GetState() != runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_READY {
				t.Fatalf("supported Get = %v %v", read, err)
			}
			captured, release, err := capture()
			if err != nil {
				t.Fatalf("supported capture: %v", err)
			}
			defer release()
			before, err := json.Marshal(captured)
			if err != nil {
				t.Fatal(err)
			}
			changed := proto.Clone(intent).(*runtimev1.AIConfigCapabilityIntent)
			changed.RequiredFeatures = []string{tc.unsupported}
			written, err = fixture.service.OverwriteAppAIConfig(writeCtx, &runtimev1.OverwriteAppAIConfigRequest{Config: appAIConfig(appID, changed), ExpectedRevision: written.GetRevision()})
			if err != nil || !written.GetCommitted() {
				t.Fatalf("later config: %v %v", written, err)
			}
			after, err := json.Marshal(captured)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatalf("captured inputs changed after overwrite: %v", err)
			}
			if _, _, err := capture(); err == nil {
				t.Fatal("new capture ignored changed required features")
			}
		})
	}
}

func TestCloudVoiceRequiredFeaturesRejectBeforePublication(t *testing.T) {
	fixture := newManagedCloudScenarioTestFixture(t, "dashscope", "qwen3-tts-vd-2026-01-26", "https://provider.example.test", Config{})
	const appID = "app.voice-required-features"
	intent := publicCloudFeatureIntent(t, fixture, appID, "voice.create")
	intent.RequiredFeatures = []string{"input.audio"}
	writeCtx := protectedAppAIConfigPrincipalContext("user-001", appID)
	written, err := fixture.service.OverwriteAppAIConfig(writeCtx, &runtimev1.OverwriteAppAIConfigRequest{Config: appAIConfig(appID, intent), ExpectedRevision: "0"})
	if err != nil || !written.GetCommitted() {
		t.Fatalf("public overwrite = %v %v", written, err)
	}
	read, err := fixture.service.GetAppAIConfig(localAppAIConfigContext("user-001", appID, accountservice.LocalAppOperationAppAIConfigRead), &runtimev1.GetAppAIConfigRequest{})
	if err != nil || read.GetEffectiveSelections()[0].GetState() != runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_BLOCKED {
		t.Fatalf("voice mismatch Get = %v %v", read, err)
	}
	ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: appID, RegisteredAppSubject: "voice-required-feature-principal", Operation: accountservice.LocalAppOperationScenarioJobSubmit, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: localappop.AppOperationIDScenarioJobSubmit})
	response, err := fixture.service.SubmitLocalAppScenarioJob(ctx, &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_VoiceCreate{VoiceCreate: &runtimev1.LocalAppVoiceCreateJobSpec{
		Source: &runtimev1.LocalAppVoiceCreateJobSpec_TextDescription{TextDescription: &runtimev1.VoiceT2VInput{InstructionText: "warm narrator", PreviewText: "Hello from Nimi."}},
	}}})
	if response != nil || status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("voice mismatch Submit = %v %v", response, err)
	}
	if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_CONFIG_INVALID {
		t.Fatalf("voice mismatch reason = %v", err)
	}
	intent.RequiredFeatures = []string{"input.text"}
	written, err = fixture.service.OverwriteAppAIConfig(writeCtx, &runtimev1.OverwriteAppAIConfigRequest{Config: appAIConfig(appID, intent), ExpectedRevision: written.GetRevision()})
	if err != nil || !written.GetCommitted() {
		t.Fatalf("voice compatible overwrite = %v %v", written, err)
	}
	read, err = fixture.service.GetAppAIConfig(localAppAIConfigContext("user-001", appID, accountservice.LocalAppOperationAppAIConfigRead), &runtimev1.GetAppAIConfigRequest{})
	if err != nil || read.GetEffectiveSelections()[0].GetState() != runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_READY {
		t.Fatalf("voice compatible Get = %v %v", read, err)
	}
}
