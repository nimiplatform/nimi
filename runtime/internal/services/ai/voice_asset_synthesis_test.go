package ai

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

func TestLocalVoxCPMVoiceAssetCreateUseDeleteLifecycle(t *testing.T) {
	const expectedVoiceRef = "voice-local-voxcpm-001"

	var synthVoice string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/voice/clone":
			_, _ = io.WriteString(w, `{"voice_id":"`+expectedVoiceRef+`","job_id":"job-local-voxcpm-001","metadata":{"host_family":"voxcpm"}}`)
		case "/v1/audio/speech":
			defer r.Body.Close()
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode synth payload: %v", err)
			}
			synthVoice = strings.TrimSpace(nimillm.ValueAsString(payload["voice"]))
			w.Header().Set("Content-Type", "audio/wav")
			_, _ = w.Write([]byte("local-voxcpm-audio"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.SetLocalProviderEndpoint("speech", server.URL+"/v1", "")
	svc.localModel = &fakeLocalModelLister{responses: repeatedLocalAssetResponses(&runtimev1.LocalAssetRecord{
		LocalAssetId: "local-voxcpm2-001",
		AssetId:      "speech/voxcpm2",
		Engine:       "speech",
		Capabilities: []string{"audio.synthesize", "voice_workflow.tts_v2v", "voice_workflow.tts_t2v"},
		Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		Endpoint:     server.URL + "/v1",
	}, 12)}

	submitResp, err := svc.SubmitScenarioJob(context.Background(), &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "speech/voxcpm2",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceClone{
				VoiceClone: &runtimev1.VoiceCloneScenarioSpec{
					TargetModelId: "speech/voxcpm2",
					Input: &runtimev1.VoiceV2VInput{
						ReferenceAudioBytes: []byte{0x01},
						ReferenceAudioMime:  "audio/wav",
						Text:                "hello from local voxcpm clone",
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("SubmitScenarioJob(local voxcpm voice clone): %v", err)
	}
	job := waitScenarioJobTerminal(t, svc, submitResp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("voice workflow job status=%v reason=%v detail=%q", job.GetStatus(), job.GetReasonCode(), job.GetReasonDetail())
	}
	assetID := strings.TrimSpace(submitResp.GetAsset().GetVoiceAssetId())
	stored, err := svc.GetVoiceAsset(context.Background(), &runtimev1.GetVoiceAssetRequest{VoiceAssetId: assetID})
	if err != nil {
		t.Fatalf("GetVoiceAsset(local voxcpm): %v", err)
	}
	if got := stored.GetAsset().GetProviderVoiceRef(); got != expectedVoiceRef {
		t.Fatalf("provider_voice_ref=%q, want %q", got, expectedVoiceRef)
	}

	synthResp, err := svc.SubmitScenarioJob(context.Background(), &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "speech/voxcpm2",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
					Text: "hello from asset-backed synth",
					VoiceRef: &runtimev1.VoiceReference{
						Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET,
						Reference: &runtimev1.VoiceReference_VoiceAssetId{
							VoiceAssetId: assetID,
						},
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("SubmitScenarioJob(local synth via voice asset): %v", err)
	}
	synthJob := waitScenarioJobTerminal(t, svc, synthResp.GetJob().GetJobId(), 3*time.Second)
	if synthJob.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("synth job status=%v reason=%v detail=%q", synthJob.GetStatus(), synthJob.GetReasonCode(), synthJob.GetReasonDetail())
	}
	if synthVoice != expectedVoiceRef {
		t.Fatalf("synth voice=%q, want %q", synthVoice, expectedVoiceRef)
	}
	artifactsResp, err := svc.GetScenarioArtifacts(scenarioJobContext("nimi.desktop"), &runtimev1.GetScenarioArtifactsRequest{
		JobId: synthJob.GetJobId(),
	})
	if err != nil {
		t.Fatalf("GetScenarioArtifacts(local synth via voice asset): %v", err)
	}
	if len(artifactsResp.GetArtifacts()) != 1 {
		t.Fatalf("expected one speech synth artifact, got %d", len(artifactsResp.GetArtifacts()))
	}

	deleteResp, err := svc.DeleteVoiceAsset(context.Background(), &runtimev1.DeleteVoiceAssetRequest{VoiceAssetId: assetID})
	if err != nil {
		t.Fatalf("DeleteVoiceAsset(local voxcpm): %v", err)
	}
	if deleteResp.GetAck() == nil || !deleteResp.GetAck().GetOk() {
		t.Fatalf("delete ack must be ok")
	}

	failedSynthResp, err := svc.SubmitScenarioJob(context.Background(), &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "speech/voxcpm2",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
					Text: "should fail after delete",
					VoiceRef: &runtimev1.VoiceReference{
						Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET,
						Reference: &runtimev1.VoiceReference_VoiceAssetId{
							VoiceAssetId: assetID,
						},
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("SubmitScenarioJob(local synth after delete): %v", err)
	}
	failedSynthJob := waitScenarioJobTerminal(t, svc, failedSynthResp.GetJob().GetJobId(), 3*time.Second)
	if failedSynthJob.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED {
		t.Fatalf("expected failed synth job after delete, got status=%v", failedSynthJob.GetStatus())
	}
	if failedSynthJob.GetReasonCode() != runtimev1.ReasonCode_AI_VOICE_ASSET_NOT_FOUND {
		t.Fatalf("expected AI_VOICE_ASSET_NOT_FOUND, got %v", failedSynthJob.GetReasonCode())
	}
}

func repeatedLocalAssetResponses(asset *runtimev1.LocalAssetRecord, n int) []*runtimev1.ListLocalAssetsResponse {
	responses := make([]*runtimev1.ListLocalAssetsResponse, 0, n)
	for i := 0; i < n; i++ {
		responses = append(responses, &runtimev1.ListLocalAssetsResponse{
			Assets: []*runtimev1.LocalAssetRecord{asset},
		})
	}
	return responses
}
