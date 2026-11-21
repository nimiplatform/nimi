package ai

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/codes"
)

func TestProjectCloudTextBehaviorsMatchesExactReviewedAdapters(t *testing.T) {
	svc := newTestService(nil)

	t.Run("streaming tool-use target (deepseek-v4-flash)", func(t *testing.T) {
		facts := textBehaviorAdapterResolutionFacts{
			ImplementationID: "deepseek",
			DriverID:         "nimillm",
			DriverDialect:    "deepseek",
			CloudTarget:      &textBehaviorCloudTarget{Provider: "deepseek", ProviderModelID: "deepseek-v4-flash"},
		}
		behaviors := projectCloudTextBehaviors(svc.textBehaviorAdapters, facts, true)
		if len(behaviors) != 3 {
			t.Fatalf("len(behaviors) = %d, want 3", len(behaviors))
		}
		toolUse := behaviors[0]
		if toolUse.GetKind() != runtimev1.TextBehaviorKind_TEXT_BEHAVIOR_KIND_TOOL_USE ||
			!toolUse.GetImplementationSupported() ||
			toolUse.GetConfigurationState() != runtimev1.TextBehaviorConfigurationState_TEXT_BEHAVIOR_CONFIGURATION_STATE_CONFIGURED {
			t.Fatalf("unexpected toolUse projection: %+v", toolUse)
		}
		if !toolUse.GetConfiguredToolUse().GetSupportsSync() || !toolUse.GetConfiguredToolUse().GetSupportsStream() {
			t.Fatalf("expected sync+stream tool use, got %+v", toolUse.GetConfiguredToolUse())
		}
		if behaviors[1].GetConfigurationState() != runtimev1.TextBehaviorConfigurationState_TEXT_BEHAVIOR_CONFIGURATION_STATE_CONFIGURED {
			t.Fatalf("expected reasoning configured, got %+v", behaviors[1])
		}
		if behaviors[2].GetConfigurationState() != runtimev1.TextBehaviorConfigurationState_TEXT_BEHAVIOR_CONFIGURATION_STATE_CONFIGURED {
			t.Fatalf("expected structured_output configured, got %+v", behaviors[2])
		}
	})

	t.Run("sync-only tool-use target (qwen3.8-flash)", func(t *testing.T) {
		facts := textBehaviorAdapterResolutionFacts{
			ImplementationID: "dashscope",
			DriverID:         "nimillm",
			DriverDialect:    "dashscope",
			CloudTarget:      &textBehaviorCloudTarget{Provider: "dashscope", ProviderModelID: "qwen3.8-flash"},
		}
		behaviors := projectCloudTextBehaviors(svc.textBehaviorAdapters, facts, true)
		if len(behaviors) != 3 {
			t.Fatalf("len(behaviors) = %d, want 3", len(behaviors))
		}
		toolUse := behaviors[0]
		if toolUse.GetConfigurationState() != runtimev1.TextBehaviorConfigurationState_TEXT_BEHAVIOR_CONFIGURATION_STATE_CONFIGURED ||
			!toolUse.GetConfiguredToolUse().GetSupportsSync() ||
			toolUse.GetConfiguredToolUse().GetSupportsStream() {
			t.Fatalf("expected sync-only tool use for qwen3.8-flash, got %+v", toolUse)
		}
		if behaviors[1].GetConfigurationState() != runtimev1.TextBehaviorConfigurationState_TEXT_BEHAVIOR_CONFIGURATION_STATE_UNAVAILABLE {
			t.Fatalf("expected reasoning unavailable for qwen3.8-flash, got %+v", behaviors[1])
		}
	})

	t.Run("unregistered plain-text target (gpt-5.4-nano)", func(t *testing.T) {
		facts := textBehaviorAdapterResolutionFacts{
			ImplementationID: "openai",
			DriverID:         "nimillm",
			DriverDialect:    "openai",
			CloudTarget:      &textBehaviorCloudTarget{Provider: "openai", ProviderModelID: "gpt-5.4-nano"},
		}
		behaviors := projectCloudTextBehaviors(svc.textBehaviorAdapters, facts, true)
		if len(behaviors) != 3 {
			t.Fatalf("len(behaviors) = %d, want 3", len(behaviors))
		}
		for _, behavior := range behaviors {
			if behavior.GetImplementationSupported() ||
				behavior.GetConfigurationState() != runtimev1.TextBehaviorConfigurationState_TEXT_BEHAVIOR_CONFIGURATION_STATE_UNAVAILABLE {
				t.Fatalf("expected unavailable behavior for unregistered target, got %+v", behavior)
			}
		}
	})
}

