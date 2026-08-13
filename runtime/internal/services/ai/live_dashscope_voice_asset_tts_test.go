//go:build live

package ai

import (
	"context"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
)

const liveDashScopeDefaultConnectorBoundID = "01KV24QPDKXD35WCV3AY9KG9NG"

func TestLiveSmokeDashScopeVoiceAssetBackedTTS(t *testing.T) {
	if strings.TrimSpace(os.Getenv("NIMI_LIVE_DASHSCOPE_API_KEY")) == "" {
		t.Skip("set NIMI_LIVE_DASHSCOPE_API_KEY to run DashScope voice asset-backed TTS live smoke")
	}
	record, ok := providerregistry.Lookup("dashscope")
	if !ok || !record.SupportsVoiceTextDescription || !record.SupportsVoiceReferenceAudio || !record.SupportsTTS {
		t.Skip("dashscope provider does not advertise required voice workflow and TTS capabilities")
	}

	for _, tc := range []struct {
		name         string
		scenarioType runtimev1.ScenarioType
		modelKey     string
		buildSpec    func(targetModelID string) *runtimev1.ScenarioSpec
	}{
		{
			name:         "text_description",
			scenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE,
			modelKey:     "VOICE_TEXT_DESCRIPTION_MODEL_ID",
			buildSpec: func(targetModelID string) *runtimev1.ScenarioSpec {
				return &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: &runtimev1.VoiceCreateScenarioSpec{
					TargetModelId: targetModelID,
					Source: &runtimev1.VoiceCreateScenarioSpec_TextDescription{TextDescription: &runtimev1.VoiceT2VInput{
						InstructionText: liveSmokeVoiceTextDescriptionInstruction,
						PreviewText:     "Hello from Nimi live DashScope text-description voice asset-backed TTS smoke.",
						PreferredName:   "nimi-live-design",
					}},
				}}}
			},
		},
		{
			name:         "reference_audio",
			scenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE,
			modelKey:     "VOICE_REFERENCE_AUDIO_MODEL_ID",
			buildSpec: func(targetModelID string) *runtimev1.ScenarioSpec {
				return &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: &runtimev1.VoiceCreateScenarioSpec{
					TargetModelId: targetModelID,
					Source:        &runtimev1.VoiceCreateScenarioSpec_ReferenceAudio{ReferenceAudio: resolveLiveVoiceReferenceAudioInput(t, "DASHSCOPE")},
				}}}
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			runLiveSmokeDashScopeVoiceAssetBackedTTS(t, record, tc.scenarioType, tc.modelKey, tc.buildSpec)
		})
	}
}

func TestLiveSmokeDashScopeVoiceAssetNativeStream(t *testing.T) {
	if strings.TrimSpace(os.Getenv("NIMI_LIVE_DASHSCOPE_API_KEY")) == "" {
		t.Skip("set NIMI_LIVE_DASHSCOPE_API_KEY to run DashScope voice asset native stream live smoke")
	}
	record, ok := providerregistry.Lookup("dashscope")
	if !ok || !record.SupportsVoiceTextDescription || !record.SupportsTTS {
		t.Skip("dashscope provider does not advertise required voice design and TTS capabilities")
	}

	const providerID = "dashscope"
	harness := newLiveSmokeProviderHarnessForProvider(t, providerID, record)
	runLiveSmokeDashScopeVoiceAssetNativeStream(t, harness)
}

func TestLiveSmokeDashScopeConnectorBoundVoiceAssetNativeStream(t *testing.T) {
	record, ok := providerregistry.Lookup("dashscope")
	if !ok || !record.SupportsVoiceTextDescription || !record.SupportsTTS {
		t.Skip("dashscope provider does not advertise required voice design and TTS capabilities")
	}
	connectorID := strings.TrimSpace(os.Getenv("NIMI_LIVE_DASHSCOPE_CONNECTOR_ID"))
	if connectorID == "" {
		connectorID = liveDashScopeDefaultConnectorBoundID
	}
	harness := newLiveSmokePersistedConnectorHarness(t, "dashscope", connectorID)
	if harness.connectorID != connectorID {
		t.Fatalf("connector-bound proof used connector_id=%q, want %q", harness.connectorID, connectorID)
	}
	runLiveSmokeDashScopeVoiceAssetNativeStream(t, harness)
}

