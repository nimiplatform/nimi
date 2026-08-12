//go:build live

package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const liveSmokeMatrixAppID = "nimi.live-smoke.matrix"
const liveSmokeMatrixUserID = "smoke-user"
const liveSmokeVoiceTextDescriptionInstruction = "Warm, calm, natural narrator voice with steady pacing, clear diction, low background noise, gentle emotional range, and a polished studio delivery for long-form spoken content."
const liveSmokeVoiceReferenceAudioText = "Hello from Nimi live reference-audio voice creation."
const liveSmokeVolcengineSeedancePrompt = "Keep the framing grounded in the supplied references. Show a short first-person fruit tea product ad with clean motion, clear cup detail, and natural lighting."
const liveSmokeVolcengineReferenceImage1 = "https://ark-project.tos-cn-beijing.volces.com/doc_image/r2v_tea_pic1.jpg"
const liveSmokeVolcengineReferenceImage2 = "https://ark-project.tos-cn-beijing.volces.com/doc_image/r2v_tea_pic2.jpg"
const liveSmokeVolcengineReferenceVideo1 = "https://ark-project.tos-cn-beijing.volces.com/doc_video/r2v_tea_video1.mp4"
const liveSmokeVolcengineReferenceAudio1 = "https://ark-project.tos-cn-beijing.volces.com/doc_audio/r2v_tea_audio1.mp3"

type liveSmokeProviderHarness struct {
	service      *Service
	context      context.Context
	providerID   string
	routePolicy  runtimev1.RoutePolicy
	connectorID  string
	grantID      string
	modelCatalog map[string]*runtimev1.ConnectorModelDescriptor
}

func (h liveSmokeProviderHarness) scenarioHead(t *testing.T, appID string, subjectUserID string, _ string, timeoutMS int32) *runtimev1.ScenarioRequestHead {
	t.Helper()
	return &runtimev1.ScenarioRequestHead{
		AppId:         appID,
		SubjectUserId: subjectUserID,
		TimeoutMs:     timeoutMS,
	}
}

func (h liveSmokeProviderHarness) scenarioContext(t *testing.T, scenarioType runtimev1.ScenarioType, modelID string) context.Context {
	t.Helper()
	if h.routePolicy != runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD {
		t.Fatalf("live Scenario provider smoke requires caller-owned Cloud AIConfig intent; Local execution is covered by the selected-capability llama journey")
	}
	descriptor := h.connectorModelDescriptor(t, modelID)
	target := cloudScenarioTargetRefForDescriptor(h.connectorID, descriptor)
	if target == nil || target.Cloud == nil || !target.Cloud.Valid() {
		t.Fatalf("live cloud smoke model %q for provider %s produced an incomplete private target", modelID, h.providerID)
	}
	target.Cloud.ConnectorGrantID = h.grantID
	providerTarget, _ := structpb.NewStruct(map[string]any{
		"provider":             target.Cloud.Provider,
		"providerModelId":      target.Cloud.ProviderModelID,
		"remoteModelCatalogId": target.Cloud.RemoteModelCatalogID,
	})
	capabilityContract := scenarioTargetCapability(scenarioType)
	driverDialect := "provider/text-v1"
	if !strings.HasPrefix(capabilityContract, "text.") {
		driverDialect = capabilitydriver.ResolveCloudMediaAdapter(h.providerID, capabilityContract)
		if driverDialect == "" {
			t.Fatalf("live cloud smoke has no admitted Driver dialect for %s/%s", h.providerID, capabilityContract)
		}
	}
	return executionintent.WithIntent(h.context, executionintent.Intent{
		CapabilityContract: scenarioTargetCapability(scenarioType),
		Route:              runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		CloudImplementation: &runtimev1.CapabilityImplementationIdentity{
			ImplementationId: "cloud." + scenarioTargetCapability(scenarioType) + "." + h.providerID,
			DriverId:         "nimi.runtime.driver." + h.providerID,
			DriverDialect:    driverDialect,
		},
		ProviderModelTarget: providerTarget,
		ConnectorGrantID:    h.grantID,
	})
}