func TestListAppAIConfigCloudTargetsSeparateToolSupportFromConnectorReadiness(t *testing.T) {
	const model = "deepseek-v4-flash"
	fixture := newManagedCloudScenarioTestFixture(t, "deepseek", model, "https://api.deepseek.com", Config{})
	svc := fixture.service
	ctx := localAppAIConfigContext("user-001", "app.options", accountservice.LocalAppOperationAppAIConfigOptionsList)
	checkTarget := func(ref string, wantReady bool, wantReason runtimev1.ReasonCode) {
		t.Helper()
		list, err := svc.ListAppAIConfigOptions(ctx, &runtimev1.ListAppAIConfigOptionsRequest{
			Query: &runtimev1.ListAppAIConfigOptionsRequest_CloudTargets{
				CloudTargets: &runtimev1.AIConfigCloudTargetOptionsQuery{
					CapabilityContract: "text.generate", ConnectorRef: ref, Search: model,
				},
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		for _, target := range list.GetCloudTargets().GetOptions() {
			if target.GetProviderModelTarget().GetFields()["providerModelId"].GetStringValue() != model {
				continue
			}
			for _, behavior := range target.GetTextBehaviors() {
				if behavior.GetKind() != runtimev1.TextBehaviorKind_TEXT_BEHAVIOR_KIND_TOOL_USE {
					continue
				}
				if !behavior.GetImplementationSupported() || !behavior.GetImplementationToolUse().GetSupportsStream() {
					t.Fatalf("target %s lost its exact implementation support: %v", ref, behavior)
				}
				if wantReady {
					if target.GetState() != runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_READY ||
						behavior.GetConfigurationState() != runtimev1.TextBehaviorConfigurationState_TEXT_BEHAVIOR_CONFIGURATION_STATE_CONFIGURED ||
						!behavior.GetConfiguredToolUse().GetSupportsStream() {
						t.Fatalf("ready target lost configured streaming Tool Use: %v", target)
					}
				} else if target.GetState() != runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_BLOCKED ||
					len(target.GetReasons()) != 1 || target.GetReasons()[0] != wantReason.String() ||
					behavior.GetConfigurationState() != runtimev1.TextBehaviorConfigurationState_TEXT_BEHAVIOR_CONFIGURATION_STATE_UNAVAILABLE ||
					behavior.GetConfiguredToolUse() != nil {
					t.Fatalf("blocked target projected incorrect readiness: %v", target)
				}
				return
			}
		}
		t.Fatalf("target %s or its Tool Use projection is missing", ref)
	}

	checkTarget(fixture.connectorID, true, 0)

	status := runtimev1.ConnectorStatus_CONNECTOR_STATUS_DISABLED
	if _, err := svc.connStore.Update(fixture.connectorID, connector.ConnectorMutations{Status: &status}); err != nil {
		t.Fatal(err)
	}
	checkTarget(fixture.connectorID, false, runtimev1.ReasonCode_AI_CONNECTOR_DISABLED)

	const uncredentialed = "connector-deepseek-uncredentialed"
	if _, err := svc.connStore.Create(connector.ConnectorRecord{
		ConnectorID: uncredentialed, Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: "user-001",
		Provider: "deepseek", Endpoint: "https://api.deepseek.com", Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, ""); err != nil {
		t.Fatal(err)
	}
	checkTarget(uncredentialed, false, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING)
}

func TestSubmitLocalAppScenarioJobConfigRefSelectsNamedRecord(t *testing.T) {
	svc := newTestService(nil)
	host := &localSpeechHostStub{entered: make(chan struct{}), release: make(chan struct{})}
	defer close(host.release)
	selected := selectedSpeechExecutionForTest(t, capabilitydriver.AudioTranscribeContract, "speech-asr")
	selected.ExecutionTarget = &runtimeidentity.Target{Local: &runtimeidentity.LocalTarget{ReadinessRef: "model-asset://speech-asr"}}
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selected})
	svc.SetLocalSpeechExecutionHost(host)

	records, ok := svc.aiConfigStore.(aiconfig.RecordStore)
	if !ok {
		t.Fatal("test aiConfigStore must implement RecordStore")
	}
	// Default ("main") has ONLY text.generate — no audio.transcribe.
	if err := overwriteAIConfigStoreForTest(context.Background(), svc.aiConfigStore, "account-1",
		appAIConfig("nimi.realm-persona-studio", localAppAIConfigIntent("text.generate"))); err != nil {
		t.Fatal(err)
	}
	// Named record carries audio.transcribe.
	namedConfig := appAIConfig("nimi.realm-persona-studio", localAppAIConfigIntent(capabilitydriver.AudioTranscribeContract))
	created, committed, err := records.EditRecord(context.Background(), "account-1", "0", namedConfig, &runtimev1.AppAIConfigRecordEdit{
		Change: &runtimev1.AppAIConfigRecordEdit_CreateName{CreateName: "Voice Config"},
	})
	if err != nil || !committed {
		t.Fatalf("EditRecord: committed=%v err=%v", committed, err)
	}
	namedRef := created.Record.ConfigRef

	ctx := localAppScenarioJobContext(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit)
	baseSpec := &runtimev1.SubmitLocalAppScenarioJobRequest_SpeechTranscribe{
		SpeechTranscribe: &runtimev1.LocalAppSpeechTranscribeJobSpec{
			MimeType: "audio/wav",
			AudioSource: &runtimev1.SpeechTranscriptionAudioSource{
				Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: []byte("RIFF0000WAVEfmt ")},
			},
		},
	}

	// 1. Omitting config_ref hits Default ("main"), which lacks audio.transcribe.
	if _, err := svc.SubmitLocalAppScenarioJob(ctx, &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: baseSpec}); err == nil {
		t.Fatal("expected failure when Default config lacks audio.transcribe")
	} else {
		assertLocalAppTextCandidateError(t, err, codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}

	// 2. Malformed config_ref is rejected before dispatch.
	if _, err := svc.SubmitLocalAppScenarioJob(ctx, &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: baseSpec, ConfigRef: "../bad"}); err == nil {
		t.Fatal("expected invalid argument for malformed config_ref")
	} else {
		assertLocalAppTextCandidateError(t, err, codes.InvalidArgument, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}

	// 3. Nonexistent named config_ref fails closed with AI_CONFIG_NOT_FOUND.
	if _, err := svc.SubmitLocalAppScenarioJob(ctx, &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: baseSpec, ConfigRef: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}); err == nil {
		t.Fatal("expected not found for nonexistent config_ref")
	} else {
		assertLocalAppTextCandidateError(t, err, codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_NOT_FOUND)
	}

	request := &runtimev1.SubmitLocalAppScenarioJobRequest{
		Spec: baseSpec, ConfigRef: namedRef, ClientSubmissionId: "speech-action",
	}
	resp, err := svc.SubmitLocalAppScenarioJob(ctx, request)
	if err != nil {
		t.Fatalf("SubmitLocalAppScenarioJob with named config_ref failed: %v", err)
	}
	if resp.GetJob().GetJobId() == "" {
		t.Fatalf("expected non-empty job id, got %+v", resp)
	}

	foreignCtx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
		AccountID: "account-1", AppID: "app.other", RegisteredAppSubject: "other-subject",
		Operation: accountservice.LocalAppOperationScenarioJobSubmit, AuthorityClass: localappop.AuthorityClassAppAccess,
		OperationCapability: localappop.AppOperationIDScenarioJobSubmit,
	})
	_, err = svc.SubmitLocalAppScenarioJob(foreignCtx, request)
	assertLocalAppTextCandidateError(t, err, codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_NOT_FOUND)

	_, err = svc.SubmitLocalAppScenarioJob(ctx, &runtimev1.SubmitLocalAppScenarioJobRequest{
		Spec: baseSpec, ConfigRef: "main", ClientSubmissionId: request.GetClientSubmissionId(),
	})
	assertLocalAppTextCandidateError(t, err, codes.AlreadyExists, runtimev1.ReasonCode_AI_MEDIA_IDEMPOTENCY_CONFLICT)

	if _, committed, err := records.EditRecord(context.Background(), "account-1", created.Revision(),
		appAIConfig("nimi.realm-persona-studio"), &runtimev1.AppAIConfigRecordEdit{
			ConfigRef: namedRef, Change: &runtimev1.AppAIConfigRecordEdit_DeleteRecord{DeleteRecord: true},
		}); err != nil || !committed {
		t.Fatalf("delete named record: committed=%v err=%v", committed, err)
	}
	replayed, err := svc.SubmitLocalAppScenarioJob(ctx, request)
	if err != nil || replayed.GetJob().GetJobId() != resp.GetJob().GetJobId() {
		t.Fatalf("same action after record deletion = (%v, %v)", replayed, err)
	}
	_, err = svc.SubmitLocalAppScenarioJob(ctx, &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: baseSpec, ConfigRef: namedRef})
	assertLocalAppTextCandidateError(t, err, codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_NOT_FOUND)

	owner := appAIConfig("nimi.realm-persona-studio")
	newDefault, committed, err := records.EditRecord(context.Background(), "account-1", "0", namedConfig, &runtimev1.AppAIConfigRecordEdit{
		Change: &runtimev1.AppAIConfigRecordEdit_CreateName{CreateName: "New default"},
	})
	if err != nil || !committed {
		t.Fatalf("create replacement record: committed=%v err=%v", committed, err)
	}
	if _, committed, err := records.EditRecord(context.Background(), "account-1", newDefault.Revision(), owner, &runtimev1.AppAIConfigRecordEdit{
		ConfigRef: newDefault.Record.GetConfigRef(), Change: &runtimev1.AppAIConfigRecordEdit_MakeDefault{MakeDefault: true},
	}); err != nil || !committed {
		t.Fatalf("change default record: committed=%v err=%v", committed, err)
	}
	omitted, err := svc.SubmitLocalAppScenarioJob(ctx, &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: baseSpec})
	if err != nil || omitted.GetJob().GetJobId() == "" {
		t.Fatalf("current default on omission = (%v, %v)", omitted, err)
	}
	_, err = svc.SubmitLocalAppScenarioJob(ctx, &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: baseSpec, ConfigRef: "main"})
	assertLocalAppTextCandidateError(t, err, codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
}
