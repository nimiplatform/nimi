package model

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
)

func modelHealthResponse(
	healthy bool,
	healthStatus runtimev1.ModelHealthStatus,
	reasonCode runtimev1.ReasonCode,
	actionHint string,
	detail string,
	endpoint string,
	modelID string,
) *runtimev1.CheckModelHealthResponse {
	if healthStatus == runtimev1.ModelHealthStatus_MODEL_HEALTH_STATUS_UNSPECIFIED {
		if healthy {
			healthStatus = runtimev1.ModelHealthStatus_MODEL_HEALTH_STATUS_HEALTHY
		} else {
			healthStatus = runtimev1.ModelHealthStatus_MODEL_HEALTH_STATUS_UNREACHABLE
		}
	}
	return &runtimev1.CheckModelHealthResponse{
		Healthy:    healthy,
		ReasonCode: reasonCode,
		ActionHint: strings.TrimSpace(actionHint),
		Status:     healthStatus,
		Detail:     strings.TrimSpace(detail),
		Endpoint:   strings.TrimSpace(endpoint),
		ModelId:    strings.TrimSpace(modelID),
	}
}

func (s *Service) CheckModelHealth(ctx context.Context, req *runtimev1.CheckModelHealthRequest) (*runtimev1.CheckModelHealthResponse, error) {
	appID := strings.TrimSpace(req.GetAppId())
	if appID == "" {
		return modelHealthResponse(false, runtimev1.ModelHealthStatus_MODEL_HEALTH_STATUS_UNREACHABLE, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, "set app_id", "", "", ""), nil
	}

	modelID := strings.TrimSpace(req.GetModelId())
	localAssetID := strings.TrimSpace(req.GetLocalAssetId())
	endpoint := strings.TrimSpace(req.GetEndpoint())
	if modelID == "" && localAssetID == "" && endpoint == "" {
		return modelHealthResponse(false, runtimev1.ModelHealthStatus_MODEL_HEALTH_STATUS_UNREACHABLE, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, "set model_id", "", "", ""), nil
	}

	if localAssetID != "" || isLocalNativeModel(modelregistry.Entry{ModelID: modelID}) {
		if resolved, ok := s.checkLocalModelHealthViaLocalService(ctx, modelID, localAssetID); ok {
			return resolved, nil
		}
	}

	if endpoint != "" {
		return checkEndpointModelHealth(ctx, req), nil
	}

	item, exists := s.registry.Get(modelID)
	if !exists {
		return modelHealthResponse(false, runtimev1.ModelHealthStatus_MODEL_HEALTH_STATUS_UNREACHABLE, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND, "pull model first", "", "", modelID), nil
	}

	if item.Status != runtimev1.ModelStatus_MODEL_STATUS_INSTALLED {
		return modelHealthResponse(false, runtimev1.ModelHealthStatus_MODEL_HEALTH_STATUS_DEGRADED, runtimev1.ReasonCode_AI_MODEL_NOT_READY, "wait for install", "", "", modelID), nil
	}

	projection, err := modelregistry.InferNativeProjection(item.ModelID, item.Capabilities, item.Files, item.Status)
	if err != nil {
		return modelHealthResponse(false, runtimev1.ModelHealthStatus_MODEL_HEALTH_STATUS_DEGRADED, runtimev1.ReasonCode_AI_MODEL_NOT_READY, "repair local model metadata", "", "", modelID), nil
	}
	if isLocalNativeModel(item) {
		probeCtx, cancel := context.WithTimeout(ctx, checkModelHealthProbeTimeout)
		defer cancel()

		if healthy, reasonCode, actionHint := checkLocalNativeModelHealth(probeCtx, item, projection); !healthy {
			return modelHealthResponse(false, runtimev1.ModelHealthStatus_MODEL_HEALTH_STATUS_DEGRADED, reasonCode, actionHint, "", "", modelID), nil
		}
	}

	return modelHealthResponse(true, runtimev1.ModelHealthStatus_MODEL_HEALTH_STATUS_HEALTHY, runtimev1.ReasonCode_ACTION_EXECUTED, "", "", "", modelID), nil
}