func (h liveSmokeProviderHarness) connectorModelDescriptor(t *testing.T, modelID string) *runtimev1.ConnectorModelDescriptor {
	t.Helper()
	if strings.TrimSpace(h.connectorID) == "" {
		t.Fatalf("live cloud smoke for %s is missing connector identity", h.providerID)
	}
	exactModelID := strings.TrimSpace(modelID)
	if exactModelID == modelID {
		if descriptor := h.modelCatalog[exactModelID]; descriptor != nil {
			return descriptor
		}
	}
	t.Fatalf("live cloud smoke model %q for provider %s is not admitted by the connector model catalog; set NIMI_LIVE_%s_*_MODEL_ID to a ListConnectorModels model_id/provider_model_id", modelID, h.providerID, liveProviderEnvToken(h.providerID))
	return nil
}

func TestLiveSmokeCloudScenarioContextUsesManagedCatalogTarget(t *testing.T) {
	harness := liveSmokeProviderHarness{
		providerID:   "openai",
		connectorID:  liveSmokeCloudConnectorID("openai"),
		grantID:      "grant-openai",
		routePolicy:  runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		context:      context.Background(),
		modelCatalog: map[string]*runtimev1.ConnectorModelDescriptor{},
	}
	harness.modelCatalog["gpt-4o-mini"] = &runtimev1.ConnectorModelDescriptor{
		ModelId:              "gpt-4o-mini",
		RemoteModelCatalogId: "remote-catalog-openai-gpt-4o-mini",
		ProviderModelId:      "gpt-4o-mini",
		Provider:             "openai",
		EndpointProfileId:    "endpoint-profile-openai",
	}

	ctx := harness.scenarioContext(t, runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE, "gpt-4o-mini")
	intent, ok := executionintent.FromContext(ctx)
	if !ok || !intent.IsAIConfigCloud() || intent.CloudTarget != nil {
		t.Fatalf("expected exact private AIConfig intent without legacy CloudTarget: %+v", intent)
	}
	if intent.GrantID() != "grant-openai" || intent.ModelID() != "gpt-4o-mini" {
		t.Fatalf("private intent grant/model = %q/%q", intent.GrantID(), intent.ModelID())
	}
	fields := intent.ProviderModelTarget.GetFields()
	if fields["remoteModelCatalogId"].GetStringValue() != "remote-catalog-openai-gpt-4o-mini" || fields["provider"].GetStringValue() != "openai" {
		t.Fatalf("private provider target = %+v", intent.ProviderModelTarget.AsMap())
	}
}

func TestLiveSmokeProviderCapabilityMatrix(t *testing.T) {
	for _, providerID := range providerregistry.SourceProviders {
		providerID := providerID
		record, ok := providerregistry.Lookup(providerID)
		if !ok || providerID == "local" {
			continue
		}
		t.Run(providerID, func(t *testing.T) {
			if record.SupportsText {
				t.Run("generate", func(t *testing.T) { runLiveSmokeGenerateForProvider(t, providerID, record) })
			}
			if record.SupportsEmbed {
				t.Run("embed", func(t *testing.T) { runLiveSmokeEmbedForProvider(t, providerID, record) })
			}
			if record.SupportsImage && capabilitydriver.ResolveCloudMediaAdapter(providerID, "image.generate") != "" {
				t.Run("image", func(t *testing.T) {
					runLiveSmokeMediaForProvider(t, providerID, record, runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE)
				})
			}
			if record.SupportsVideo && capabilitydriver.ResolveCloudMediaAdapter(providerID, "video.generate") != "" {
				t.Run("video", func(t *testing.T) {
					runLiveSmokeMediaForProvider(t, providerID, record, runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE)
				})
			}
			if record.SupportsTTS && capabilitydriver.ResolveCloudMediaAdapter(providerID, "audio.synthesize") != "" {
				t.Run("tts", func(t *testing.T) {
					runLiveSmokeMediaForProvider(t, providerID, record, runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE)
				})
			}
			if record.SupportsSTT && capabilitydriver.ResolveCloudMediaAdapter(providerID, "audio.transcribe") != "" {
				t.Run("stt", func(t *testing.T) {
					runLiveSmokeMediaForProvider(t, providerID, record, runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE)
				})
			}
			if record.SupportsMusic && capabilitydriver.ResolveCloudMediaAdapter(providerID, "music.generate") != "" {
				t.Run("music", func(t *testing.T) {
					runLiveSmokeMediaForProvider(t, providerID, record, runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE)
				})
			}
			if record.SupportsVoiceReferenceAudio && providerID != "local" && capabilitydriver.ResolveCloudMediaAdapter(providerID, "voice.create") != "" {
				t.Run("reference_audio", func(t *testing.T) {
					runLiveSmokeVoiceWorkflowForProvider(t, providerID, record, runtimev1.VoiceCreationSource_VOICE_CREATION_SOURCE_REFERENCE_AUDIO)
				})
			}
			if record.SupportsVoiceTextDescription && providerID != "local" && capabilitydriver.ResolveCloudMediaAdapter(providerID, "voice.create") != "" {
				t.Run("text_description", func(t *testing.T) {
					runLiveSmokeVoiceWorkflowForProvider(t, providerID, record, runtimev1.VoiceCreationSource_VOICE_CREATION_SOURCE_TEXT_DESCRIPTION)
				})
			}
		})
	}
}

