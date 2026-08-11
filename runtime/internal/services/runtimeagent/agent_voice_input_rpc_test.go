package runtimeagent

import (
	"context"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

type captureAgentVoiceTranscriptionExecutor struct {
	context context.Context
	submit  *runtimev1.SubmitScenarioJobRequest
}

func (f *captureAgentVoiceTranscriptionExecutor) SubmitScenarioJob(
	ctx context.Context,
	req *runtimev1.SubmitScenarioJobRequest,
) (*runtimev1.SubmitScenarioJobResponse, error) {
	f.context = ctx
	f.submit = proto.Clone(req).(*runtimev1.SubmitScenarioJobRequest)
	return &runtimev1.SubmitScenarioJobResponse{Job: &runtimev1.ScenarioJob{
		JobId:  "voice-input-job-1",
		Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
	}}, nil
}

func (*captureAgentVoiceTranscriptionExecutor) GetScenarioJob(
	context.Context,
	*runtimev1.GetScenarioJobRequest,
) (*runtimev1.GetScenarioJobResponse, error) {
	return &runtimev1.GetScenarioJobResponse{Job: &runtimev1.ScenarioJob{
		JobId:   "voice-input-job-1",
		Status:  runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
		TraceId: "voice-input-trace-1",
	}}, nil
}

func (*captureAgentVoiceTranscriptionExecutor) GetScenarioArtifacts(
	context.Context,
	*runtimev1.GetScenarioArtifactsRequest,
) (*runtimev1.GetScenarioArtifactsResponse, error) {
	return &runtimev1.GetScenarioArtifactsResponse{
		JobId:   "voice-input-job-1",
		TraceId: "voice-input-trace-1",
		Output: &runtimev1.ScenarioOutput{Output: &runtimev1.ScenarioOutput_SpeechTranscribe{
			SpeechTranscribe: &runtimev1.SpeechTranscribeResult{Text: "transcribed intent"},
		}},
	}, nil
}

func TestTranscribeAgentVoiceInputUsesSharedLocalAgentExecutionSnapshot(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "nimi.desktop", "user-1")
	localAgentRef := testRuntimeAgentLocalRef("agent-alpha")
	modelPath, err := filepath.Abs(filepath.Join("testdata", "qwen3-asr", "model.safetensors"))
	if err != nil {
		t.Fatal(err)
	}
	selected := &localexecution.SelectedLocalExecution{
		ConfigurationID:    "lcc-asr",
		CapabilityContract: runtimeAgentAIConfigCapabilityAudioTranscribe,
		DisplayName:        "Qwen3 ASR",
		DriverIdentity: &runtimev1.CapabilityImplementationIdentity{
			ImplementationId: capabilitydriver.Qwen3ASRImplementationID,
			DriverId:         capabilitydriver.Qwen3ASRDriverID,
			DriverDialect:    capabilitydriver.Qwen3ASRDriverDialect,
		},
		Requirements: []*runtimev1.LocalCapabilityRequirement{{
			RequirementId: capabilitydriver.Qwen3ASRModelRequirementID,
		}},
		ExactBindings: []localexecution.ExactBinding{{
			RequirementID:     capabilitydriver.Qwen3ASRModelRequirementID,
			AssetID:           "catalog/qwen3-asr",
			LocalAssetID:      "asset-asr",
			AbsolutePath:      modelPath,
			VerifiedContentID: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			EntrySHA256:       "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		}},
		Configured: true,
	}
	svc.setMachineExecutionBindingResolver(machineExecutionBindingResolverFunc(func(
		_ context.Context,
		accountNamespace string,
		capabilityContracts []string,
	) (publicChatExecutionBindings, error) {
		if accountNamespace != "user-1" || len(capabilityContracts) != 1 ||
			capabilityContracts[0] != runtimeAgentAIConfigCapabilityAudioTranscribe {
			t.Fatalf("unexpected binding request account=%q capabilities=%v", accountNamespace, capabilityContracts)
		}
		return publicChatExecutionBindings{runtimeAgentAIConfigCapabilityAudioTranscribe: {
			BindingAlias:        "lcc-asr",
			ModelID:             "Qwen3 ASR",
			RoutePolicy:         runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			CapabilityContract:  runtimeAgentAIConfigCapabilityAudioTranscribe,
			LocalAIConfigIntent: true,
			ExecutionIntent: executionintent.Intent{
				CapabilityContract: runtimeAgentAIConfigCapabilityAudioTranscribe,
				Route:              runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			},
			LocalExecution: selected,
		}}, nil
	}))
	executor := &captureAgentVoiceTranscriptionExecutor{}
	svc.SetAgentVoiceTranscriptionScenarioExecutor(executor)

	response, err := svc.TranscribeAgentVoiceInput(
		desktopAccountProductTestPrincipalContext("user-1", make(chan struct{})),
		&runtimev1.TranscribeAgentVoiceInputRequest{
			Context:              &runtimev1.AgentRequestContext{AppId: "nimi.desktop"},
			AgentId:              localAgentRef,
			ConversationAnchorId: anchorID,
			AudioBytes:           []byte{1, 2, 3, 4},
			MimeType:             "audio/webm;codecs=opus",
			RequestId:            "voice-input-request-1",
		},
	)
	if err != nil {
		t.Fatalf("TranscribeAgentVoiceInput: %v", err)
	}
	if response.GetText() != "transcribed intent" || response.GetJobId() != "voice-input-job-1" || response.GetTraceId() != "voice-input-trace-1" {
		t.Fatalf("unexpected transcription response: %+v", response)
	}
	if executor.submit.GetScenarioType() != runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE ||
		executor.submit.GetSpec().GetSpeechTranscribe().GetMimeType() != "audio/webm;codecs=opus" ||
		string(executor.submit.GetSpec().GetSpeechTranscribe().GetAudioSource().GetAudioBytes()) != string([]byte{1, 2, 3, 4}) {
		t.Fatalf("unexpected transcription Job: %+v", executor.submit)
	}
	intent, ok := executionintent.FromContext(executor.context)
	if !ok || !intent.IsLocal() || intent.CapabilityContract != runtimeAgentAIConfigCapabilityAudioTranscribe {
		t.Fatalf("transcription execution intent=%+v ok=%v", intent, ok)
	}
	captured, ok := localexecution.SelectedLocalExecutionFromContext(executor.context, runtimeAgentAIConfigCapabilityAudioTranscribe)
	if !ok || captured.ConfigurationID != "lcc-asr" || captured.ExactBindings[0].AbsolutePath != modelPath {
		t.Fatalf("transcription Local execution=%+v ok=%v", captured, ok)
	}
}

func TestTranscribeAgentVoiceInputReturnsTypedCapabilityMismatchWhenSharedAIConfigOmitsTranscription(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "nimi.desktop", "user-1")
	localAgentRef := testRuntimeAgentLocalRef("agent-alpha")
	svc.setMachineExecutionBindingResolver(machineExecutionBindingResolverFunc(func(
		_ context.Context,
		accountNamespace string,
		capabilityContracts []string,
	) (publicChatExecutionBindings, error) {
		if accountNamespace != "user-1" || len(capabilityContracts) != 1 ||
			capabilityContracts[0] != runtimeAgentAIConfigCapabilityAudioTranscribe {
			t.Fatalf("unexpected binding request account=%q capabilities=%v", accountNamespace, capabilityContracts)
		}
		return publicChatExecutionBindings{}, nil
	}))
	svc.SetAgentVoiceTranscriptionScenarioExecutor(&captureAgentVoiceTranscriptionExecutor{})

	_, err := svc.TranscribeAgentVoiceInput(
		desktopAccountProductTestPrincipalContext("user-1", make(chan struct{})),
		&runtimev1.TranscribeAgentVoiceInputRequest{
			Context:              &runtimev1.AgentRequestContext{AppId: "nimi.desktop"},
			AgentId:              localAgentRef,
			ConversationAnchorId: anchorID,
			AudioBytes:           []byte{1, 2, 3, 4},
			MimeType:             "audio/webm;codecs=opus",
			RequestId:            "voice-input-request-missing-capability",
		},
	)
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("status code=%s, want FailedPrecondition: %v", status.Code(err), err)
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AGENT_AI_CONFIG_CAPABILITY_MISMATCH {
		t.Fatalf("reason=%s ok=%v, want AGENT_AI_CONFIG_CAPABILITY_MISMATCH: %v", reason, ok, err)
	}
}
