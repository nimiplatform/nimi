package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/metadata"
)

const liveSmokeMatrixAppID = "nimi.live-smoke.matrix"
const liveSmokeMatrixUserID = "smoke-user"
const liveSmokeVoiceDesignInstruction = "Warm, calm, natural narrator voice with steady pacing, clear diction, low background noise, gentle emotional range, and a polished studio delivery for long-form spoken content."
const liveSmokeVoiceCloneText = "Hello from Nimi live voice clone."
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
	modelCatalog map[string]*runtimev1.ConnectorModelDescriptor
}

func (h liveSmokeProviderHarness) scenarioHead(t *testing.T, appID string, subjectUserID string, modelID string, timeoutMS int32) *runtimev1.ScenarioRequestHead {
	t.Helper()
	head := &runtimev1.ScenarioRequestHead{
		AppId:         appID,
		SubjectUserId: subjectUserID,
		ModelId:       strings.TrimSpace(modelID),
		RoutePolicy:   h.routePolicy,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:     timeoutMS,
	}
	if h.routePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
		head.TargetRef = localScenarioTargetRefForModel(modelID)
		return head
	}
	descriptor := h.connectorModelDescriptor(t, modelID)
	head.ConnectorId = h.connectorID
	head.TargetRef = cloudScenarioTargetRefForDescriptor(h.connectorID, descriptor)
	return head
}

func (h liveSmokeProviderHarness) connectorModelDescriptor(t *testing.T, modelID string) *runtimev1.ConnectorModelDescriptor {
	t.Helper()
	if strings.TrimSpace(h.connectorID) == "" {
		t.Fatalf("live cloud smoke for %s is missing connector identity", h.providerID)
	}
	for _, candidate := range liveSmokeCatalogModelCandidates(h.providerID, modelID) {
		if descriptor := h.modelCatalog[candidate]; descriptor != nil {
			return descriptor
		}
	}
	t.Fatalf("live cloud smoke model %q for provider %s is not admitted by the connector model catalog; set NIMI_LIVE_%s_*_MODEL_ID to a ListConnectorModels model_id/provider_model_id", modelID, h.providerID, liveProviderEnvToken(h.providerID))
	return nil
}

func liveSmokeCatalogModelCandidates(providerID string, modelID string) []string {
	candidates := make([]string, 0, 8)
	add := func(value string) {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			return
		}
		for _, existing := range candidates {
			if existing == trimmed {
				return
			}
		}
		candidates = append(candidates, trimmed)
		lower := strings.ToLower(trimmed)
		if lower != trimmed {
			candidates = append(candidates, lower)
		}
	}
	add(modelID)
	withoutRoute := strings.TrimSpace(modelID)
	for {
		next := strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(withoutRoute, "cloud/"), "token/"))
		if next == withoutRoute {
			break
		}
		withoutRoute = next
		add(withoutRoute)
	}
	if segments := strings.SplitN(withoutRoute, "/", 2); len(segments) == 2 {
		prefix := strings.TrimSpace(segments[0])
		rest := strings.TrimSpace(segments[1])
		if nimillm.ResolveProviderAlias(prefix) == nimillm.ResolveProviderAlias(providerID) {
			add(rest)
		}
	}
	return candidates
}