func liveProviderEnvToken(providerID string) string {
	token := strings.TrimSpace(strings.ToUpper(providerID))
	token = strings.ReplaceAll(token, "-", "_")
	token = strings.ReplaceAll(token, ".", "_")
	token = strings.ReplaceAll(token, " ", "_")
	for strings.Contains(token, "__") {
		token = strings.ReplaceAll(token, "__", "_")
	}
	return strings.Trim(token, "_")
}

func newLiveSmokeServiceForProvider(t *testing.T, providerID string, record providerregistry.ProviderRecord) *Service {
	t.Helper()
	return newLiveSmokeProviderHarnessForProvider(t, providerID, record).service
}

func newLiveSmokeProviderHarnessForProvider(t *testing.T, providerID string, record providerregistry.ProviderRecord) liveSmokeProviderHarness {
	t.Helper()
	if providerID == "local" {
		t.Fatalf("ambient Local provider smoke is retired; use the selected-capability llama journey")
	}
	envToken := liveProviderEnvToken(providerID)
	baseURL := liveEnvOrDefault(t, "NIMI_LIVE_"+envToken+"_BASE_URL", record.DefaultEndpoint)
	apiKey := requiredLiveProviderAPIKey(t, providerID, envToken)
	return newLiveSmokeCloudProviderHarness(t, providerID, baseURL, apiKey, liveSmokeProviderHeaders(providerID))
}

func newLiveSmokeCloudProviderHarness(t *testing.T, providerID string, baseURL string, apiKey string, headers map[string]string) liveSmokeProviderHarness {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	normalizedProviderID := strings.TrimSpace(providerID)
	normalizedBaseURL := strings.TrimSpace(baseURL)
	normalizedAPIKey := strings.TrimSpace(apiKey)
	if normalizedProviderID == "" || normalizedAPIKey == "" {
		t.Fatalf("live cloud smoke requires provider id and api key")
	}
	store := connector.NewConnectorStoreWithMemorySecrets(t.TempDir())
	connectorID := liveSmokeCloudConnectorID(normalizedProviderID)
	created, err := store.Create(connector.ConnectorRecord{
		ConnectorID: connectorID,
		Kind:        runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType:   runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID:     liveSmokeMatrixUserID,
		Provider:    normalizedProviderID,
		Endpoint:    normalizedBaseURL,
		Label:       "Cloud " + normalizedProviderID,
		Status:      runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
		AuthKind:    runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_API_KEY,
	}, normalizedAPIKey)
	if err != nil {
		t.Fatalf("create live smoke cloud connector: %v", err)
	}

	grant, err := store.CreateGrant(liveSmokeMatrixUserID, created.ConnectorID)
	if err != nil {
		t.Fatalf("create live smoke connector grant: %v", err)
	}
	connectorSvc := connector.New(logger, store, nil)
	modelCatalog := liveSmokeConnectorModelCatalog(t, connectorSvc, context.Background(), created.ConnectorID)
	svc, err := newFromProviderConfig(logger, nil, nil, nil, store, Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			normalizedProviderID: {BaseURL: normalizedBaseURL, APIKey: normalizedAPIKey, Headers: headers},
		},
	}, 8, 2)
	if err != nil {
		t.Fatalf("new live smoke cloud ai service: %v", err)
	}
	return liveSmokeProviderHarness{
		service: svc,
		context: authn.WithIdentity(
			metadata.NewIncomingContext(context.Background(), metadata.Pairs(metadataKeySourceKey, keySourceManaged)),
			&authn.Identity{SubjectUserID: liveSmokeMatrixUserID},
		),
		providerID:   normalizedProviderID,
		routePolicy:  runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		connectorID:  created.ConnectorID,
		grantID:      grant.GrantID,
		modelCatalog: modelCatalog,
	}
}

func liveSmokeCloudConnectorID(providerID string) string {
	return "live-cloud-" + strings.ToLower(strings.TrimSpace(providerID))
}