func checkEndpointModelHealth(ctx context.Context, req *runtimev1.CheckModelHealthRequest) *runtimev1.CheckModelHealthResponse {
	endpoint := strings.TrimSpace(req.GetEndpoint())
	modelID := strings.TrimSpace(req.GetModelId())
	capability := strings.ToLower(strings.TrimSpace(req.GetCapability()))
	engineLabel := normalizeHealthEngine(req.GetProvider(), modelID)
	plane := healthPlaneForEndpoint(endpoint)

	if engineLabel == "speech" && isVoiceWorkflowHealthCapability(capability) && plane == "local-supervised" {
		return modelHealthResponse(
			false,
			runtimev1.ModelHealthStatus_MODEL_HEALTH_STATUS_UNSUPPORTED,
			runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED,
			"select cloud or attached workflow provider",
			withHealthPlaneDetail(plane, "local workflow health requires capability-scoped readiness and is not admitted on the canonical local speech path"),
			endpoint,
			modelID,
		)
	}

	probeCtx, cancel := context.WithTimeout(ctx, checkModelHealthProbeTimeout)
	defer cancel()

	switch engineLabel {
	case "media", "speech":
		requiredCapabilities := admittedHealthCapabilities(engineLabel, capability)
		if err := probeTargetCatalogHealth(probeCtx, endpoint, engineLabel, requiredCapabilities, modelID); err != nil {
			return modelHealthResponse(
				false,
				runtimev1.ModelHealthStatus_MODEL_HEALTH_STATUS_DEGRADED,
				runtimev1.ReasonCode_AI_MODEL_NOT_READY,
				fmt.Sprintf("start local %s engine", engineLabel),
				healthDetailForEngine(engineLabel, plane, err.Error()),
				endpoint,
				modelID,
			)
		}
		return modelHealthResponse(
			true,
			runtimev1.ModelHealthStatus_MODEL_HEALTH_STATUS_HEALTHY,
			runtimev1.ReasonCode_ACTION_EXECUTED,
			"",
			healthDetailForEngine(engineLabel, plane, ""),
			endpoint,
			modelID,
		)
	default:
		if err := engine.ProbeHealth(probeCtx, endpoint, "/v1/models", ""); err != nil {
			status := runtimev1.ModelHealthStatus_MODEL_HEALTH_STATUS_DEGRADED
			if strings.Contains(strings.ToLower(err.Error()), "health probe failed") {
				status = runtimev1.ModelHealthStatus_MODEL_HEALTH_STATUS_UNREACHABLE
			}
			return modelHealthResponse(false, status, runtimev1.ReasonCode_AI_MODEL_NOT_READY, "start local model endpoint", err.Error(), endpoint, modelID)
		}
		return modelHealthResponse(true, runtimev1.ModelHealthStatus_MODEL_HEALTH_STATUS_HEALTHY, runtimev1.ReasonCode_ACTION_EXECUTED, "", "", endpoint, modelID)
	}
}

func normalizeHealthEngine(provider string, modelID string) string {
	normalized := strings.ToLower(strings.TrimSpace(provider))
	if normalized == "local" {
		return "llama"
	}
	switch normalized {
	case "llama", "media", "speech", "sidecar":
		return normalized
	}
	lowerModel := strings.ToLower(strings.TrimSpace(modelID))
	for _, prefix := range []string{"llama/", "media/", "speech/", "sidecar/"} {
		if strings.HasPrefix(lowerModel, prefix) {
			return strings.TrimSuffix(prefix, "/")
		}
	}
	return normalized
}

func healthPlaneForEndpoint(endpoint string) string {
	parsed, err := url.Parse(strings.TrimSpace(endpoint))
	if err != nil {
		return "unknown"
	}
	host := strings.ToLower(strings.TrimSpace(parsed.Hostname()))
	if host == "localhost" || host == "127.0.0.1" || host == "::1" {
		return "local-supervised"
	}
	if host != "" {
		return "attached-endpoint"
	}
	return "unknown"
}