func runLiveSmokeDashScopeVoiceAssetNativeStream(t *testing.T, harness liveSmokeProviderHarness) {
	t.Helper()
	voiceAssetID, targetModelID := createLiveDashScopeVoiceTextDescriptionAsset(t, harness)
	ownerCtx := scenarioJobContext(liveSmokeMatrixAppID)
	defer deleteLiveDashScopeVoiceAsset(t, harness.service, ownerCtx, voiceAssetID)

	streamCtx, cancel := context.WithTimeout(harness.scenarioContext(t, runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE, targetModelID), 120*time.Second)
	defer cancel()
	stream := &mockScenarioEventStream{ctx: streamCtx}
	if err := harness.service.StreamScenario(&runtimev1.StreamScenarioRequest{
		Head:          harness.scenarioHead(t, liveSmokeMatrixAppID, liveSmokeMatrixUserID, targetModelID, liveSmokeTimeoutMS(runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE)),
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
			Text:        "你好，这是 Nimi DashScope 自定义 VoiceAsset 原生流式语音验收。",
			Language:    "zh",
			AudioFormat: "mp3",
			VoiceRef: &runtimev1.VoiceReference{
				Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET,
				Reference: &runtimev1.VoiceReference_VoiceAssetId{
					VoiceAssetId: voiceAssetID,
				},
			},
		}}},
	}, stream); err != nil {
		t.Fatalf("DashScope VoiceAsset native stream failed: %v", err)
	}
	if len(stream.events) < 3 {
		t.Fatalf("expected started, native delta, completed; got=%d events=%s", len(stream.events), describeScenarioStreamEvents(stream.events))
	}
	if got := stream.events[0].GetStarted().GetVoiceOutputMode(); got != runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_NATIVE_STREAM {
		t.Fatalf("DashScope VoiceAsset stream voice_output_mode=%v, want native_stream", got)
	}

	var deltaCount int
	var totalBytes int
	var completed *runtimev1.ScenarioStreamCompleted
	for _, event := range stream.events {
		switch event.GetEventType() {
		case runtimev1.StreamEventType_STREAM_EVENT_DELTA:
			chunk := deltaArtifactChunk(event.GetDelta())
			if len(chunk) == 0 {
				t.Fatalf("native stream delta must carry playable audio bytes")
			}
			mimeType := strings.TrimSpace(deltaArtifactMimeType(event.GetDelta()))
			if !strings.HasPrefix(strings.ToLower(mimeType), "audio/") {
				t.Fatalf("native stream delta mime=%q, want audio/*", mimeType)
			}
			deltaCount++
			totalBytes += len(chunk)
		case runtimev1.StreamEventType_STREAM_EVENT_COMPLETED:
			completed = event.GetCompleted()
		case runtimev1.StreamEventType_STREAM_EVENT_FAILED:
			t.Fatalf("unexpected native stream failure: %#v", event.GetFailed())
		}
	}
	if deltaCount == 0 || totalBytes == 0 {
		t.Fatalf("DashScope VoiceAsset native stream emitted no audio delta")
	}
	if completed == nil {
		t.Fatalf("DashScope VoiceAsset native stream did not complete; events=%s", describeScenarioStreamEvents(stream.events))
	}
	if completed.GetStreamSimulated() {
		t.Fatalf("DashScope VoiceAsset native stream must not be marked simulated")
	}
	if completed.GetFinishReason() != runtimev1.FinishReason_FINISH_REASON_STOP {
		t.Fatalf("DashScope VoiceAsset native stream finish_reason=%v, want STOP", completed.GetFinishReason())
	}
}