func liveSmokeProviderHeaders(providerID string) map[string]string {
	if providerID != "mubert" {
		return nil
	}
	headers := map[string]string{}
	if customerID := strings.TrimSpace(os.Getenv("NIMI_LIVE_MUBERT_CUSTOMER_ID")); customerID != "" {
		headers["customer-id"] = customerID
	}
	if accessToken := strings.TrimSpace(os.Getenv("NIMI_LIVE_MUBERT_ACCESS_TOKEN")); accessToken != "" {
		headers["access-token"] = accessToken
	}
	if len(headers) == 0 {
		return nil
	}
	return headers
}

func liveSmokeConnectorModelCatalog(t *testing.T, svc *connector.Service, ctx context.Context, connectorID string) map[string]*runtimev1.ConnectorModelDescriptor {
	t.Helper()
	result := map[string]*runtimev1.ConnectorModelDescriptor{}
	pageToken := ""
	for {
		resp, err := svc.ListConnectorModels(ctx, &runtimev1.ListConnectorModelsRequest{
			ConnectorId: connectorID,
			PageSize:    200,
			PageToken:   pageToken,
		})
		if err != nil {
			t.Fatalf("ListConnectorModels for live smoke connector %s: %v", connectorID, err)
		}
		for _, model := range resp.GetModels() {
			liveSmokeIndexConnectorModel(result, model.GetModelId(), model)
			liveSmokeIndexConnectorModel(result, model.GetProviderModelId(), model)
		}
		pageToken = resp.GetNextPageToken()
		if strings.TrimSpace(pageToken) == "" {
			return result
		}
	}
}

func liveSmokeIndexConnectorModel(index map[string]*runtimev1.ConnectorModelDescriptor, key string, descriptor *runtimev1.ConnectorModelDescriptor) {
	if index == nil || descriptor == nil {
		return
	}
	trimmed := strings.TrimSpace(key)
	if trimmed == "" {
		return
	}
	if existing, found := index[trimmed]; found && existing != descriptor {
		index[trimmed] = nil
		return
	}
	index[trimmed] = descriptor
}

func requiredLiveProviderAPIKey(t *testing.T, providerID string, envToken string) string {
	t.Helper()
	keys := []string{"NIMI_LIVE_" + envToken + "_API_KEY"}
	if strings.EqualFold(strings.TrimSpace(providerID), "mimo") {
		keys = append(keys, "MIMO_API_KEY")
	}
	if value := liveEnvFirst(keys...); value != "" {
		return value
	}
	t.Skipf("set one of %s to run %s live smoke", strings.Join(keys, ", "), providerID)
	return ""
}

func resolveLiveTTSVoiceRef(t *testing.T, svc *Service, providerID string, modelID string) string {
	t.Helper()
	token := liveProviderEnvToken(providerID)
	if voiceID := liveEnvFirst(
		"NIMI_LIVE_"+token+"_TTS_VOICE_ID",
		"NIMI_LIVE_"+token+"_VOICE_ID",
		"NIMI_LIVE_TTS_VOICE_ID",
	); voiceID != "" {
		return voiceID
	}
	if svc == nil || svc.speechCatalog == nil {
		return ""
	}
	voices, _, _, err := resolveSpeechVoicesForModelWithProviderType(modelID, providerID, svc.speechCatalog)
	if err != nil || len(voices) == 0 {
		return ""
	}
	if strings.EqualFold(strings.TrimSpace(providerID), "dashscope") {
		return strings.TrimSpace(voices[0].GetName())
	}
	return strings.TrimSpace(voices[0].GetVoiceId())
}

func envModelIDForProvider(t *testing.T, providerID string, capabilitySuffix string, fallbackSuffix string) string {
	t.Helper()
	token := liveProviderEnvToken(providerID)
	primaryKey := "NIMI_LIVE_" + token + "_" + capabilitySuffix
	primary := strings.TrimSpace(os.Getenv(primaryKey))
	if primary != "" {
		return primary
	}
	if fallbackSuffix == "" {
		return requiredLiveEnv(t, primaryKey)
	}
	fallbackKey := "NIMI_LIVE_" + token + "_" + fallbackSuffix
	fallback := strings.TrimSpace(os.Getenv(fallbackKey))
	if fallback != "" {
		return fallback
	}
	return requiredLiveEnv(t, primaryKey)
}

func liveEnvFirst(keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}