func withHealthPlaneDetail(plane string, detail string) string {
	normalizedPlane := strings.TrimSpace(plane)
	normalizedDetail := strings.TrimSpace(detail)
	if normalizedPlane == "" || normalizedPlane == "unknown" {
		return normalizedDetail
	}
	if normalizedDetail == "" {
		return "plane=" + normalizedPlane
	}
	return "plane=" + normalizedPlane + "; " + normalizedDetail
}

func healthDetailForEngine(engineLabel string, plane string, detail string) string {
	if engineLabel == "speech" {
		return withHealthPlaneDetail(plane, detail)
	}
	return strings.TrimSpace(detail)
}

func isVoiceWorkflowHealthCapability(value string) bool {
	normalized := strings.ToLower(strings.TrimSpace(value))
	return normalized == "voice_workflow.voice_clone" || normalized == "voice_workflow.voice_design"
}

func admittedHealthCapabilities(engineLabel string, capability string) []string {
	if engineLabel != "speech" {
		return nil
	}
	normalized := strings.ToLower(strings.TrimSpace(capability))
	if normalized == "audio.synthesize" || normalized == "audio.transcribe" {
		return []string{normalized}
	}
	return nil
}

func (s *Service) checkLocalModelHealthViaLocalService(ctx context.Context, modelID string, localAssetID string) (*runtimev1.CheckModelHealthResponse, bool) {
	s.mu.Lock()
	localModel := s.localModel
	s.mu.Unlock()
	if localModel == nil {
		return nil, false
	}

	assets, err := s.listAllLocalAssets(ctx, localModel)
	if err != nil {
		return nil, false
	}
	if len(assets) == 0 {
		return nil, false
	}

	normalizedModelID := strings.TrimSpace(modelID)
	normalizedLocalAssetID := strings.TrimSpace(localAssetID)
	var selected *runtimev1.LocalAssetRecord
	for _, asset := range assets {
		if asset == nil || !localAssetMatchesHealthRequest(asset, normalizedModelID, normalizedLocalAssetID) {
			continue
		}
		if selected == nil || localAssetStatusPriority(asset.GetStatus()) < localAssetStatusPriority(selected.GetStatus()) {
			selected = asset
		}
	}
	if selected == nil {
		return nil, false
	}

	if localSpeechAssetMissingAdmittedPlainCapability(selected) {
		return modelHealthResponse(false, runtimev1.ModelHealthStatus_MODEL_HEALTH_STATUS_DEGRADED, runtimev1.ReasonCode_AI_MODEL_NOT_READY, "repair local model metadata", "", selected.GetEndpoint(), normalizedModelID), true
	}

	switch selected.GetStatus() {
	case runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE:
		switch selected.GetWarmState() {
		case runtimev1.LocalWarmState_LOCAL_WARM_STATE_READY:
			return modelHealthResponse(true, runtimev1.ModelHealthStatus_MODEL_HEALTH_STATUS_HEALTHY, runtimev1.ReasonCode_ACTION_EXECUTED, "", "", selected.GetEndpoint(), normalizedModelID), true
		case runtimev1.LocalWarmState_LOCAL_WARM_STATE_FAILED:
			return modelHealthResponse(false, runtimev1.ModelHealthStatus_MODEL_HEALTH_STATUS_UNREACHABLE, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, "inspect_local_runtime_model_health", strings.TrimSpace(selected.GetHealthDetail()), selected.GetEndpoint(), normalizedModelID), true
		default:
			return modelHealthResponse(false, runtimev1.ModelHealthStatus_MODEL_HEALTH_STATUS_DEGRADED, runtimev1.ReasonCode_AI_MODEL_NOT_READY, "warm local model", "", selected.GetEndpoint(), normalizedModelID), true
		}
	case runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED:
		return modelHealthResponse(false, runtimev1.ModelHealthStatus_MODEL_HEALTH_STATUS_DEGRADED, runtimev1.ReasonCode_AI_MODEL_NOT_READY, "warm local model", "", selected.GetEndpoint(), normalizedModelID), true
	case runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY:
		detail := strings.TrimSpace(selected.GetHealthDetail())
		if isRecoverableSupervisedIdleProbe(detail) {
			return modelHealthResponse(false, runtimev1.ModelHealthStatus_MODEL_HEALTH_STATUS_DEGRADED, runtimev1.ReasonCode_AI_MODEL_NOT_READY, "warm local model", "managed local model ready to warm", selected.GetEndpoint(), normalizedModelID), true
		}
		if detail == "" {
			detail = "runtime local model unhealthy"
		}
		return modelHealthResponse(false, runtimev1.ModelHealthStatus_MODEL_HEALTH_STATUS_UNREACHABLE, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, "inspect_local_runtime_model_health", detail, selected.GetEndpoint(), normalizedModelID), true
	case runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED:
		return modelHealthResponse(false, runtimev1.ModelHealthStatus_MODEL_HEALTH_STATUS_UNREACHABLE, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND, "pull model first", "", selected.GetEndpoint(), normalizedModelID), true
	default:
		return nil, false
	}
}