func newLiveSmokePersistedConnectorHarness(t *testing.T, providerID string, connectorID string) liveSmokeProviderHarness {
	t.Helper()
	normalizedProviderID := strings.TrimSpace(providerID)
	normalizedConnectorID := strings.TrimSpace(connectorID)
	if normalizedProviderID == "" || normalizedConnectorID == "" {
		t.Skip("connector-bound proof blocked: provider_id and connector_id are required")
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	store := connector.NewConnectorStore(connector.ResolveBasePath())
	record, found, err := store.Get(normalizedConnectorID)
	if err != nil {
		t.Skipf("connector-bound proof blocked: cannot read persisted connector store: %v", err)
	}
	if !found {
		t.Skipf("connector-bound proof blocked: persisted connector %s not found", normalizedConnectorID)
	}
	if strings.TrimSpace(record.Provider) != normalizedProviderID {
		t.Skipf("connector-bound proof blocked: persisted connector %s provider=%q, want %q", normalizedConnectorID, record.Provider, normalizedProviderID)
	}
	if record.Kind != runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED {
		t.Skipf("connector-bound proof blocked: persisted connector %s kind=%s, want REMOTE_MANAGED", normalizedConnectorID, record.Kind.String())
	}
	if record.Status != runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE {
		t.Skipf("connector-bound proof blocked: persisted connector %s status=%s, want ACTIVE", normalizedConnectorID, record.Status.String())
	}
	secretPayload, err := store.LoadSecretPayload(normalizedConnectorID)
	if err != nil {
		t.Skipf("connector-bound proof blocked: cannot load persisted connector credential for %s: %v", normalizedConnectorID, err)
	}
	resolvedCredential := connector.ResolveCredential(record, secretPayload)
	if strings.TrimSpace(resolvedCredential.APIKey) == "" {
		t.Skipf("connector-bound proof blocked: persisted connector %s has no usable credential", normalizedConnectorID)
	}

	connectorSvc := connector.New(logger, store, nil)
	modelCatalog := liveSmokeConnectorModelCatalog(t, connectorSvc, context.Background(), normalizedConnectorID)
	svc, err := newFromProviderConfig(logger, nil, nil, nil, store, Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			normalizedProviderID: {
				BaseURL: strings.TrimSpace(record.Endpoint),
				APIKey:  resolvedCredential.APIKey,
				Headers: resolvedCredential.Headers,
			},
		},
	}, 8, 2)
	if err != nil {
		t.Fatalf("new connector-bound live smoke ai service: %v", err)
	}
	return liveSmokeProviderHarness{
		service:      svc,
		context:      scenarioJobUserContext(liveSmokeMatrixAppID, liveSmokeMatrixUserID),
		providerID:   normalizedProviderID,
		routePolicy:  runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		connectorID:  normalizedConnectorID,
		modelCatalog: modelCatalog,
	}
}