func liveEnvFirstOrDefault(defaultValue string, keys ...string) string {
	if value := liveEnvFirst(keys...); value != "" {
		return value
	}
	return strings.TrimSpace(defaultValue)
}

func liveSmokeTimeoutMS(scenarioType runtimev1.ScenarioType) int32 {
	switch scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
		runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE:
		return 300_000
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		return 45_000
	default:
		return 120_000
	}
}

func liveSmokeShouldOnlyVerifyAsyncAcceptance(providerID string, scenarioType runtimev1.ScenarioType) bool {
	return scenarioType == runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE &&
		strings.EqualFold(strings.TrimSpace(providerID), "volcengine")
}

func resolveLiveAudioMIME(resource string) string {
	lower := strings.ToLower(strings.TrimSpace(resource))
	switch {
	case strings.HasSuffix(lower, ".mp3"):
		return "audio/mpeg"
	case strings.HasSuffix(lower, ".m4a"):
		return "audio/mp4"
	case strings.HasSuffix(lower, ".ogg"):
		return "audio/ogg"
	default:
		return "audio/wav"
	}
}

func resolveLiveTranscriptionAudioSource(t *testing.T) (*runtimev1.SpeechTranscriptionAudioSource, string) {
	t.Helper()
	if audioPath := liveEnvFirst("NIMI_LIVE_STT_AUDIO_PATH"); audioPath != "" {
		audioBytes, err := os.ReadFile(audioPath)
		if err != nil {
			t.Fatalf("read stt live audio path %s: %v", audioPath, err)
		}
		if len(audioBytes) == 0 {
			t.Fatalf("stt live audio path %s is empty", audioPath)
		}
		return &runtimev1.SpeechTranscriptionAudioSource{
			Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: audioBytes},
		}, resolveLiveAudioMIME(audioPath)
	}

	audioURI := requiredLiveEnv(t, "NIMI_LIVE_STT_AUDIO_URI")
	return &runtimev1.SpeechTranscriptionAudioSource{
		Source: &runtimev1.SpeechTranscriptionAudioSource_AudioUri{AudioUri: audioURI},
	}, resolveLiveAudioMIME(audioURI)
}

func resolveLiveVoiceReferenceAudioInput(t *testing.T, providerToken string) *runtimev1.VoiceV2VInput {
	t.Helper()
	liveText := resolveLiveVoiceReferenceAudioText(providerToken)
	if strings.EqualFold(strings.TrimSpace(providerToken), "DASHSCOPE") {
		if audioURI := liveEnvFirst(
			"NIMI_LIVE_"+providerToken+"_VOICE_REFERENCE_AUDIO_URI",
			"NIMI_LIVE_VOICE_REFERENCE_AUDIO_URI",
		); audioURI != "" {
			return &runtimev1.VoiceV2VInput{
				ReferenceAudioUri:  audioURI,
				ReferenceAudioMime: resolveLiveAudioMIME(audioURI),
				Text:               liveText,
			}
		}
	}
	audioPath := liveEnvFirst(
		"NIMI_LIVE_"+providerToken+"_VOICE_REFERENCE_AUDIO_PATH",
		"NIMI_LIVE_VOICE_REFERENCE_AUDIO_PATH",
	)
	if audioPath != "" {
		audioBytes, err := os.ReadFile(audioPath)
		if err != nil {
			t.Fatalf("read voice clone live audio path %s: %v", audioPath, err)
		}
		if len(audioBytes) == 0 {
			t.Fatalf("voice clone live audio path %s is empty", audioPath)
		}
		return &runtimev1.VoiceV2VInput{
			ReferenceAudioBytes: audioBytes,
			ReferenceAudioMime:  resolveLiveAudioMIME(audioPath),
			Text:                liveText,
		}
	}

	audioURI := liveEnvFirst(
		"NIMI_LIVE_"+providerToken+"_VOICE_REFERENCE_AUDIO_URI",
		"NIMI_LIVE_VOICE_REFERENCE_AUDIO_URI",
	)
	if audioURI == "" {
		audioURI = requiredLiveEnv(t, "NIMI_LIVE_VOICE_REFERENCE_AUDIO_URI")
	}
	return &runtimev1.VoiceV2VInput{
		ReferenceAudioUri:  audioURI,
		ReferenceAudioMime: resolveLiveAudioMIME(audioURI),
		Text:               liveText,
	}
}