func (s *Service) listAllLocalAssets(ctx context.Context, localModel localModelLister) ([]*runtimev1.LocalAssetRecord, error) {
	pageToken := ""
	collected := make([]*runtimev1.LocalAssetRecord, 0, 16)
	for i := 0; i < 20; i++ {
		resp, err := localModel.ListLocalAssets(ctx, &runtimev1.ListLocalAssetsRequest{
			StatusFilter: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNSPECIFIED,
			PageSize:     100,
			PageToken:    pageToken,
		})
		if err != nil {
			return nil, err
		}
		collected = append(collected, resp.GetAssets()...)
		pageToken = strings.TrimSpace(resp.GetNextPageToken())
		if pageToken == "" {
			break
		}
	}
	return collected, nil
}

func localAssetStatusPriority(status runtimev1.LocalAssetStatus) int {
	switch status {
	case runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE:
		return 0
	case runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY:
		return 1
	case runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED:
		return 2
	case runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED:
		return 3
	default:
		return 4
	}
}

func localAssetMatchesHealthRequest(asset *runtimev1.LocalAssetRecord, modelID string, localAssetID string) bool {
	if asset == nil {
		return false
	}
	normalizedLocalAssetID := strings.TrimSpace(localAssetID)
	if normalizedLocalAssetID != "" && strings.EqualFold(strings.TrimSpace(asset.GetLocalAssetId()), normalizedLocalAssetID) {
		return true
	}

	normalizedModelID := strings.TrimSpace(modelID)
	if normalizedModelID == "" {
		return false
	}
	candidates := []string{
		asset.GetLogicalModelId(),
		asset.GetAssetId(),
	}
	for _, candidate := range candidates {
		if strings.EqualFold(strings.TrimSpace(candidate), normalizedModelID) {
			return true
		}
		candidateComparable := comparableModelID(candidate)
		requestComparable := comparableModelID(normalizedModelID)
		if candidateComparable != "" && candidateComparable == requestComparable {
			return true
		}
		candidateBase := comparableModelIDBase(candidate)
		requestBase := comparableModelIDBase(normalizedModelID)
		if candidateBase != "" && candidateBase == requestBase {
			return true
		}
	}
	return false
}

func isRecoverableSupervisedIdleProbe(detail string) bool {
	normalized := strings.ToLower(strings.TrimSpace(detail))
	return strings.Contains(normalized, "plane=local-supervised") &&
		strings.Contains(normalized, "connect: connection refused")
}

func isLocalNativeModel(item modelregistry.Entry) bool {
	if strings.EqualFold(strings.TrimSpace(item.Source), "local") {
		return true
	}
	lower := strings.ToLower(strings.TrimSpace(item.ModelID))
	for _, prefix := range []string{"local/", "llama/", "media/", "speech/", "sidecar/"} {
		if strings.HasPrefix(lower, prefix) {
			return true
		}
	}
	return false
}