func TestLiveSmokeCloudScenarioHeadUsesManagedCatalogTargetRef(t *testing.T) {
	harness := liveSmokeProviderHarness{
		providerID:   "openai",
		connectorID:  connector.SystemCloudConnectorID("openai"),
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

	head := harness.scenarioHead(t, liveSmokeMatrixAppID, liveSmokeMatrixUserID, "cloud/gpt-4o-mini", 45_000)

	if head.GetConnectorId() != connector.SystemCloudConnectorID("openai") {
		t.Fatalf("connector_id = %q", head.GetConnectorId())
	}
	cloud := head.GetTargetRef().GetCloud()
	if cloud == nil {
		t.Fatalf("expected cloud targetRef, got %#v", head.GetTargetRef())
	}
	if cloud.GetConnectorId() != connector.SystemCloudConnectorID("openai") {
		t.Fatalf("targetRef connector_id = %q", cloud.GetConnectorId())
	}
	if cloud.GetRemoteModelCatalogId() != "remote-catalog-openai-gpt-4o-mini" {
		t.Fatalf("remote_model_catalog_id = %q", cloud.GetRemoteModelCatalogId())
	}
	if cloud.GetProviderModelId() != "gpt-4o-mini" {
		t.Fatalf("provider_model_id = %q", cloud.GetProviderModelId())
	}
	if cloud.GetProvider() != "openai" {
		t.Fatalf("provider = %q", cloud.GetProvider())
	}
}

func TestLiveSmokeProviderCapabilityMatrix(t *testing.T) {
	for _, providerID := range providerregistry.SourceProviders {
		providerID := providerID
		record, ok := providerregistry.Lookup(providerID)
		if !ok {
			continue
		}
		t.Run(providerID, func(t *testing.T) {
			if record.SupportsText {
				t.Run("generate", func(t *testing.T) { runLiveSmokeGenerateForProvider(t, providerID, record) })
			}
			if record.SupportsEmbed {
				t.Run("embed", func(t *testing.T) { runLiveSmokeEmbedForProvider(t, providerID, record) })
			}
			if record.SupportsImage {
				t.Run("image", func(t *testing.T) {
					runLiveSmokeMediaForProvider(t, providerID, record, runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE)
				})
			}
			if record.SupportsVideo {
				t.Run("video", func(t *testing.T) {
					runLiveSmokeMediaForProvider(t, providerID, record, runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE)
				})
			}
			if record.SupportsTTS {
				t.Run("tts", func(t *testing.T) {
					runLiveSmokeMediaForProvider(t, providerID, record, runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE)
				})
			}
			if record.SupportsSTT {
				t.Run("stt", func(t *testing.T) {
					runLiveSmokeMediaForProvider(t, providerID, record, runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE)
				})
			}
			if record.SupportsMusic {
				t.Run("music", func(t *testing.T) {
					runLiveSmokeMediaForProvider(t, providerID, record, runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE)
				})
			}
			if record.SupportsVoiceClone && providerID != "local" {
				t.Run("voice_clone", func(t *testing.T) {
					runLiveSmokeVoiceWorkflowForProvider(t, providerID, record, runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE)
				})
			}
			if record.SupportsVoiceDesign && providerID != "local" {
				t.Run("voice_design", func(t *testing.T) {
					runLiveSmokeVoiceWorkflowForProvider(t, providerID, record, runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN)
				})
			}
		})
	}
}

func TestLiveSmokeLocalSidecarMusicPromptOnly(t *testing.T) {
	sidecarBaseURL := strings.TrimSpace(os.Getenv("NIMI_LIVE_LOCAL_SIDECAR_BASE_URL"))
	if sidecarBaseURL == "" {
		t.Skip("set NIMI_LIVE_LOCAL_SIDECAR_BASE_URL to run local sidecar music live smoke")
	}
	modelID := liveEnvFirst("NIMI_LIVE_LOCAL_SIDECAR_MUSIC_MODEL_ID", "NIMI_LIVE_LOCAL_MUSIC_MODEL_ID")
	if modelID == "" {
		t.Skip("set NIMI_LIVE_LOCAL_SIDECAR_MUSIC_MODEL_ID or NIMI_LIVE_LOCAL_MUSIC_MODEL_ID to run local sidecar music live smoke")
	}
	record, ok := providerregistry.Lookup("local")
	if !ok || !record.SupportsMusic {
		t.Skip("local provider does not advertise music support")
	}

	harness := newLiveSmokeProviderHarnessForProvider(t, "local", record)
	svc := harness.service
	submitResp, err := svc.SubmitScenarioJob(harness.context, &runtimev1.SubmitScenarioJobRequest{
		Head:          harness.scenarioHead(t, liveSmokeMatrixAppID, liveSmokeMatrixUserID, qualifyLocalSidecarLiveModelID(modelID), 120_000),
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_MusicGenerate{MusicGenerate: &runtimev1.MusicGenerateScenarioSpec{
				Prompt: "A short atmospheric cue with warm pads and a gentle pulse.",
				Title:  "Nimi Local Sidecar Smoke",
			}},
		},
	})
	if err != nil {
		t.Fatalf("submit local sidecar music scenario job failed: %v", err)
	}
	job := waitLiveSmokeScenarioJob(t, svc, submitResp.GetJob().GetJobId())
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("local sidecar music job status not completed: %s reason=%s detail=%s", job.GetStatus().String(), job.GetReasonCode().String(), job.GetReasonDetail())
	}
	artifactsResp, err := svc.GetScenarioArtifacts(scenarioJobContext(liveSmokeMatrixAppID), &runtimev1.GetScenarioArtifactsRequest{
		JobId: submitResp.GetJob().GetJobId(),
	})
	if err != nil {
		t.Fatalf("GetScenarioArtifacts(%s): %v", submitResp.GetJob().GetJobId(), err)
	}
	if len(artifactsResp.GetArtifacts()) == 0 {
		t.Fatalf("local sidecar music live smoke returned no artifacts")
	}
	first := artifactsResp.GetArtifacts()[0]
	if len(first.GetBytes()) == 0 && strings.TrimSpace(first.GetUri()) == "" {
		t.Fatalf("local sidecar music artifact must contain bytes or uri")
	}
	if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(first.GetMimeType())), "audio/") {
		t.Fatalf("local sidecar music artifact mime type must be audio/*, got %q", first.GetMimeType())
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
		return newLiveSmokeLocalProviderHarness(t, providerID)
	}

	envToken := liveProviderEnvToken(providerID)
	baseURL := liveEnvOrDefault(t, "NIMI_LIVE_"+envToken+"_BASE_URL", record.DefaultEndpoint)
	apiKey := requiredLiveProviderAPIKey(t, providerID, envToken)
	return newLiveSmokeCloudProviderHarness(t, providerID, baseURL, apiKey, liveSmokeProviderHeaders(providerID))
}