func resolveLiveVoiceReferenceAudioText(providerToken string) string {
	text := liveEnvFirst(
		"NIMI_LIVE_"+providerToken+"_VOICE_REFERENCE_AUDIO_TEXT",
		"NIMI_LIVE_VOICE_REFERENCE_AUDIO_TEXT",
	)
	if text != "" {
		return text
	}
	if strings.EqualFold(strings.TrimSpace(providerToken), "STEPFUN") {
		return liveSmokeVoiceReferenceAudioText
	}
	return ""
}

func liveProviderFailure(err error, job *runtimev1.ScenarioJob) (runtimev1.ReasonCode, string, string) {
	if job != nil {
		actionHint := ""
		if metadata := job.GetReasonMetadata(); metadata != nil {
			actionHint = strings.TrimSpace(metadata.GetFields()["action_hint"].GetStringValue())
		}
		return job.GetReasonCode(), actionHint, strings.TrimSpace(job.GetReasonDetail())
	}
	if err == nil {
		return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, "", ""
	}
	reasonCode, _ := grpcerr.ExtractReasonCode(err)
	metadata, _ := grpcerr.ExtractReasonMetadata(err)
	return reasonCode, strings.TrimSpace(metadata["action_hint"]), strings.TrimSpace(status.Convert(err).Message())
}

func maybeSkipFishAudioBalanceBlocked(t *testing.T, providerID string, err error, job *runtimev1.ScenarioJob) {
	t.Helper()
	if !strings.EqualFold(strings.TrimSpace(providerID), "fish_audio") {
		return
	}
	reasonCode, actionHint, detail := liveProviderFailure(err, job)
	if reasonCode == runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED {
		t.Skipf(
			"fish_audio live smoke skipped due to typed provider balance block: reason=%s action_hint=%s detail=%s",
			reasonCode.String(),
			actionHint,
			detail,
		)
	}
}

func maybeSkipStepFunQuotaBlocked(t *testing.T, providerID string, err error, job *runtimev1.ScenarioJob) {
	t.Helper()
	if !strings.EqualFold(strings.TrimSpace(providerID), "stepfun") {
		return
	}
	reasonCode, actionHint, detail := liveProviderFailure(err, job)
	if reasonCode == runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED {
		t.Skipf(
			"stepfun live smoke skipped due to typed provider quota block: reason=%s action_hint=%s detail=%s",
			reasonCode.String(),
			actionHint,
			detail,
		)
	}
}

func maybeSkipFishAudioBalancePreflight(t *testing.T, svc *Service, providerID string, modelID string) {
	t.Helper()
	if !strings.EqualFold(strings.TrimSpace(providerID), "fish_audio") || svc == nil {
		return
	}

	cfg := svc.resolveConfiguredProbeAdapterConfig("fish_audio")
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		baseURL = "https://api.fish.audio"
	}
	voiceRef := resolveLiveTTSVoiceRef(t, svc, providerID, modelID)
	if voiceRef == "" {
		return
	}

	payload := map[string]any{
		"text":         "Nimi Fish Audio balance preflight.",
		"reference_id": voiceRef,
	}
	requestBody, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal fish_audio preflight payload: %v", err)
	}
	request, err := http.NewRequestWithContext(context.Background(), http.MethodPost, baseURL+"/v1/tts", bytes.NewReader(requestBody))
	if err != nil {
		t.Fatalf("build fish_audio preflight request: %v", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("model", strings.TrimSpace(modelID))
	if strings.TrimSpace(cfg.APIKey) != "" {
		request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(cfg.APIKey))
	}

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusPaymentRequired {
		return
	}
	var responsePayload map[string]any
	_ = json.NewDecoder(response.Body).Decode(&responsePayload)
	maybeSkipFishAudioBalanceBlocked(t, providerID, nimillm.MapProviderHTTPError(response.StatusCode, responsePayload), nil)
}

func runLiveSmokeGenerateForProvider(t *testing.T, providerID string, record providerregistry.ProviderRecord) {
	t.Helper()
	harness := newLiveSmokeProviderHarnessForProvider(t, providerID, record)
	modelID := envModelIDForProvider(t, providerID, "MODEL_ID", "")
	text, err := executeLiveSmokeScenarioGenerateTextWithHead(
		harness.scenarioContext(t, runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE, modelID),
		harness.service,
		harness.scenarioHead(t, liveSmokeMatrixAppID, liveSmokeMatrixUserID, modelID, 45_000),
	)
	if err != nil {
		maybeSkipStepFunQuotaBlocked(t, providerID, err, nil)
		t.Fatalf("live generate failed: %v", err)
	}
	if strings.TrimSpace(text) == "" {
		t.Fatalf("live generate returned empty output")
	}
}