func checkLocalNativeModelHealth(
	ctx context.Context,
	item modelregistry.Entry,
	projection modelregistry.NativeProjection,
) (bool, runtimev1.ReasonCode, string) {
	if projection.BundleState != runtimev1.LocalBundleState_LOCAL_BUNDLE_STATE_READY {
		return false, runtimev1.ReasonCode_AI_MODEL_NOT_READY, "finish local model install"
	}
	if projection.WarmState == runtimev1.LocalWarmState_LOCAL_WARM_STATE_FAILED {
		return false, runtimev1.ReasonCode_AI_MODEL_NOT_READY, "warm local model"
	}

	preferredEngine := strings.ToLower(strings.TrimSpace(projection.PreferredEngine))
	switch preferredEngine {
	case "llama":
		if projection.WarmState != runtimev1.LocalWarmState_LOCAL_WARM_STATE_READY {
			return false, runtimev1.ReasonCode_AI_MODEL_NOT_READY, "warm local model"
		}
		if err := probeLlamaHealth(ctx); err != nil {
			return false, runtimev1.ReasonCode_AI_MODEL_NOT_READY, "start local llama engine"
		}
	case "media":
		return false, runtimev1.ReasonCode_AI_MODEL_NOT_READY, "inspect_local_runtime_model_health"
	case "speech":
		if err := probeTargetCatalogHealth(ctx, resolveEngineEndpoint("NIMI_RUNTIME_LOCAL_SPEECH_BASE_URL", engine.DefaultSpeechConfig().Endpoint()), "speech", item.Capabilities, projection.LogicalModelID, item.ModelID); err != nil {
			return false, runtimev1.ReasonCode_AI_MODEL_NOT_READY, "start local speech engine"
		}
	case "sidecar":
		if strings.TrimSpace(os.Getenv(localSidecarEndpointEnv)) == "" {
			return false, runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED, "set sidecar endpoint"
		}
		return false, runtimev1.ReasonCode_AI_MODEL_NOT_READY, "validate sidecar availability via a music request"
	}
	return true, runtimev1.ReasonCode_ACTION_EXECUTED, ""
}

func localSpeechAssetMissingAdmittedPlainCapability(asset *runtimev1.LocalAssetRecord) bool {
	if asset == nil || !strings.EqualFold(strings.TrimSpace(asset.GetEngine()), "speech") {
		return false
	}
	for _, capability := range asset.GetCapabilities() {
		switch strings.ToLower(strings.TrimSpace(capability)) {
		case "audio.synthesize", "audio.transcribe":
			return false
		}
	}
	return true
}

func probeLlamaHealth(ctx context.Context) error {
	cfg := engine.DefaultLlamaConfig()
	return engine.ProbeHealth(ctx, resolveEngineEndpoint("NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL", cfg.Endpoint()), cfg.HealthPath, cfg.HealthResponse)
}

func resolveEngineEndpoint(envKey string, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(envKey)); value != "" {
		return value
	}
	return strings.TrimSpace(fallback)
}