func newLiveSmokeLocalProviderHarness(t *testing.T, providerID string) liveSmokeProviderHarness {
	t.Helper()
	baseURL := requiredLiveEnv(t, "NIMI_LIVE_LOCAL_BASE_URL")
	apiKey := strings.TrimSpace(os.Getenv("NIMI_LIVE_LOCAL_API_KEY"))
	speechBaseURL := strings.TrimSpace(os.Getenv("NIMI_LIVE_LOCAL_SPEECH_BASE_URL"))
	speechAPIKey := strings.TrimSpace(os.Getenv("NIMI_LIVE_LOCAL_SPEECH_API_KEY"))
	sidecarBaseURL := strings.TrimSpace(os.Getenv("NIMI_LIVE_LOCAL_SIDECAR_BASE_URL"))
	sidecarAPIKey := strings.TrimSpace(os.Getenv("NIMI_LIVE_LOCAL_SIDECAR_API_KEY"))
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{
			"llama":   {BaseURL: baseURL, APIKey: apiKey},
			"media":   {BaseURL: baseURL, APIKey: apiKey},
			"speech":  {BaseURL: firstNonEmptyString(speechBaseURL, baseURL), APIKey: firstNonEmptyString(speechAPIKey, apiKey)},
			"sidecar": {BaseURL: firstNonEmptyString(sidecarBaseURL, baseURL), APIKey: firstNonEmptyString(sidecarAPIKey, apiKey)},
		},
	})
	return liveSmokeProviderHarness{
		service:     svc,
		context:     context.Background(),
		providerID:  providerID,
		routePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
	}
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
	connectorID := connector.SystemCloudConnectorID(normalizedProviderID)
	created, err := store.Create(connector.ConnectorRecord{
		ConnectorID: connectorID,
		Kind:        runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType:   runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM,
		OwnerID:     "system",
		Provider:    normalizedProviderID,
		Endpoint:    normalizedBaseURL,
		Label:       "Cloud " + normalizedProviderID,
		Status:      runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
		AuthKind:    runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_API_KEY,
	}, normalizedAPIKey)
	if err != nil {
		t.Fatalf("create live smoke cloud connector: %v", err)
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
		service:      svc,
		context:      metadata.NewIncomingContext(context.Background(), metadata.Pairs(metadataKeySourceKey, keySourceManaged)),
		providerID:   normalizedProviderID,
		routePolicy:  runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		connectorID:  created.ConnectorID,
		modelCatalog: modelCatalog,
	}
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
	index[trimmed] = descriptor
	lower := strings.ToLower(trimmed)
	if lower != trimmed {
		index[lower] = descriptor
	}
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