func runLiveSmokeDashScopeVoiceAssetBackedTTS(
	t *testing.T,
	record providerregistry.ProviderRecord,
	scenarioType runtimev1.ScenarioType,
	modelKey string,
	buildSpec func(targetModelID string) *runtimev1.ScenarioSpec,
) {
	t.Helper()
	const providerID = "dashscope"
	const token = "DASHSCOPE"

	harness := newLiveSmokeProviderHarnessForProvider(t, providerID, record)
	svc := harness.service
	workflowModelID := envModelIDForProvider(t, providerID, modelKey, "TTS_MODEL_ID")
	targetModelID := strings.TrimSpace(os.Getenv("NIMI_LIVE_" + token + "_" + modelKey + "_TARGET_MODEL_ID"))
	if targetModelID == "" {
		targetModelID = workflowModelID
	}

	submitResp, err := svc.SubmitScenarioJob(harness.scenarioContext(t, scenarioType, workflowModelID), &runtimev1.SubmitScenarioJobRequest{
		Head:          harness.scenarioHead(t, liveSmokeMatrixAppID, liveSmokeMatrixUserID, workflowModelID, 120_000),
		ScenarioType:  scenarioType,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec:          buildSpec(targetModelID),
	})
	if err != nil {
		t.Fatalf("submit DashScope voice workflow failed: %v", err)
	}
	ownerCtx := scenarioJobContext(liveSmokeMatrixAppID)
	workflowJob := waitLiveSmokeScenarioJob(t, svc, submitResp.GetJob().GetJobId())
	if workflowJob.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("DashScope voice workflow job status not completed: %s reason=%s detail=%s", workflowJob.GetStatus().String(), workflowJob.GetReasonCode().String(), workflowJob.GetReasonDetail())
	}
	terminal, err := svc.GetScenarioJob(ownerCtx, &runtimev1.GetScenarioJobRequest{JobId: workflowJob.GetJobId()})
	if err != nil {
		t.Fatalf("GetScenarioJob(%s) terminal result: %v", workflowJob.GetJobId(), err)
	}
	voiceAssetID := strings.TrimSpace(terminal.GetAsset().GetVoiceAssetId())
	if voiceAssetID == "" || terminal.GetVoiceReference().GetVoiceAssetId() != voiceAssetID {
		t.Fatalf("DashScope voice workflow terminal result must contain an exact voice asset reference")
	}
	defer func() {
		deleteResp, deleteErr := svc.DeleteVoiceAsset(ownerCtx, &runtimev1.DeleteVoiceAssetRequest{VoiceAssetId: voiceAssetID})
		if deleteErr != nil {
			t.Errorf("DeleteVoiceAsset(%s): %v", voiceAssetID, deleteErr)
			return
		}
		if deleteResp.GetAck() == nil || !deleteResp.GetAck().GetOk() {
			t.Errorf("DeleteVoiceAsset(%s) ack must be ok", voiceAssetID)
		}
	}()

	assetResp, err := svc.GetVoiceAsset(ownerCtx, &runtimev1.GetVoiceAssetRequest{VoiceAssetId: voiceAssetID})
	if err != nil {
		t.Fatalf("GetVoiceAsset(%s): %v", voiceAssetID, err)
	}
	asset := assetResp.GetAsset()
	if asset == nil {
		t.Fatalf("GetVoiceAsset(%s) returned nil asset", voiceAssetID)
	}
	if asset.GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE {
		t.Fatalf("voice asset status=%s, want ACTIVE", asset.GetStatus().String())
	}
	if strings.TrimSpace(asset.GetProviderVoiceRef()) == "" {
		t.Fatalf("voice asset %s missing provider_voice_ref", voiceAssetID)
	}

	synthResp, err := svc.SubmitScenarioJob(harness.scenarioContext(t, runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE, targetModelID), &runtimev1.SubmitScenarioJobRequest{
		Head:          harness.scenarioHead(t, liveSmokeMatrixAppID, liveSmokeMatrixUserID, targetModelID, liveSmokeTimeoutMS(runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE)),
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
			Text: "Hello from Nimi live DashScope voice asset-backed TTS smoke.",
			VoiceRef: &runtimev1.VoiceReference{
				Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET,
				Reference: &runtimev1.VoiceReference_VoiceAssetId{
					VoiceAssetId: voiceAssetID,
				},
			},
		}}},
	})
	if err != nil {
		t.Fatalf("submit DashScope TTS via voice asset failed: %v", err)
	}
	synthJob := waitLiveSmokeScenarioJob(t, svc, synthResp.GetJob().GetJobId())
	if synthJob.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("DashScope voice asset TTS job status not completed: %s reason=%s detail=%s", synthJob.GetStatus().String(), synthJob.GetReasonCode().String(), synthJob.GetReasonDetail())
	}
	artifactsResp, err := svc.GetScenarioArtifacts(scenarioJobContext(liveSmokeMatrixAppID), &runtimev1.GetScenarioArtifactsRequest{JobId: synthJob.GetJobId()})
	if err != nil {
		t.Fatalf("GetScenarioArtifacts(%s): %v", synthJob.GetJobId(), err)
	}
	if len(artifactsResp.GetArtifacts()) == 0 {
		t.Fatalf("DashScope voice asset TTS returned no artifacts")
	}
	artifact := artifactsResp.GetArtifacts()[0]
	if len(artifact.GetBytes()) == 0 && strings.TrimSpace(artifact.GetUri()) == "" {
		t.Fatalf("DashScope voice asset TTS artifact must contain bytes or uri")
	}
}