func probeTargetCatalogHealth(ctx context.Context, endpoint string, engineLabel string, requiredCapabilities []string, expectedIDs ...string) error {
	normalizedEndpoint := strings.TrimSpace(endpoint)
	if normalizedEndpoint == "" {
		return fmt.Errorf("%s endpoint missing", engineLabel)
	}
	switch engineLabel {
	case "media":
		if err := engine.ProbeMediaHealth(ctx, normalizedEndpoint); err != nil {
			return err
		}
	case "speech":
		if err := engine.ProbeSpeechHealth(ctx, normalizedEndpoint); err != nil {
			return err
		}
	default:
		return fmt.Errorf("unsupported engine probe: %s", engineLabel)
	}

	rows, err := fetchReadyCatalogRows(ctx, normalizedEndpoint)
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		return fmt.Errorf("%s catalog missing ready models", engineLabel)
	}
	hasExpectedID := false
	for _, expected := range expectedIDs {
		if comparableModelID(expected) != "" {
			hasExpectedID = true
			break
		}
	}
	if !hasExpectedID {
		normalizedRequired := normalizeProbeCapabilities(requiredCapabilities)
		if engineLabel == "speech" && len(normalizedRequired) > 0 {
			for _, row := range rows {
				if _, missing := firstMissingProbeCapability(row.capabilities, normalizedRequired); !missing {
					return nil
				}
			}
			return fmt.Errorf("%s catalog missing required capability %q", engineLabel, normalizedRequired[0])
		}
		return nil
	}
	for _, row := range rows {
		if !hasComparableProbeModel([]string{row.id}, expectedIDs...) {
			continue
		}
		if engineLabel == "speech" && len(normalizeProbeCapabilities(requiredCapabilities)) > 0 {
			if missing, ok := firstMissingProbeCapability(row.capabilities, requiredCapabilities); ok {
				return fmt.Errorf("%s catalog missing required capability %q for target model", engineLabel, missing)
			}
		}
		return nil
	}
	return fmt.Errorf("%s catalog missing target model", engineLabel)
}

type readyCatalogRow struct {
	id           string
	capabilities []string
}

func fetchReadyCatalogRows(ctx context.Context, endpoint string) ([]readyCatalogRow, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimSuffix(endpoint, "/")+"/v1/catalog", nil)
	if err != nil {
		return nil, fmt.Errorf("build catalog probe: %w", err)
	}

	resp, err := (&http.Client{Timeout: checkModelHealthProbeTimeout}).Do(req)
	if err != nil {
		return nil, fmt.Errorf("catalog probe failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 128*1024))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("catalog probe returned status %d: %s", resp.StatusCode, string(body))
	}

	payload := struct {
		Models []struct {
			ID           string   `json:"id"`
			Ready        bool     `json:"ready"`
			Capabilities []string `json:"capabilities"`
		} `json:"models"`
	}{}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("catalog probe parse failed: %w", err)
	}

	readyModels := make([]readyCatalogRow, 0, len(payload.Models))
	for _, model := range payload.Models {
		if strings.TrimSpace(model.ID) == "" || !model.Ready {
			continue
		}
		readyModels = append(readyModels, readyCatalogRow{
			id:           strings.TrimSpace(model.ID),
			capabilities: normalizeProbeCapabilities(model.Capabilities),
		})
	}
	return readyModels, nil
}

func normalizeProbeCapabilities(values []string) []string {
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.ToLower(strings.TrimSpace(value))
		if trimmed == "" {
			continue
		}
		normalized = append(normalized, trimmed)
	}
	return normalized
}

func firstMissingProbeCapability(available []string, required []string) (string, bool) {
	normalizedAvailable := normalizeProbeCapabilities(available)
	normalizedRequired := normalizeProbeCapabilities(required)
	for _, capability := range normalizedRequired {
		found := false
		for _, current := range normalizedAvailable {
			if current == capability {
				found = true
				break
			}
		}
		if !found {
			return capability, true
		}
	}
	return "", false
}

func hasComparableProbeModel(models []string, expectedIDs ...string) bool {
	for _, expected := range expectedIDs {
		expectedComparable := comparableModelID(expected)
		expectedBase := comparableModelIDBase(expected)
		if expectedComparable == "" {
			continue
		}
		for _, modelID := range models {
			if comparableModelID(modelID) == expectedComparable {
				return true
			}
			if comparableModelIDBase(modelID) == expectedBase && expectedBase != "" {
				return true
			}
		}
	}
	return false
}

func comparableModelID(value string) string {
	comparable := strings.ToLower(strings.TrimSpace(value))
	for _, prefix := range []string{"models/", "model/", "local/", "llama/", "media/", "speech/", "sidecar/"} {
		comparable = strings.TrimPrefix(comparable, prefix)
	}
	return comparable
}

func comparableModelIDBase(value string) string {
	comparable := comparableModelID(value)
	if idx := strings.Index(comparable, "@"); idx > 0 {
		return strings.TrimSpace(comparable[:idx])
	}
	return comparable
}