func runLiveSmokeEmbedForProvider(t *testing.T, providerID string, record providerregistry.ProviderRecord) {
	t.Helper()
	harness := newLiveSmokeProviderHarnessForProvider(t, providerID, record)
	modelID := envModelIDForProvider(t, providerID, "EMBED_MODEL_ID", "MODEL_ID")

	resp, err := harness.service.ExecuteScenario(harness.scenarioContext(t, runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED, modelID), &runtimev1.ExecuteScenarioRequest{
		Head:          harness.scenarioHead(t, liveSmokeMatrixAppID, liveSmokeMatrixUserID, modelID, 45_000),
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextEmbed{
				TextEmbed: &runtimev1.TextEmbedScenarioSpec{Inputs: []string{"Nimi live smoke embed probe."}},
			},
		},
	})
	if err != nil {
		t.Fatalf("live embed failed: %v", err)
	}
	if count := outputVectorCount(resp.GetOutput()); count == 0 {
		t.Fatalf("live embed returned empty vectors")
	}
}

func runLiveSmokeMediaForProvider(t *testing.T, providerID string, record providerregistry.ProviderRecord, scenarioType runtimev1.ScenarioType) {
	t.Helper()
	harness := newLiveSmokeProviderHarnessForProvider(t, providerID, record)
	svc := harness.service

	modelID := ""
	spec := &runtimev1.ScenarioSpec{}
	switch scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE:
		modelID = envModelIDForProvider(t, providerID, "IMAGE_MODEL_ID", "MODEL_ID")
		spec.Spec = &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "A tiny planet above the sea."}}
	case runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE:
		modelID = envModelIDForProvider(t, providerID, "VIDEO_MODEL_ID", "MODEL_ID")
		spec.Spec = &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: liveSmokeVideoGenerateSpec(providerID, modelID)}
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		modelID = envModelIDForProvider(t, providerID, "TTS_MODEL_ID", "MODEL_ID")
		speechText := "Hello from Nimi live smoke."
		language := ""
		audioFormat := ""
		if strings.EqualFold(strings.TrimSpace(providerID), "dashscope") {
			speechText = liveEnvFirstOrDefault("你好，这是 Nimi DashScope CosyVoice live smoke。", "NIMI_LIVE_DASHSCOPE_TTS_TEXT")
			language = liveEnvFirstOrDefault("zh", "NIMI_LIVE_DASHSCOPE_TTS_LANGUAGE")
			audioFormat = liveEnvFirstOrDefault("mp3", "NIMI_LIVE_DASHSCOPE_TTS_AUDIO_FORMAT")
		}
		speechSpec := &runtimev1.SpeechSynthesizeScenarioSpec{Text: speechText, Language: language, AudioFormat: audioFormat}
		if voiceRef := resolveLiveTTSVoiceRef(t, svc, providerID, modelID); voiceRef != "" {
			speechSpec.VoiceRef = &runtimev1.VoiceReference{
				Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET,
				Reference: &runtimev1.VoiceReference_PresetVoiceId{
					PresetVoiceId: voiceRef,
				},
			}
		}
		spec.Spec = &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: speechSpec}
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		modelID = envModelIDForProvider(t, providerID, "STT_MODEL_ID", "MODEL_ID")
		audioSource, mimeType := resolveLiveTranscriptionAudioSource(t)
		spec.Spec = &runtimev1.ScenarioSpec_SpeechTranscribe{SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{
			MimeType:    mimeType,
			AudioSource: audioSource,
		}}
	case runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE:
		modelID = envModelIDForProvider(t, providerID, "MUSIC_MODEL_ID", "MODEL_ID")
		spec.Spec = &runtimev1.ScenarioSpec_MusicGenerate{MusicGenerate: &runtimev1.MusicGenerateScenarioSpec{
			Prompt: "A short cinematic electronic cue with warm synths and a steady pulse.",
			Title:  "Nimi Live Smoke Cue",
		}}
	default:
		t.Fatalf("unsupported media scenario type: %v", scenarioType)
	}
	if scenarioType == runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE {
		maybeSkipFishAudioBalancePreflight(t, svc, providerID, modelID)
	}

	submitResp, err := svc.SubmitScenarioJob(harness.scenarioContext(t, scenarioType, modelID), &runtimev1.SubmitScenarioJobRequest{
		Head:          harness.scenarioHead(t, liveSmokeMatrixAppID, liveSmokeMatrixUserID, modelID, liveSmokeTimeoutMS(scenarioType)),
		ScenarioType:  scenarioType,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec:          spec,
	})
	if err != nil {
		maybeSkipFishAudioBalanceBlocked(t, providerID, err, nil)
		maybeSkipStepFunQuotaBlocked(t, providerID, err, nil)
		t.Fatalf("submit scenario job failed: %v", err)
	}
	if liveSmokeShouldOnlyVerifyAsyncAcceptance(providerID, scenarioType) {
		job := waitLiveSmokeScenarioJobAccepted(t, svc, submitResp.GetJob().GetJobId(), 45*time.Second)
		switch job.GetStatus() {
		case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED:
			return
		default:
			t.Fatalf("scenario job did not enter async accepted state: status=%s reason=%s detail=%s", job.GetStatus().String(), job.GetReasonCode().String(), job.GetReasonDetail())
		}
	}
	job := waitLiveSmokeScenarioJob(t, svc, submitResp.GetJob().GetJobId())
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		maybeSkipFishAudioBalanceBlocked(t, providerID, nil, job)
		maybeSkipStepFunQuotaBlocked(t, providerID, nil, job)
		t.Fatalf(
			"scenario job status not completed: %s reason=%s detail=%s metadata=%v",
			job.GetStatus().String(),
			job.GetReasonCode().String(),
			job.GetReasonDetail(),
			func() map[string]any {
				if job.GetReasonMetadata() == nil {
					return nil
				}
				return job.GetReasonMetadata().AsMap()
			}(),
		)
	}
}