func routePolicyForProvider(providerID string) runtimev1.RoutePolicy {
	if providerID == "local" {
		return runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL
	}
	return runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD
}

func qualifyLiveModelIDForRoute(providerID string, modelID string) string {
	modelID = strings.TrimSpace(modelID)
	if modelID == "" || providerID == "local" {
		return modelID
	}
	lower := strings.ToLower(modelID)
	if strings.HasPrefix(lower, "cloud/") || strings.HasPrefix(lower, "token/") || strings.Contains(modelID, "/") {
		return modelID
	}
	return "cloud/" + modelID
}

func qualifyLocalSidecarLiveModelID(modelID string) string {
	normalized := strings.TrimSpace(modelID)
	lower := strings.ToLower(normalized)
	switch {
	case normalized == "":
		return ""
	case strings.HasPrefix(lower, "sidecar/"):
		return normalized
	default:
		return "sidecar/" + normalized
	}
}

func qualifyLocalSpeechLiveModelID(modelID string) string {
	normalized := strings.TrimSpace(modelID)
	lower := strings.ToLower(normalized)
	switch {
	case normalized == "":
		return ""
	case strings.HasPrefix(lower, "speech/"):
		return normalized
	case strings.Contains(normalized, "/"):
		return normalized
	default:
		return "speech/" + normalized
	}
}

func isAdmittedLocalQwen3WorkflowModelID(modelID string) bool {
	normalized := strings.ToLower(strings.TrimSpace(modelID))
	return normalized != "" && (strings.Contains(normalized, "qwen3-tts") || strings.Contains(normalized, "qwen3tts"))
}

func isAdmittedLocalQwen3STTModelID(modelID string) bool {
	normalized := strings.ToLower(strings.TrimSpace(modelID))
	return normalized != "" && (strings.Contains(normalized, "qwen3-asr") || strings.Contains(normalized, "qwen3asr"))
}

func localSpeechHealthURL(baseURL string) string {
	normalized := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if strings.HasSuffix(normalized, "/v1") {
		return strings.TrimSuffix(normalized, "/v1") + "/healthz"
	}
	return normalized + "/healthz"
}

func localSpeechCatalogURL(baseURL string) string {
	normalized := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if strings.HasSuffix(normalized, "/v1") {
		return normalized + "/catalog"
	}
	return normalized + "/v1/catalog"
}