func createLiveDashScopeVoiceTextDescriptionAsset(t *testing.T, harness liveSmokeProviderHarness) (string, string) {
	t.Helper()
	const providerID = "dashscope"
	const token = "DASHSCOPE"
	workflowModelID := envModelIDForProvider(t, providerID, "VOICE_TEXT_DESCRIPTION_MODEL_ID", "TTS_MODEL_ID")
	targetModelID := strings.TrimSpace(os.Getenv("NIMI_LIVE_" + token + "_VOICE_TEXT_DESCRIPTION_MODEL_ID_TARGET_MODEL_ID"))
	if targetModelID == "" {
		targetModelID = workflowModelID
	}

	submitResp, err := harness.service.SubmitScenarioJob(harness.scenarioContext(t, runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE, workflowModelID), &runtimev1.SubmitScenarioJobRequest{
		Head:          harness.scenarioHead(t, liveSmokeMatrixAppID, liveSmokeMatrixUserID, workflowModelID, 120_000),
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: &runtimev1.VoiceCreateScenarioSpec{
			TargetModelId: targetModelID,
			Source: &runtimev1.VoiceCreateScenarioSpec_TextDescription{TextDescription: &runtimev1.VoiceT2VInput{
				InstructionText: liveSmokeVoiceTextDescriptionInstruction,
				PreviewText:     "Hello from Nimi live DashScope native stream proof.",
				PreferredName:   "nimi-live-native-stream-proof",
			}},
		}}},
	})
	if err != nil {
		t.Fatalf("submit DashScope text-description voice creation for native stream proof failed: %v", err)
	}
	workflowJob := waitLiveSmokeScenarioJob(t, harness.service, submitResp.GetJob().GetJobId())
	if workflowJob.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("DashScope text-description voice creation job status not completed: %s reason=%s detail=%s", workflowJob.GetStatus().String(), workflowJob.GetReasonCode().String(), workflowJob.GetReasonDetail())
	}
	terminal, err := harness.service.GetScenarioJob(scenarioJobContext(liveSmokeMatrixAppID), &runtimev1.GetScenarioJobRequest{JobId: workflowJob.GetJobId()})
	if err != nil {
		t.Fatalf("GetScenarioJob(%s) terminal result: %v", workflowJob.GetJobId(), err)
	}
	voiceAssetID := strings.TrimSpace(terminal.GetAsset().GetVoiceAssetId())
	if voiceAssetID == "" || terminal.GetVoiceReference().GetKind() != runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET ||
		strings.TrimSpace(terminal.GetVoiceReference().GetVoiceAssetId()) != voiceAssetID {
		t.Fatalf("DashScope text-description voice creation returned mismatched terminal voice reference")
	}
	assetResp, err := harness.service.GetVoiceAsset(scenarioJobContext(liveSmokeMatrixAppID), &runtimev1.GetVoiceAssetRequest{VoiceAssetId: voiceAssetID})
	if err != nil {
		t.Fatalf("GetVoiceAsset(%s): %v", voiceAssetID, err)
	}
	asset := assetResp.GetAsset()
	if asset == nil {
		t.Fatalf("GetVoiceAsset(%s) returned nil asset", voiceAssetID)
	}
	if asset.GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE {
		t.Fatalf("voice asset status=%s, want ACTIVE", asset.GetStatus().String())
	}
	if strings.TrimSpace(asset.GetProviderVoiceRef()) == "" {
		t.Fatalf("voice asset %s missing provider_voice_ref", voiceAssetID)
	}
	return voiceAssetID, targetModelID
}

func deleteLiveDashScopeVoiceAsset(t *testing.T, svc *Service, ctx context.Context, voiceAssetID string) {
	t.Helper()
	deleteResp, deleteErr := svc.DeleteVoiceAsset(ctx, &runtimev1.DeleteVoiceAssetRequest{VoiceAssetId: voiceAssetID})
	if deleteErr != nil {
		t.Errorf("DeleteVoiceAsset(%s): %v", voiceAssetID, deleteErr)
		return
	}
	if deleteResp.GetAck() == nil || !deleteResp.GetAck().GetOk() {
		t.Errorf("DeleteVoiceAsset(%s) ack must be ok", voiceAssetID)
	}
}