func liveSmokeVideoGenerateSpec(providerID string, modelID string) *runtimev1.VideoGenerateScenarioSpec {
	if strings.EqualFold(strings.TrimSpace(providerID), "volcengine") &&
		strings.Contains(strings.ToLower(strings.TrimSpace(modelID)), "seedance") {
		return &runtimev1.VideoGenerateScenarioSpec{
			Mode: runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE,
			Content: []*runtimev1.VideoContentItem{
				{
					Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT,
					Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT,
					Text: liveEnvFirstOrDefault(liveSmokeVolcengineSeedancePrompt, "NIMI_LIVE_VOLCENGINE_VIDEO_PROMPT", "NIMI_LIVE_VOLCENGINE_SEEDANCE_PROMPT"),
				},
				{
					Type:     runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL,
					Role:     runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE,
					ImageUrl: &runtimev1.VideoContentImageURL{Url: liveEnvFirstOrDefault(liveSmokeVolcengineReferenceImage1, "NIMI_LIVE_VOLCENGINE_VIDEO_REFERENCE_IMAGE_1_URL")},
				},
				{
					Type:     runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL,
					Role:     runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE,
					ImageUrl: &runtimev1.VideoContentImageURL{Url: liveEnvFirstOrDefault(liveSmokeVolcengineReferenceImage2, "NIMI_LIVE_VOLCENGINE_VIDEO_REFERENCE_IMAGE_2_URL")},
				},
				{
					Type:     runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_VIDEO_URL,
					Role:     runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_VIDEO,
					VideoUrl: &runtimev1.VideoContentVideoURL{Url: liveEnvFirstOrDefault(liveSmokeVolcengineReferenceVideo1, "NIMI_LIVE_VOLCENGINE_VIDEO_REFERENCE_VIDEO_1_URL")},
				},
				{
					Type:     runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_AUDIO_URL,
					Role:     runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO,
					AudioUrl: &runtimev1.VideoContentAudioURL{Url: liveEnvFirstOrDefault(liveSmokeVolcengineReferenceAudio1, "NIMI_LIVE_VOLCENGINE_VIDEO_REFERENCE_AUDIO_1_URL")},
				},
			},
			Options: &runtimev1.VideoGenerationOptions{
				DurationSec:     proto.Int32(11),
				Ratio:           "16:9",
				Resolution:      "480p",
				GenerateAudio:   proto.Bool(true),
				ReturnLastFrame: proto.Bool(true),
				Watermark:       proto.Bool(false),
			},
		}
	}

	return &runtimev1.VideoGenerateScenarioSpec{
		Mode:    runtimev1.VideoMode_VIDEO_MODE_T2V,
		Content: []*runtimev1.VideoContentItem{{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT, Text: "A short cinematic scene of sunrise."}},
		Options: &runtimev1.VideoGenerationOptions{DurationSec: proto.Int32(4)},
	}
}