func runLocalSpeechHostPreflight(t *testing.T, baseURL string, apiKey string, modelID string) {
	t.Helper()

	request, err := http.NewRequestWithContext(context.Background(), http.MethodGet, localSpeechHealthURL(baseURL), nil)
	if err != nil {
		t.Fatalf("build local speech health request: %v", err)
	}
	if strings.TrimSpace(apiKey) != "" {
		request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("local speech health preflight failed: %v", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("local speech health preflight status=%d", response.StatusCode)
	}
	var healthPayload map[string]any
	if err := json.NewDecoder(response.Body).Decode(&healthPayload); err != nil {
		t.Fatalf("decode local speech health preflight: %v", err)
	}
	if ready, _ := healthPayload["ready"].(bool); !ready {
		t.Fatalf("local speech health preflight not ready: %#v", healthPayload)
	}

	catalogRequest, err := http.NewRequestWithContext(context.Background(), http.MethodGet, localSpeechCatalogURL(baseURL), nil)
	if err != nil {
		t.Fatalf("build local speech catalog request: %v", err)
	}
	if strings.TrimSpace(apiKey) != "" {
		catalogRequest.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
	}
	catalogResponse, err := http.DefaultClient.Do(catalogRequest)
	if err != nil {
		t.Fatalf("local speech catalog preflight failed: %v", err)
	}
	defer func() { _ = catalogResponse.Body.Close() }()
	if catalogResponse.StatusCode != http.StatusOK {
		t.Fatalf("local speech catalog preflight status=%d", catalogResponse.StatusCode)
	}
	var catalogPayload map[string]any
	if err := json.NewDecoder(catalogResponse.Body).Decode(&catalogPayload); err != nil {
		t.Fatalf("decode local speech catalog preflight: %v", err)
	}
	if ready, _ := catalogPayload["ready"].(bool); !ready {
		t.Fatalf("local speech catalog preflight not ready: %#v", catalogPayload)
	}
	models, _ := catalogPayload["models"].([]any)
	for _, item := range models {
		entry, _ := item.(map[string]any)
		if strings.TrimSpace(nimillm.ValueAsString(entry["id"])) != modelID {
			continue
		}
		if ready, _ := entry["ready"].(bool); !ready {
			t.Fatalf("local speech catalog model %q not ready: %#v", modelID, entry)
		}
		return
	}
	t.Fatalf("local speech catalog missing ready model %q: %#v", modelID, catalogPayload)
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

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
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

func resolveLiveVoiceCloneInput(t *testing.T, providerToken string) *runtimev1.VoiceV2VInput {
	t.Helper()
	liveText := resolveLiveVoiceCloneText(providerToken)
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

func resolveLiveVoiceCloneText(providerToken string) string {
	text := liveEnvFirst(
		"NIMI_LIVE_"+providerToken+"_VOICE_CLONE_TEXT",
		"NIMI_LIVE_VOICE_CLONE_TEXT",
	)
	if text != "" {
		return text
	}
	if strings.EqualFold(strings.TrimSpace(providerToken), "STEPFUN") {
		return liveSmokeVoiceCloneText
	}
	return ""
}

func maybeSkipFishAudioBalanceBlocked(t *testing.T, providerID string, err error, detail string) {
	t.Helper()
	if !strings.EqualFold(strings.TrimSpace(providerID), "fish_audio") {
		return
	}
	message := strings.ToLower(strings.TrimSpace(detail))
	if err != nil {
		message = strings.TrimSpace(message + " " + strings.ToLower(err.Error()))
	}
	if strings.Contains(message, "insufficient balance") || strings.Contains(message, "insufficient credits") {
		if err != nil {
			t.Skipf("fish_audio live smoke skipped due to provider balance block: %v", err)
		}
		t.Skipf("fish_audio live smoke skipped due to provider balance block: %s", strings.TrimSpace(detail))
	}
}

func maybeSkipStepFunQuotaBlocked(t *testing.T, providerID string, err error, detail string) {
	t.Helper()
	if !strings.EqualFold(strings.TrimSpace(providerID), "stepfun") {
		return
	}
	message := strings.ToLower(strings.TrimSpace(detail))
	if err != nil {
		message = strings.TrimSpace(message + " " + strings.ToLower(err.Error()))
	}
	// 'stepfun' live smoke treats quota and rate-limit responses as skip-worthy provider blocks.
	if strings.Contains(message, "quota_exceeded") ||
		strings.Contains(message, "exceeded your current quota") ||
		strings.Contains(message, "billing details") ||
		strings.Contains(message, "insufficient balance") ||
		strings.Contains(message, "available balance") ||
		strings.Contains(message, "resourceexhausted") ||
		strings.Contains(message, "resource exhausted") ||
		strings.Contains(message, "ai_provider_rate_limited") ||
		strings.Contains(message, "replenish_provider_balance_or_skip_live_test") {
		if err != nil {
			t.Skipf("stepfun live smoke skipped due to provider quota block: %v", err)
		}
		t.Skipf("stepfun live smoke skipped due to provider quota block: %s", strings.TrimSpace(detail))
	}
}

func maybeSkipFishAudioBalancePreflight(t *testing.T, svc *Service, providerID string, modelID string) {
	t.Helper()
	if !strings.EqualFold(strings.TrimSpace(providerID), "fish_audio") || svc == nil {
		return
	}

	cfg := svc.resolveNativeAdapterConfig("fish_audio", nil)
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
	request.Header.Set("model", strings.TrimSpace(strings.TrimPrefix(modelID, "cloud/")))
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
	message := strings.ToLower(strings.TrimSpace(nimillm.ProviderErrorMessage(responsePayload)))
	if strings.Contains(message, "insufficient balance") || strings.Contains(message, "insufficient credits") {
		t.Skipf("fish_audio live smoke skipped due to provider balance block: %s", strings.TrimSpace(nimillm.ProviderErrorMessage(responsePayload)))
	}
}

func runLiveSmokeGenerateForProvider(t *testing.T, providerID string, record providerregistry.ProviderRecord) {
	t.Helper()
	harness := newLiveSmokeProviderHarnessForProvider(t, providerID, record)
	modelID := qualifyLiveModelIDForRoute(providerID, envModelIDForProvider(t, providerID, "MODEL_ID", ""))
	text, err := executeLiveSmokeScenarioGenerateTextWithHead(
		harness.context,
		harness.service,
		harness.scenarioHead(t, liveSmokeMatrixAppID, liveSmokeMatrixUserID, modelID, 45_000),
	)
	if err != nil {
		maybeSkipStepFunQuotaBlocked(t, providerID, err, "")
		t.Fatalf("live generate failed: %v", err)
	}
	if strings.TrimSpace(text) == "" {
		t.Fatalf("live generate returned empty output")
	}
}

func runLiveSmokeEmbedForProvider(t *testing.T, providerID string, record providerregistry.ProviderRecord) {
	t.Helper()
	harness := newLiveSmokeProviderHarnessForProvider(t, providerID, record)
	modelID := qualifyLiveModelIDForRoute(providerID, envModelIDForProvider(t, providerID, "EMBED_MODEL_ID", "MODEL_ID"))

	resp, err := harness.service.ExecuteScenario(harness.context, &runtimev1.ExecuteScenarioRequest{
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
		modelID = qualifyLiveModelIDForRoute(providerID, envModelIDForProvider(t, providerID, "IMAGE_MODEL_ID", "MODEL_ID"))
		spec.Spec = &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "A tiny planet above the sea."}}
	case runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE:
		modelID = qualifyLiveModelIDForRoute(providerID, envModelIDForProvider(t, providerID, "VIDEO_MODEL_ID", "MODEL_ID"))
		spec.Spec = &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: liveSmokeVideoGenerateSpec(providerID, modelID)}
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		modelID = qualifyLiveModelIDForRoute(providerID, envModelIDForProvider(t, providerID, "TTS_MODEL_ID", "MODEL_ID"))
		if providerID == "local" {
			modelID = qualifyLocalSpeechLiveModelID(modelID)
		}
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
		modelID = qualifyLiveModelIDForRoute(providerID, envModelIDForProvider(t, providerID, "STT_MODEL_ID", "MODEL_ID"))
		if providerID == "local" {
			modelID = qualifyLocalSpeechLiveModelID(modelID)
		}
		audioSource, mimeType := resolveLiveTranscriptionAudioSource(t)
		spec.Spec = &runtimev1.ScenarioSpec_SpeechTranscribe{SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{
			MimeType:    mimeType,
			AudioSource: audioSource,
		}}
	case runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE:
		modelID = qualifyLiveModelIDForRoute(providerID, envModelIDForProvider(t, providerID, "MUSIC_MODEL_ID", "MODEL_ID"))
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

	submitResp, err := svc.SubmitScenarioJob(harness.context, &runtimev1.SubmitScenarioJobRequest{
		Head:          harness.scenarioHead(t, liveSmokeMatrixAppID, liveSmokeMatrixUserID, modelID, liveSmokeTimeoutMS(scenarioType)),
		ScenarioType:  scenarioType,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec:          spec,
	})
	if err != nil {
		maybeSkipFishAudioBalanceBlocked(t, providerID, err, "")
		maybeSkipStepFunQuotaBlocked(t, providerID, err, "")
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
		maybeSkipFishAudioBalanceBlocked(t, providerID, errors.New(job.GetReasonDetail()), job.GetReasonDetail())
		maybeSkipStepFunQuotaBlocked(t, providerID, errors.New(job.GetReasonDetail()), job.GetReasonDetail())
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
				DurationSec:     11,
				Ratio:           "16:9",
				Resolution:      "480p",
				GenerateAudio:   true,
				ReturnLastFrame: true,
				Watermark:       false,
			},
		}
	}

	return &runtimev1.VideoGenerateScenarioSpec{
		Mode:    runtimev1.VideoMode_VIDEO_MODE_T2V,
		Content: []*runtimev1.VideoContentItem{{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT, Text: "A short cinematic scene of sunrise."}},
		Options: &runtimev1.VideoGenerationOptions{DurationSec: 4},
	}
}
